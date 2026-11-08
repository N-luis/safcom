import { NextRequest, after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { logRouteError } from '@/lib/hearingCasesServer';
import { templateFor, fieldOf, EXTRA_QUESTIONS, type ExtraQuestion, type DraftFields } from '@/lib/reportTemplates';
import {
  loadReport, originalOf, questionsFor, residentDraftView, addVersion, signalsDanger, flagUrgentFromResident, generateDraft, draftQuietly,
  fieldLabel, MAX_ADDENDA_PER_DAY, SOURCE_LABEL, type AddendumField, type AddendumSource,
} from '@/lib/reportReviewServer';

export const dynamic = 'force-dynamic';

/**
 * A resident's own report: what they first wrote (kept exactly), what they
 * added since, the barangay's requests for information, the questions still
 * worth answering, and SafeComm AI's organized draft of it.
 *
 *   GET  - all of the above, for the caller's own report only.
 *   POST - correct, add, clarify or answer: always a new version, never an
 *          overwrite. An immediate danger in what is added raises the case to
 *          urgent review at once, without waiting for the AI.
 *
 * Another person's report is "not found". Interview notes and officials'
 * records are never returned here.
 */

type Params = { params: Promise<{ id: string }> };
const CLOSED = ['Resolved', 'Closed'];

const answerSchema = z.object({
  key: z.string().trim().min(1).max(40),
  value: z.string().trim().max(500, 'Keep each answer under 500 characters').optional(),
  skipped: z.boolean().optional(),
});
const postSchema = z.object({
  kind: z.enum(['correction', 'addition', 'clarification', 'answers']),
  text: z.string().trim().max(2000, 'Keep this under 2,000 characters').optional(),
  reason: z.string().trim().max(300, 'Keep the reason under 300 characters').optional(),
  answers: z.array(answerSchema).max(20).optional(),
  requestId: z.string().max(64).optional(),
});
const SOURCE: Record<z.infer<typeof postSchema>['kind'], AddendumSource> = {
  correction: 'RESIDENT_CORRECTION', addition: 'RESIDENT_ADDITION', clarification: 'RESIDENT_CLARIFICATION', answers: 'RESIDENT_ANSWERS',
};
const todayPh = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

async function own(caseId: string, residentId: string) {
  return prisma.case.findFirst({ where: { id: caseId, residentId }, select: { id: true } });
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;
  try {
    if (!(await own(id, auth.resident.residentId))) return rError('Case not found', 404);
    const c = await loadReport(id);
    if (!c) return rError('Case not found', 404);
    const latest = c.reportDrafts[0];
    const requests = await prisma.clarificationRequest.findMany({ where: { caseId: id }, orderBy: { createdAt: 'desc' },
      select: { id: true, items: true, message: true, status: true, createdAt: true, answeredAt: true } });
    return rSuccess({
      caseNumber: c.caseNumber, open: !CLOSED.includes(c.status),
      original: { text: originalOf(c), filedAt: c.filedAt },
      // Their own versions only - an official's interview is not shown here.
      versions: c.reportAddenda.filter(a => a.residentId === auth.resident.residentId).map(a => ({
        version: a.version, previousVersion: a.previousVersion, source: a.source, sourceLabel: SOURCE_LABEL[a.source as AddendumSource],
        text: a.text, reason: a.reason, fields: a.fields, createdAt: a.createdAt })),
      requests,
      questions: questionsFor(c, latest ? (latest.fields as unknown as DraftFields) : null),
      draft: residentDraftView(latest),
      limitPerDay: MAX_ADDENDA_PER_DAY,
    });
  } catch (e) {
    logRouteError('GET /api/resident/cases/[id]/report', e);
    return rError('Your report could not be loaded right now.', 503);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;
  const me = auth.resident.residentId;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check what you entered', 400);
  const d = parsed.data;
  try {
    const c = await prisma.case.findFirst({ where: { id, residentId: me },
      select: { id: true, caseNumber: true, caseType: true, status: true, triageStatus: true, assignedToId: true } });
    if (!c) return rError('Case not found', 404);
    if (CLOSED.includes(c.status)) return rError('This case is closed. Contact the barangay if something needs to be added.', 409);
    const template = templateFor(c.caseType);

    // The request being answered, if any - this case's, and still open.
    const request = d.requestId ? await prisma.clarificationRequest.findFirst({ where: { id: d.requestId, caseId: id, status: 'OPEN' } }) : null;
    if (d.requestId && !request) return rError('That request was already answered or withdrawn.', 409);
    const requestKeys = new Set(((request?.items ?? []) as { key: string }[]).map(i => i.key));

    // Each answer must be to a question this report can be asked.
    const fields: AddendumField[] = [];
    for (const a of d.answers ?? []) {
      const f = fieldOf(template, a.key);
      const extra = a.key in EXTRA_QUESTIONS;
      if (!(f?.ask || extra || requestKeys.has(a.key))) return rError('One of the answers is not for this report.', 400);
      if (a.skipped) { fields.push({ key: a.key, label: fieldLabel(template, a.key), skipped: true }); continue; }
      const value = a.value?.trim();
      if (!value) continue;
      if (f?.ask?.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayPh() || value < '1990-01-01')) {
        return rError('The date cannot be in the future - use the date picker, or skip the question.', 400);
      }
      const label = f ? f.label : extra ? EXTRA_QUESTIONS[a.key as ExtraQuestion]
        : ((request?.items ?? []) as { key: string; question: string }[]).find(i => i.key === a.key)?.question ?? a.key;
      fields.push({ key: a.key, label, value });
    }
    const text = d.text?.trim() || null;
    if (!text && !fields.length) return rError('Write what you want to correct or add, or answer at least one question.', 400);
    if (d.kind === 'correction' && !text) return rError('Say what should be corrected, in your own words.', 400);

    const today = await prisma.reportAddendum.count({ where: { caseId: id, residentId: me, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (today >= MAX_ADDENDA_PER_DAY) return rError('You have added a lot to this report today. Please try again tomorrow, or contact the barangay.', 429);

    const danger = signalsDanger([text ?? '', ...fields.map(f => f.value ?? '')].join('\n'));
    const out = await prisma.$transaction(async tx => {
      const v = await addVersion(tx, { caseId: id, source: request ? 'RESIDENT_CLARIFICATION' : SOURCE[d.kind], fields, text, reason: d.reason,
        residentId: me, requestId: request?.id ?? null });
      if (request) {
        await tx.clarificationRequest.update({ where: { id: request.id }, data: { status: 'ANSWERED', answeredAt: new Date(), addendumId: v.id } });
      }
      await tx.case.update({ where: { id }, data: { lastResidentUpdateAt: new Date() } });
      await tx.activity.create({ data: { type: 'report_update', message: `The reporter added version ${v.version} of the report (${SOURCE_LABEL[v.source as AddendumSource].toLowerCase()})`,
        entityId: v.id, entityType: 'ReportAddendum', caseId: id, color: '#0369a1' } });
      const notify = [...new Set([c.assignedToId, request?.requestedById].filter((x): x is string => Boolean(x)))];
      for (const userId of notify) {
        await tx.notification.create({ data: { title: request ? `Clarification received: ${c.caseNumber}` : `New information on case ${c.caseNumber}`,
          message: request ? 'The resident answered your request for more information.' : 'The resident added to their report. Review it in Report Review and Clarification.',
          type: 'info', userId, caseId: id } });
      }
      const urgent = danger ? await flagUrgentFromResident(tx, c) : false;
      return { version: v.version, urgent };
    });

    // The organized draft follows at once from what is recorded; SafeComm AI
    // reads it again after the response - the resident never waits on it.
    const draft = await draftQuietly(id, { useAi: false, by: { residentId: me }, chargeTo: me, reason: `Version ${out.version} added by the resident` });
    try {
      after(async () => { await generateDraft(id, { useAi: true, by: { residentId: me }, chargeTo: me, reason: `Version ${out.version} added by the resident` }).catch(() => null); });
    } catch { /* outside a request (tests): the records-only draft stands */ }

    return rSuccess({ version: out.version, emergency: danger, flaggedUrgent: out.urgent, draftNumber: draft?.draftNumber ?? null }, 201);
  } catch (e) {
    logRouteError('POST /api/resident/cases/[id]/report', e);
    return rError('What you added could not be saved right now. It is still on your screen - try again.', 503);
  }
}
