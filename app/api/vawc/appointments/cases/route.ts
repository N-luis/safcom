import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { CLOSED_CASE_STATUSES } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import {
  noStore, gateAppointments, decideAppointmentAccess, appointmentScope, appointmentCaseContext, appointmentOfficers, logAccess,
} from '@/lib/vawcAppointmentsServer';

export const dynamic = 'force-dynamic';

/**
 * The VAWC cases an appointment can be made on, for Create Appointment.
 * Read from the case records - VAWC categories only, never a blotter case -
 * and shown by reference, category, status and filing date: no names and
 * no narrative. Search is by case reference.
 *
 *   ?q=        part of a case reference (any status)
 *   ?caseId=   one case: what scheduling needs (access, the reporter's
 *              account and safe-contact preference, the officers) - logged
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const caseId = sp.get('caseId')?.trim().slice(0, 64) || null;
  if (caseId) {
    const g = await gateAppointments(req, caseId, 'view');
    if ('error' in g) return g.error;
    try {
      const [officers, count] = await Promise.all([appointmentOfficers(), prisma.vawcAppointment.count({ where: { caseId } })]);
      await g.log('permitted', `${g.access.code}:context`);
      return noStore({ success: true, data: {
        case: appointmentCaseContext(g.c), officers, appointments: count,
        canEdit: g.access.edit, accessMessage: g.access.message, canClaim: g.access.canClaim,
      } });
    } catch (e) {
      logRouteError('GET /api/vawc/appointments/cases?caseId', e);
      return errorResponse('The case could not be loaded right now.', 503);
    }
  }

  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  if (!appointmentScope(actor)) {
    await logAccess(actor, '(appointment cases)', null, 'denied', 'role_not_permitted');
    return noStore({ success: false, error: 'VAWC Appointments are for the VAWC desk.', code: 'wrong_desk' }, 403);
  }
  const q = sp.get('q')?.trim().slice(0, 40) || null;
  try {
    const cases = await prisma.case.findMany({
      where: {
        caseType: { in: [...VAWC_TYPES] },
        ...(q ? { caseNumber: { contains: q, mode: 'insensitive' } } : { status: { notIn: CLOSED_CASE_STATUSES } }),
      },
      orderBy: { filedAt: 'desc' }, take: 200,
      select: { id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, filedAt: true, assignedToId: true,
        assignedTo: { select: { id: true, name: true } } },
    });
    const rows = cases.map(c => {
      const access = decideAppointmentAccess(actor, c);
      return {
        id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status, riskLevel: c.riskLevel, filedAt: c.filedAt,
        assignedTo: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name, me: c.assignedTo.id === actor.id } : null,
        canSchedule: access.edit, canClaim: access.canClaim,
      };
    })
      // Their own cases first, then the ones they can take, newest first within each.
      .sort((a, b) => Number(b.canSchedule) - Number(a.canSchedule) || Number(b.canClaim) - Number(a.canClaim))
      .slice(0, 50);
    await logAccess(actor, '(appointment cases)', null, 'permitted', 'list');
    return noStore({ success: true, data: { rows } });
  } catch (e) {
    logRouteError('GET /api/vawc/appointments/cases', e);
    return errorResponse('The cases could not be loaded right now.', 503);
  }
}
