import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import {
  gateHearings, noStore, eligibilityOf, recordEvent, hearingActivity, actorName, scheduleFields, instantOf, checkPeople,
  findConflicts, conflictResponse,
} from '@/lib/hearingsServer';
import {
  allowedFrom, isPastDay, hasDayArrived, phInstant, scheduleTimeRefusal, formatHearingWhen, HEARING_OUTCOMES, HEARING_OUTCOME_KEYS, HEARING_STATUSES,
  type HearingStatus,
} from '@/lib/hearings';

/**
 * Everything an official does to one hearing. Each action is allowed only
 * from the statuses that make sense (lib/hearings.ts ALLOWED_FROM), and each
 * leaves a row in the hearing's history - a new date keeps the old one, a
 * note is added rather than edited, an outcome is recorded once.
 *
 *   update          edit a draft (date, time, venue, official, parties, notes)
 *   schedule        a draft becomes scheduled - the complainant is told
 *   details         the presiding official or the complainant's instructions
 *   reschedule      a new date, time or venue, with the reason (and the
 *                   complainant's request it answers, if any)
 *   attendance      who appeared - recorded by an official only
 *   proceedings     add a proceedings note
 *   complete        held: outcome, agreements, summary for the complainant, next action
 *   cancel          with the reason
 *   decline_request decline a complainant's request for a new date
 */

const attendance = z.enum(['PRESENT', 'ABSENT', 'EXCUSED', 'NOT_RECORDED']);
const idOrNull = z.string().trim().min(1).max(64).nullable().optional();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), ...scheduleFields, assignedOfficialId: idOrNull, complainantPartyId: idOrNull, respondentPartyId: idOrNull,
    notes: z.string().trim().max(1000).optional(), residentInstructions: z.string().trim().max(600).optional() }),
  z.object({ action: z.literal('schedule'), confirmConflicts: z.boolean().optional() }),
  z.object({ action: z.literal('details'), assignedOfficialId: idOrNull, residentInstructions: z.string().trim().max(600).optional(), confirmConflicts: z.boolean().optional() }),
  z.object({ action: z.literal('reschedule'), ...scheduleFields, reason: z.string().trim().min(3, 'Say why the date is changing').max(300), requestId: z.string().max(64).optional() }),
  z.object({ action: z.literal('attendance'), complainant: attendance.optional(), respondent: attendance.optional() }),
  z.object({ action: z.literal('proceedings'), note: z.string().trim().min(3, 'Write the proceedings note').max(3000) }),
  z.object({ action: z.literal('complete'), outcome: z.enum(HEARING_OUTCOME_KEYS), agreements: z.string().trim().max(3000).optional(),
    outcomeSummary: z.string().trim().max(600).optional(), nextAction: z.string().trim().max(300).optional(),
    nextHearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    complainantAttendance: attendance.optional(), respondentAttendance: attendance.optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3, 'Say why it is cancelled').max(300) }),
  z.object({ action: z.literal('decline_request'), requestId: z.string().max(64), note: z.string().trim().min(3, 'Tell the complainant why').max(300) }),
]);

class Conflict extends Error {}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);
  const d = parsed.data;
  try {
    const h = await prisma.caseHearing.findUnique({ where: { id: hid } });
    // Another case's hearing, reached through this case's id: not found.
    if (!h || h.caseId !== id) return errorResponse('Hearing not found', 404);
    if (!allowedFrom(d.action, h.status)) {
      return errorResponse(`This cannot be done to a hearing that is ${HEARING_STATUSES[h.status as HearingStatus]?.toLowerCase() ?? h.status}.`, 409);
    }
    const by = await actorName(g.actor.id);
    const me = g.actor.id;
    const N = h.hearingNumber;
    const snap = (at: Date, venue: string | null) => ({ hearingNumber: N, scheduledAt: at.toISOString(), venue });
    // Every write is conditional on the hearing being as it was read.
    const guard = { id: hid, status: h.status, updatedAt: h.updatedAt };
    const write = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], data: Record<string, unknown>) => {
      const r = await tx.caseHearing.updateMany({ where: guard, data: { ...data, updatedById: me } });
      if (!r.count) throw new Conflict();
    };

    if (d.action === 'update') {
      const at = d.date || d.time || d.scheduledAt ? instantOf({ date: d.date ?? undefined, time: d.time ?? undefined, scheduledAt: d.scheduledAt }) : h.scheduledAt;
      if (!at) return errorResponse('Choose both the date and the time', 400);
      const timeRefusal = scheduleTimeRefusal(at);
      if (timeRefusal) return errorResponse(timeRefusal, 400);
      const people = await checkPeople(id, d);
      if (people) return errorResponse(people, 400);
      const conflicts = await findConflicts(g.actor, { at, venue: d.venue ?? h.venue,
        officialId: d.assignedOfficialId === undefined ? h.assignedOfficialId : d.assignedOfficialId, excludeId: hid });
      if (conflicts.length && !d.confirmConflicts) return conflictResponse(conflicts);
      const next = {
        scheduledAt: at, venue: d.venue ?? h.venue,
        assignedOfficialId: d.assignedOfficialId === undefined ? h.assignedOfficialId : d.assignedOfficialId,
        complainantPartyId: d.complainantPartyId === undefined ? h.complainantPartyId : d.complainantPartyId,
        respondentPartyId: d.respondentPartyId === undefined ? h.respondentPartyId : d.respondentPartyId,
        notes: d.notes === undefined ? h.notes : d.notes || null,
        residentInstructions: d.residentInstructions === undefined ? h.residentInstructions : d.residentInstructions || null,
      };
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next)) {
        const old = (h as Record<string, unknown>)[k];
        const same = v instanceof Date && old instanceof Date ? v.getTime() === old.getTime() : v === old;
        if (!same) { before[k] = old instanceof Date ? old.toISOString() : old; after[k] = v instanceof Date ? v.toISOString() : v; }
      }
      if (!Object.keys(after).length) return noStore({ success: true, unchanged: true });
      await prisma.$transaction(async tx => {
        await write(tx, next);
        await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'updated', actorType: 'official', actorId: me, before, after });
      });
    }

    else if (d.action === 'schedule') {
      const eligibility = await eligibilityOf(g.c);
      if (!eligibility.eligible) return noStore({ success: false, error: eligibility.reasons[0], eligibility }, 422);
      if (scheduleTimeRefusal(h.scheduledAt)) return errorResponse('The draft\'s date and time have already passed. Set a new date first.', 400);
      const conflicts = await findConflicts(g.actor, { at: h.scheduledAt, venue: h.venue, officialId: h.assignedOfficialId, excludeId: hid });
      if (conflicts.length && !d.confirmConflicts) return conflictResponse(conflicts);
      await prisma.$transaction(async tx => {
        await write(tx, { status: 'SCHEDULED' });
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'scheduled', actorType: 'official', actorId: me, after: snap(h.scheduledAt, h.venue) });
        await hearingActivity(tx, e.id, id, me, `Hearing ${N} scheduled for ${formatHearingWhen(h.scheduledAt)} at ${h.venue ?? 'Barangay Hall'} by ${by}`);
      });
    }

    else if (d.action === 'details') {
      const people = await checkPeople(id, d);
      if (people) return errorResponse(people, 400);
      const official = d.assignedOfficialId === undefined ? h.assignedOfficialId : d.assignedOfficialId;
      const instructions = d.residentInstructions === undefined ? h.residentInstructions : d.residentInstructions || null;
      if (official === h.assignedOfficialId && instructions === h.residentInstructions) return noStore({ success: true, unchanged: true });
      if (official && official !== h.assignedOfficialId) {
        const conflicts = (await findConflicts(g.actor, { at: h.scheduledAt, venue: null, officialId: official, excludeId: hid })).filter(c => c.kind === 'official');
        if (conflicts.length && !d.confirmConflicts) return conflictResponse(conflicts);
      }
      await prisma.$transaction(async tx => {
        await write(tx, { assignedOfficialId: official, residentInstructions: instructions });
        await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'updated', actorType: 'official', actorId: me,
          before: { assignedOfficialId: h.assignedOfficialId, residentInstructions: h.residentInstructions },
          after: { assignedOfficialId: official, residentInstructions: instructions } });
        if (official && official !== h.assignedOfficialId && official !== me) {
          await tx.notification.create({ data: { title: `You are assigned to Hearing ${N} on ${g.c.caseNumber}`,
            message: `Set for ${formatHearingWhen(h.scheduledAt)}. Open Hearing Management for the details.`, type: 'info', userId: official, caseId: id } });
        }
      });
    }

    else if (d.action === 'reschedule') {
      const at = instantOf({ date: d.date, time: d.time, scheduledAt: d.scheduledAt });
      if (!at) return errorResponse('Choose the new date and time', 400);
      const timeRefusal = scheduleTimeRefusal(at);
      if (timeRefusal) return errorResponse(timeRefusal, 400);
      const venue = d.venue || h.venue;
      if (at.getTime() === h.scheduledAt.getTime() && venue === h.venue) return errorResponse('That is the date, time and venue already set.', 400);
      const conflicts = await findConflicts(g.actor, { at, venue, officialId: h.assignedOfficialId, excludeId: hid });
      if (conflicts.length && !d.confirmConflicts) return conflictResponse(conflicts);
      const request = d.requestId ? await prisma.caseHearingRequest.findFirst({ where: { id: d.requestId, hearingId: hid, status: 'PENDING' } }) : null;
      if (d.requestId && !request) return errorResponse('That request is no longer waiting for a decision. Reload to see it.', 409);
      await prisma.$transaction(async tx => {
        await write(tx, { scheduledAt: at, venue, status: 'RESCHEDULED', rescheduleCount: h.rescheduleCount + 1, statusReason: d.reason,
          reminderSentAt: null, residentIntent: null, residentIntentAt: null });
        // The notices for the old date no longer hold; new ones are issued for the new date.
        await tx.caseHearingNotice.updateMany({ where: { hearingId: hid, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'rescheduled', actorType: 'official', actorId: me,
          before: { scheduledAt: h.scheduledAt.toISOString(), venue: h.venue },
          after: { ...snap(at, venue), ...(conflicts.length && { conflictsAccepted: conflicts.map(c => c.message) }) }, note: d.reason });
        await hearingActivity(tx, e.id, id, me, `Hearing ${N} moved to ${formatHearingWhen(at)} at ${venue ?? 'Barangay Hall'} by ${by} (was ${formatHearingWhen(h.scheduledAt)})`);
        if (request) {
          await tx.caseHearingRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', pendingKey: null, reviewedById: me, reviewedAt: new Date(), reviewNote: null } });
          const r = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'request_approved', actorType: 'official', actorId: me, after: { ...snap(at, venue), requestId: request.id } });
          await hearingActivity(tx, r.id, id, me, `Complainant's request for a new date on Hearing ${N} approved by ${by}`);
        }
      });
    }

    else if (d.action === 'attendance') {
      const next = { complainantAttendance: d.complainant ?? h.complainantAttendance, respondentAttendance: d.respondent ?? h.respondentAttendance };
      if (next.complainantAttendance === h.complainantAttendance && next.respondentAttendance === h.respondentAttendance) return noStore({ success: true, unchanged: true });
      await prisma.$transaction(async tx => {
        await write(tx, next);
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'attendance', actorType: 'official', actorId: me,
          before: { complainantAttendance: h.complainantAttendance, respondentAttendance: h.respondentAttendance }, after: next });
        await hearingActivity(tx, e.id, id, me, `Attendance recorded for Hearing ${N} by ${by}`);
      });
    }

    else if (d.action === 'proceedings') {
      await prisma.$transaction(async tx => {
        // Touch the hearing so its "last updated" moves; the note itself is the event.
        await write(tx, {});
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'proceedings_note', actorType: 'official', actorId: me, note: d.note });
        await hearingActivity(tx, e.id, id, me, `Proceedings note added to Hearing ${N} by ${by}`);
      });
    }

    else if (d.action === 'complete') {
      if (!hasDayArrived(h.scheduledAt)) return errorResponse(`Hearing ${N} is set for ${formatHearingWhen(h.scheduledAt)}. It can be recorded as held from that day.`, 409);
      const cA = d.complainantAttendance ?? h.complainantAttendance;
      const rA = d.respondentAttendance ?? h.respondentAttendance;
      if (cA === 'NOT_RECORDED' || rA === 'NOT_RECORDED') return errorResponse('Record who attended (complainant and respondent) before recording the outcome.', 400);
      const ends = HEARING_OUTCOMES[d.outcome].ends;
      if (d.nextHearingDate && (ends || N === 3)) {
        return errorResponse(N === 3 ? 'Hearing 3 is the last hearing - record the next action instead of a next hearing date.' : 'This outcome ends the proceedings, so no next hearing date applies.', 400);
      }
      const nextAt = d.nextHearingDate ? phInstant(d.nextHearingDate, '00:00') : null;
      if (d.nextHearingDate && (!nextAt || isPastDay(nextAt))) return errorResponse('The next hearing date must be today or later.', 400);
      await prisma.$transaction(async tx => {
        await write(tx, { status: 'COMPLETED', openKey: null, outcome: d.outcome, agreements: d.agreements || null, outcomeSummary: d.outcomeSummary || null,
          nextAction: d.nextAction || null, nextHearingAt: nextAt, complainantAttendance: cA, respondentAttendance: rA,
          completedAt: new Date(), completedById: me });
        await tx.caseHearingRequest.updateMany({ where: { hearingId: hid, status: 'PENDING' },
          data: { status: 'DECLINED', pendingKey: null, reviewedById: me, reviewedAt: new Date(), reviewNote: 'The hearing was held on its date.' } });
        if (cA !== h.complainantAttendance || rA !== h.respondentAttendance) {
          await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'attendance', actorType: 'official', actorId: me,
            before: { complainantAttendance: h.complainantAttendance, respondentAttendance: h.respondentAttendance }, after: { complainantAttendance: cA, respondentAttendance: rA } });
        }
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'outcome', actorType: 'official', actorId: me,
          after: { hearingNumber: N, outcome: d.outcome, outcomeSummary: d.outcomeSummary || null, nextAction: d.nextAction || null, nextHearingAt: nextAt?.toISOString() ?? null } });
        await hearingActivity(tx, e.id, id, me, `Hearing ${N} held - ${HEARING_OUTCOMES[d.outcome].label.toLowerCase()} (recorded by ${by})${d.nextAction ? `. Next action: ${d.nextAction}` : ''}`);
      });
    }

    else if (d.action === 'cancel') {
      await prisma.$transaction(async tx => {
        await write(tx, { status: 'CANCELLED', activeKey: null, openKey: null, statusReason: d.reason, cancelledAt: new Date(), cancelledById: me });
        await tx.caseHearingNotice.updateMany({ where: { hearingId: hid, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
        await tx.caseHearingRequest.updateMany({ where: { hearingId: hid, status: 'PENDING' },
          data: { status: 'DECLINED', pendingKey: null, reviewedById: me, reviewedAt: new Date(), reviewNote: 'The hearing was cancelled.' } });
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'cancelled', actorType: 'official', actorId: me,
          before: { status: h.status }, after: { hearingNumber: N, wasDraft: h.status === 'DRAFT' }, note: d.reason });
        await hearingActivity(tx, e.id, id, me, `Hearing ${N} cancelled by ${by}`);
      });
    }

    else if (d.action === 'decline_request') {
      const request = await prisma.caseHearingRequest.findFirst({ where: { id: d.requestId, hearingId: hid, status: 'PENDING' } });
      if (!request) return errorResponse('That request is no longer waiting for a decision. Reload to see it.', 409);
      await prisma.$transaction(async tx => {
        const r = await tx.caseHearingRequest.updateMany({ where: { id: request.id, status: 'PENDING' },
          data: { status: 'DECLINED', pendingKey: null, reviewedById: me, reviewedAt: new Date(), reviewNote: d.note } });
        if (!r.count) throw new Conflict();
        const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'request_declined', actorType: 'official', actorId: me,
          after: { hearingNumber: N, reviewNote: d.note, requestId: request.id } });
        await hearingActivity(tx, e.id, id, me, `Complainant's request for a new date on Hearing ${N} declined by ${by}`);
      });
    }

    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Conflict) return errorResponse('This hearing was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The hearing could not be updated right now.', 503);
  }
}
