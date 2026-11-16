import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { logRouteError } from '@/lib/hearingCasesServer';
import { noStore, residentAppointmentWhere, recordAppointmentEvent, notifyAppointmentOfficials, appointmentSnap } from '@/lib/vawcAppointmentsServer';
import { isOpenAppointment, phDay, RESCHEDULE_REQUESTS_PER_APPOINTMENT } from '@/lib/vawcAppointments';

/**
 * What a resident may do about their own appointment:
 *   acknowledge  they have seen the date (it does not mark attendance)
 *   reschedule   ask for a new date - an official decides; the date does not move
 * Neither touches the schedule, the notes or the outcome. Each is kept in the
 * appointment's history, and the officials handling it are told.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acknowledge') }),
  z.object({ action: z.literal('reschedule'), reason: z.string().trim().min(5, 'Tell the barangay why you need a new date (at least 5 characters)').max(500),
    preferredSchedule: z.string().trim().max(200).optional() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { aid } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check your answer', 400);
  const d = parsed.data;
  const me = auth.resident.residentId;
  try {
    // Only an appointment on this resident's own report that they were told about; anything else is not found.
    const a = await prisma.vawcAppointment.findFirst({
      where: { id: aid.slice(0, 64), ...residentAppointmentWhere(me) },
      include: { case: { select: { id: true, caseNumber: true, assignedToId: true } } },
    });
    if (!a) return rError('Appointment not found', 404);
    if (!isOpenAppointment(a.status)) return rError('This appointment is no longer scheduled.', 409);
    if (phDay(a.scheduledAt) < phDay(new Date())) return rError('This appointment date has passed.', 409);

    if (d.action === 'acknowledge') {
      if (a.residentAcknowledgedAt) return noStore({ success: true, data: { already: true } });
      await prisma.$transaction(async tx => {
        const r = await tx.vawcAppointment.updateMany({ where: { id: a.id, residentAcknowledgedAt: null, scheduledAt: a.scheduledAt },
          data: { residentAcknowledgedAt: new Date(), residentSeenAt: a.residentSeenAt ?? new Date() } });
        if (!r.count) throw new Error('changed');
        await recordAppointmentEvent(tx, { appointmentId: a.id, caseId: a.caseId, kind: 'resident_acknowledged', actorType: 'resident', actorId: me, after: appointmentSnap(a) });
        await notifyAppointmentOfficials(tx, a, a.case, `Hearing acknowledged by the resident - ${a.case.caseNumber}`, `The resident acknowledged ${a.reference}. This is a receipt, not attendance.`);
      });
      return noStore({ success: true });
    }

    const made = await prisma.vawcAppointmentRequest.count({ where: { appointmentId: a.id, residentId: me } });
    if (made >= RESCHEDULE_REQUESTS_PER_APPOINTMENT) return rError(`You have already asked ${RESCHEDULE_REQUESTS_PER_APPOINTMENT} times for this appointment. Please contact the barangay when it is safe.`, 429);
    const request = await prisma.$transaction(async tx => {
      const r = await tx.vawcAppointmentRequest.create({ data: {
        appointmentId: a.id, caseId: a.caseId, residentId: me, reason: d.reason, preferredSchedule: d.preferredSchedule || null, pendingKey: a.id,
      } });
      await recordAppointmentEvent(tx, { appointmentId: a.id, caseId: a.caseId, kind: 'reschedule_requested', actorType: 'resident', actorId: me,
        after: { ...appointmentSnap(a), requestId: r.id }, note: d.reason });
      await notifyAppointmentOfficials(tx, a, a.case, `New date requested - ${a.case.caseNumber}`,
        `The resident asked for a new date for ${a.reference}. Open Hearings to set one or reply.`, 'warning');
      return r;
    });
    return noStore({ success: true, data: { id: request.id, status: request.status } }, 201);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') return rError('You already have a request waiting for this appointment.', 409);
    if (e instanceof Error && e.message === 'changed') return rError('This appointment was just updated. Reload to see it.', 409);
    logRouteError('POST /api/resident/appointments/[aid]', e);
    return rError('That could not be saved right now.', 503);
  }
}
