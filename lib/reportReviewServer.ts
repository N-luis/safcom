/**
 * Report review, on the server: a report's versions, its structured drafts,
 * the questions still worth asking, and what an official does with them.
 *
 * The original narrative is version 1 and is never changed. Everything added
 * later is a ReportAddendum (version 2, 3, ...). A draft is built from all of
 * it - the case's records, direct answers, and SafeComm AI's reading of the
 * resident's words (lib/reportStandardizer.ts) - and is kept when the next one
 * supersedes it. Only an official's approval makes a draft the official
 * report; nothing here changes the case's category or risk level.
 */
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { analyzeIntake } from './intake';
import { RELATIONSHIP_LABEL, type ReportingRelationship } from './interviewTypes';
import { REFERRAL_AGENCIES, ANSWER_LABEL, type YesNoUnknownAnswer } from './caseRecords';
import { SEX_AT_BIRTH } from './victimSurvivors';
import {
  templateFor, fieldsOf, fieldOf, countNeedsConfirmation, EXTRA_QUESTIONS, type TemplateName, type DraftFields, type DraftField, type ExtraQuestion,
} from './reportTemplates';
import {
  buildDraftFields, checkProposals, aiStandardize, blocksForAi, type SourceBlock, type RecordedValue, type FieldAnswer,
} from './reportStandardizer';
import type { ReadDeps } from './aiClassifier';

export const MAX_ADDENDA_PER_DAY = 10;
export const ADDENDUM_SOURCES = ['RESIDENT_CORRECTION', 'RESIDENT_ADDITION', 'RESIDENT_CLARIFICATION', 'RESIDENT_ANSWERS', 'INTERVIEW'] as const;
export type AddendumSource = (typeof ADDENDUM_SOURCES)[number];
export const SOURCE_LABEL: Record<AddendumSource, string> = {
  RESIDENT_CORRECTION: 'Correction by the resident',
  RESIDENT_ADDITION: 'Information added by the resident',
  RESIDENT_CLARIFICATION: 'Clarification by the resident',
  RESIDENT_ANSWERS: 'Answers to follow-up questions',
  INTERVIEW: 'Recorded interview',
};
const AI_TRANSIENT = ['busy', 'rate_limited', 'error', 'daily_limit', 'resident_limit'];

export interface AddendumField { key: string; label: string; value?: string; skipped?: boolean }

const dateText = (d: Date) => d.toISOString().slice(0, 10);
const phDateTime = (d: Date) => d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Everything a draft is built from - never a contact detail. */
export async function loadReport(caseId: string) {
  return prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, filedAt: true, description: true, barangay: true, locationLabel: true,
      incidentDate: true, incidentTimeApprox: true, witnessInfo: true, reportingRelationship: true, affectedPersonNote: true,
      reporterIdentityWithheld: true, residentId: true, residentName: true, assignedToId: true, contactPreference: true, triageStatus: true,
      assignedTo: { select: { name: true } },
      intake: { select: { narrative: true, turns: true, immediateSafetyConcern: true } },
      parties: { select: { role: true, source: true, fullName: true, age: true, address: true, relationship: true }, orderBy: { createdAt: 'asc' } },
      safetyAssessment: { select: { immediateConcern: true, urgentAssistance: true, dependentsAffected: true, updatedAt: true } },
      referrals: { select: { agency: true, agencyOther: true, status: true } },
      followUps: { where: { type: 'intervention' }, select: { id: true } },
      attachments: { select: { id: true } },
      victimSurvivors: { where: { removedAt: null }, select: { sexAtBirth: true } },
      officialIntake: { select: { formType: true, status: true, responses: true } },
      assessmentHistory: { where: { kind: { in: ['category_confirm', 'category_change', 'ai_reassessment'] } }, orderBy: { createdAt: 'desc' },
        select: { kind: true, caseType: true, createdAt: true } },
      reportAddenda: { orderBy: { version: 'asc' } },
      reportDrafts: { orderBy: { draftNumber: 'desc' } },
    },
  });
}
export type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>;

/** The original narrative - version 1, exactly as filed. */
export const originalOf = (c: LoadedReport) => c.intake?.narrative ?? c.description;

/** What the case already records, by template field. Each with where it came from. */
export function recordsOf(c: LoadedReport, template: TemplateName): Record<string, RecordedValue> {
  const r: Record<string, RecordedValue> = {};
  const set = (k: string, v: string | null | undefined, status: RecordedValue['status']) => { if (v && v.trim()) r[k] = { value: v.trim(), status }; };
  // The official's record of a person wins over the reporter's account of them.
  const party = (role: 'AFFECTED' | 'REPORTED') => c.parties.find(p => p.role === role && p.source === 'official') ?? c.parties.find(p => p.role === role) ?? null;
  const partyStatus = (role: 'AFFECTED' | 'REPORTED') => (party(role)?.source === 'official' ? 'OFFICIAL' : 'RESIDENT_CONFIRMED') as RecordedValue['status'];
  const rel = (c.reportingRelationship ?? 'SELF') as ReportingRelationship;
  const affected = party('AFFECTED'), reported = party('REPORTED');
  const reviewed = c.assessmentHistory.find(h => h.kind === 'category_confirm' || h.kind === 'category_change');
  const danger = c.safetyAssessment?.immediateConcern === 'yes' || c.intake?.immediateSafetyConcern || c.triageStatus === 'URGENT_REVIEW';
  const where = [c.locationLabel, c.barangay].filter(Boolean).join(' - ');
  // What the resident gave on the report form itself.
  set('incidentDate', c.incidentDate ? dateText(c.incidentDate) : null, 'RESIDENT_CONFIRMED');
  set('incidentTime', c.incidentTimeApprox, 'RESIDENT_CONFIRMED');
  set('incidentLocation', where || null, 'RESIDENT_CONFIRMED');
  set('witnesses', c.witnessInfo, 'RESIDENT_CONFIRMED');

  if (template === 'BLOTTER') {
    set('blotterReferenceNo', c.caseNumber, 'RECORDED');
    set('recordedDate', dateText(new Date(c.filedAt.getTime() + 8 * 3600_000)), 'RECORDED');
    set('recordedTime', c.filedAt.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }), 'RECORDED');
    set('assignedOfficer', c.assignedTo?.name ?? null, 'RECORDED');
    set('complainantName', c.reporterIdentityWithheld ? 'Withheld - filed without identifying the reporter' : c.residentName, 'RECORDED');
    set('complainantRelationship', RELATIONSHIP_LABEL[rel]?.en ?? null, 'RESIDENT_CONFIRMED');
    // Reporting about themselves, there is no one else affected to relate to - and nothing for the AI to fill.
    if (rel === 'SELF') set('complainantRelationshipNote', 'Not applicable - the reporter is the person affected', 'RECORDED');
    else set('complainantRelationshipNote', affected?.relationship ?? c.affectedPersonNote, affected ? partyStatus('AFFECTED') : 'RESIDENT_CONFIRMED');
    set('respondentName', reported?.fullName, partyStatus('REPORTED'));
    set('respondentAge', reported?.age != null ? String(reported.age) : null, partyStatus('REPORTED'));
    set('respondentAddress', reported?.address, partyStatus('REPORTED'));
    set('respondentRelationship', reported?.relationship, partyStatus('REPORTED'));
    set('incidentCategory', reviewed ? reviewed.caseType ?? c.caseType : null, 'OFFICIAL');
    set('immediateDanger', danger ? 'Yes - flagged for urgent review' : c.safetyAssessment ? 'No' : null, c.safetyAssessment ? 'OFFICIAL' : 'RECORDED');
    set('attachments', c.attachments.length ? `${c.attachments.length} photo${c.attachments.length === 1 ? '' : 's'} attached by the reporter` : null, 'RECORDED');
  } else {
    set('incidentNo', c.caseNumber, 'RECORDED');
    set('dateReported', dateText(new Date(c.filedAt.getTime() + 8 * 3600_000)), 'RECORDED');
    set('reportingMode', rel === 'SELF' ? 'Reported by the victim-survivor' : 'Reported by an informant or companion', 'RESIDENT_CONFIRMED');
    set('informantName', rel === 'SELF' ? 'The victim-survivor (the reporter)' : c.reporterIdentityWithheld ? 'Withheld - filed without identifying the reporter' : c.residentName, 'RECORDED');
    if (rel === 'SELF') set('informantRelationship', 'Not applicable - reported by the victim-survivor', 'RECORDED');
    else set('informantRelationship', affected?.relationship ?? c.affectedPersonNote, affected ? partyStatus('AFFECTED') : 'RESIDENT_CONFIRMED');
    set('victimName', rel === 'SELF' ? (c.reporterIdentityWithheld ? 'The reporter (identity withheld)' : c.residentName) : affected?.fullName,
      rel === 'SELF' ? 'RECORDED' : partyStatus('AFFECTED'));
    const sex = c.victimSurvivors.find(v => v.sexAtBirth)?.sexAtBirth;
    set('sexAtBirth', sex ? SEX_AT_BIRTH[sex as keyof typeof SEX_AT_BIRTH] : null, 'OFFICIAL');
    set('age', rel !== 'SELF' && affected?.age != null ? String(affected.age) : null, partyStatus('AFFECTED'));
    const intake = c.officialIntake?.formType === 'VAWC_INTAKE' && c.officialIntake.status === 'COMPLETED' ? c.officialIntake.responses as Record<string, { value?: unknown }> : null;
    const violence = Array.isArray(intake?.typeOfViolence?.value) ? (intake!.typeOfViolence!.value as string[]) : [];
    set('typeOfViolence', violence.length ? `${violence.length} form${violence.length === 1 ? '' : 's'} recorded on the completed intake form` : null, 'OFFICIAL');
    set('perpName', reported?.fullName, partyStatus('REPORTED'));
    set('perpAge', reported?.age != null ? String(reported.age) : null, partyStatus('REPORTED'));
    set('perpRelationship', reported?.relationship, partyStatus('REPORTED'));
    set('immediateDanger', danger ? 'Yes - flagged for urgent review' : c.safetyAssessment ? 'No' : null, c.safetyAssessment ? 'OFFICIAL' : 'RECORDED');
    const s = c.safetyAssessment;
    set('safetyAssessment', s ? `Immediate concern: ${ANSWER_LABEL[s.immediateConcern as YesNoUnknownAnswer] ?? s.immediateConcern}; urgent assistance: ${ANSWER_LABEL[s.urgentAssistance as YesNoUnknownAnswer] ?? s.urgentAssistance}` : null, 'OFFICIAL');
    set('referrals', c.referrals.length ? c.referrals.map(x => `${x.agency === 'OTHER' ? x.agencyOther ?? 'Other' : REFERRAL_AGENCIES[x.agency as keyof typeof REFERRAL_AGENCIES]?.label ?? x.agency} (${x.status.toLowerCase()})`).join('; ') : null, 'OFFICIAL');
    set('interventions', c.followUps.length ? `${c.followUps.length} recorded` : null, 'OFFICIAL');
  }
  return r;
}

/** The report as written, for SafeComm AI: version 1 with the answers given before filing, then each later version. */
export function blocksOf(c: LoadedReport): SourceBlock[] {
  const turns = Array.isArray(c.intake?.turns) ? c.intake!.turns as { topic?: string; text?: string | null; value?: string | null }[] : [];
  const before = turns.flatMap(t => (t?.text?.trim() ? [`${t.topic ?? 'Answer'}: ${t.text.trim()}`] : []));
  const blocks: SourceBlock[] = [{ version: 1, label: 'ORIGINAL REPORT', by: 'resident',
    text: [originalOf(c), ...(before.length ? ['', 'Answers given before submitting:', ...before] : [])].join('\n') }];
  for (const a of c.reportAddenda) {
    const fields = (a.fields as unknown as AddendumField[]).filter(f => !f.skipped && f.value?.trim());
    const text = [a.text?.trim() ?? '', ...fields.map(f => `${f.label}: ${f.value}`)].filter(Boolean).join('\n');
    if (text) blocks.push({ version: a.version, label: SOURCE_LABEL[a.source as AddendumSource] ?? a.source, by: a.source === 'INTERVIEW' ? 'official' : 'resident', text });
  }
  return blocks;
}

/** The direct answers to template fields in later versions. */
export function answersOf(c: LoadedReport): FieldAnswer[] {
  return c.reportAddenda.flatMap(a => (a.fields as unknown as AddendumField[])
    .filter(f => !f.skipped && f.value?.trim() && !f.key.startsWith('q_'))
    .map(f => ({ key: f.key, value: f.value!.trim(), version: a.version, by: a.source === 'INTERVIEW' ? 'official' as const : 'resident' as const })));
}

/** What later versions added to the narrative, kept apart from the original. */
export function additionsOf(c: LoadedReport) {
  return c.reportAddenda.flatMap(a => {
    const extras = (a.fields as unknown as AddendumField[]).filter(f => f.key.startsWith('q_') && !f.skipped && f.value?.trim()).map(f => `${f.label} ${f.value}`);
    const text = [a.text?.trim(), ...extras].filter(Boolean).join('\n');
    return text ? [{ version: a.version, source: SOURCE_LABEL[a.source as AddendumSource] ?? a.source, text }] : [];
  });
}

export const latestVersion = (c: { reportAddenda: { version: number }[] }) => c.reportAddenda.reduce((m, a) => Math.max(m, a.version), 1);

/**
 * The follow-up questions still worth asking the resident: a template field
 * the latest draft still needs, with a neutral question - and the optional
 * extras, once. Anything answered or skipped before is not asked again.
 * Nothing about the person responsible or anyone's identity is asked here.
 */
export function questionsFor(c: LoadedReport, draft: DraftFields | null) {
  const template = templateFor(c.caseType);
  const seen = new Set(c.reportAddenda.flatMap(a => (a.fields as unknown as AddendumField[]).map(f => f.key)));
  const out: { key: string; question: string; kind: 'text' | 'date' | 'time'; optional: boolean }[] = [];
  for (const f of fieldsOf(template)) {
    if (!f.ask || seen.has(f.key)) continue;
    if (draft && draft[f.key] && draft[f.key].status !== 'NEEDS_CONFIRMATION') continue;
    out.push({ key: f.key, question: f.ask.question, kind: f.ask.kind, optional: false });
  }
  const short = originalOf(c).trim().length < 160;
  for (const k of Object.keys(EXTRA_QUESTIONS) as ExtraQuestion[]) {
    if (seen.has(k) || (k === 'q_clarify' && !short)) continue;
    out.push({ key: k, question: EXTRA_QUESTIONS[k], kind: 'text', optional: true });
  }
  return out;
}

/** The fields an official corrected on the latest draft - carried into the next one. */
function carriedFrom(c: LoadedReport): Record<string, DraftField> {
  const latest = c.reportDrafts[0];
  if (!latest) return {};
  const f = latest.fields as unknown as DraftFields;
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v.status === 'OFFICIAL' && v.source === 'official_edit'));
}

/**
 * A new structured draft from everything the report holds. With useAi, one
 * Groq call (charged to whoever asked) - without it, or when the AI is
 * unavailable, the same draft from the records and direct answers alone,
 * every other field NEEDS_CONFIRMATION. The previous draft is superseded,
 * not changed; an approved one stays approved until another is approved.
 */
export async function generateDraft(caseId: string, opts: { useAi: boolean; by: { userId?: string; residentId?: string }; chargeTo: string; reason?: string; deps?: ReadDeps; extraMeta?: Record<string, unknown> }) {
  const c = await loadReport(caseId);
  if (!c) throw new Error('not_found');
  const template = templateFor(c.caseType);
  const blocks = blocksOf(c);
  const names = c.reporterIdentityWithheld ? [] : c.residentName.split(/\s+/);
  let ai: Awaited<ReturnType<typeof aiStandardize>> | null = null;
  if (opts.useAi) ai = await aiStandardize(template, blocksForAi(blocks, names), opts.chargeTo, opts.deps);
  const usable = ai && (ai.status === 'ok' || ai.status === 'cached');
  // Without a new AI reading, the values the last AI reading found (each
  // already checked against the resident's words, which are never changed)
  // are kept - so a records-only draft does not throw away what was read.
  const previous = c.reportDrafts.find(d => d.generator === 'ai');
  const previousAi = !usable && previous
    ? Object.fromEntries(Object.entries(previous.fields as unknown as DraftFields)
      .filter(([, v]) => ['ORIGINAL', 'NEW', 'UNVERIFIED'].includes(v.status) && /^v\d+$/.test(v.source ?? '') && v.quote))
    : null;
  const checked = usable ? checkProposals(template, ai!.proposals, blocksForAi(blocks, names))
    : previousAi ? { accepted: previousAi, notes: {}, dropped: 0 } : null;
  const narrativeKey = template === 'BLOTTER' ? 'narrative' : 'description';
  const fields = buildDraftFields({ template, records: recordsOf(c, template), answers: answersOf(c), ai: checked, carried: carriedFrom(c),
    narrativeKey, original: originalOf(c), additions: additionsOf(c) });
  // A neutral organized label for the complaint, clearly marked as the AI's.
  const nature = usable ? ai!.complaintNature : previous ? (previous.fields as unknown as DraftFields).complaintNature : null;
  if (template === 'BLOTTER' && fields.complaintNature?.status === 'NEEDS_CONFIRMATION' && nature) {
    fields.complaintNature = typeof nature === 'string'
      ? { value: nature, status: 'AI_ORGANIZED', source: 'ai', note: 'Worded by SafeComm AI - not the resident\'s words' }
      : nature.status === 'AI_ORGANIZED' ? nature : fields.complaintNature;
  }
  const summary = usable ? ai!.summary : previous?.summary ?? null;
  const basedOnVersion = latestVersion(c);
  return prisma.$transaction(async tx => {
    const n = (await tx.reportDraft.aggregate({ where: { caseId }, _max: { draftNumber: true } }))._max.draftNumber ?? 0;
    await tx.reportDraft.updateMany({ where: { caseId, status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });
    return tx.reportDraft.create({ data: {
      caseId, draftNumber: n + 1, basedOnVersion, template, fields: fields as unknown as Prisma.InputJsonValue,
      summary,
      generator: usable ? 'ai' : 'rules', aiStatus: ai ? ai.status : 'not_requested', model: usable ? ai?.model ?? null : previousAi ? previous!.model : null,
      needsConfirmation: countNeedsConfirmation(fields),
      meta: JSON.parse(JSON.stringify({ version: '1', reason: opts.reason ?? null, droppedAiValues: usable ? checked?.dropped ?? 0 : 0,
        ...(previousAi ? { aiValuesFromDraft: previous!.draftNumber } : {}), ...(opts.extraMeta ?? {}) })) as Prisma.InputJsonValue,
      createdById: opts.by.userId ?? null, createdByResident: opts.by.residentId ?? null,
    } });
  });
}

/** Create a draft without letting a failure reach the caller - the report is already safe. */
export async function draftQuietly(caseId: string, opts: Parameters<typeof generateDraft>[1]) {
  try { return await generateDraft(caseId, opts); } catch { return null; }
}

/** Add a version to the report. Retries once if two land at the same moment (the version number is unique). */
export async function addVersion(tx: Prisma.TransactionClient, data: {
  caseId: string; source: AddendumSource; fields: AddendumField[]; text?: string | null; reason?: string | null;
  residentId?: string | null; actorUserId?: string | null; requestId?: string | null; interviewId?: string | null;
}) {
  const max = (await tx.reportAddendum.aggregate({ where: { caseId: data.caseId }, _max: { version: true } }))._max.version ?? 1;
  const material = Boolean(data.text?.trim()) || data.fields.some(f => f.key.startsWith('q_') && !f.skipped && f.value?.trim());
  return tx.reportAddendum.create({ data: {
    caseId: data.caseId, version: max + 1, previousVersion: max, source: data.source, fields: data.fields as unknown as Prisma.InputJsonValue,
    text: data.text?.trim() || null, reason: data.reason?.trim() || null, residentId: data.residentId ?? null, actorUserId: data.actorUserId ?? null,
    requestId: data.requestId ?? null, interviewId: data.interviewId ?? null, material,
  } });
}

/**
 * Whether new words describe someone in danger now - the rules alone, so it
 * works without Groq. The emergency path never waits for the AI.
 */
export function signalsDanger(text: string): boolean {
  if (!text.trim()) return false;
  try { return analyzeIntake({ narrative: text, answers: [] }).result.immediateSafetyConcern; } catch { return false; }
}

/** Raise the case to urgent review because of what a resident just added. */
export async function flagUrgentFromResident(tx: Prisma.TransactionClient, c: { id: string; caseNumber: string; triageStatus: string | null; assignedToId: string | null }) {
  if (c.triageStatus === 'URGENT_REVIEW') return false;
  await tx.case.update({ where: { id: c.id }, data: { triageStatus: 'URGENT_REVIEW', requiresOfficerReview: true } });
  await tx.activity.create({ data: { type: 'urgent', message: 'New information from the resident describes an immediate safety concern - flagged for urgent review',
    entityId: c.id, entityType: 'Case', caseId: c.id, color: '#dc2626' } });
  if (c.assignedToId) await tx.notification.create({ data: { title: `Urgent: case ${c.caseNumber}`, message: 'New information from the resident describes an immediate safety concern.', type: 'error', userId: c.assignedToId, caseId: c.id } });
  return true;
}

/** What an official sees about a version - the resident's wording kept as given. */
export function versionRow(a: LoadedReport['reportAddenda'][number]) {
  return { id: a.id, version: a.version, previousVersion: a.previousVersion, source: a.source, sourceLabel: SOURCE_LABEL[a.source as AddendumSource] ?? a.source,
    fields: a.fields as unknown as AddendumField[], text: a.text, reason: a.reason, material: a.material, by: a.residentId ? 'resident' : 'official',
    requestId: a.requestId, interviewId: a.interviewId, createdAt: a.createdAt };
}

export function draftRow(d: LoadedReport['reportDrafts'][number]) {
  return { id: d.id, draftNumber: d.draftNumber, basedOnVersion: d.basedOnVersion, template: d.template, fields: d.fields as unknown as DraftFields,
    summary: d.summary, generator: d.generator, aiStatus: d.aiStatus, model: d.model, needsConfirmation: d.needsConfirmation, status: d.status,
    meta: d.meta, createdAt: d.createdAt, approvedAt: d.approvedAt, approvalNote: d.approvalNote, approvedById: d.approvedById };
}

/**
 * The resident's view of a draft: their own report organized - without what
 * officials recorded (safety assessment, referrals, interventions, interview
 * notes, the official category) or anything only an official may see.
 */
export function residentDraftView(d: LoadedReport['reportDrafts'][number] | undefined) {
  if (!d) return null;
  const template = d.template as TemplateName;
  const fields = d.fields as unknown as DraftFields;
  const hidden = new Set(['Initial safety assessment', 'Intervention and referral information', 'Initial action and supporting documentation']);
  // Officers are never named to a resident (as on their timeline and notices).
  const hiddenKeys = new Set(['assignedOfficer']);
  const rows = fieldsOf(template).filter(f => !hidden.has(f.section) && !hiddenKeys.has(f.key) && !f.from.every(x => x === 'official')).map(f => {
    const v = fields[f.key];
    const official = v?.status === 'OFFICIAL' || (v?.status === 'NEW' && v.note === 'From a recorded interview');
    return { key: f.key, label: f.label, section: f.section, status: official ? 'OFFICIAL' : v?.status ?? 'NEEDS_CONFIRMATION',
      value: official ? null : v?.value ?? null, additions: v?.additions?.filter(x => x.source !== SOURCE_LABEL.INTERVIEW) ?? undefined };
  });
  return { draftNumber: d.draftNumber, template, summary: d.summary, generator: d.generator, createdAt: d.createdAt, status: d.status, rows };
}

/** Field-by-field differences between two drafts - for "Review changes". */
export function draftChanges(newer: DraftFields, older: DraftFields | null, template: TemplateName) {
  return fieldsOf(template).flatMap(f => {
    const a = newer[f.key], b = older?.[f.key];
    const added = (a?.additions?.length ?? 0) - (b?.additions?.length ?? 0);
    if (a?.value === b?.value && a?.status === b?.status && added <= 0) return [];
    return [{ key: f.key, label: f.label, before: b ? { value: b.value, status: b.status } : null, after: { value: a?.value ?? null, status: a?.status ?? 'NEEDS_CONFIRMATION' },
      addedText: added > 0 ? a!.additions!.slice(-added).map(x => `v${x.version}: ${x.text}`) : [] }];
  });
}

/**
 * Re-run the existing AI assessment when versions added since the last run
 * change what the report says happened. The result is a new history row -
 * the case's category and level are not touched (lib/caseRecordsServer reassess).
 */
export function materialSinceLastRun(c: LoadedReport) {
  const lastRun = c.assessmentHistory.find(h => h.kind === 'ai_reassessment')?.createdAt ?? c.filedAt;
  return c.reportAddenda.filter(a => a.material && a.createdAt > lastRun);
}

/** For the cron: AI drafts that could not be made because the AI was busy or down. */
export async function retryPendingDrafts(limit = 3, onlyCaseIds?: string[]) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  // The current draft of a report is records-only - the AI was busy or down,
  // or its after-filing pass never ran - and no AI draft covers its version.
  const candidates = await prisma.reportDraft.findMany({
    where: { status: 'DRAFT', generator: 'rules', aiStatus: { in: [...AI_TRANSIENT, 'not_requested'] }, createdAt: { gte: since }, ...(onlyCaseIds ? { caseId: { in: onlyCaseIds } } : {}) },
    orderBy: { createdAt: 'asc' }, take: limit * 5, select: { caseId: true, basedOnVersion: true, case: { select: { caseNumber: true } } },
  });
  const rows: typeof candidates = [];
  for (const r of candidates) {
    if (rows.length >= limit) break;
    const covered = await prisma.reportDraft.count({ where: { caseId: r.caseId, generator: 'ai', basedOnVersion: { gte: r.basedOnVersion } } });
    if (!covered) rows.push(r);
  }
  const results: { caseNumber: string; outcome: string }[] = [];
  for (const r of rows) {
    const d = await draftQuietly(r.caseId, { useAi: true, by: {}, chargeTo: 'system:report-drafts', reason: 'Retried after the AI was unavailable' });
    results.push({ caseNumber: r.case.caseNumber, outcome: d ? `${d.generator} (${d.aiStatus})` : 'failed' });
  }
  return results;
}

export const fieldLabel = (template: TemplateName, key: string) =>
  fieldOf(template, key)?.label ?? (key in EXTRA_QUESTIONS ? EXTRA_QUESTIONS[key as ExtraQuestion] : key);
export { phDateTime };
