import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore, recordEvent, notifyOfficials, isUniqueViolation, residentHearingWhere, partyRoleOf, hearingPartySelect, syncHearingStatus, hearingSnap } from '@/lib/hearingsServer';
import { isLive, phDay, sessionTitle, kpFormName, RESCHEDULE_REQUESTS_PER_HEARING } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';

/**
 * What a party may do about a proceeding they are a party to:
 *   acknowledge  their own issued notice (receipt only - it does not mark attendance)
 *   attendance   the complainant says whether they will attend (their answer, not the official record)
 *   reschedule   ask for a new date - an official decides; the date does not move
 *
 * None of these touches the schedule, the attendance record, the notes or
 * the outcome. Each is kept in the proceeding's history and the officials
 * handling it are told.
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acknowledge'), noticeId: z.string().max(64).optional() }),
  z.object({ action: z.literal('attendance'), intent: z.enum(['WILL_ATTEND', 'CANNOT_ATTEND']) }),
  z.object({ action: z.literal('reschedule'), reason: z.string().trim().min(10, 'Tell the barangay why you need a new date (at least 10 characters)').max(500),
    preferredSchedule: z.string().trim().max(200).optional() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ hid: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { hid } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check your answer', 400);
  const d = parsed.data;
  const residentId = auth.resident.residentId;
  try {
    // Only a proceeding this resident is a party to, already scheduled; anything else is not found.
    const h = await prisma.caseHearing.findFirst({
      where: { id: hid, ...residentHearingWhere(residentId) },
      include: { case: { select: { id: true, caseNumber: true, assignedToId: true } }, ...hearingPartySelect },
    });
    if (!h) return rError('Hearing not found', 404);
    if (!isLive(h.status)) return rError('This hearing is no longer scheduled.', 409);
    const role = partyRoleOf(h, residentId);
    const side = role === 'RESPONDENT' ? 'The respondent' : 'The complainant';
    const title = sessionTitle(h.stage, h.session);
    const ev = (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], kind: string, after: Record<string, unknown>, note?: string) =>
      recordEvent(tx, { hearingId: h.id, caseId: h.caseId, kind, actorType: 'resident', actorId: residentId,
        after: { ...hearingSnap(h, h.scheduledAt, h.venue), requesterRole: role, ...after }, note });

    if (d.action === 'acknowledge') {
      const n = await prisma.caseHearingNotice.findFirst({
        where: { hearingId: h.id, recipientRole: role, status: { in: ['ISSUED', 'DELIVERED', 'UNDELIVERED'] }, ...(d.noticeId && { id: d.noticeId }) },
        orderBy: { generatedAt: 'desc' },
      });
      if (!n) return rError('There is no issued notice to acknowledge for this hearing.', 409);
      await prisma.$transaction(async tx => {
        const r = await tx.caseHearingNotice.updateMany({ where: { id: n.id, status: n.status },
          data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedVia: 'RESIDENT_APP', seenAt: n.seenAt ?? new Date() } });
        if (!r.count) throw new Error('changed');
        await ev(tx, 'notice_acknowledged', { formNo: n.formNo, recipientRole: role, noticeNumber: n.noticeNumber, status: 'ACKNOWLEDGED', via: 'RESIDENT_APP' });
        await syncHearingStatus(tx, h, null);
        await notifyOfficials(tx, h, h.case, `Notice acknowledged - ${h.case.caseNumber}`, `${side} acknowledged ${kpFormName(n.formNo)} for the ${title.toLowerCase()}. This is a receipt, not attendance.`);
      });
      return noStore({ success: true });
    }

    if (phDay(h.scheduledAt) < phDay(new Date())) return rError('This hearing date has passed.', 409);

    if (d.action === 'attendance') {
      if (role !== 'COMPLAINANT') return rError('Acknowledge the summons, or ask for a new date if you cannot attend.', 400);
      await prisma.$transaction(async tx => {
        await tx.caseHearing.update({ where: { id: h.id }, data: { residentIntent: d.intent, residentIntentAt: new Date() } });
        await ev(tx, 'resident_intent', { intent: d.intent });
        await notifyOfficials(tx, h, h.case, `Attendance reply - ${h.case.caseNumber}`,
          d.intent === 'WILL_ATTEND' ? `The complainant confirmed they will attend the ${title.toLowerCase()}.` : `The complainant said they cannot attend the ${title.toLowerCase()}.`,
          d.intent === 'WILL_ATTEND' ? 'info' : 'warning');
      });
      return noStore({ success: true });
    }

    // reschedule
    const made = await prisma.caseHearingRequest.count({ where: { hearingId: h.id, residentId } });
    if (made >= RESCHEDULE_REQUESTS_PER_HEARING) return rError(`You have already asked ${RESCHEDULE_REQUESTS_PER_HEARING} times for this hearing. Please contact the barangay hall.`, 429);
    const request = await prisma.$transaction(async tx => {
      const r = await tx.caseHearingRequest.create({ data: {
        hearingId: h.id, caseId: h.caseId, residentId, requesterRole: role, reason: d.reason, preferredSchedule: d.preferredSchedule || null, pendingKey: `${h.id}:${role}`,
      } });
      await ev(tx, 'reschedule_requested', { requestId: r.id }, d.reason);
      await notifyOfficials(tx, h, h.case, `New date requested - ${h.case.caseNumber}`,
        `${side} asked for a new date for the ${title.toLowerCase()}. Open the hearing to approve or decline.`, 'warning');
      return r;
    });
    return noStore({ success: true, data: { id: request.id, status: request.status } }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return rError('You already have a request waiting for this hearing.', 409);
    if (e instanceof Error && e.message === 'changed') return rError('This notice was just updated. Reload to see it.', 409);
    logRouteError('POST /api/resident/hearings/[hid]', e);
    return rError('That could not be saved right now.', 503);
  }
}
