import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { phInstant } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import { noStore, gateAppointments, decideAppointmentAccess, checkOfficer, logAccess, notifyAppointmentOfficials } from '@/lib/vawcAppointmentsServer';
import {
  BPO_ACTING_KEYS, BPO_SERVICE_KEYS, VAWC_REFERRAL_STATUS_KEYS, PROCEEDING_KINDS, KIND_LABEL, PROCEEDING_EVENT_LABELS,
  bpoAllowed, bpoDecisionRefusal, bpoServiceRefusal, bpoLastDay, type ProceedingKind,
} from '@/lib/vawcProceedings';
import { recordProceedingEvent, proceedingActivity, proceedingHistory } from '@/lib/vawcProceedingsServer';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ kind: string; rid: string }> };

/** The record's case, from the record - and "not found" to anyone who may not see it. */
async function load(req: NextRequest, kindRaw: string, rid: string, need: 'view' | 'edit') {
  if (!(PROCEEDING_KINDS as readonly string[]).includes(kindRaw)) return { error: errorResponse('Not found', 404) };
  const kind = kindRaw as ProceedingKind;
  const id = rid.slice(0, 64);
  const find = kind === 'bpo' ? prisma.vawcBpo.findUnique({ where: { id } }) : prisma.vawcReferral.findUnique({ where: { id } });
  const row = await (find as Promise<Record<string, unknown> & { caseId: string; assignedOfficerId: string | null } | null>).catch(() => undefined);
  if (row === undefined) return { error: errorResponse('The record could not be loaded right now.', 503) };
  if (!row) {
    const auth = await requireAuth(req);
    if ('status' in auth) return { error: auth };
    await logAccess(await loadActor(auth.user.userId), id, null, 'denied', 'proceeding_not_found');
    return { error: errorResponse('Record not found', 404) };
  }
  const g = await gateAppointments(req, row.caseId, 'view');
  if ('error' in g) return g;
  // The case's officer manages its records; so does the official assigned to this record (the same rule as appointments).
  const access = decideAppointmentAccess(g.actor, g.c, row.assignedOfficerId === g.actor.id);
  if (need === 'edit' && !access.edit) {
    await g.log('denied', access.code);
    return { error: noStore({ success: false, error: access.message ?? 'Not permitted', code: access.code }, 403) };
  }
  return { ...g, access, kind, row };
}

/** One record and its history, for the officials who may see it. */
export async function GET(req: NextRequest, { params }: Params) {
  const { kind, rid } = await params;
  const r = await load(req, kind, rid, 'view');
  if ('error' in r) return r.error;
  try {
    const history = await proceedingHistory(r.kind, rid);
    await r.log('permitted', `${r.kind}_view`);
    return noStore({ success: true, data: { record: r.row, history: history.map(h => ({ ...h, label: PROCEEDING_EVENT_LABELS[h.kind] ?? h.kind })), canEdit: r.access.edit } });
  } catch (e) {
    logRouteError('GET /api/vawc/proceedings/[kind]/[rid]', e);
    return errorResponse('The record could not be loaded right now.', 503);
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the time');
const reason = z.string().trim().min(5, 'Write the reason (at least 5 characters)').max(500);
const schema = z.discriminatedUnion('action', [
  // BPO: each step on its own.
  z.object({ action: z.literal('decide'), decision: z.enum(['ISSUED', 'DENIED']), date, time, actingRole: z.enum(BPO_ACTING_KEYS),
    actingOfficialName: z.string().trim().min(2, 'Enter the name of the official who decided').max(120), punongBarangayUnavailable: z.boolean().optional(),
    exParteAssessment: z.string().trim().min(5, 'Write the ex parte assessment (at least 5 characters)').max(3000) }),
  z.object({ action: z.literal('serve'), date, time, serviceMethod: z.enum(BPO_SERVICE_KEYS),
    servedByName: z.string().trim().min(2, 'Enter who served it').max(120), serviceNotes: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('correct'), reason, applicationNotes: z.string().trim().max(2000).optional(), exParteAssessment: z.string().trim().max(3000).optional(),
    serviceNotes: z.string().trim().max(2000).optional(), actingOfficialName: z.string().trim().max(120).optional(), servedByName: z.string().trim().max(120).optional(),
    assignedOfficerId: z.string().max(64).nullable().optional() }),
  z.object({ action: z.literal('cancel'), reason }),
  // Referral: its status, follow-up date and outcome.
  z.object({ action: z.literal('update'), status: z.enum(VAWC_REFERRAL_STATUS_KEYS).optional(), followUpDate: date.nullable().optional(),
    outcome: z.string().trim().max(2000).optional(), assignedOfficerId: z.string().max(64).nullable().optional() }),
]);

const BPO_ACTIONS = ['decide', 'serve', 'correct', 'cancel'];
const REFERRAL_ACTIONS = ['update', 'correct'];

export async function PATCH(req: NextRequest, { params }: Params) {
  const { kind, rid } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  const d = parsed.data;
  const r = await load(req, kind, rid, 'edit');
  if ('error' in r) return r.error;
  const { actor, c } = r;
  const allowedActions = r.kind === 'bpo' ? BPO_ACTIONS : REFERRAL_ACTIONS;
  if (!allowedActions.includes(d.action)) return errorResponse(`That action is not for a ${KIND_LABEL[r.kind].toLowerCase()}.`, 400);
  if ('assignedOfficerId' in d && d.assignedOfficerId) {
    const bad = await checkOfficer(d.assignedOfficerId);
    if (bad) return errorResponse(bad, 400);
  }
  const row = r.row as Record<string, unknown>;
  const status = String(row.status);
  if (r.kind === 'bpo' && !bpoAllowed(d.action, status)) return errorResponse(`This BPO is ${status.toLowerCase()}: that step cannot be recorded now.`, 409);
  if (r.kind === 'referral' && status === 'CANCELLED') return errorResponse('This referral was marked as recorded in error.', 409);

  let data: Record<string, unknown> = { updatedById: actor.id };
  let eventKind = '';
  let note: string | null = null;
  let tellOfficials: { title: string; message: string; type: string } | null = null;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter(k => k in d && (d as Record<string, unknown>)[k] !== undefined).map(k => [k, (d as Record<string, unknown>)[k]]));

  if (d.action === 'decide') {
    const at = phInstant(d.date, d.time);
    if (!at) return errorResponse('Choose a valid date and time.', 400);
    const refusal = bpoDecisionRefusal({ decision: d.decision, acting: d.actingRole, pbUnavailable: Boolean(d.punongBarangayUnavailable), decidedAt: at, appliedAt: new Date(row.appliedAt as string) });
    if (refusal) return errorResponse(refusal, 400);
    data = { ...data, decision: d.decision, decidedAt: at, actingRole: d.actingRole, actingOfficialName: d.actingOfficialName,
      punongBarangayUnavailable: d.actingRole === 'KAGAWAD' ? true : Boolean(d.punongBarangayUnavailable), exParteAssessment: d.exParteAssessment,
      decisionRecordedById: actor.id, status: d.decision === 'ISSUED' ? 'ISSUED' : 'DENIED' };
    eventKind = d.decision === 'ISSUED' ? 'bpo_issued' : 'bpo_denied';
    if (d.decision === 'ISSUED') tellOfficials = { title: `BPO issued - serve it now - ${c.caseNumber}`,
      message: `${row.reference} was issued. Serve it on the respondent immediately (RA 9262 sec. 14). Last effective day: ${bpoLastDay(at)}.`, type: 'warning' };
  } else if (d.action === 'serve') {
    const at = phInstant(d.date, d.time);
    if (!at) return errorResponse('Choose a valid date and time.', 400);
    const refusal = bpoServiceRefusal(at, row.decidedAt ? new Date(row.decidedAt as string) : null);
    if (refusal) return errorResponse(refusal, 400);
    data = { ...data, servedAt: at, serviceMethod: d.serviceMethod, servedByName: d.servedByName, serviceNotes: d.serviceNotes || null, serviceRecordedById: actor.id, status: 'SERVED' };
    eventKind = 'bpo_served';
  } else if (d.action === 'correct') {
    const fields = r.kind === 'bpo' ? ['applicationNotes', 'exParteAssessment', 'serviceNotes', 'actingOfficialName', 'servedByName', 'assignedOfficerId']
      : ['assignedOfficerId'];
    const changes = pick(fields);
    if (!Object.keys(changes).length) return errorResponse('Nothing to correct on this record.', 400);
    data = { ...data, ...changes };
    eventKind = 'corrected'; note = d.reason;
  } else if (d.action === 'cancel') {
    if (r.kind === 'referral') return errorResponse('A referral is closed by its status (completed, declined by the client). It cannot be deleted.', 400);
    data = { ...data, status: 'CANCELLED', cancelledAt: new Date(), cancelReason: d.reason };
    eventKind = 'cancelled'; note = d.reason;
  } else if (d.action === 'update') {
    const changes: Record<string, unknown> = pick(['status', 'outcome', 'assignedOfficerId']);
    if (d.followUpDate !== undefined) {
      const f = d.followUpDate ? phInstant(d.followUpDate, '09:00') : null;
      if (d.followUpDate && (!f || f.getTime() < new Date(row.referredAt as string).getTime() - 86_400_000)) return errorResponse('The follow-up date cannot be before the referral.', 400);
      changes.followUpAt = f;
    }
    if (!Object.keys(changes).length) return errorResponse('Nothing to update.', 400);
    data = { ...data, ...changes };
    eventKind = 'referral_updated';
  }

  try {
    const by = (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'an official';
    const before = Object.fromEntries(Object.keys(data).filter(k => k !== 'updatedById').map(k => [k, row[k] ?? null]));
    await prisma.$transaction(async tx => {
      // Moved only from the state it was read in: two officials cannot both record the same step.
      const where = { id: rid, status, updatedAt: row.updatedAt as Date };
      const n = r.kind === 'bpo' ? await tx.vawcBpo.updateMany({ where, data }) : await tx.vawcReferral.updateMany({ where, data });
      if (!n.count) throw new Error('changed');
      const after = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'updatedById').map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
      const e = await recordProceedingEvent(tx, { caseId: c.id, recordKind: r.kind, recordId: rid, kind: eventKind, actorId: actor.id,
        before: JSON.parse(JSON.stringify(before)), after, note });
      await proceedingActivity(tx, e.id, c.id, actor.id, `${PROCEEDING_EVENT_LABELS[eventKind] ?? eventKind} (${row.reference}) by ${by}`);
      if (tellOfficials) await notifyAppointmentOfficials(tx, { assignedOfficerId: (row.assignedOfficerId as string | null) ?? null }, c, tellOfficials.title, tellOfficials.message, tellOfficials.type, actor.id);
    });
    await r.log('permitted', `${r.kind}_${d.action}`);
    return noStore({ success: true, data: { id: rid, action: d.action } });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('Someone else changed this record a moment ago. Reload it and try again.', 409);
    logRouteError('PATCH /api/vawc/proceedings/[kind]/[rid]', e);
    return errorResponse('The change could not be saved right now. Nothing was changed.', 503);
  }
}
