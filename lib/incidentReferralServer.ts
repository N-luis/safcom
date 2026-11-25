import 'server-only';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { canSeeVawc } from './caseAccess';
import { roundCoord, isValidCoordinate } from './geo';
import { EMERGENCY_CONTACTS } from './safecommConfig';
import { runIntake } from './intakeServer';
import { deskFor } from './reportDeskServer';
import { isUniqueViolationOn } from './caseNumber';
import { fingerprint, type IncomingPhoto } from './evidenceServer';
import { checkAgainstJurisdiction } from './jurisdictionServer';
import { createSchema, fileResidentCase, type ResidentCaseInput } from './residentCaseFiling';
import { resolveIncidentStreet } from './verifiedStreets';
import {
  REFERRAL_KINDS, REFERRAL_STATUSES, REFERRAL_STATUS_FOR_RESIDENT, incidentOutcome, referralReason, validationSummary,
  type LocationCheck, type LocationInput, type ReferralKind, type ReferralStatus,
} from './jurisdiction';
import type { InterviewTurn } from './interviewTypes';

/**
 * Referral records made from File a Report, and what officials do with them.
 *
 * The server's location check (lib/jurisdiction.ts) decides; nothing here
 * takes a client's word for where an incident happened:
 *   - outside the jurisdiction: a referral record (OUTSIDE_JURISDICTION),
 *     with everything the resident entered, so nothing is asked twice;
 *   - uncertain: a record held FOR_VERIFICATION (LOCATION_VERIFICATION). An
 *     official checks the place and either files it as the SafeComm case it
 *     would have been (the same pipeline, lib/residentCaseFiling.ts) or
 *     confirms it is outside.
 *
 * Who sees a referral: the Barangay Captain ('admin') sees all; the VAWC desk
 * sees the confidential (possible VAWC) ones only; the blotter desk and the
 * system administrator see none. "Acknowledged" is only ever set with the
 * acknowledgment an official recorded.
 */

// ── Access ───────────────────────────────────────────────────────────────────

const CAPTAIN = 'admin';
/** Which referral records a role may open, as a query filter - or null for none. */
export function referralAccessWhere(role: string | null | undefined): Prisma.JurisdictionReferralWhereInput | null {
  const r = (role ?? '').trim();
  if (r === CAPTAIN) return {};
  if (canSeeVawc(r)) return { confidential: true };
  return null;
}
export const canManageReferral = (role: string | null | undefined, ref: { confidential: boolean }) => {
  const w = referralAccessWhere(role);
  return w !== null && (!('confidential' in w) || ref.confidential);
};

// ── Reference numbers ────────────────────────────────────────────────────────

export async function nextReferenceNumber(tx: Prisma.TransactionClient, year = new Date().getFullYear()) {
  const prefix = `REF-${year}-`;
  const latest = await tx.jurisdictionReferral.findFirst({ where: { referenceNumber: { startsWith: prefix } }, orderBy: { referenceNumber: 'desc' }, select: { referenceNumber: true } });
  const n = latest?.referenceNumber ? Number(latest.referenceNumber.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, '0')}`;
}

// ── What a resident is shown ─────────────────────────────────────────────────

export function residentGuidance(kind: ReferralKind, check: LocationCheck | null, urgent: boolean): string[] {
  const where = check?.destination ? [check.destination.barangay, check.destination.municipality, check.destination.province].filter(Boolean).join(', ') : null;
  return [
    ...(urgent ? ['Kung may agarang panganib, tumawag kaagad sa mga numero sa ibaba. Ang SafeComm ay hindi emergency response service. (If anyone is in immediate danger, call the numbers below now. SafeComm is not an emergency response service.)'] : []),
    ...(kind === 'LOCATION_VERIFICATION'
      ? ['Hindi pa ma-verify ang lokasyon ng insidente. Susuriin ito ng isang opisyal; kung nasa loob ng barangay, ito ay magiging SafeComm case, at kung nasa labas, isang referral. (The location could not be verified yet. An official will check it: inside the barangay it becomes a SafeComm case; outside, a referral.)']
      : kind === 'OUTSIDE_JURISDICTION'
        ? ['Ang insidente ay nasa labas ng sakop ng barangay, kaya ito ay isang referral at hindi isang SafeComm case. Susuriin ito ng barangay upang maidirekta sa tamang hurisdiksyon - hindi pa ito tinatanggap ng ibang tanggapan hangga\'t hindi nila kinukumpirma. (The incident is outside the barangay\'s jurisdiction, so this is a referral, not a SafeComm case. The barangay reviews it to direct it to the right jurisdiction - no other office has accepted it unless they confirm it.)']
        : []),
    ...(where && kind === 'OUTSIDE_JURISDICTION' ? [`Maaari ka ring direktang makipag-ugnayan sa barangay o awtoridad ng ${where}. (You may also contact the barangay or local authority of ${where} directly.)`] : []),
  ];
}

const placeLine = (r: { street?: string | null; locationDetails?: string | null; barangay?: string | null; municipality?: string | null; province?: string | null }) =>
  [r.street, r.locationDetails, r.barangay, r.municipality, r.province].filter(Boolean).join(', ');

export function referralSummaryForResident(r: {
  id: string; referenceNumber: string | null; kind: string; status: string; urgent: boolean; reason: string | null; createdAt: Date;
  street?: string | null; locationDetails?: string | null; barangay?: string | null; municipality?: string | null; province?: string | null;
}) {
  return {
    id: r.id, referenceNumber: r.referenceNumber, kind: r.kind, kindLabel: REFERRAL_KINDS[r.kind as ReferralKind] ?? r.kind,
    status: r.status, statusLabel: REFERRAL_STATUSES[r.status as ReferralStatus] ?? r.status,
    statusMeaning: REFERRAL_STATUS_FOR_RESIDENT[r.status as ReferralStatus] ?? '', urgent: r.urgent, reason: r.reason,
    location: placeLine(r), createdAt: r.createdAt.toISOString(),
  };
}

// ── Saving a referral from File a Report ─────────────────────────────────────

/** The report as submitted, minus the photo bytes (kept as attachments) - what a confirmed-inside location is filed from. */
const payloadOf = (data: ResidentCaseInput) => {
  const { attachments: _photos, ...rest } = data;
  void _photos;
  return JSON.parse(JSON.stringify(rest)) as Prisma.InputJsonValue;
};

async function notifyReviewers(tx: Prisma.TransactionClient, p: { referenceNumber: string; kind: ReferralKind; confidential: boolean; urgent: boolean }) {
  // The captain always; the VAWC desk too when it may be a VAWC concern. The notice names no one and quotes nothing.
  const roles = p.confidential ? ['admin', 'vawc_officer', 'vawc', 'vawc_lead'] : ['admin'];
  const users = await tx.user.findMany({ where: { active: true, role: { in: roles } }, select: { id: true } });
  for (const u of users) {
    await tx.notification.create({ data: {
      userId: u.id, type: p.urgent ? 'warning' : 'info',
      title: p.urgent ? `Urgent referral ${p.referenceNumber}` : `Referral ${p.referenceNumber} received`,
      message: `${REFERRAL_KINDS[p.kind]}. Open Referrals to review it.`,
    } });
  }
}

export interface SavedReferral {
  duplicate: boolean;
  body: {
    outcome: 'REFERRAL' | 'LOCATION_VERIFICATION';
    referral: ReturnType<typeof referralSummaryForResident> & { validationResult: string | null; destination: unknown };
    explanation: string;
    guidance: string[];
    emergencyContacts: typeof EMERGENCY_CONTACTS;
  };
}

/**
 * Save a File a Report submission as a referral record - outside the
 * jurisdiction, or held for an official to verify the place. Runs SafeComm's
 * rules (no AI) only to know whether it may be a VAWC concern (confidential)
 * and whether it is urgent; nothing is classified or assessed.
 */
export async function saveIncidentReferral(p: {
  residentId: string; data: ResidentCaseInput; photos: IncomingPhoto[]; unclearWordCount: number;
  check: LocationCheck; kind: 'OUTSIDE_JURISDICTION' | 'LOCATION_VERIFICATION';
  /** The street as the server checked it (lib/verifiedStreets.ts). */
  street?: { streetId: string | null; manual: boolean | null };
}): Promise<SavedReferral> {
  const { residentId, data, check, kind } = p;
  const key = data.submissionKey ?? null;
  const findByKey = () => key ? prisma.jurisdictionReferral.findUnique({ where: { residentId_submissionKey: { residentId, submissionKey: key } } }) : Promise.resolve(null);
  type Row = NonNullable<Awaited<ReturnType<typeof findByKey>>>;
  const answer = (row: Row, duplicate: boolean): SavedReferral => ({
    duplicate,
    body: {
      outcome: row.kind === 'LOCATION_VERIFICATION' ? 'LOCATION_VERIFICATION' : 'REFERRAL',
      referral: { ...referralSummaryForResident(row), validationResult: row.validationResult, destination: row.recommendedDestination },
      explanation: check.explanation,
      guidance: residentGuidance(row.kind as ReferralKind, check, row.urgent),
      emergencyContacts: EMERGENCY_CONTACTS,
    },
  });
  // A retry of the same submission: the same record, never a second one.
  const existing = await findByKey();
  if (existing) return answer(existing, true);

  const resident = await prisma.resident.findUnique({ where: { id: residentId }, select: { firstName: true, lastName: true, gender: true } });
  const narrative = (data.intakeNarrative ?? '').trim() || data.description;
  const relationship = data.reportingRelationship ?? 'SELF';
  // SafeComm's rules only (no AI): may it be a VAWC concern, and is anyone in danger now?
  let recommendedDesk: string | null = null;
  let confidential = data.reportPath === 'VAWC';
  let urgent = false;
  try {
    const intake = await runIntake({
      residentId, narrative, answers: data.intakeAnswers, selectedCategory: data.caseType ?? null, street: data.barangay ?? null,
      gender: resident?.gender ?? null, useAi: false, residentNames: resident ? [resident.firstName, resident.lastName] : [],
      relationship, turns: (data.intakeTurns ?? []) as InterviewTurn[],
    });
    const desk = await deskFor(intake, narrative, false, undefined, data.reportPath === 'VAWC');
    recommendedDesk = desk.decision === 'HUMAN_REVIEW' ? 'STAFF_REVIEW' : desk.decision;
    confidential = confidential || desk.confidentialReview || desk.decision === 'VAWC';
    urgent = intake.result.immediateSafetyConcern;
  } catch {
    // The rules could not run: kept confidential, so only the captain and the VAWC desk see it until someone reads it.
    confidential = true;
  }
  const pin = isValidCoordinate(data.latitude, data.longitude) ? { latitude: roundCoord(data.latitude as number), longitude: roundCoord(data.longitude as number) } : null;
  const status: ReferralStatus = kind === 'LOCATION_VERIFICATION' ? 'FOR_VERIFICATION' : 'PENDING_REVIEW';
  const reason = referralReason(check);
  const validationResult = validationSummary(check);

  let row;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      row = await prisma.$transaction(async tx => {
        const referenceNumber = await nextReferenceNumber(tx);
        const r = await tx.jurisdictionReferral.create({ data: {
          referenceNumber, residentId, kind, status, urgent, source: 'REPORT_FORM', submissionKey: key,
          reportingRelationship: relationship,
          province: data.incidentProvince || null, municipality: data.incidentMunicipality || null, barangay: data.incidentBarangay || null,
          street: data.barangay || null, streetId: p.street?.streetId ?? null, streetManual: p.street?.manual ?? null,
          locationDetails: data.incidentLocationDetails || data.locationLabel || null,
          latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null,
          summary: data.description,
          residentOriginalNarrative: data.narrativeAssist ? data.residentOriginalNarrative ?? null : null,
          narrativeAssist: data.narrativeAssist ?? null,
          incidentDate: data.incidentDate ? new Date(`${data.incidentDate}T00:00:00Z`) : null,
          incidentTimeApprox: data.incidentTimeApprox || null,
          reportPayload: payloadOf(data),
          locationCheck: JSON.parse(JSON.stringify(check)),
          validationResult, reason,
          recommendedDestination: check.destination ? JSON.parse(JSON.stringify(check.destination)) : undefined,
          recommendedDesk, confidential,
        } });
        await tx.jurisdictionReferralEvent.create({ data: {
          referralId: r.id, kind: 'created', actorType: 'resident', actorId: residentId, toStatus: status,
          note: `Saved from File a Report by the server's location check: ${validationResult}.`,
          residentMessage: kind === 'LOCATION_VERIFICATION' ? 'Received. An official will verify where the incident happened.' : 'Received as a referral. The barangay will review it.',
          snapshot: JSON.parse(JSON.stringify({ check })),
        } });
        if (p.photos.length) {
          await tx.jurisdictionReferralAttachment.createMany({ data: p.photos.map(ph => ({
            referralId: r.id, filename: ph.filename, mimeType: ph.mimeType, size: ph.size, data: ph.data, sha256: ph.sha256, uploadedByResidentId: residentId,
          })) });
        }
        await notifyReviewers(tx, { referenceNumber, kind, confidential, urgent });
        await tx.activity.create({ data: {
          type: 'referral_created', entityType: 'JurisdictionReferral', entityId: r.id, color: '#4338ca',
          message: `Referral record ${referenceNumber} saved (${REFERRAL_KINDS[kind].toLowerCase()})`,
        } });
        return r;
      }, { timeout: 20_000 });
      break;
    } catch (e) {
      if (isUniqueViolationOn(e, 'submissionkey')) {
        const again = await findByKey();
        if (again) return answer(again, true);
      }
      if (!isUniqueViolationOn(e, 'referencenumber') || attempt === 4) throw e;
    }
  }
  return answer(row!, false);
}

// ── Officials: reading ───────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, referenceNumber: true, kind: true, urgent: true, status: true, source: true, confidential: true, recommendedDesk: true,
  province: true, municipality: true, barangay: true, street: true, locationDetails: true, reason: true, validationResult: true,
  receivingOffice: true, assignedToId: true, forwardedAt: true, acknowledgedAt: true, caseId: true, createdAt: true, updatedAt: true,
  reportingRelationship: true, summary: true, reviewNote: true,
  resident: { select: { id: true, residentNumber: true, firstName: true, lastName: true, contactNumber: true, residencyStatus: true } },
} satisfies Prisma.JurisdictionReferralSelect;

export async function listReferralsFor(role: string, status: string) {
  const access = referralAccessWhere(role);
  if (access === null) return null;
  const where: Prisma.JurisdictionReferralWhereInput = { ...access, ...(status === 'ALL' ? {} : status === 'OPEN' ? { status: { not: 'CLOSED' } } : { status }) };
  const [rows, counts] = await Promise.all([
    prisma.jurisdictionReferral.findMany({ where, orderBy: [{ urgent: 'desc' }, { createdAt: 'desc' }], take: 200, select: LIST_SELECT }),
    prisma.jurisdictionReferral.groupBy({ by: ['status'], where: access, _count: true }),
  ]);
  return {
    counts: Object.fromEntries(Object.keys(REFERRAL_STATUSES).map(k => [k, counts.find(c => c.status === k)?._count ?? 0])),
    rows: rows.map(r => ({
      ...r, kindLabel: REFERRAL_KINDS[r.kind as ReferralKind] ?? r.kind, statusLabel: REFERRAL_STATUSES[r.status as ReferralStatus] ?? r.status,
      resident: r.resident ? { id: r.resident.id, residentNumber: r.resident.residentNumber, name: `${r.resident.firstName} ${r.resident.lastName}`,
        contactNumber: r.resident.contactNumber, residencyStatus: r.resident.residencyStatus } : null,
    })),
  };
}

export async function referralDetailFor(role: string, id: string) {
  const access = referralAccessWhere(role);
  if (access === null) return { error: 403 as const };
  const r = await prisma.jurisdictionReferral.findFirst({ where: { id, ...access }, include: {
    resident: { select: { id: true, residentNumber: true, firstName: true, lastName: true, contactNumber: true, email: true, residencyStatus: true } },
    events: { orderBy: { createdAt: 'asc' } },
    attachments: { select: { id: true, filename: true, mimeType: true, size: true, sha256: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    case: { select: { id: true, caseNumber: true } },
  } });
  if (!r) return { error: 404 as const };
  const actorIds = [...new Set([...r.events.filter(e => e.actorType === 'official' && e.actorId).map(e => e.actorId as string), ...(r.assignedToId ? [r.assignedToId] : [])])];
  const users = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map(u => [u.id, u.name]));
  const anonymous = r.reportingRelationship === 'ANONYMOUS';
  return { data: {
    ...r,
    kindLabel: REFERRAL_KINDS[r.kind as ReferralKind] ?? r.kind, statusLabel: REFERRAL_STATUSES[r.status as ReferralStatus] ?? r.status,
    assignedToName: r.assignedToId ? name.get(r.assignedToId) ?? null : null,
    resident: r.resident ? (anonymous ? { id: r.resident.id, residentNumber: r.resident.residentNumber, name: 'Withheld (anonymous report)', contactNumber: null, email: null, residencyStatus: r.resident.residencyStatus }
      : { id: r.resident.id, residentNumber: r.resident.residentNumber, name: `${r.resident.firstName} ${r.resident.lastName}`, contactNumber: r.resident.contactNumber, email: r.resident.email, residencyStatus: r.resident.residencyStatus }) : null,
    events: r.events.map(e => ({ ...e, actorName: e.actorType === 'official' ? name.get(e.actorId ?? '') ?? 'An official' : e.actorType === 'resident' ? 'The reporter' : 'SafeComm' })),
    canFileAsCase: Boolean(r.reportPayload) && Boolean(r.residentId) && r.status !== 'CLOSED' && r.kind === 'LOCATION_VERIFICATION',
  } };
}

export async function referralAttachmentFor(role: string, id: string, attachmentId: string) {
  const access = referralAccessWhere(role);
  if (access === null) return null;
  return prisma.jurisdictionReferralAttachment.findFirst({ where: { id: attachmentId, referral: { id, ...access } }, select: { filename: true, mimeType: true, data: true } });
}

/** Assignable officials for a referral: those who may open it. */
export async function assignableOfficials(confidential: boolean) {
  const roles = confidential ? ['admin', 'vawc_officer', 'vawc', 'vawc_lead'] : ['admin'];
  return prisma.user.findMany({ where: { active: true, role: { in: roles } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
}

// ── Officials: acting ────────────────────────────────────────────────────────

export type ReferralAction =
  | { action: 'status'; status: ReferralStatus; note?: string; residentMessage?: string }
  | { action: 'note'; note: string }
  | { action: 'message'; residentMessage: string }
  | { action: 'assign'; assignedToId: string | null; note?: string }
  | { action: 'receiving_office'; receivingOffice: string; note?: string }
  | { action: 'forwarded'; receivingOffice?: string; forwardedAt?: string; note: string; residentMessage?: string }
  | { action: 'acknowledged'; acknowledgedAt?: string; note: string; residentMessage?: string }
  | { action: 'relocate'; location: LocationInput; note: string }
  | { action: 'confirm_outside'; note: string; residentMessage?: string }
  | { action: 'file_as_case'; note: string; residentMessage?: string };

type Fail = { ok: false; status: number; error: string };
type Done = { ok: true; data?: Record<string, unknown> };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Statuses an official may set by hand, by kind. Referred and Acknowledged come with their own records (forwarded, acknowledged). */
const MANUAL_STATUSES: Record<'VERIFY' | 'OTHER', ReferralStatus[]> = {
  VERIFY: ['FOR_VERIFICATION', 'FOLLOW_UP_REQUIRED', 'CLOSED'],
  OTHER: ['PENDING_REVIEW', 'READY_FOR_REFERRAL', 'FOLLOW_UP_REQUIRED', 'CLOSED'],
};

const parseDate = (v: string | undefined) => {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 60_000 ? null : d;
};

export async function actOnReferral(actor: { id: string; role: string }, id: string, a: ReferralAction): Promise<Done | Fail> {
  const r = await prisma.jurisdictionReferral.findUnique({ where: { id } });
  if (!r || !canManageReferral(actor.role, r)) return fail(404, 'Referral record not found');
  if (r.status === 'CLOSED' && a.action !== 'note') return fail(409, 'This referral is closed. Add a note if something more happened.');
  const verifying = r.kind === 'LOCATION_VERIFICATION';
  const event = (tx: Prisma.TransactionClient, e: { kind: string; fromStatus?: string | null; toStatus?: string | null; note?: string | null; residentMessage?: string | null; snapshot?: unknown }) =>
    tx.jurisdictionReferralEvent.create({ data: {
      referralId: id, kind: e.kind, actorType: 'official', actorId: actor.id, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null,
      note: e.note?.trim() || null, residentMessage: e.residentMessage?.trim() || null,
      snapshot: e.snapshot === undefined ? undefined : JSON.parse(JSON.stringify(e.snapshot)),
    } });
  const audit = (tx: Prisma.TransactionClient, message: string) => tx.activity.create({ data: {
    type: 'referral_updated', userId: actor.id, entityType: 'JurisdictionReferral', entityId: id, color: '#4338ca', message: `Referral ${r.referenceNumber ?? id}: ${message}` } });
  const stamp = { reviewedById: actor.id, reviewedAt: new Date() };

  switch (a.action) {
    case 'status': {
      const allowed = MANUAL_STATUSES[verifying ? 'VERIFY' : 'OTHER'];
      if (!allowed.includes(a.status)) {
        return fail(400, verifying ? 'Verify the location first: file it as a case, or confirm it is outside.' : `Set "${REFERRAL_STATUSES[a.status]}" with its own record (forwarded / acknowledged).`);
      }
      if (a.status === r.status) return fail(400, 'The referral already has this status.');
      if (a.status === 'CLOSED' && !(a.note ?? '').trim()) return fail(400, 'Write why it is closed.');
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { status: a.status, ...(a.status === 'CLOSED' && { reviewNote: a.note }), ...stamp } });
        await event(tx, { kind: 'status', fromStatus: r.status, toStatus: a.status, note: a.note, residentMessage: a.residentMessage });
        await audit(tx, `status ${REFERRAL_STATUSES[r.status as ReferralStatus] ?? r.status} -> ${REFERRAL_STATUSES[a.status]}`);
      });
      return { ok: true };
    }
    case 'note':
      await prisma.$transaction(async tx => { await event(tx, { kind: 'note', note: a.note }); });
      return { ok: true };
    case 'message':
      await prisma.$transaction(async tx => { await event(tx, { kind: 'note', residentMessage: a.residentMessage, note: 'Update shared with the reporter.' }); });
      return { ok: true };
    case 'assign': {
      if (a.assignedToId) {
        const u = await prisma.user.findUnique({ where: { id: a.assignedToId }, select: { active: true, role: true, name: true } });
        if (!u?.active || !canManageReferral(u.role, r)) return fail(400, 'That official cannot be assigned this referral.');
      }
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { assignedToId: a.assignedToId } });
        await event(tx, { kind: 'assigned', note: a.note, snapshot: { from: r.assignedToId, to: a.assignedToId } });
        await audit(tx, a.assignedToId ? 'assigned' : 'unassigned');
      });
      return { ok: true };
    }
    case 'receiving_office':
      if (verifying) return fail(400, 'Verify the location first.');
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { receivingOffice: a.receivingOffice.trim() } });
        await event(tx, { kind: 'receiving_office', note: a.note, snapshot: { from: r.receivingOffice, to: a.receivingOffice.trim() } });
        await audit(tx, 'receiving office recorded');
      });
      return { ok: true };
    case 'forwarded': {
      if (verifying) return fail(400, 'Verify the location first: a referral cannot be sent on while its location is unverified.');
      const office = (a.receivingOffice ?? r.receivingOffice ?? '').trim();
      if (!office) return fail(400, 'Record the receiving office or jurisdiction it was sent to.');
      const at = parseDate(a.forwardedAt);
      if (!at) return fail(400, 'The date it was forwarded cannot be in the future.');
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { status: 'REFERRED', receivingOffice: office, forwardedAt: at, ...stamp } });
        await event(tx, { kind: 'forwarded', fromStatus: r.status, toStatus: 'REFERRED', note: a.note, residentMessage: a.residentMessage, snapshot: { receivingOffice: office, forwardedAt: at } });
        await audit(tx, `forwarded to ${office}`);
      });
      return { ok: true };
    }
    case 'acknowledged': {
      if (!r.forwardedAt) return fail(400, 'Record when it was forwarded first - an acknowledgment answers a referral that was sent.');
      const at = parseDate(a.acknowledgedAt);
      if (!at) return fail(400, 'The date of the acknowledgment cannot be in the future.');
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: at, ...stamp } });
        await event(tx, { kind: 'acknowledged', fromStatus: r.status, toStatus: 'ACKNOWLEDGED', note: a.note, residentMessage: a.residentMessage, snapshot: { acknowledgedAt: at } });
        await audit(tx, 'acknowledgment by the receiving office recorded');
      });
      return { ok: true };
    }
    case 'relocate': {
      // The place changed: the server checks it again, and the earlier decision stays in the history.
      const check = await checkAgainstJurisdiction(a.location, 'incident');
      const st = await resolveIncidentStreet({ province: a.location.province, municipality: a.location.municipality, barangay: a.location.barangay, street: a.location.street });
      if (check.status === 'INCOMPLETE') return fail(400, check.explanation);
      const outcome = incidentOutcome(check);
      const kind: ReferralKind = outcome === 'REFERRAL' ? 'OUTSIDE_JURISDICTION' : 'LOCATION_VERIFICATION';
      const status: ReferralStatus = kind === 'LOCATION_VERIFICATION' ? 'FOR_VERIFICATION' : verifying ? 'PENDING_REVIEW' : (r.status as ReferralStatus);
      const pin = isValidCoordinate(a.location.latitude, a.location.longitude) ? { latitude: roundCoord(a.location.latitude as number), longitude: roundCoord(a.location.longitude as number) } : null;
      const before = { province: r.province, municipality: r.municipality, barangay: r.barangay, street: r.street, locationDetails: r.locationDetails, latitude: r.latitude, longitude: r.longitude, check: r.locationCheck, kind: r.kind, status: r.status };
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: {
          province: a.location.province || null, municipality: a.location.municipality || null, barangay: a.location.barangay || null,
          street: st.ok ? st.streetName : a.location.street || null, streetId: st.ok ? st.streetId : null, streetManual: st.ok ? st.manual : null,
          locationDetails: a.location.details || null, latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null,
          locationCheck: JSON.parse(JSON.stringify(check)), validationResult: validationSummary(check), reason: referralReason(check),
          recommendedDestination: check.destination ? JSON.parse(JSON.stringify(check.destination)) : undefined,
          kind, status, ...stamp,
        } });
        await event(tx, { kind: 'location_rechecked', fromStatus: r.status, toStatus: status, note: a.note,
          snapshot: { before, after: { ...a.location, check, kind, status } } });
        await audit(tx, `location corrected and re-checked: ${check.status.toLowerCase().replace('_', ' ')}`);
      });
      return { ok: true, data: { check: { status: check.status, explanation: check.explanation }, outcome } };
    }
    case 'confirm_outside': {
      if (!verifying) return fail(400, 'Only a record waiting for location verification is confirmed outside.');
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { kind: 'OUTSIDE_JURISDICTION', status: 'PENDING_REVIEW',
          reason: `An official verified that the incident location is outside the authorized jurisdiction. ${r.reason ?? ''}`.trim(), ...stamp } });
        await event(tx, { kind: 'confirmed_outside', fromStatus: r.status, toStatus: 'PENDING_REVIEW', note: a.note,
          residentMessage: a.residentMessage || 'An official checked the location: it is outside the barangay, so this is handled as a referral.' });
        await audit(tx, 'location verified outside the jurisdiction - handled as a referral');
      });
      return { ok: true };
    }
    case 'file_as_case': {
      if (!r.reportPayload || !r.residentId) return fail(400, 'This record has no report to file (it was saved from the short referral form). Take it in through the Walk-in Report.');
      // Only once an official has the place to verify: a record confirmed outside is corrected (relocate) first,
      // and the server's check must then hold it for verification again - never filed straight from "outside".
      if (r.kind !== 'LOCATION_VERIFICATION') return fail(400, 'Only a record waiting for location verification is filed as a case. If the location was wrong, correct it first.');
      // The location as it stands now (corrected, if an official corrected it): the report's own fields otherwise.
      const parsed = createSchema.safeParse({ ...(r.reportPayload as object),
        incidentProvince: r.province ?? undefined, incidentMunicipality: r.municipality ?? undefined, incidentBarangay: r.barangay ?? undefined,
        barangay: r.street ?? undefined, streetId: r.streetId ?? undefined, incidentLocationDetails: r.locationDetails ?? undefined,
        latitude: r.latitude ?? undefined, longitude: r.longitude ?? undefined });
      if (!parsed.success) return fail(400, `The saved report could not be read: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const rows = await prisma.jurisdictionReferralAttachment.findMany({ where: { referralId: id }, orderBy: { createdAt: 'asc' } });
      const photos: IncomingPhoto[] = rows.map(x => ({ filename: x.filename, mimeType: x.mimeType, size: x.size, data: new Uint8Array(x.data) as Uint8Array<ArrayBuffer>, sha256: x.sha256 || fingerprint(x.data) }));
      const st = await resolveIncidentStreet({ province: r.province, municipality: r.municipality, barangay: r.barangay, street: r.street, streetId: r.streetId });
      const res = await fileResidentCase({ residentId: r.residentId, data: parsed.data, photos, unclearWordCount: (parsed.data.documentUnclearWords ?? []).length, locationReview: false,
        street: st.ok ? { streetId: st.streetId, manual: st.manual } : { streetId: null, manual: true } });
      const json = await res.json().catch(() => null) as { success?: boolean; data?: { id: string; caseNumber: string }; error?: string } | null;
      if (!res.ok || !json?.data?.id) return fail(502, json?.error ?? 'The case could not be filed right now. Nothing was changed.');
      const c = json.data;
      await prisma.$transaction(async tx => {
        await tx.jurisdictionReferral.update({ where: { id }, data: { status: 'CLOSED', caseId: c.id, reviewNote: a.note, ...stamp } });
        await event(tx, { kind: 'filed_as_case', fromStatus: r.status, toStatus: 'CLOSED', note: a.note,
          residentMessage: a.residentMessage || `An official confirmed the location is within the barangay. Your report was filed as SafeComm case ${c.caseNumber} - follow it in My Cases.`,
          snapshot: { caseId: c.id, caseNumber: c.caseNumber } });
        await audit(tx, `location verified inside - filed as case ${c.caseNumber}`);
      });
      return { ok: true, data: { caseId: c.id, caseNumber: c.caseNumber } };
    }
  }
}

// ── The resident's own referrals ─────────────────────────────────────────────

export async function residentReferrals(residentId: string) {
  const rows = await prisma.jurisdictionReferral.findMany({
    where: { residentId }, orderBy: { createdAt: 'desc' }, take: 50,
    select: {
      id: true, referenceNumber: true, kind: true, status: true, urgent: true, reason: true, createdAt: true,
      street: true, locationDetails: true, barangay: true, municipality: true, province: true,
      case: { select: { caseNumber: true } },
      // Only what an official chose to tell the reporter - never internal notes.
      events: { where: { residentMessage: { not: null } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, residentMessage: true, toStatus: true } },
    },
  });
  return rows.map(r => ({
    ...referralSummaryForResident(r),
    caseNumber: r.case?.caseNumber ?? null,
    updates: r.events.map(e => ({ at: e.createdAt.toISOString(), message: e.residentMessage as string, status: e.toStatus ? REFERRAL_STATUSES[e.toStatus as ReferralStatus] ?? null : null })),
  }));
}

export { placeLine as referralPlaceLine };
