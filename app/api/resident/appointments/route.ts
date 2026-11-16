import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { logRouteError } from '@/lib/hearingCasesServer';
import { noStore, residentAppointmentWhere, recordAppointmentEvent } from '@/lib/vawcAppointmentsServer';
import {
  APPOINTMENT_TYPES, isOpenAppointment, residentAppointmentMessage, RESIDENT_APPOINTMENT_EVENTS, RESIDENT_APPOINTMENT_INSTRUCTIONS,
  RESCHEDULE_REQUESTS_PER_APPOINTMENT, phDay, type AppointmentType,
} from '@/lib/vawcAppointments';

export const dynamic = 'force-dynamic';

const RESIDENT_STATUS: Record<string, string> = {
  SCHEDULED: 'Scheduled', RESCHEDULED: 'New date', COMPLETED: 'Done', NOT_HELD: 'Did not take place', CANCELLED: 'Cancelled',
};

/**
 * My Appointments: the appointments on the resident's own reports that the
 * officer chose to tell them about - the kind (in general words), the date,
 * time and place, what to bring, their acknowledgement and their requests
 * for a new date. Never the reference or case number, the purpose, the
 * officer, the other participants, internal notes, the outcome, attendance,
 * follow-up actions or referral records.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const me = auth.resident.residentId;
  try {
    const rows = await prisma.vawcAppointment.findMany({
      where: residentAppointmentWhere(me),
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, type: true, scheduledAt: true, venue: true, status: true, rescheduleCount: true, residentInstructions: true,
        residentSeenAt: true, residentAcknowledgedAt: true, caseId: true,
        requests: { where: { residentId: me }, orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, reason: true, preferredSchedule: true, reviewNote: true, createdAt: true, reviewedAt: true } },
        events: { where: { kind: { in: [...RESIDENT_APPOINTMENT_EVENTS] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, after: true, createdAt: true } },
      },
    });
    // Opening the page is seeing the appointment: kept in its history once per date.
    const unseen = rows.filter(a => isOpenAppointment(a.status) && !a.residentSeenAt);
    if (unseen.length) {
      await prisma.$transaction(async tx => {
        for (const a of unseen) {
          const r = await tx.vawcAppointment.updateMany({ where: { id: a.id, residentSeenAt: null }, data: { residentSeenAt: new Date() } });
          if (r.count) await recordAppointmentEvent(tx, { appointmentId: a.id, caseId: a.caseId, kind: 'resident_seen', actorType: 'resident', actorId: me, after: { scheduledAt: a.scheduledAt.toISOString() } });
        }
      }).catch(() => undefined);
    }
    const today = phDay(new Date());
    const view = rows.map(a => {
      const open = isOpenAppointment(a.status);
      const notPast = phDay(a.scheduledAt) >= today;
      const pending = a.requests.find(r => r.status === 'PENDING');
      return {
        id: a.id,
        title: a.type in APPOINTMENT_TYPES ? APPOINTMENT_TYPES[a.type as AppointmentType].resident : 'Appointment',
        scheduledAt: a.scheduledAt, venue: a.venue,
        status: a.status, statusLabel: RESIDENT_STATUS[a.status] ?? 'Scheduled',
        upcoming: open && notPast, rescheduled: a.rescheduleCount > 0,
        acknowledgedAt: a.residentAcknowledgedAt,
        canAcknowledge: open && notPast && !a.residentAcknowledgedAt,
        canRequest: open && notPast && !pending && a.requests.length < RESCHEDULE_REQUESTS_PER_APPOINTMENT,
        requests: a.requests,
        instructions: open ? [...RESIDENT_APPOINTMENT_INSTRUCTIONS, ...(a.residentInstructions ? [a.residentInstructions] : [])] : [],
        updates: a.events.flatMap(e => { const m = residentAppointmentMessage(e); return m ? [{ id: e.id, message: m, at: e.createdAt }] : []; }),
      };
    });
    return noStore({ success: true, data: { upcoming: view.filter(a => a.upcoming), all: [...view].reverse() } });
  } catch (e) {
    logRouteError('GET /api/resident/appointments', e);
    return rError('Your appointments could not be loaded right now.', 503);
  }
}
