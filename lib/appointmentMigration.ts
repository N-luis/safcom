/**
 * Merging the VAWC Appointments into hearings: each VawcAppointment becomes a
 * CaseHearing on the same case (a VAWC case, so a VAWC hearing type), keeping
 * its dates, venue, officer, instructions, notes, status, who made it and
 * when. Nothing is deleted or changed on the appointment: the table stays,
 * read-only, for one release. Each hearing records the appointment it was
 * made from (migratedFromAppointmentId, unique), so running it again makes
 * no second copy.
 *
 * Only what maps clearly is moved. A status or type with no clear hearing
 * equivalent is listed in the report and left as it is - never guessed.
 *
 * Run: npx tsx --env-file=.env scripts/migrate-appointments-to-hearings.ts [--dry-run]
 */
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { VAWC_TYPES } from './vawcTypes';
import { hearingReference, isOpen, phDay, type HearingStatus, type VawcHearingType } from './hearings';

/**
 * Appointment status -> hearing status. null: no clear equivalent - listed,
 * not migrated. NOT_HELD ("did not take place") is neither a held hearing
 * (COMPLETED records an outcome of one that took place) nor a cancelled one.
 * A resident's acknowledgement of a SCHEDULED appointment is kept in the
 * hearing's history; the hearing stays SCHEDULED, since no hearing notice
 * was ever issued for it to acknowledge.
 */
export const APPOINTMENT_STATUS_MAP: Record<string, HearingStatus | null> = {
  SCHEDULED: 'SCHEDULED',
  RESCHEDULED: 'RESCHEDULED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NOT_HELD: null,
};

/**
 * Appointment type -> VAWC hearing type. null: no clear equivalent. An
 * external court hearing is a court's date the desk only tracked - not a
 * barangay hearing - so it is not made into one.
 */
export const APPOINTMENT_TYPE_MAP: Record<string, VawcHearingType | null> = {
  VICTIM_INTERVIEW: 'VICTIM_INTERVIEW',
  INTAKE_FOLLOW_UP: 'FOLLOW_UP',
  SAFETY_FOLLOW_UP: 'FOLLOW_UP',
  REFERRAL_COORDINATION: 'CASE_CONFERENCE',
  CASE_CONFERENCE: 'CASE_CONFERENCE',
  EXTERNAL_COURT_HEARING: null,
};

/** The resident's attendance as an official recorded it on the appointment. */
const ATTENDANCE_MAP: Record<string, 'PRESENT' | 'ABSENT' | 'NOT_RECORDED'> = { ATTENDED: 'PRESENT', DID_NOT_ATTEND: 'ABSENT', NOT_APPLICABLE: 'NOT_RECORDED' };

export type SkipReason = 'already_migrated' | 'unmapped_status' | 'unmapped_type' | 'case_not_vawc' | 'case_has_open_hearing';
export const SKIP_REASONS: Record<SkipReason, string> = {
  already_migrated: 'Already migrated (a hearing records it) - nothing done',
  unmapped_status: 'Status has no clear hearing equivalent - left as it is',
  unmapped_type: 'Type has no clear hearing equivalent (a court date is not a barangay hearing) - left as it is',
  case_not_vawc: 'The case is no longer a VAWC case - left as it is',
  case_has_open_hearing: 'The case already has an open hearing (one at a time) - left as it is',
};

export interface MigrationReport {
  dryRun: boolean;
  read: number;
  created: number;
  skipped: { appointmentId: string; reference: string; status: string; type: string; reason: SkipReason }[];
  /** Per appointment status: read, created, skipped. */
  byStatus: Record<string, { read: number; created: number; skipped: number }>;
  createdHearings: { appointmentId: string; hearingId: string; reference: string; status: string; stage: string }[];
  /** Hearings whose case is missing (should never happen: the link is required). */
  hearingsWithoutCase: number;
}

type Tx = Prisma.TransactionClient;

/** What one appointment would become, or why it stays: pure, for the tests. */
export function planFor(a: { status: string; type: string }, caseType: string): { status: HearingStatus; stage: VawcHearingType } | { skip: SkipReason } {
  if (!(VAWC_TYPES as readonly string[]).includes(caseType)) return { skip: 'case_not_vawc' };
  const status = APPOINTMENT_STATUS_MAP[a.status] ?? null;
  if (!status) return { skip: 'unmapped_status' };
  const stage = APPOINTMENT_TYPE_MAP[a.type] ?? null;
  if (!stage) return { skip: 'unmapped_type' };
  return { status, stage };
}

/** Migrate every appointment that maps clearly. With dryRun, report what would happen and write nothing. */
export async function migrateAppointments({ dryRun = false, only }: { dryRun?: boolean; only?: string[] } = {}): Promise<MigrationReport> {
  const appointments = await prisma.vawcAppointment.findMany({
    where: only ? { id: { in: only } } : {},
    orderBy: { createdAt: 'asc' },
    include: {
      case: { select: { id: true, caseNumber: true, caseType: true } },
      events: { orderBy: { createdAt: 'asc' }, select: { kind: true, createdAt: true } },
      requests: { orderBy: { createdAt: 'asc' } },
    },
  });
  const done = new Set((await prisma.caseHearing.findMany({
    where: { migratedFromAppointmentId: { in: appointments.map(a => a.id) } }, select: { migratedFromAppointmentId: true },
  })).map(h => h.migratedFromAppointmentId));
  const report: MigrationReport = { dryRun, read: appointments.length, created: 0, skipped: [], byStatus: {}, createdHearings: [], hearingsWithoutCase: 0 };
  // A dry run writes nothing, so it remembers what it would have made: the next appointment on the case sees it.
  const planned = new Map<string, { stage: string; session: number; status: string }[]>();
  const tally = (status: string, k: 'read' | 'created' | 'skipped') => {
    report.byStatus[status] ??= { read: 0, created: 0, skipped: 0 };
    report.byStatus[status][k]++;
  };

  for (const a of appointments) {
    tally(a.status, 'read');
    const skip = (reason: SkipReason) => { report.skipped.push({ appointmentId: a.id, reference: a.reference, status: a.status, type: a.type, reason }); tally(a.status, 'skipped'); };
    if (done.has(a.id)) { skip('already_migrated'); continue; }
    const plan = planFor(a, a.case.caseType);
    if ('skip' in plan) { skip(plan.skip); continue; }
    const existing = [...await prisma.caseHearing.findMany({ where: { caseId: a.caseId }, select: { stage: true, session: true, status: true } }), ...(planned.get(a.caseId) ?? [])];
    if (isOpen(plan.status) && existing.some(h => isOpen(h.status))) { skip('case_has_open_hearing'); continue; }
    const hearingNumber = existing.filter(h => h.status !== 'CANCELLED').length + 1;
    const session = existing.filter(h => h.stage === plan.stage && h.status === 'COMPLETED').length + 1;
    const attempt = existing.filter(h => h.stage === plan.stage && h.session === session).length + 1;
    const reference = hearingReference(a.case.caseNumber, plan.stage, session, attempt);
    if (dryRun) {
      planned.set(a.caseId, [...(planned.get(a.caseId) ?? []), { stage: plan.stage, session, status: plan.status }]);
      report.created++; tally(a.status, 'created');
      report.createdHearings.push({ appointmentId: a.id, hearingId: '(dry run)', reference, status: plan.status, stage: plan.stage });
      continue;
    }
    const notes = [`Purpose (from the appointment): ${a.purpose}`, a.internalNotes ? `Notes: ${a.internalNotes}` : null].filter(Boolean).join('\n\n');
    try {
      const h = await prisma.$transaction(async (tx: Tx) => {
        const h = await tx.caseHearing.create({ data: {
          caseId: a.caseId, reference, hearingNumber, stage: plan.stage, session,
          scheduledAt: a.scheduledAt, venue: a.venue, status: plan.status,
          activeKey: plan.status === 'CANCELLED' ? null : `${a.caseId}:${hearingNumber}`,
          openKey: isOpen(plan.status) ? a.caseId : null,
          assignedOfficialId: a.assignedOfficerId,
          // The reporter is the complainant; the respondent was never a participant of an appointment.
          complainantPartyId: null, respondentPartyId: null,
          complainantAttendance: (a.attendance && ATTENDANCE_MAP[a.attendance]) || 'NOT_RECORDED',
          outcome: plan.status === 'COMPLETED' ? 'HELD' : null,
          agreements: plan.status === 'COMPLETED' ? a.outcomeNotes : null,
          nextAction: a.followUpActions, nextHearingAt: a.nextAppointmentAt,
          residentInstructions: a.residentInstructions, statusReason: a.statusReason, notes,
          rescheduleCount: a.rescheduleCount,
          completedAt: a.completedAt, completedById: a.completedById, cancelledAt: a.cancelledAt, cancelledById: a.cancelledById,
          createdById: a.createdById, updatedById: a.updatedById, createdAt: a.createdAt,
          migratedFromAppointmentId: a.id,
        } });
        for (const r of a.requests) {
          await tx.caseHearingRequest.create({ data: {
            hearingId: h.id, caseId: a.caseId, residentId: r.residentId, requesterRole: 'COMPLAINANT', reason: r.reason,
            preferredSchedule: r.preferredSchedule, status: r.status, pendingKey: r.status === 'PENDING' ? `${h.id}:COMPLAINANT` : null,
            reviewedById: r.reviewedById, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, createdAt: r.createdAt,
          } });
        }
        // One history row: where it came from, as it stood, and its own history - officials only.
        const e = await tx.caseHearingEvent.create({ data: {
          hearingId: h.id, caseId: a.caseId, kind: 'migrated_from_appointment', actorType: 'system', actorId: null,
          after: {
            hearingNumber, stage: plan.stage, session, scheduledAt: a.scheduledAt.toISOString(), venue: a.venue,
            appointmentId: a.id, appointmentReference: a.reference, appointmentType: a.type, appointmentStatus: a.status,
            participants: a.participants, notifyVia: a.notifyVia, createdById: a.createdById, createdAt: a.createdAt.toISOString(),
            residentSeenAt: a.residentSeenAt?.toISOString() ?? null, residentAcknowledgedAt: a.residentAcknowledgedAt?.toISOString() ?? null,
            appointmentEvents: a.events.map(x => ({ kind: x.kind, at: x.createdAt.toISOString() })),
          } as Prisma.InputJsonValue,
          note: `Moved from VAWC Appointments (${a.reference}) when Appointments were merged into Hearings.`,
        } });
        await tx.activity.create({ data: {
          type: 'hearing', message: `Appointment ${a.reference} moved to Hearings as ${reference} (${phDay(a.scheduledAt)})`,
          entityId: e.id, entityType: 'CaseHearingEvent', userId: null, caseId: a.caseId, color: '#0369a1',
        } });
        return h;
      });
      report.created++; tally(a.status, 'created');
      report.createdHearings.push({ appointmentId: a.id, hearingId: h.id, reference: h.reference, status: h.status, stage: h.stage });
    } catch (e) {
      // A second run racing this one, or a hearing made meanwhile: the unique keys refuse a duplicate.
      if ((e as { code?: string }).code === 'P2002') { skip('already_migrated'); continue; }
      throw e;
    }
  }
  report.hearingsWithoutCase = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "CaseHearing" h LEFT JOIN "Case" c ON c."id" = h."caseId" WHERE c."id" IS NULL`)[0]?.n ?? 0);
  return report;
}

/** The report as text, for the console. */
export function formatReport(r: MigrationReport): string {
  const lines = [
    `VAWC Appointments -> Hearings${r.dryRun ? ' (DRY RUN - nothing written)' : ''}`,
    `  Appointments read:  ${r.read}`,
    `  Hearings created:   ${r.created}`,
    `  Skipped:            ${r.skipped.length}`,
    '  Per status (read / created / skipped):',
    ...Object.entries(r.byStatus).map(([s, c]) => `    ${s.padEnd(12)} ${c.read} / ${c.created} / ${c.skipped}`),
  ];
  if (r.createdHearings.length) lines.push('  Created:', ...r.createdHearings.map(h => `    ${h.appointmentId} -> ${h.reference} (${h.stage}, ${h.status})`));
  if (r.skipped.length) lines.push('  Skipped:', ...r.skipped.map(s => `    ${s.reference} [${s.status}, ${s.type}]: ${SKIP_REASONS[s.reason]}`));
  lines.push(`  Hearings with no linked case: ${r.hearingsWithoutCase}`);
  const ok = r.read === r.created + r.skipped.length;
  lines.push(`  Reconciles (read = created + skipped): ${ok ? 'yes' : 'NO'}`);
  return lines.join('\n');
}
