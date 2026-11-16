import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { phInstant } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import {
  APPOINTMENT_TYPE_KEYS, PARTICIPANT_KEYS, NOTIFY_KEYS, ATTENDANCE_KEYS, REFERRAL_STATUS_KEYS, appointmentAllowed, appointmentDayArrived,
  normalizeParticipants, notifyRefusal, residentNotified, forbiddenRequest, appointmentTimeRefusal, APPOINTMENT_STATUSES, type AppointmentStatus,
  COURT_MATTER_KEYS, COURT_SOURCE_KEYS, courtRefusal, isCourtType, MODULE_LABEL,
} from '@/lib/vawcAppointments';
import {
  noStore, gateAppointments, loadAppointment, officialView, appointmentCaseContext, appointmentOfficers, checkOfficer, officerConflicts, conflictReply,
  recordAppointmentEvent, appointmentActivity, notifyAppointmentOfficials, appointmentSnap, logAccess,
} from '@/lib/vawcAppointmentsServer';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ aid: string }> };

/** The appointment's case, from the appointment - and "not found" for anyone who may not see it. */
async function caseOf(req: NextRequest, aid: string, need: 'view' | 'edit') {
  const row = await prisma.vawcAppointment.findUnique({ where: { id: aid.slice(0, 64) }, select: { caseId: true } }).catch(() => undefined);
  if (row === undefined) return { error: errorResponse('The hearing could not be loaded right now.', 503) };
  if (!row) {
    const auth = await requireAuth(req);
    if ('status' in auth) return { error: auth };
    await logAccess(await loadActor(auth.user.userId), aid, null, 'denied', 'appointment_not_found');
    return { error: errorResponse('Hearing not found', 404) };
  }
  return gateAppointments(req, row.caseId, need, aid);
}

/** One appointment: the full record and its history, for the officials who may see it. */
export async function GET(req: NextRequest, { params }: Params) {
  const { aid } = await params;
  const g = await caseOf(req, aid, 'view');
  if ('error' in g) return g.error;
  try {
    const a = await loadAppointment(g.c.id, aid);
    if (!a) return errorResponse('Hearing not found', 404);
    const [view, officers] = await Promise.all([officialView(a), g.access.edit ? appointmentOfficers() : Promise.resolve([])]);
    await g.log('permitted', `${g.access.code}:appointment`);
    return noStore({ success: true, data: {
      appointment: view, case: appointmentCaseContext(g.c), officers, canEdit: g.access.edit, accessMessage: g.access.message,
    } });
  } catch (e) {
    logRouteError('GET /api/vawc/appointments/[aid]', e);
    return errorResponse('The hearing could not be loaded right now.', 503);
  }
}

const text = (max: number) => z.string().trim().max(max);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), type: z.enum(APPOINTMENT_TYPE_KEYS).optional(), venue: z.string().trim().min(2).max(200).optional(),
    assignedOfficerId: z.string().max(64).nullable().optional(), participants: z.array(z.enum(PARTICIPANT_KEYS)).min(1).optional(),
    purpose: z.string().trim().min(5, 'Write the purpose (at least 5 characters)').max(1000).optional(), internalNotes: text(2000).optional(),
    notifyVia: z.enum(NOTIFY_KEYS).optional(), residentInstructions: text(500).optional(),
    courtMatter: z.enum(COURT_MATTER_KEYS).optional(), courtSource: z.enum(COURT_SOURCE_KEYS).optional(), courtReference: text(100).optional() }),
  z.object({ action: z.literal('reschedule'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the new date'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the new time'),
    reason: z.string().trim().min(3, 'Write why the date changes').max(500), venue: z.string().trim().min(2).max(200).optional(),
    requestId: z.string().max(64).optional(), confirmConflicts: z.boolean().optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3, 'Write why it is cancelled').max(500) }),
  z.object({ action: z.literal('record'), held: z.boolean(), attendance: z.enum(ATTENDANCE_KEYS), outcomeNotes: text(4000).optional(),
    followUpActions: text(2000).optional(), referralStatus: z.enum(REFERRAL_STATUS_KEYS).optional(),
    nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), nextTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }),
  z.object({ action: z.literal('amend_outcome'), outcomeNotes: text(4000).optional(), followUpActions: text(2000).optional(),
    referralStatus: z.enum(REFERRAL_STATUS_KEYS).optional(), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    nextTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }),
  z.object({ action: z.literal('review_request'), requestId: z.string().min(1).max(64), reviewNote: z.string().trim().min(3, 'Write the reply the resident will read').max(500) }),
]);

/**
 * Change an appointment: its details, a new date (approving a resident's
 * request with it, when one is given), a cancellation, the outcome once
 * held, or a reply declining a request. Each change is written to the
 * history with the official who made it; the resident is told only of a new
 * date, a cancellation or an answer to their request - in safe words, and
 * only when the officer chose to notify their account.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { aid } = await params;
  const raw = await req.json().catch(() => null);
  const forbidden = forbiddenRequest(raw);
  if (forbidden) return errorResponse(forbidden, 400);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  const d = parsed.data;
  const g = await caseOf(req, aid, 'edit');
  if ('error' in g) return g.error;
  const { actor, c } = g;
  try {
    const a = await loadAppointment(c.id, aid);
    if (!a) return errorResponse('Hearing not found', 404);
    if (!appointmentAllowed(d.action, a.status)) {
      return errorResponse(`This hearing is ${APPOINTMENT_STATUSES[a.status as AppointmentStatus]?.toLowerCase() ?? a.status}, so that cannot be done now.`, 409);
    }
    const by = (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'an official';
    const snap = appointmentSnap(a);
    const ev = (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], kind: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, note?: string | null) =>
      recordAppointmentEvent(tx, { appointmentId: a.id, caseId: c.id, kind, actorType: 'official', actorId: actor.id, before, after, note });
    // Refuses the write if someone changed the status meanwhile.
    const guard = { id: a.id, status: a.status };

    if (d.action === 'update') {
      const participants = d.participants ? normalizeParticipants(d.participants, c.reportingRelationship) : a.participants;
      const notifyVia = d.notifyVia ?? a.notifyVia;
      const refusal = notifyRefusal(notifyVia, { hasAccount: Boolean(c.residentId) }, participants);
      if (refusal) return errorResponse(refusal, 400);
      if (d.assignedOfficerId !== undefined) { const bad = await checkOfficer(d.assignedOfficerId); if (bad) return errorResponse(bad, 400); }
      const next = {
        type: d.type ?? a.type, venue: d.venue ?? a.venue, assignedOfficerId: d.assignedOfficerId === undefined ? a.assignedOfficerId : d.assignedOfficerId,
        participants, purpose: d.purpose ?? a.purpose, internalNotes: d.internalNotes === undefined ? a.internalNotes : d.internalNotes || null,
        notifyVia, residentInstructions: d.residentInstructions === undefined ? a.residentInstructions : d.residentInstructions || null,
        courtMatter: null as string | null, courtSource: null as string | null, courtReference: null as string | null,
      };
      // Court details go with the court type only: kept or changed on a court date, cleared on any other type.
      if (isCourtType(next.type)) {
        next.courtMatter = d.courtMatter ?? a.courtMatter;
        next.courtSource = d.courtSource ?? a.courtSource;
        next.courtReference = d.courtReference === undefined ? a.courtReference : d.courtReference || null;
      }
      const courtErr = courtRefusal(next.type, next);
      if (courtErr) return errorResponse(courtErr, 400);
      // The history records which fields changed - the confidential ones by name only.
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(k => JSON.stringify(next[k]) !== JSON.stringify(a[k]));
      if (!changed.length) return noStore({ success: true, data: { unchanged: true } });
      const visible = ['type', 'venue', 'assignedOfficerId', 'participants', 'notifyVia', 'courtMatter', 'courtSource', 'courtReference'] as const;
      const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.filter(k => (visible as readonly string[]).includes(k)).map(k => [k, o[k]]));
      await prisma.$transaction(async tx => {
        const r = await tx.vawcAppointment.updateMany({ where: guard, data: { ...next, updatedById: actor.id } });
        if (!r.count) throw new Error('changed');
        const e = await ev(tx, 'updated', pick(a as unknown as Record<string, unknown>), { ...pick(next), changed });
        await appointmentActivity(tx, e.id, c.id, actor.id, `${a.reference} details updated (${changed.join(', ')}) by ${by}`);
        if (!residentNotified(a) && residentNotified(next)) {
          await recordAppointmentEvent(tx, { appointmentId: a.id, caseId: c.id, kind: 'resident_notified', actorType: 'system', actorId: null, after: snap });
        }
      });
      await g.log('permitted', 'updated');
      return noStore({ success: true, data: { changed } });
    }

    if (d.action === 'reschedule') {
      const at = phInstant(d.date, d.time);
      const refusal = appointmentTimeRefusal(at);
      if (refusal || !at) return errorResponse(refusal ?? 'Choose a valid date and time.', 400);
      const request = d.requestId ? a.requests.find(r => r.id === d.requestId && r.status === 'PENDING') : null;
      if (d.requestId && !request) return errorResponse('That request is no longer waiting for an answer.', 409);
      if (!d.confirmConflicts) {
        const conflicts = await officerConflicts(a.assignedOfficerId, at, a.id);
        if (conflicts.length) return conflictReply(conflicts);
      }
      const venue = d.venue ?? a.venue;
      await prisma.$transaction(async tx => {
        const r = await tx.vawcAppointment.updateMany({ where: guard, data: {
          scheduledAt: at, venue, status: 'RESCHEDULED', statusReason: d.reason, rescheduleCount: { increment: 1 },
          residentAcknowledgedAt: null, residentSeenAt: null, updatedById: actor.id,
        } });
        if (!r.count) throw new Error('changed');
        const e = await ev(tx, 'rescheduled', { scheduledAt: snap.scheduledAt, venue: a.venue }, { ...appointmentSnap({ type: a.type, scheduledAt: at }), venue }, d.reason);
        await appointmentActivity(tx, e.id, c.id, actor.id, `${a.reference} moved to a new date by ${by}`);
        if (request) {
          await tx.vawcAppointmentRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', pendingKey: null, reviewedById: actor.id, reviewedAt: new Date(),
            reviewNote: 'Approved - see the new date.' } });
          await ev(tx, 'request_approved', null, { requestId: request.id, scheduledAt: at.toISOString() });
        }
        await notifyAppointmentOfficials(tx, a, c, `VAWC hearing moved - ${c.caseNumber}`, `${a.reference} has a new date. Open ${MODULE_LABEL} for the details.`, 'info', actor.id);
      });
      await g.log('permitted', 'rescheduled');
      return noStore({ success: true });
    }

    if (d.action === 'cancel') {
      await prisma.$transaction(async tx => {
        const r = await tx.vawcAppointment.updateMany({ where: guard, data: { status: 'CANCELLED', statusReason: d.reason, cancelledAt: new Date(), cancelledById: actor.id, updatedById: actor.id } });
        if (!r.count) throw new Error('changed');
        // A request still waiting has nothing left to move.
        await tx.vawcAppointmentRequest.updateMany({ where: { appointmentId: a.id, status: 'PENDING' }, data: { status: 'DECLINED', pendingKey: null, reviewedById: actor.id, reviewedAt: new Date(),
          reviewNote: 'It was cancelled.' } });
        const e = await ev(tx, 'cancelled', { status: a.status }, { ...snap, status: 'CANCELLED' }, d.reason);
        await appointmentActivity(tx, e.id, c.id, actor.id, `${a.reference} cancelled by ${by}`);
        await notifyAppointmentOfficials(tx, a, c, `VAWC hearing cancelled - ${c.caseNumber}`, `${a.reference} was cancelled.`, 'warning', actor.id);
      });
      await g.log('permitted', 'cancelled');
      return noStore({ success: true });
    }

    if (d.action === 'record' || d.action === 'amend_outcome') {
      if (d.action === 'record' && !appointmentDayArrived(a.scheduledAt)) return errorResponse('The outcome can be recorded from the hearing day on.', 409);
      let nextAt: Date | null | undefined;
      if (d.nextDate === null) nextAt = null;
      else if (d.nextDate) {
        nextAt = phInstant(d.nextDate, d.nextTime ?? '09:00');
        if (!nextAt) return errorResponse('Choose a valid date for the follow-up.', 400);
      }
      const outcome = {
        ...(d.outcomeNotes !== undefined && { outcomeNotes: d.outcomeNotes || null }),
        ...(d.followUpActions !== undefined && { followUpActions: d.followUpActions || null }),
        ...(d.referralStatus !== undefined && { referralStatus: d.referralStatus }),
        ...(nextAt !== undefined && { nextAppointmentAt: nextAt }),
      };
      const status = d.action === 'record' ? (d.held ? 'COMPLETED' : 'NOT_HELD') : a.status;
      await prisma.$transaction(async tx => {
        const r = await tx.vawcAppointment.updateMany({ where: guard, data: {
          ...outcome, updatedById: actor.id,
          ...(d.action === 'record' && { status, attendance: d.attendance, completedAt: new Date(), completedById: actor.id }),
        } });
        if (!r.count) throw new Error('changed');
        // The history names what was recorded; the notes themselves stay on the appointment.
        const after = { status, ...(d.action === 'record' && { attendance: d.attendance }), referralStatus: d.referralStatus ?? a.referralStatus,
          nextAppointmentAt: nextAt === undefined ? a.nextAppointmentAt : nextAt, recorded: Object.keys(outcome) };
        const kind = d.action === 'record' ? (d.held ? 'completed' : 'not_held') : 'outcome_amended';
        const e = await ev(tx, kind, { status: a.status }, after);
        await appointmentActivity(tx, e.id, c.id, actor.id, `${a.reference}: ${kind === 'completed' ? 'held' : kind === 'not_held' ? 'did not take place' : 'outcome updated'} - recorded by ${by}`);
        if (d.action === 'record') {
          await tx.vawcAppointmentRequest.updateMany({ where: { appointmentId: a.id, status: 'PENDING' }, data: { status: 'DECLINED', pendingKey: null, reviewedById: actor.id,
            reviewedAt: new Date(), reviewNote: 'It has already taken place.' } });
        }
      });
      await g.log('permitted', d.action === 'record' ? 'recorded' : 'outcome_amended');
      return noStore({ success: true, data: { status } });
    }

    // review_request: decline, with a reply the resident reads. (Approving is a new date: reschedule with requestId.)
    const request = a.requests.find(r => r.id === d.requestId && r.status === 'PENDING');
    if (!request) return errorResponse('That request is no longer waiting for an answer.', 409);
    await prisma.$transaction(async tx => {
      await tx.vawcAppointmentRequest.update({ where: { id: request.id }, data: { status: 'DECLINED', pendingKey: null, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: d.reviewNote } });
      const e = await ev(tx, 'request_declined', null, { requestId: request.id, ...snap });
      await appointmentActivity(tx, e.id, c.id, actor.id, `${a.reference}: request for a new date declined by ${by}`);
    });
    await g.log('permitted', 'request_declined');
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This hearing was just changed by someone else. Reload to see it.', 409);
    logRouteError('PATCH /api/vawc/appointments/[aid]', e);
    return errorResponse('That could not be saved right now. Nothing was changed.', 503);
  }
}
