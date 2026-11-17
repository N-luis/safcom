import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { logRouteError } from '@/lib/hearingCasesServer';
import { noStore, gateAppointments, loadAppointment, officialView, appointmentCaseContext, appointmentOfficers, logAccess } from '@/lib/vawcAppointmentsServer';

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

/**
 * Retired: VAWC Appointments were merged into the hearing workflow, which
 * VAWC cases now share with blotter cases. The appointment records stay,
 * read-only, for one release (each one migrated is linked from its hearing:
 * CaseHearing.migratedFromAppointmentId). Nothing is written here any more -
 * a hearing is created with POST /api/cases/:id/hearings.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  return Response.json({
    success: false, code: 'appointments_retired',
    error: 'Appointments are now hearings. Create or change it in Hearings (the same workflow as blotter hearings) - nothing was saved here.',
    use: 'PATCH /api/cases/:caseId/hearings/:hearingId',
  }, { status: 410, headers: { 'Cache-Control': 'no-store, private' } });
}
