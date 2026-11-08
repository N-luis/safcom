import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore, reassess, MAX_AI_RERUNS_PER_DAY } from '@/lib/caseRecordsServer';
import { logRouteError } from '@/lib/hearingCasesServer';
import { isVawcType } from '@/lib/reportingStats';
import { templateFor, fieldOf, fieldsOf, countNeedsConfirmation, REQUEST_QUESTIONS, type DraftFields } from '@/lib/reportTemplates';
import {
  loadReport, originalOf, versionRow, draftRow, draftChanges, generateDraft, addVersion, materialSinceLastRun, questionsFor, fieldLabel,
  type AddendumField,
} from '@/lib/reportReviewServer';

/**
 * Report Review and Clarification - officials, through the same gate as the
 * case's other records (a VAWC case outside the role does not exist; recording
 * is for the officer it is assigned to). Every look and change is logged.
 *
 *   GET  - the original narrative, every later version, the clarification
 *          requests, recorded interviews and every structured draft.
 *   POST { action } -
 *     request_clarification { items: [{ key, question }], message? }
 *     cancel_request        { requestId, reason }
 *     record_interview      { interviewedAt, contactMethod, questions: [{ question, answer, fieldKey? }], notes?, followUpActions?, safetyConfirmed? }
 *     regenerate            { reason? }   - a new draft; reassesses when new information changes what happened
 *     edit_field            { draftId, key, value, reason }   - an official correction, as a new draft
 *     approve               { draftId, note?, acknowledgeOutstanding? }
 * AI output becomes the official report only through approve.
 */

type Params = { params: Promise<{ id: string }> };
const MAX_DRAFTS_PER_DAY = 15;
const CONTACT_METHODS = ['IN_PERSON', 'PHONE', 'SAFECOMM_MESSAGE', 'HOME_VISIT', 'OTHER'] as const;

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request_clarification'), message: z.string().trim().max(500).optional(),
    items: z.array(z.object({ key: z.string().trim().min(1).max(40), question: z.string().trim().min(5, 'Write each question in full').max(300) })).min(1, 'Choose at least one thing to clarify').max(8) }),
  z.object({ action: z.literal('cancel_request'), requestId: z.string().max(64), reason: z.string().trim().min(3, 'Say why the request is withdrawn').max(300) }),
  z.object({ action: z.literal('record_interview'), interviewedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
    contactMethod: z.enum(CONTACT_METHODS), interviewerId: z.string().max(64).optional(),
    questions: z.array(z.object({ question: z.string().trim().min(3).max(300), answer: z.string().trim().max(2000), fieldKey: z.string().max(40).optional() })).min(1, 'Record at least one question').max(20),
    notes: z.string().trim().max(2000).optional(), followUpActions: z.string().trim().max(1000).optional(), safetyConfirmed: z.boolean().optional() }),
  z.object({ action: z.literal('regenerate'), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('edit_field'), draftId: z.string().max(64), key: z.string().max(40), value: z.string().trim().max(1000), reason: z.string().trim().min(3, 'Say why the field is corrected').max(300) }),
  z.object({ action: z.literal('approve'), draftId: z.string().max(64), note: z.string().trim().max(1000).optional(), acknowledgeOutstanding: z.boolean().optional() }),
]);

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return (uid: string | null | undefined) => (uid && users.find(u => u.id === uid)?.name) || null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'report_review');
  if ('error' in g) return g.error;
  try {
    const c = await loadReport(id);
    if (!c) return errorResponse('Case not found', 404);
    const [requests, interviews] = await Promise.all([
      prisma.clarificationRequest.findMany({ where: { caseId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.caseInterview.findMany({ where: { caseId: id }, orderBy: { interviewedAt: 'desc' } }),
    ]);
    const name = await names([...requests.map(r => r.requestedById), ...requests.map(r => r.cancelledById), ...interviews.flatMap(i => [i.interviewerId, i.recordedById]),
      ...c.reportDrafts.flatMap(d => [d.createdById, d.approvedById]), ...c.reportAddenda.map(a => a.actorUserId)]);
    const drafts = c.reportDrafts.map(d => ({ ...draftRow(d), createdBy: d.createdById ? name(d.createdById) : d.createdByResident ? 'Created after the resident\'s update' : 'SafeComm', approvedBy: name(d.approvedById) }));
    const latest = drafts[0] ?? null;
    const template = templateFor(c.caseType);
    const material = materialSinceLastRun(c);
    const officials = await prisma.user.findMany({ where: { role: { not: 'system_admin' }, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }).catch(() => []);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      caseNumber: c.caseNumber, template, vawc: isVawcType(c.caseType), canEdit: g.access.edit,
      residentLinked: Boolean(c.residentId), contactPreference: isVawcType(c.caseType) ? c.contactPreference : null,
      original: { text: originalOf(c), filedAt: c.filedAt },
      versions: c.reportAddenda.map(a => ({ ...versionRow(a), by: a.residentId ? 'The resident' : name(a.actorUserId) ?? 'An official' })),
      drafts, latestDraft: latest,
      changes: latest ? draftChanges(latest.fields, drafts[1]?.fields ?? null, template) : [],
      approved: drafts.find(d => d.status === 'APPROVED') ?? null,
      requests: requests.map(r => ({ ...r, requestedBy: name(r.requestedById), cancelledBy: name(r.cancelledById) })),
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

    if (d.action === 'record_interview') {
      // A VAWC reporter who asked not to be phoned: an official confirms the call was arranged safely.
      if (vawc && d.contactMethod === 'PHONE' && c.contactPreference === 'no_phone' && !d.safetyConfirmed) {
        return errorResponse('The reporter asked not to be called. Confirm the call was arranged safely with them, or record another contact method.', 409);
      }
      const when = new Date(d.interviewedAt.length === 16 ? `${d.interviewedAt}:00+08:00` : d.interviewedAt);
      if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60_000) return errorResponse('The interview date cannot be in the future.', 400);
      const interviewer = d.interviewerId || me;
      for (const q of d.questions) if (q.fieldKey && !fieldOf(template, q.fieldKey)) return errorResponse('A question is linked to a field that is not on this report.', 400);
      const out = await prisma.$transaction(async tx => {
        const iv = await tx.caseInterview.create({ data: { caseId: id, interviewedAt: when, contactMethod: d.contactMethod, interviewerId: interviewer,
          questions: d.questions.map(q => ({ question: q.question, answer: q.answer, fieldKey: q.fieldKey ?? null })), notes: d.notes || null,
          followUpActions: d.followUpActions || null, recordedById: me } });
        // The answers become a report version, so the next draft can use them - marked as from an interview.
        const fields: AddendumField[] = d.questions.filter(q => q.answer.trim()).map((q, i) => q.fieldKey
          ? { key: q.fieldKey, label: fieldOf(template, q.fieldKey)!.label, value: q.answer }
          : { key: `q_interview_${i + 1}`, label: q.question, value: q.answer });
        const v = await addVersion(tx, { caseId: id, source: 'INTERVIEW', fields, text: d.notes || null, actorUserId: me, interviewId: iv.id });
        await tx.activity.create({ data: { type: 'report_interview', message: `Interview recorded by ${myName} (report version ${v.version})`,
          entityId: iv.id, entityType: 'CaseInterview', userId: me, caseId: id, color: '#0369a1' } });
        return { interviewId: iv.id, version: v.version };
      });
      await g.log('permitted', `${g.access.code}:interview`);
      return noStore({ success: true, data: out }, 201);
    }

    if (d.action === 'regenerate') {
      const recent = await prisma.reportDraft.count({ where: { caseId: id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (recent >= MAX_DRAFTS_PER_DAY) return errorResponse('This report has been redrafted many times today. Try again tomorrow.', 429);
      // New information that changes what happened: run the existing assessment again first. Its
      // result is a history row for an officer to confirm - the case's category and level stay as they are.
      const material = materialSinceLastRun(c);
      let reassessment: Record<string, unknown> | null = null;
      if (material.length) {
        const reruns = await prisma.assessmentHistory.count({ where: { caseId: id, kind: 'ai_reassessment', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
        if (reruns < MAX_AI_RERUNS_PER_DAY) {
          const newInformation = material.map(a => `[Version ${a.version}] ${[a.text, ...(a.fields as unknown as AddendumField[]).filter(f => !f.skipped && f.value).map(f => `${f.label}: ${f.value}`)].filter(Boolean).join(' / ')}`).join('\n');
          const before = await prisma.assessmentHistory.findFirst({ where: { caseId: id, kind: 'ai_reassessment' }, orderBy: { createdAt: 'desc' }, select: { matrixLevel: true, caseType: true } });
          const r = await reassess(g.c, { ...g.actor, name: myName }, { reason: `New information in report version${material.length === 1 ? '' : 's'} ${material.map(a => a.version).join(', ')}`, newInformation });
          const after = await prisma.assessmentHistory.findUnique({ where: { id: r.historyId }, select: { matrixLevel: true, matrixLabel: true, caseType: true, createdAt: true, rationale: true } });
          reassessment = { historyId: r.historyId, at: after?.createdAt, versions: material.map(a => a.version),
            before: before ? { level: before.matrixLevel, category: before.caseType } : { level: null, category: c.caseType },
            after: { level: after?.matrixLevel ?? null, label: after?.matrixLabel ?? null, category: after?.caseType ?? null },
            references: ((after?.rationale ?? {}) as { references?: unknown }).references ?? [], flaggedUrgent: r.flaggedUrgent,
            note: 'Advisory - the case\'s official category and risk level are unchanged until an officer reviews this.' };
        } else reassessment = { skipped: `The AI assessment has been re-run ${MAX_AI_RERUNS_PER_DAY} times today.` };
      }
      const draft = await generateDraft(id, { useAi: true, by: { userId: me }, chargeTo: `staff:${me}`, reason: d.reason || 'Regenerated by an official', extraMeta: reassessment ? { reassessment } : {} });
      await prisma.activity.create({ data: { type: 'report_draft', message: `Report draft ${draft.draftNumber} generated by ${myName} (${draft.generator === 'ai' ? 'SafeComm AI' : `records only - AI ${draft.aiStatus}`})`,
        entityId: draft.id, entityType: 'ReportDraft', userId: me, caseId: id, color: '#0f766e' } });
      await g.log('permitted', `${g.access.code}:draft_regenerate`);
      return noStore({ success: true, data: { draftNumber: draft.draftNumber, generator: draft.generator, aiStatus: draft.aiStatus, reassessment } }, 201);
    }

    if (d.action === 'edit_field') {
      const latest = c.reportDrafts[0];
      if (!latest || latest.id !== d.draftId || latest.status !== 'DRAFT') return errorResponse('Only the latest draft can be corrected. Reload to see it.', 409);
      const f = fieldOf(template, d.key);
      if (!f || d.key === 'narrative' || d.key === 'description') return errorResponse('That field cannot be edited here - the original narrative is never changed.', 400);
      const fields = { ...(latest.fields as unknown as DraftFields), [d.key]: { value: d.value || null, status: d.value ? 'OFFICIAL' : 'NEEDS_CONFIRMATION', source: 'official_edit', note: d.reason } } as DraftFields;
      const row = await prisma.$transaction(async tx => {
        await tx.reportDraft.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
        return tx.reportDraft.create({ data: { caseId: id, draftNumber: latest.draftNumber + 1, basedOnVersion: latest.basedOnVersion, template: latest.template,
          fields: JSON.parse(JSON.stringify(fields)), summary: latest.summary, generator: 'official_edit', aiStatus: latest.aiStatus, model: latest.model,
          needsConfirmation: countNeedsConfirmation(fields), meta: { editedField: d.key, previousDraft: latest.draftNumber, reason: d.reason }, createdById: me } });
      });
      await g.log('permitted', `${g.access.code}:draft_edit`);
      return noStore({ success: true, data: { draftNumber: row.draftNumber } }, 201);
    }

    // approve
    const latest = c.reportDrafts[0];
    if (!latest || latest.id !== d.draftId) return errorResponse('Only the latest draft can be approved. Reload to see it.', 409);
    if (latest.status !== 'DRAFT') return errorResponse('This draft is already approved or superseded.', 409);
    if (latest.needsConfirmation > 0 && !(d.acknowledgeOutstanding && (d.note ?? '').length >= 5)) {
      return errorResponse(`${latest.needsConfirmation} field${latest.needsConfirmation === 1 ? ' still needs' : 's still need'} confirmation. Confirm you reviewed them and add a note to approve anyway.`, 409);
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
