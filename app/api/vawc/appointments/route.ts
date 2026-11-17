import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { parseRange } from '@/lib/analytics';
import { phInstant } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import {
  APPOINTMENT_TYPE_KEYS, PARTICIPANT_KEYS, NOTIFY_KEYS, APPOINTMENT_VIEW_KEYS, inView, typeLabel, isOpenAppointment,
  normalizeParticipants, notifyRefusal, residentNotified, forbiddenRequest, appointmentTimeRefusal, courtRefusal, isCourtType,
  COURT_MATTER_KEYS, COURT_SOURCE_KEYS, MODULE_LABEL, type AppointmentView,
} from '@/lib/vawcAppointments';
import {
  noStore, gateAppointments, decideAppointmentAccess, appointmentScope, checkOfficer, officerConflicts, conflictReply, nextAppointmentReference,
  recordAppointmentEvent, appointmentActivity, notifyAppointmentOfficials, appointmentSnap, logAccess,
} from '@/lib/vawcAppointmentsServer';

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

const createSchema = z.object({
  caseId: z.string().min(1).max(64),
  type: z.enum(APPOINTMENT_TYPE_KEYS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the time'),
  venue: z.string().trim().min(2, 'Enter the venue or approved meeting location').max(200),
  assignedOfficerId: z.string().max(64).nullable().optional(),
  participants: z.array(z.enum(PARTICIPANT_KEYS)).min(1, 'Choose who the appointment is for').max(PARTICIPANT_KEYS.length),
  purpose: z.string().trim().min(5, 'Write the purpose (at least 5 characters)').max(1000),
  internalNotes: z.string().trim().max(2000).optional(),
  notifyVia: z.enum(NOTIFY_KEYS),
  residentInstructions: z.string().trim().max(500).optional(),
  confirmConflicts: z.boolean().optional(),
  // External court hearing only.
  courtMatter: z.enum(COURT_MATTER_KEYS).optional(),
  courtSource: z.enum(COURT_SOURCE_KEYS).optional(),
  courtReference: z.string().trim().max(100).optional(),
  /** One per Create form: a repeat of the same submit returns the hearing already saved. */
  submissionKey: z.string().trim().min(8).max(64).optional(),
});

/** Save a hearing on a VAWC case - the case by its id, never by a name. */
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const forbidden = forbiddenRequest(raw);
  if (forbidden) return errorResponse(forbidden, 400);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the hearing details', 400);
  const d = parsed.data;
  const courtErr = courtRefusal(d.type, d);
  if (courtErr) return errorResponse(courtErr, 400);
  const g = await gateAppointments(req, d.caseId, 'edit');
  if ('error' in g) return g.error;
  const { actor, c } = g;
  const at = phInstant(d.date, d.time);
  const refusal = appointmentTimeRefusal(at);
  if (refusal || !at) return errorResponse(refusal ?? 'Choose a valid date and time.', 400);
  const participants = normalizeParticipants(d.participants, c.reportingRelationship);
  const notify = notifyRefusal(d.notifyVia, { hasAccount: Boolean(c.residentId) }, participants);
  if (notify) return errorResponse(notify, 400);
  const officerId = d.assignedOfficerId === undefined ? (c.assignedToId ?? actor.id) : d.assignedOfficerId;
  const badOfficer = await checkOfficer(officerId);
  if (badOfficer) return errorResponse(badOfficer, 400);
  // Already saved from this form (a double click, or a retry after a lost reply): the same record, nothing new.
  const already = async () => d.submissionKey
    ? prisma.vawcAppointment.findUnique({ where: { submissionKey: d.submissionKey }, select: { id: true, caseId: true, reference: true, createdById: true } })
    : null;
  try {
    const sameForm = (p: NonNullable<Awaited<ReturnType<typeof already>>>) => p.caseId !== c.id || p.createdById !== actor.id
      ? errorResponse('This form was already used for another record. Close it and start again.', 409)
      : noStore({ success: true, data: { id: p.id, caseId: p.caseId, reference: p.reference, duplicate: true } });
    const prior = await already();
    if (prior) return sameForm(prior);
    if (!d.confirmConflicts) {
      const conflicts = await officerConflicts(officerId, at);
      if (conflicts.length) {
        // The "conflict" may be this same form, saved a moment ago by an overlapping submit.
        const justSaved = await already();
        return justSaved ? sameForm(justSaved) : conflictReply(conflicts);
      }
    }
    const by = (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'an official';
    const a = await prisma.$transaction(async tx => {
      const created = await tx.vawcAppointment.create({ data: {
        caseId: c.id, reference: await nextAppointmentReference(tx, c.id, c.caseNumber), type: d.type, scheduledAt: at, venue: d.venue,
        assignedOfficerId: officerId, participants, purpose: d.purpose, internalNotes: d.internalNotes || null, notifyVia: d.notifyVia,
        residentInstructions: d.residentInstructions || null, createdById: actor.id, updatedById: actor.id,
        courtMatter: isCourtType(d.type) ? d.courtMatter : null, courtSource: isCourtType(d.type) ? d.courtSource : null,
        courtReference: isCourtType(d.type) ? d.courtReference || null : null, submissionKey: d.submissionKey ?? null,
      } });
      const e = await recordAppointmentEvent(tx, { appointmentId: created.id, caseId: c.id, kind: 'created', actorType: 'official', actorId: actor.id,
        after: { ...appointmentSnap(created), venue: created.venue, participants, notifyVia: created.notifyVia, assignedOfficerId: officerId } });
      await appointmentActivity(tx, e.id, c.id, actor.id, `${typeLabel(d.type)} scheduled (${created.reference}) by ${by}`);
      if (residentNotified(created)) {
        await recordAppointmentEvent(tx, { appointmentId: created.id, caseId: c.id, kind: 'resident_notified', actorType: 'system', actorId: null, after: appointmentSnap(created) });
      }
      await notifyAppointmentOfficials(tx, created, c, `VAWC hearing scheduled - ${c.caseNumber}`,
        `${typeLabel(d.type)} (${created.reference}) is set. Open ${MODULE_LABEL} for the details.`, 'info', actor.id);
      return created;
    });
    await g.log('permitted', 'created');
    return noStore({ success: true, data: { id: a.id, caseId: a.caseId, reference: a.reference } }, 201);
  } catch (e) {
    // Two submits of one form at the same moment: the second finds the first.
    if (d.submissionKey && /P2002|Unique constraint/i.test(`${(e as { code?: string }).code ?? ''} ${e instanceof Error ? e.message : ''}`)) {
      const prior = await already().catch(() => null);
      if (prior && prior.caseId === c.id) return noStore({ success: true, data: { id: prior.id, caseId: prior.caseId, reference: prior.reference, duplicate: true } });
    }
    logRouteError('POST /api/vawc/appointments', e);
    return errorResponse('The hearing could not be saved right now. Nothing was changed.', 503);
  }
}
