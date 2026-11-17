import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { parseRange } from '@/lib/analytics';
import { logRouteError } from '@/lib/hearingCasesServer';
import { APPOINTMENT_TYPE_KEYS, APPOINTMENT_VIEW_KEYS, inView, typeLabel, isOpenAppointment, type AppointmentView } from '@/lib/vawcAppointments';
import { noStore, decideAppointmentAccess, appointmentScope, logAccess } from '@/lib/vawcAppointmentsServer';

export const dynamic = 'force-dynamic';

/**
 * VAWC Hearings (stored as VawcAppointment): the records an official may see,
 * for the list and the calendar - one query, so both show the same rows.
 * VAWC cases only, by construction.
 *
 *   VAWC officer   appointments on the cases assigned to them, or assigned to them
 *   captain        every VAWC appointment (managing them when assigned)
 *   anyone else    refused - blotter officers and the system administrator included
 *
 *   ?view=upcoming|past|rescheduled|completed|cancelled  ?from= &to= (Philippine days)
 *   ?type= &officer= &q= (case number or appointment reference) &caseId= (one case)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  const scope = appointmentScope(actor);
  if (!scope) {
    await logAccess(actor, '(appointments)', null, 'denied', 'role_not_permitted');
    return noStore({ success: false, error: 'VAWC Hearings are for the VAWC desk.', code: 'wrong_desk' }, 403);
  }
  const sp = req.nextUrl.searchParams;
  const view = (APPOINTMENT_VIEW_KEYS as string[]).includes(sp.get('view') ?? '') ? sp.get('view') as AppointmentView : null;
  const type = (APPOINTMENT_TYPE_KEYS as string[]).includes(sp.get('type') ?? '') ? sp.get('type')! : null;
  const officer = sp.get('officer')?.trim().slice(0, 64) || null;
  const q = sp.get('q')?.trim().slice(0, 60) || null;
  const caseId = sp.get('caseId')?.trim().slice(0, 64) || null;
  const { from, to } = parseRange(sp.get('from'), sp.get('to'));
  try {
    const all = await prisma.vawcAppointment.findMany({
      where: caseId ? { AND: [scope, { caseId }] } : scope, orderBy: { scheduledAt: 'asc' }, take: 2000,
      include: {
        case: { select: { id: true, caseNumber: true, caseType: true, status: true, assignedToId: true } },
        assignedOfficer: { select: { id: true, name: true } },
        requests: { where: { status: 'PENDING' }, select: { id: true } },
      },
    });
    const now = new Date();
    const rows = all.map(a => ({
      id: a.id, reference: a.reference, type: a.type, typeLabel: typeLabel(a.type), scheduledAt: a.scheduledAt, venue: a.venue, status: a.status,
      case: { id: a.case.id, caseNumber: a.case.caseNumber, caseType: a.case.caseType, status: a.case.status }, courtMatter: a.courtMatter,
      officer: a.assignedOfficer, participants: a.participants, notifyVia: a.notifyVia, rescheduleCount: a.rescheduleCount,
      acknowledged: Boolean(a.residentAcknowledgedAt), pendingRequests: a.requests.length,
      overdue: isOpenAppointment(a.status) && a.scheduledAt < now,
      canEdit: decideAppointmentAccess(actor, a.case, a.assignedOfficerId === actor.id).edit,
    }));
    const count = (v: AppointmentView) => all.filter(a => inView(a, v, now)).length;
    const shown = rows.filter(r => (!view || inView(r, view, now))
      && (!type || r.type === type) && (!officer || r.officer?.id === officer)
      && (!from || r.scheduledAt >= from) && (!to || r.scheduledAt <= to)
      && (!q || r.reference.toLowerCase().includes(q.toLowerCase()) || r.case.caseNumber.toLowerCase().includes(q.toLowerCase())));
    await logAccess(actor, '(appointments)', null, 'permitted', 'list');
    const officers = [...new Map(all.flatMap(a => (a.assignedOfficer ? [[a.assignedOfficer.id, a.assignedOfficer] as const] : []))).values()]
      .sort((x, y) => x.name.localeCompare(y.name));
    return noStore({ success: true, data: {
      rows: view === 'past' || view === 'completed' || view === 'cancelled' ? shown.reverse() : shown,
      summary: {
        upcoming: count('upcoming'), overdue: rows.filter(r => r.overdue).length,
        pendingRequests: rows.reduce((n, r) => n + r.pendingRequests, 0),
        rescheduled: count('rescheduled'), completed: count('completed'), cancelled: count('cancelled'),
      },
      canCreate: true,
      filters: { officers },
    } });
  } catch (e) {
    logRouteError('GET /api/vawc/appointments', e);
    return errorResponse('The hearings could not be loaded right now.', 503);
  }
}

/**
 * Retired: VAWC Appointments were merged into the hearing workflow, which
 * VAWC cases now share with blotter cases. The appointment records stay,
 * read-only, for one release (each one migrated is linked from its hearing:
 * CaseHearing.migratedFromAppointmentId). Nothing is written here any more -
 * a hearing is created with POST /api/cases/:id/hearings.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  return Response.json({
    success: false, code: 'appointments_retired',
    error: 'Appointments are now hearings. Create or change it in Hearings (the same workflow as blotter hearings) - nothing was saved here.',
    use: 'POST /api/cases/:caseId/hearings',
  }, { status: 410, headers: { 'Cache-Control': 'no-store, private' } });
}
