/**
 * Server side of VAWC Appointments & Follow-ups: who may see or run a VAWC
 * case's appointments, the case they belong to, their history and the
 * notices they send.
 *
 * ACCESS follows the VAWC case records (lib/officialIntake decideIntakeAccess),
 * read fresh on every request:
 *   - the VAWC officer the case is assigned to - or the officer assigned to
 *     the appointment - creates and manages its appointments;
 *   - the Punong Barangay ('admin') may view them, and manage them when
 *     assigned (the case or the appointment);
 *   - another VAWC officer is refused, and told they can take an unassigned case;
 *   - to anyone else - blotter officers and the system administrator
 *     included - a VAWC case and its appointments do not exist (404).
 * A blotter case never has an appointment here: it is refused with the reason.
 * Every look, refusal and change is written to ReporterAccessLog (field
 * "vawc_appointments") - never a name, note or purpose.
 */
import 'server-only';
import { NextRequest } from 'next/server';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { requireAuth, errorResponse } from './auth';
import { canSeeVawc } from './caseAccess';
import { loadActor, VAWC_DESK_ROLES, isVawcType, PREFERENCE_GUIDANCE, type Actor, type ContactPreference } from './reporterAccess';
import { noStore } from './caseRecordsServer';
import { VAWC_TYPES } from './vawcTypes';
import { HEARING_SLOT_MINUTES } from './safecommConfig';
import { formatHearingWhen } from './hearings';
import { reporterIsVictim, participantChoices, isOpenAppointment, typeLabel } from './vawcAppointments';

export { noStore };

export const LOG_FIELD = 'vawc_appointments';

/** Who may be assigned to an appointment: the VAWC desk, or the Punong Barangay. */
export const APPOINTMENT_OFFICER_ROLES = [...VAWC_DESK_ROLES, 'admin'];

export interface AppointmentAccess { view: boolean; edit: boolean; hidden: boolean; code: string; message: string | null; canClaim: boolean }

export const NOT_VAWC_MESSAGE = 'VAWC Appointments are for VAWC cases only. Blotter cases are scheduled in Hearing Management.';

/** The rule, on its own so it can be tested. `officer`: the actor is assigned to one of the case's appointments. */
export function decideAppointmentAccess(actor: Actor, c: { caseType: string; assignedToId: string | null }, officer = false): AppointmentAccess {
  const role = actor.role.trim();
  const no = (code: string, message: string, extra: Partial<AppointmentAccess> = {}): AppointmentAccess =>
    ({ view: false, edit: false, hidden: false, code, message, canClaim: false, ...extra });
  if (!actor.active) return no('inactive', 'Your account is not active.');
  if (!isVawcType(c.caseType)) return no('not_vawc', NOT_VAWC_MESSAGE);
  if (!canSeeVawc(role)) return no('vawc_restricted', 'Case not found.', { hidden: true });
  const mine = c.assignedToId === actor.id || officer;
  if (VAWC_DESK_ROLES.includes(role)) {
    if (mine) return { view: true, edit: true, hidden: false, code: 'assigned', message: null, canClaim: false };
    return no('not_assigned', 'Only the VAWC officer assigned to this case (or to the appointment) can manage its appointments. Take the case first if it is unassigned.',
      { canClaim: c.assignedToId === null });
  }
  if (role === 'admin') {
    return { view: true, edit: mine, hidden: false, code: 'oversight', canClaim: false,
      message: mine ? null : 'You can view these appointments. Managing them is for the VAWC officer the case is assigned to.' };
  }
  return no('role_not_permitted', 'Your role cannot open VAWC appointments.');
}

/** What the appointment routes need about the case - no narrative, no people. */
export async function loadAppointmentCase(caseId: string) {
  return prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, filedAt: true, assignedToId: true, residentId: true,
      reportingRelationship: true, reporterIdentityWithheld: true, contactPreference: true, contactSafetyNote: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
}
export type AppointmentCase = NonNullable<Awaited<ReturnType<typeof loadAppointmentCase>>>;

export type AppointmentGate =
  | { error: Response }
  | { actor: Actor; c: AppointmentCase; access: AppointmentAccess; log: (outcome: 'permitted' | 'denied', code: string) => Promise<void> };

/** Writes one line to the access log: who, which case, what was allowed - never a value. */
export const logAccess = (actor: Actor | null, caseId: string, caseNumber: string | null, outcome: 'permitted' | 'denied', code: string) =>
  prisma.reporterAccessLog.create({
    data: { actorId: actor?.id ?? null, actorRole: actor?.role ?? null, caseId: caseId.slice(0, 64), caseNumber, fields: [LOG_FIELD], outcome, code },
  }).then(() => undefined).catch(() => undefined);

/** May this official see (or run) this case's appointments? Logged either way. */
export async function gateAppointments(req: NextRequest, caseId: string, need: 'view' | 'edit', appointmentId?: string | null): Promise<AppointmentGate> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor) return { error: errorResponse('Unauthorized', 401) };
  let c: AppointmentCase | null;
  let officer = false;
  try {
    c = await loadAppointmentCase(caseId);
    if (c && c.assignedToId !== actor.id) {
      officer = (await prisma.vawcAppointment.count({ where: { caseId, assignedOfficerId: actor.id, ...(appointmentId && { id: appointmentId }) } })) > 0;
    }
  } catch {
    return { error: errorResponse('The case could not be loaded right now. Nothing was changed.', 503) };
  }
  const suffix = need === 'edit' ? ':edit' : '';
  const log = (outcome: 'permitted' | 'denied', code: string) => logAccess(actor, caseId, c?.caseNumber ?? null, outcome, `${code}${suffix}`);
  if (!c) { await log('denied', 'not_found'); return { error: errorResponse('Case not found', 404) }; }
  const access = decideAppointmentAccess(actor, c, officer);
  if (access.hidden) { await log('denied', access.code); return { error: errorResponse('Case not found', 404) }; }
  if (!access.view || (need === 'edit' && !access.edit)) {
    await log('denied', access.code);
    return { error: noStore({ success: false, error: access.message ?? 'Not permitted', code: access.code, canClaim: access.canClaim }, access.code === 'not_vawc' ? 422 : 403) };
  }
  return { actor, c, access, log };
}

/**
 * What the officer sees about the case while scheduling: the reference,
 * category, status, whether the reporter has an account to notify, who the
 * reporter is to the case, and their safe-contact preference with what it
 * asks of staff. Not the narrative, not names.
 */
export function appointmentCaseContext(c: AppointmentCase) {
  const pref = c.contactPreference && c.contactPreference in PREFERENCE_GUIDANCE ? PREFERENCE_GUIDANCE[c.contactPreference as ContactPreference] : null;
  return {
    id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status, riskLevel: c.riskLevel, filedAt: c.filedAt,
    assignedTo: c.assignedTo,
    hasAccount: Boolean(c.residentId),
    reportingRelationship: c.reportingRelationship,
    reporterIsVictim: reporterIsVictim(c.reportingRelationship),
    participantChoices: participantChoices(c.reportingRelationship),
    contact: {
      preference: c.contactPreference, label: pref?.label ?? 'Not recorded', guidance: pref?.guidance ?? 'The reporter did not say how it is safe to reach them. Ask in person before calling or texting.',
      allowCall: pref?.allowCall ?? false, allowText: pref?.allowText ?? false, note: c.contactSafetyNote,
    },
  };
}

/** Officials an appointment may be assigned to. */
export async function appointmentOfficers() {
  return prisma.user.findMany({ where: { active: true, role: { in: APPOINTMENT_OFFICER_ROLES } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
}

export async function checkOfficer(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id, active: true, role: { in: APPOINTMENT_OFFICER_ROLES } }, select: { id: true } });
  return u ? null : 'The assigned officer must be an active VAWC officer or the Punong Barangay.';
}

/** The next free APT-<case number>-<n>. Run inside the creating transaction. */
export async function nextAppointmentReference(tx: Prisma.TransactionClient, caseId: string, caseNumber: string) {
  const n = await tx.vawcAppointment.count({ where: { caseId } });
  return `APT-${caseNumber.replace(/[^A-Za-z0-9-]/g, '')}-${n + 1}`;
}

/** One row of the appointment's history. Insert-only: the database refuses any change to it. */
export function recordAppointmentEvent(tx: Prisma.TransactionClient, e: {
  appointmentId: string; caseId: string; kind: string; actorType: 'official' | 'resident' | 'system'; actorId: string | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; note?: string | null;
}) {
  return tx.vawcAppointmentEvent.create({ data: {
    appointmentId: e.appointmentId, caseId: e.caseId, kind: e.kind, actorType: e.actorType, actorId: e.actorId,
    before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
    after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
    note: e.note ?? null,
  } });
}

/**
 * The case-timeline line, for the desk. Its type is not on the resident's
 * allow-list (lib/notifications RESIDENT_ACTIVITY_TYPES): the resident is
 * told from the appointment's own events, in safe words.
 */
export async function appointmentActivity(tx: Prisma.TransactionClient, eventId: string, caseId: string, actorId: string | null, message: string) {
  await tx.activity.create({ data: { type: 'vawc_appointment', message, entityId: eventId, entityType: 'VawcAppointmentEvent', userId: actorId, caseId, color: '#7c3aed' } });
}

/**
 * Tell the officials handling it: the appointment's officer and the case's
 * officer, or the VAWC desk as a whole when neither is set. Staff
 * notifications about a VAWC case are visible to the VAWC roles only
 * (lib/caseAccess notificationsVisibleTo). No note, purpose or reason.
 */
export async function notifyAppointmentOfficials(tx: Prisma.TransactionClient, a: { assignedOfficerId: string | null }, c: { id: string; assignedToId: string | null },
  title: string, message: string, type = 'info', except?: string) {
  const to = [...new Set([a.assignedOfficerId, c.assignedToId].filter((x): x is string => Boolean(x) && x !== except))];
  if (!to.length && (a.assignedOfficerId || c.assignedToId)) return;
  for (const userId of to.length ? to : [null]) await tx.notification.create({ data: { title, message, type, userId, caseId: c.id } });
}

/** What every event carries, so the resident's message can be told from it alone. */
export const appointmentSnap = (a: { type: string; scheduledAt: Date }) => ({ type: a.type, scheduledAt: a.scheduledAt.toISOString() });

/** Which appointments an official may list: VAWC cases only - their own, or all of them for the Punong Barangay. */
export function appointmentScope(actor: Actor): Prisma.VawcAppointmentWhereInput | null {
  const role = actor.role.trim();
  const vawcOnly = { case: { caseType: { in: [...VAWC_TYPES] } } };
  if (VAWC_DESK_ROLES.includes(role)) return { AND: [vawcOnly, { OR: [{ case: { assignedToId: actor.id } }, { assignedOfficerId: actor.id }] }] };
  if (role === 'admin') return vawcOnly;
  return null;
}

/**
 * The appointments a resident may see: on the VAWC cases they filed, where
 * they are a participant and the officer chose to notify their account.
 * Nothing else reaches a resident - no other person's appointment, no
 * appointment the officer keeps to the desk.
 */
export function residentAppointmentWhere(residentId: string): Prisma.VawcAppointmentWhereInput {
  return { notifyVia: 'SAFECOMM_ACCOUNT', participants: { has: 'REPORTER' }, case: { residentId, caseType: { in: [...VAWC_TYPES] } } };
}

/** Other open appointments the officer already has within one slot. Nothing is moved: the officer is told and decides. */
export async function officerConflicts(officerId: string | null, at: Date, excludeId?: string | null) {
  if (!officerId) return [];
  const slot = HEARING_SLOT_MINUTES * 60_000;
  const rows = await prisma.vawcAppointment.findMany({
    where: { assignedOfficerId: officerId, status: { in: ['SCHEDULED', 'RESCHEDULED'] }, scheduledAt: { gt: new Date(at.getTime() - slot), lt: new Date(at.getTime() + slot) },
      ...(excludeId && { id: { not: excludeId } }) },
    select: { reference: true, scheduledAt: true, type: true, assignedOfficer: { select: { name: true } } }, orderBy: { scheduledAt: 'asc' },
  });
  return rows.map(r => ({ kind: 'official' as const, reference: r.reference, scheduledAt: r.scheduledAt.toISOString(),
    message: `${r.assignedOfficer?.name ?? 'The officer'} already has an appointment at ${formatHearingWhen(r.scheduledAt)} (${r.reference}, ${typeLabel(r.type).toLowerCase()}).` }));
}

export const conflictReply = (conflicts: Awaited<ReturnType<typeof officerConflicts>>) => noStore({
  success: false, code: 'schedule_conflict', conflicts,
  error: `Scheduling conflict: ${conflicts[0].message} Nothing was changed.`,
}, 409);

/** Everything the details view and the history need, read once. */
export async function loadAppointment(caseId: string, id: string) {
  const a = await prisma.vawcAppointment.findUnique({
    where: { id },
    include: {
      assignedOfficer: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: 'asc' } },
      requests: { orderBy: { createdAt: 'desc' } },
    },
  });
  return a && a.caseId === caseId ? a : null;
}
export type LoadedAppointment = NonNullable<Awaited<ReturnType<typeof loadAppointment>>>;

/** The full record, for the officials who may see it. */
export async function officialView(a: LoadedAppointment) {
  const ids = [...new Set([a.createdById, a.updatedById, a.completedById, a.cancelledById, ...a.events.map(e => e.actorType === 'official' ? e.actorId : null),
    ...a.requests.map(r => r.reviewedById)].filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (id: string | null | undefined) => (id ? users.find(u => u.id === id)?.name ?? 'Former official' : null);
  return {
    id: a.id, caseId: a.caseId, reference: a.reference, type: a.type, scheduledAt: a.scheduledAt, venue: a.venue,
    assignedOfficer: a.assignedOfficer, participants: a.participants, purpose: a.purpose, internalNotes: a.internalNotes,
    notifyVia: a.notifyVia, residentInstructions: a.residentInstructions, status: a.status, statusReason: a.statusReason, rescheduleCount: a.rescheduleCount,
    attendance: a.attendance, outcomeNotes: a.outcomeNotes, followUpActions: a.followUpActions, referralStatus: a.referralStatus, nextAppointmentAt: a.nextAppointmentAt,
    residentSeenAt: a.residentSeenAt, residentAcknowledgedAt: a.residentAcknowledgedAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt, createdBy: name(a.createdById), completedAt: a.completedAt, completedBy: name(a.completedById),
    cancelledAt: a.cancelledAt, cancelledBy: name(a.cancelledById),
    open: isOpenAppointment(a.status),
    events: a.events.map(e => ({ id: e.id, kind: e.kind, actorType: e.actorType, before: e.before, after: e.after, note: e.note, createdAt: e.createdAt,
      by: e.actorType === 'official' ? name(e.actorId) : e.actorType === 'resident' ? 'The resident' : 'SafeComm' })),
    requests: a.requests.map(r => ({ id: r.id, reason: r.reason, preferredSchedule: r.preferredSchedule, status: r.status, createdAt: r.createdAt,
      reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewedBy: name(r.reviewedById) })),
  };
}
