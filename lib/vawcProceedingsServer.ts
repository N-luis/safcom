/**
 * Server side of VAWC Case Proceedings (BPOs and referrals; court dates are Hearings).
 *
 * Access is exactly the VAWC appointments' (lib/vawcAppointmentsServer.ts
 * decideAppointmentAccess, through gateAppointments): the VAWC officer the
 * case is assigned to manages these records; the Punong Barangay ('admin')
 * may view them and manage them when assigned; other VAWC officers are
 * refused; blotter officers, the system administrator and residents are told
 * the case does not exist. Every look and change is in ReporterAccessLog.
 * Nothing here ever reaches a resident or the respondent: these records are
 * the desk's, and their staff notifications carry a case number and a kind of
 * step - never a note, an assessment or a name.
 */
import 'server-only';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { VAWC_DESK_ROLES, type Actor } from './reporterAccess';
import { VAWC_TYPES } from './vawcTypes';
import { decideAppointmentAccess, notifyAppointmentOfficials } from './vawcAppointmentsServer';
import { phDay } from './hearings';
import { typeLabel } from './vawcAppointments';
import { activityItems, remindersDue, reminderMessage, bpoLastDay, bpoInEffect, type ProceedingKind } from './vawcProceedings';

const vawcOnly = { case: { caseType: { in: [...VAWC_TYPES] } } };

/** Which records an official may list: VAWC cases only - their own, or all of them for the Punong Barangay. */
export function proceedingScope(actor: Actor): { case: Prisma.CaseWhereInput; officer: string | null } | null {
  const role = actor.role.trim();
  if (VAWC_DESK_ROLES.includes(role)) return { case: { caseType: { in: [...VAWC_TYPES] } }, officer: actor.id };
  if (role === 'admin') return { case: { caseType: { in: [...VAWC_TYPES] } }, officer: null };
  return null;
}

/** A where-clause for one of the three tables, from the scope. */
function scoped(s: NonNullable<ReturnType<typeof proceedingScope>>, caseId: string | null) {
  const mine = s.officer ? { OR: [{ case: { assignedToId: s.officer } }, { assignedOfficerId: s.officer }] } : {};
  return { AND: [vawcOnly, mine, ...(caseId ? [{ caseId }] : [])] };
}

const caseSel = { select: { id: true, caseNumber: true, caseType: true, status: true, assignedToId: true } } as const;

/** Everything listed for these cases, with the dated items and who may change each record. */
export async function loadProceedings(actor: Actor, caseId: string | null) {
  const s = proceedingScope(actor);
  if (!s) return null;
  const where = scoped(s, caseId);
  const [bpos, referrals] = await Promise.all([
    prisma.vawcBpo.findMany({ where, include: { case: caseSel }, orderBy: { appliedAt: 'desc' }, take: 500 }),
    prisma.vawcReferral.findMany({ where, include: { case: caseSel }, orderBy: { referredAt: 'desc' }, take: 500 }),
  ]);
  const ids = [...new Set([...bpos, ...referrals].map(r => r.assignedOfficerId).filter((x): x is string => Boolean(x)))];
  const names = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const officer = (id: string | null) => (id ? { id, name: names.find(u => u.id === id)?.name ?? 'Former official' } : null);
  const canEdit = (c: { caseType: string; assignedToId: string | null }, assignedOfficerId: string | null) =>
    decideAppointmentAccess(actor, c, assignedOfficerId === actor.id).edit;
  const now = new Date();
  return {
    bpos: bpos.map(b => ({
      id: b.id, reference: b.reference, status: b.status, case: { id: b.case.id, caseNumber: b.case.caseNumber },
      appliedAt: b.appliedAt, applicantType: b.applicantType, decision: b.decision, decidedAt: b.decidedAt, actingRole: b.actingRole,
      actingOfficialName: b.actingOfficialName, punongBarangayUnavailable: b.punongBarangayUnavailable, servedAt: b.servedAt,
      serviceMethod: b.serviceMethod, servedByName: b.servedByName, officer: officer(b.assignedOfficerId),
      lastDay: b.decision === 'ISSUED' && b.decidedAt ? bpoLastDay(b.decidedAt) : null,
      inEffect: b.decision === 'ISSUED' && b.status !== 'CANCELLED' && bpoInEffect(b.decidedAt, now),
      // Officials-only text, sent only to those who may see the case.
      applicationNotes: b.applicationNotes, exParteAssessment: b.exParteAssessment, serviceNotes: b.serviceNotes, cancelReason: b.cancelReason,
      canEdit: canEdit(b.case, b.assignedOfficerId),
    })),
    referrals: referrals.map(r => ({
      id: r.id, reference: r.reference, status: r.status, case: { id: r.case.id, caseNumber: r.case.caseNumber },
      agencyType: r.agencyType, agencyName: r.agencyName, referredAt: r.referredAt, purpose: r.purpose, followUpAt: r.followUpAt,
      outcome: r.outcome, serviceReferralId: r.serviceReferralId, officer: officer(r.assignedOfficerId), canEdit: canEdit(r.case, r.assignedOfficerId),
    })),
    items: activityItems({ bpos, referrals }, now),
  };
}

/** The next free BPO-/REF-<case number>-<n>. Run inside the creating transaction. */
export async function nextProceedingReference(tx: Prisma.TransactionClient, kind: ProceedingKind, caseId: string, caseNumber: string) {
  const n = kind === 'bpo' ? await tx.vawcBpo.count({ where: { caseId } }) : await tx.vawcReferral.count({ where: { caseId } });
  const prefix = kind === 'bpo' ? 'BPO' : 'REF';
  return `${prefix}-${caseNumber.replace(/[^A-Za-z0-9-]/g, '')}-${n + 1}`;
}

/** One row of the history. Insert-only: the database refuses any change to it. */
export function recordProceedingEvent(tx: Prisma.TransactionClient, e: {
  caseId: string; recordKind: ProceedingKind | 'appointment'; recordId: string; kind: string; actorId: string | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; note?: string | null; reminderKey?: string | null;
}) {
  return tx.vawcProceedingEvent.create({ data: {
    caseId: e.caseId, recordKind: e.recordKind, recordId: e.recordId, kind: e.kind, actorId: e.actorId,
    before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined, after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
    note: e.note ?? null, reminderKey: e.reminderKey ?? null,
  } });
}

/** The case-timeline line for the desk. Its type is not on the resident's allow-list (lib/notifications RESIDENT_ACTIVITY_TYPES). */
export async function proceedingActivity(tx: Prisma.TransactionClient, eventId: string, caseId: string, actorId: string | null, message: string) {
  await tx.activity.create({ data: { type: 'vawc_proceeding', message, entityId: eventId, entityType: 'VawcProceedingEvent', userId: actorId, caseId, color: '#7c3aed' } });
}

/**
 * The reminders job: each due item (lib/vawcProceedings.ts remindersDue) and
 * each open VAWC appointment today or tomorrow is told to the officials
 * handling it - the record's officer and the case's, or the VAWC desk - once:
 * the history row with its reminderKey is written first, and a key already
 * there means it was sent. Staff only; no resident or respondent is told.
 */
export async function runVawcReminders(now = new Date(), opts: { onlyCaseIds?: string[] } = {}) {
  const cases = opts.onlyCaseIds ? { caseId: { in: opts.onlyCaseIds } } : {};
  const where = { AND: [vawcOnly, cases, { status: { not: 'CANCELLED' } }] };
  const [bpos, referrals, appts] = await Promise.all([
    prisma.vawcBpo.findMany({ where, include: { case: caseSel } }),
    prisma.vawcReferral.findMany({ where, include: { case: caseSel } }),
    prisma.vawcAppointment.findMany({ where: { AND: [vawcOnly, cases, { status: { in: ['SCHEDULED', 'RESCHEDULED'] } },
      { scheduledAt: { gte: new Date(now.getTime() - 12 * 3_600_000), lte: new Date(now.getTime() + 36 * 3_600_000) } }] },
      include: { case: caseSel } }),
  ]);
  const officerOf = new Map<string, string | null>([...bpos, ...referrals].map(r => [r.id, r.assignedOfficerId]));
  const caseOf = new Map([...bpos, ...referrals, ...appts].map(r => [r.caseId, r.case]));
  const due = remindersDue(activityItems({ bpos, referrals }, now), now).map(i => ({
    key: i.key, caseId: i.caseId, recordKind: i.recordKind as ProceedingKind | 'appointment', recordId: i.recordId, officer: officerOf.get(i.recordId) ?? null,
    title: `VAWC reminder - ${i.caseNumber}`, message: reminderMessage(i),
  }));
  for (const a of appts) {
    const day = phDay(a.scheduledAt);
    due.push({ key: `APPOINTMENT:${a.id}:${day}`, caseId: a.caseId, recordKind: 'appointment', recordId: a.id, officer: a.assignedOfficerId,
      title: `VAWC reminder - ${a.case.caseNumber}`, message: `${typeLabel(a.type)} ${a.reference} on case ${a.case.caseNumber}, ${day}. Open Hearings for the details.` });
  }
  let sent = 0;
  for (const r of due) {
    const c = caseOf.get(r.caseId)!;
    try {
      await prisma.$transaction(async tx => {
        await recordProceedingEvent(tx, { caseId: r.caseId, recordKind: r.recordKind, recordId: r.recordId, kind: 'reminder_sent', actorId: null,
          after: { key: r.key }, reminderKey: r.key });
        await notifyAppointmentOfficials(tx, { assignedOfficerId: r.officer }, c, r.title, r.message, 'warning');
      });
      sent++;
    } catch (e) {
      // Already sent (the key is unique) - or a failure, which the next run retries.
      if (!(e instanceof Error && /Unique constraint|P2002/i.test(`${e.message} ${(e as { code?: string }).code ?? ''}`))) throw e;
    }
  }
  return { due: due.length, sent };
}

/** A record's history, with who did each step. */
export async function proceedingHistory(kind: ProceedingKind, recordId: string) {
  const events = await prisma.vawcProceedingEvent.findMany({ where: { recordKind: kind, recordId }, orderBy: { createdAt: 'asc' } });
  const ids = [...new Set(events.map(e => e.actorId).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return events.map(e => ({ id: e.id, kind: e.kind, at: e.createdAt, note: e.note, before: e.before, after: e.after,
    by: e.actorId ? users.find(u => u.id === e.actorId)?.name ?? 'Former official' : 'SafeComm' }));
}
