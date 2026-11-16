import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore, reassess, MAX_AI_RERUNS_PER_DAY, type RecordsCase } from '@/lib/caseRecordsServer';
import { logRouteError } from '@/lib/hearingCasesServer';
import { isVawcType } from '@/lib/reportingStats';
import {
  templateFor, fieldOf, fieldsOf, countNeedsConfirmation, REQUEST_QUESTIONS, FIELD_MARKERS, requiredKeys, needsAttention,
  type DraftFields, type DraftField, type FieldStatus,
} from '@/lib/reportTemplates';
import { interviewFieldOf, checkAnswer } from '@/lib/interviewAnswers';
import {
  loadReport, originalOf, versionRow, draftRow, generateDraft, addVersion, materialSinceLastRun, questionsFor, fieldLabel, fieldChanges,
  type AddendumField, type LoadedReport,
} from '@/lib/reportReviewServer';

/**
 * Report Review and Clarification - officials, through the same gate as the
 * case's other records (a VAWC case outside the role does not exist; recording
 * is for the officer it is assigned to). Every look and change is logged.
 * An internal SafeComm documentation step - not a Katarungang Pambarangay
 * proceeding or a government form, and it decides no eligibility.
 *
 *   GET  - the original narrative, every later version, the requests and
 *          interviews, every draft, what still needs attention, and the
 *          field-by-field changes since the first draft.
 *   POST { action } -
 *     request_clarification { items: [{ key, question }], message? }
 *     cancel_request        { requestId, reason }   - an unanswered request is withdrawn
 *     review_request        { requestId }           - an official starts reviewing the resident's response
 *     complete_request      { requestId, note? }    - the clarification is done
 *   A request's own progress, apart from the case status: OPEN (awaiting the
 *   resident) -> ANSWERED -> IN_REVIEW -> COMPLETED, or CANCELLED.
 *     record_interview      { interviewedAt, contactMethod, questions: [{ question, answer, fieldKey? }], notes?, followUpActions?, safetyConfirmed? }
 *                           - also redrafts the report with the answers, and re-runs the
 *                             AI assessment when they change what happened
 *     edit_field            { draftId, key, value?, marker?, reason? }   - an official's value, as a new draft
 *     confirm_field         { draftId, key }   - an official confirms the value shown, as a new draft
 *     approve               { draftId, note?, acknowledgeOutstanding? }
 * AI output becomes the official report only through approve.
 */

type Params = { params: Promise<{ id: string }> };
const CONTACT_METHODS = ['IN_PERSON', 'PHONE', 'SAFECOMM_MESSAGE', 'HOME_VISIT', 'OTHER'] as const;
const MARKERS = ['unknown', 'declined', 'na'] as const;

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request_clarification'), message: z.string().trim().max(500).optional(),
    items: z.array(z.object({ key: z.string().trim().min(1).max(40), question: z.string().trim().min(5, 'Write each question in full').max(300) })).min(1, 'Choose at least one thing to clarify').max(8) }),
  z.object({ action: z.literal('cancel_request'), requestId: z.string().max(64), reason: z.string().trim().min(3, 'Say why the request is withdrawn').max(300) }),
  z.object({ action: z.literal('review_request'), requestId: z.string().max(64) }),
  z.object({ action: z.literal('complete_request'), requestId: z.string().max(64), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('record_interview'), interviewedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
    contactMethod: z.enum(CONTACT_METHODS), interviewerId: z.string().max(64).optional(),
    questions: z.array(z.object({ question: z.string().trim().min(3).max(300), answer: z.string().trim().max(2000), fieldKey: z.string().max(40).optional() })).min(1, 'Record at least one question').max(20),
    notes: z.string().trim().max(2000).optional(), followUpActions: z.string().trim().max(1000).optional(), safetyConfirmed: z.boolean().optional() }),
  z.object({ action: z.literal('edit_field'), draftId: z.string().max(64), key: z.string().max(40), value: z.string().trim().max(1000).optional(),
    marker: z.enum(MARKERS).optional(), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('confirm_field'), draftId: z.string().max(64), key: z.string().max(40) }),
  z.object({ action: z.literal('approve'), draftId: z.string().max(64), note: z.string().trim().max(1000).optional(), acknowledgeOutstanding: z.boolean().optional() }),
]);

/** The report versions that are a resident's response to a clarification request. */
const responseVersionsOf = (c: LoadedReport) => new Set(c.reportAddenda.filter(a => a.source === 'RESIDENT_CLARIFICATION').map(a => a.version));

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return (uid: string | null | undefined) => (uid && users.find(u => u.id === uid)?.name) || null;
}

/**
 * The draft always follows the case's template: with no draft yet, or after
 * the case moved desks (Blotter <-> VAWC), a draft is made from the records -
 * no AI call here; the retry job adds the AI's organizing later.
 */
async function ensureCurrentDraft(c: LoadedReport): Promise<LoadedReport> {
  const latest = c.reportDrafts[0];
  if (latest && latest.template === templateFor(c.caseType)) return c;
  await generateDraft(c.id, { useAi: false, by: {}, chargeTo: 'system:report-drafts', reason: latest ? 'The case type changed - the draft follows its template' : 'First draft' });
  return (await loadReport(c.id))!;
}

/** New information that changes what happened: the existing AI assessment runs again - advisory only. */
async function reassessIfMaterial(c: LoadedReport, rc: RecordsCase, actor: { id: string; role: string; active: boolean }, myName: string) {
  const material = materialSinceLastRun(c);
  if (!material.length) return null;
  const reruns = await prisma.assessmentHistory.count({ where: { caseId: c.id, kind: 'ai_reassessment', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (reruns >= MAX_AI_RERUNS_PER_DAY) return { skipped: `The AI assessment has been re-run ${MAX_AI_RERUNS_PER_DAY} times today.` };
  const newInformation = material.map(a => `[Version ${a.version}] ${[a.text, ...(a.fields as unknown as AddendumField[]).filter(f => !f.skipped && f.value).map(f => `${f.label}: ${f.value}`)].filter(Boolean).join(' / ')}`).join('\n');
  const before = await prisma.assessmentHistory.findFirst({ where: { caseId: c.id, kind: 'ai_reassessment' }, orderBy: { createdAt: 'desc' }, select: { matrixLevel: true, caseType: true } });
  const r = await reassess(rc, { ...actor, name: myName }, { reason: `New information in report version${material.length === 1 ? '' : 's'} ${material.map(a => a.version).join(', ')}`, newInformation });
  const after = await prisma.assessmentHistory.findUnique({ where: { id: r.historyId }, select: { matrixLevel: true, matrixLabel: true, caseType: true, createdAt: true, rationale: true } });
  return { historyId: r.historyId, at: after?.createdAt, versions: material.map(a => a.version),
    before: before ? { level: before.matrixLevel, category: before.caseType } : { level: null, category: c.caseType },
    after: { level: after?.matrixLevel ?? null, label: after?.matrixLabel ?? null, category: after?.caseType ?? null },
    references: ((after?.rationale ?? {}) as { references?: unknown }).references ?? [], flaggedUrgent: r.flaggedUrgent,
    note: 'Advisory - the case\'s official category and risk level are unchanged until an officer reviews this.' };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'report_review');
  if ('error' in g) return g.error;
  try {
    let c = await loadReport(id);
    if (!c) return errorResponse('Case not found', 404);
    c = await ensureCurrentDraft(c);
    const [requests, interviews] = await Promise.all([
      prisma.clarificationRequest.findMany({ where: { caseId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.caseInterview.findMany({ where: { caseId: id }, orderBy: { interviewedAt: 'desc' } }),
    ]);
    const name = await names([...requests.flatMap(r => [r.requestedById, r.cancelledById, r.reviewStartedById, r.completedById]), ...interviews.flatMap(i => [i.interviewerId, i.recordedById]),
      ...c.reportDrafts.flatMap(d => [d.createdById, d.approvedById]), ...c.reportAddenda.map(a => a.actorUserId)]);
    const createdBy = (d: LoadedReport['reportDrafts'][number]) => (d.createdById ? name(d.createdById) : d.createdByResident ? 'After the resident\'s update' : null);
    const drafts = c.reportDrafts.map(d => ({ ...draftRow(d), createdBy: createdBy(d) ?? (d.generator === 'ai' ? 'SafeComm AI' : 'SafeComm'), approvedBy: name(d.approvedById) }));
    const latest = drafts[0] ?? null;
    const template = templateFor(c.caseType);
    const material = materialSinceLastRun(c);
    const officials = await prisma.user.findMany({ where: { role: { not: 'system_admin' }, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }).catch(() => []);
    // The drafts in this template, oldest first - what Review Changes compares.
    const sameTemplate = [...c.reportDrafts].reverse().filter(d => d.template === template)
      .map(d => ({ fields: d.fields as unknown as DraftFields, createdAt: d.createdAt, createdBy: createdBy(d), generator: d.generator }));
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      caseNumber: c.caseNumber, template, vawc: isVawcType(c.caseType), canEdit: g.access.edit,
      residentLinked: Boolean(c.residentId), contactPreference: isVawcType(c.caseType) ? c.contactPreference : null,
      original: { text: originalOf(c), filedAt: c.filedAt },
      versions: c.reportAddenda.map(a => ({ ...versionRow(a), by: a.residentId ? 'The resident' : name(a.actorUserId) ?? 'An official' })),
      drafts, latestDraft: latest,
      required: requiredKeys(template),
      attention: latest && latest.template === template ? needsAttention(template, latest.fields, responseVersionsOf(c)) : [],
      changes: fieldChanges(template, sameTemplate),
      approved: drafts.find(d => d.status === 'APPROVED') ?? null,
      // Each request with the resident's response, as they sent it (a report version of its own).
      requests: requests.map(r => {
        const a = r.addendumId ? c.reportAddenda.find(x => x.id === r.addendumId) : null;
        return { ...r, requestedBy: name(r.requestedById), cancelledBy: name(r.cancelledById), reviewStartedBy: name(r.reviewStartedById), completedBy: name(r.completedById),
          response: a ? { version: a.version, text: a.text, fields: a.fields as unknown as AddendumField[], at: a.createdAt } : null };
      }),
      interviews: interviews.map(i => ({ ...i, interviewer: name(i.interviewerId), recordedBy: name(i.recordedById) })),
      // What could still be asked of the resident, from the latest draft's gaps.
      suggestions: [
        ...(latest ? fieldsOf(template).filter(f => latest.fields[f.key]?.status === 'NEEDS_CONFIRMATION' && f.from.includes('ai') && REQUEST_QUESTIONS[f.key])
          .map(f => ({ key: f.key, label: f.label, question: REQUEST_QUESTIONS[f.key] })) : []),
        ...questionsFor(c, latest?.fields ?? null).filter(q => q.optional).map(q => ({ key: q.key, label: q.question, question: q.question })),
      ].filter((s, i, a) => a.findIndex(x => x.key === s.key) === i),
      reassessDue: material.map(a => a.version),
      officials,
    } });
  } catch (e) {
    logRouteError('GET /api/cases/[id]/report-review', e);
    return errorResponse('The report review could not be loaded right now.', 503);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'report_review');
  if ('error' in g) return g.error;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  const d = parsed.data;
  const me = g.actor.id;
  const myName = (await prisma.user.findUnique({ where: { id: me }, select: { name: true } }))?.name ?? 'an official';
  try {
    const c = await loadReport(id);
    if (!c) return errorResponse('Case not found', 404);
    const template = templateFor(c.caseType);
    const vawc = isVawcType(c.caseType);

    if (d.action === 'request_clarification') {
      // Only to the resident who filed - in SafeComm, never by text or call.
      if (!c.residentId) return errorResponse('This report was not filed through a resident account. Record an interview instead.', 409);
      const open = await prisma.clarificationRequest.count({ where: { caseId: id, status: 'OPEN' } });
      if (open >= 3) return errorResponse('Three requests are already waiting for the resident. Withdraw one or wait for an answer.', 409);
      const items = d.items.map(i => ({ key: i.key, label: fieldOf(template, i.key)?.label ?? fieldLabel(template, i.key), question: i.question }));
      const r = await prisma.$transaction(async tx => {
        const row = await tx.clarificationRequest.create({ data: { caseId: id, requestedById: me, items, message: d.message || null } });
        // The resident's notice is in general words (lib/notifications residentNotice) - never the questions.
        await tx.activity.create({ data: { type: 'clarification_request', message: `More information requested from the reporter by ${myName} (${items.length} item${items.length === 1 ? '' : 's'})`,
          entityId: row.id, entityType: 'ClarificationRequest', userId: me, caseId: id, color: '#0369a1' } });
        return row;
      });
      await g.log('permitted', `${g.access.code}:clarification_request`);
      return noStore({ success: true, data: { id: r.id } }, 201);
    }

    if (d.action === 'cancel_request') {
      const r = await prisma.clarificationRequest.findFirst({ where: { id: d.requestId, caseId: id } });
      if (!r) return errorResponse('Not found', 404);
      if (r.status !== 'OPEN') return errorResponse('That request is already closed.', 409);
      await prisma.clarificationRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelledById: me, cancelledAt: new Date(), cancelReason: d.reason } });
      await g.log('permitted', `${g.access.code}:clarification_cancel`);
      return noStore({ success: true });
    }

    if (d.action === 'review_request' || d.action === 'complete_request') {
      const r = await prisma.clarificationRequest.findFirst({ where: { id: d.requestId, caseId: id } });
      if (!r) return errorResponse('Not found', 404);
      const now = new Date();
      if (d.action === 'review_request') {
        if (r.status !== 'ANSWERED') return errorResponse(r.status === 'OPEN' ? 'The resident has not responded yet.' : 'This response is already under review or closed.', 409);
        await prisma.$transaction(async tx => {
          await tx.clarificationRequest.update({ where: { id: r.id }, data: { status: 'IN_REVIEW', reviewStartedAt: now, reviewStartedById: me } });
          await tx.activity.create({ data: { type: 'clarification_review', message: `Resident's clarification response under review by ${myName}`,
            entityId: r.id, entityType: 'ClarificationRequest', userId: me, caseId: id, color: '#0369a1' } });
        });
      } else {
        if (r.status !== 'ANSWERED' && r.status !== 'IN_REVIEW') return errorResponse(r.status === 'OPEN' ? 'The resident has not responded yet - withdraw the request instead.' : 'This request is already closed.', 409);
        await prisma.$transaction(async tx => {
          await tx.clarificationRequest.update({ where: { id: r.id }, data: { status: 'COMPLETED', completedAt: now, completedById: me, completionNote: d.note || null,
            ...(r.reviewStartedAt ? {} : { reviewStartedAt: now, reviewStartedById: me }) } });
          await tx.activity.create({ data: { type: 'clarification_completed', message: `Clarification marked complete by ${myName}`,
            entityId: r.id, entityType: 'ClarificationRequest', userId: me, caseId: id, color: '#15803d' } });
        });
      }
      await g.log('permitted', `${g.access.code}:${d.action === 'review_request' ? 'clarification_review' : 'clarification_complete'}`);
      return noStore({ success: true });
    }

    if (d.action === 'record_interview') {
      // A VAWC reporter who asked not to be phoned: an official confirms the call was arranged safely.
      if (vawc && d.contactMethod === 'PHONE' && c.contactPreference === 'no_phone' && !d.safetyConfirmed) {
        return errorResponse('The reporter asked not to be called. Confirm the call was arranged safely with them, or record another contact method.', 409);
      }
      const when = new Date(d.interviewedAt.length === 16 ? `${d.interviewedAt}:00+08:00` : d.interviewedAt);
      if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60_000) return errorResponse('The interview date cannot be in the future.', 400);
      const interviewer = d.interviewerId || me;
      // A linked answer fills a field of the official form, written the way that form item is answered.
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const linked = new Set<string>();
      for (const q of d.questions) {
        if (!q.fieldKey) continue;
        if (linked.has(q.fieldKey)) return errorResponse('Two answers fill the same field - keep one, or add the other as information.', 400);
        linked.add(q.fieldKey);
        const f = interviewFieldOf(template, q.fieldKey);
        if (!f || !fieldOf(template, q.fieldKey)) return errorResponse('A question is linked to a field that is not on this report.', 400);
        const bad = checkAnswer(f, q.answer, today);
        if (bad) return errorResponse(`${f.label} (${f.section}): ${bad}`, 400);
      }
      const out = await prisma.$transaction(async tx => {
        const iv = await tx.caseInterview.create({ data: { caseId: id, interviewedAt: when, contactMethod: d.contactMethod, interviewerId: interviewer,
          questions: d.questions.map(q => ({ question: q.question, answer: q.answer, fieldKey: q.fieldKey ?? null })), notes: d.notes || null,
          followUpActions: d.followUpActions || null, recordedById: me } });
        // The answers become a report version, kept apart from the original narrative and marked as from an interview.
        const fields: AddendumField[] = d.questions.filter(q => q.answer.trim()).map((q, i) => q.fieldKey
          ? { key: q.fieldKey, label: fieldOf(template, q.fieldKey)!.label, value: q.answer }
          : { key: `q_interview_${i + 1}`, label: q.question, value: q.answer });
        const v = await addVersion(tx, { caseId: id, source: 'INTERVIEW', fields, text: d.notes || null, actorUserId: me, interviewId: iv.id });
        await tx.activity.create({ data: { type: 'report_interview', message: `Interview recorded by ${myName} (report version ${v.version})`,
          entityId: iv.id, entityType: 'CaseInterview', userId: me, caseId: id, color: '#0369a1' } });
        return { interviewId: iv.id, version: v.version };
      });
      await g.log('permitted', `${g.access.code}:interview`);
      // The report is redrafted with the answers at once, and when they change what happened the
      // existing AI assessment runs again (advisory - the case's category and level stay until reviewed).
      // Neither can undo the interview, which is already saved.
      let reassessment: Awaited<ReturnType<typeof reassessIfMaterial>> = null;
      let draft: { draftNumber: number; generator: string; aiStatus: string | null } | null = null;
      try {
        const fresh = (await loadReport(id))!;
        reassessment = await reassessIfMaterial(fresh, g.c, g.actor, myName);
        const made = await generateDraft(id, { useAi: true, by: { userId: me }, chargeTo: `staff:${me}`, reason: `Interview recorded (version ${out.version})`, extraMeta: reassessment ? { reassessment } : {} });
        draft = { draftNumber: made.draftNumber, generator: made.generator, aiStatus: made.aiStatus };
        await prisma.activity.create({ data: { type: 'report_draft', message: `Report draft ${made.draftNumber} updated with the interview (${made.generator === 'ai' ? 'SafeComm AI' : 'records'})`,
          entityId: made.id, entityType: 'ReportDraft', userId: me, caseId: id, color: '#0f766e' } });
      } catch (e) { logRouteError('record_interview: redraft', e); }
      return noStore({ success: true, data: { ...out, draft, reassessment } }, 201);
    }

    if (d.action === 'edit_field' || d.action === 'confirm_field') {
      const latest = c.reportDrafts[0];
      if (!latest || latest.id !== d.draftId) return errorResponse('The report changed since you opened it. Reload to see the latest draft.', 409);
      if (latest.status !== 'DRAFT') return errorResponse('This report is approved. It changes only when new information makes a new draft.', 409);
      const f = fieldOf(template, d.key);
      if (!f || d.key === 'narrative' || d.key === 'description') return errorResponse('That field cannot be changed here - the original narrative is never changed.', 400);
      const prev = (latest.fields as unknown as DraftFields)[d.key] ?? { value: null, status: 'NEEDS_CONFIRMATION' as FieldStatus, source: null };
      const stamp = { by: me, byName: myName, at: new Date().toISOString() };
      let next: DraftField;
      if (d.action === 'confirm_field') {
        if (!prev.value) return errorResponse('There is no value to confirm - enter it, or mark it Unknown, Declined or N/A.', 400);
        if (prev.status === 'OFFICIAL') return errorResponse('Already confirmed.', 409);
        next = { value: prev.value, status: 'OFFICIAL', source: 'official_confirm', quote: prev.quote ?? null, note: null, confirmedFrom: prev.status, ...stamp };
      } else {
        const value = d.marker ? FIELD_MARKERS[d.marker] : (d.value ?? '');
        // Empty: the field goes back to needing confirmation - nothing is invented in its place.
        next = value
          ? { value, status: 'OFFICIAL', source: 'official_edit', note: d.reason || null, marker: d.marker ?? null, ...stamp }
          : { value: null, status: 'NEEDS_CONFIRMATION', source: null, note: d.reason || null, ...stamp };
      }
      const fields = { ...(latest.fields as unknown as DraftFields), [d.key]: next } as DraftFields;
      // A new draft; the previous one is kept, superseded - never changed.
      const row = await prisma.$transaction(async tx => {
        await tx.reportDraft.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
        return tx.reportDraft.create({ data: { caseId: id, draftNumber: latest.draftNumber + 1, basedOnVersion: latest.basedOnVersion, template: latest.template,
          fields: JSON.parse(JSON.stringify(fields)), summary: latest.summary, generator: 'official_edit', aiStatus: latest.aiStatus, model: latest.model,
          needsConfirmation: countNeedsConfirmation(fields),
          meta: { [d.action === 'confirm_field' ? 'confirmedField' : 'editedField']: d.key, previousDraft: latest.draftNumber, reason: d.action === 'edit_field' ? d.reason ?? null : null }, createdById: me } });
      });
      await g.log('permitted', `${g.access.code}:${d.action === 'confirm_field' ? 'draft_confirm' : 'draft_edit'}`);
      return noStore({ success: true, data: { draftNumber: row.draftNumber, field: next } }, 201);
    }

    // approve
    const latest = c.reportDrafts[0];
    if (!latest || latest.id !== d.draftId) return errorResponse('Only the latest draft can be approved. Reload to see it.', 409);
    if (latest.status !== 'DRAFT') return errorResponse('This draft is already approved or superseded.', 409);
    if (latest.template !== template) return errorResponse('The case type changed. Reload to see the draft in its template.', 409);
    const fields = latest.fields as unknown as DraftFields;
    // The form's required items need a value or one of its markers - nothing is approved as complete while one is open.
    const missing = requiredKeys(template).filter(k => (fields[k]?.status ?? 'NEEDS_CONFIRMATION') === 'NEEDS_CONFIRMATION');
    if (missing.length) {
      return noStore({ success: false, code: 'required_missing', missing: missing.map(k => fieldOf(template, k)!.label),
        error: `Still needed before approval: ${missing.map(k => fieldOf(template, k)!.label).join(', ')}. Record them, mark them Unknown, Declined or N/A, or keep the draft and continue clarifying.` }, 409);
    }
    const unconfirmed = needsAttention(template, fields, responseVersionsOf(c)).filter(a => a.reason !== 'missing');
    if (unconfirmed.length && !d.acknowledgeOutstanding) {
      return noStore({ success: false, code: 'unconfirmed', items: unconfirmed.map(a => a.label),
        error: `Check these before approving: ${unconfirmed.map(a => a.label).join(', ')}.` }, 409);
    }
    await prisma.$transaction(async tx => {
      await tx.reportDraft.updateMany({ where: { caseId: id, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await tx.reportDraft.update({ where: { id: latest.id }, data: { status: 'APPROVED', approvedById: me, approvedAt: new Date(), approvalNote: d.note || null } });
      await tx.activity.create({ data: { type: 'report_approved', message: `Official report approved by ${myName} (draft ${latest.draftNumber}, based on report version ${latest.basedOnVersion})`,
        entityId: latest.id, entityType: 'ReportDraft', userId: me, caseId: id, color: '#15803d' } });
    });
    await g.log('permitted', `${g.access.code}:report_approve`);
    return noStore({ success: true, data: { draftNumber: latest.draftNumber } });
  } catch (e) {
    logRouteError(`POST /api/cases/[id]/report-review (${d.action})`, e);
    return errorResponse('That could not be saved right now. Nothing was changed.', 503);
  }
}
