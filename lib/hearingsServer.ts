/**
 * Server side of Hearing Management: who may see or run a case's hearings,
 * whether the case may have one, and the history every change leaves.
 *
 * Every route re-reads the official's account and the case on each request
 * and logs each look and refusal to ReporterAccessLog (field "hearings") -
 * without names, notes or narrative.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { requireAuth, errorResponse } from './auth';
import { canSeeVawc } from './caseAccess';
import { loadActor, BLOTTER_ROLES, VAWC_DESK_ROLES, isVawcType, type Actor } from './reporterAccess';
import { noStore } from './caseRecordsServer';
import {
  hearingEligibility, phInstant, formatHearingWhen, sameVenue, OPEN_STATUSES, VAWC_HEARING_REFUSAL, type Eligibility, type ScheduleConflict,
} from './hearings';
import { BARANGAY_CONTEXT, EMERGENCY_CONTACTS, HEARING_SLOT_MINUTES } from './safecommConfig';
import type { NoticeInput } from './hearingNoticePdf';

export { noStore };

/** Who presides over a hearing: a blotter officer or the captain. */
export const PRESIDING_ROLES = [...BLOTTER_ROLES, 'admin'];

export interface HearingAccess {
  view: boolean;
  edit: boolean;
  /** A VAWC case outside this role: answered as "not found". */
  hidden: boolean;
  code: string;
  message: string | null;
  canClaim: boolean;
}

/**
 * The rule, on its own so it can be tested:
 *   - blotter officer: the case's assigned officer, or the official presiding
 *     over one of its hearings, runs them;
 *   - captain: runs hearings on any blotter case;
 *   - system administrator: may view, never schedule or record;
 *   - VAWC desk: no ordinary hearings - RA 9262 cases stay in the VAWC
 *     workflow, and blotter cases are the other desk's;
 *   - a VAWC case is not found for anyone outside the VAWC roles.
 */
export function decideHearingAccess(actor: Actor, c: { caseType: string; assignedToId: string | null }, presides = false): HearingAccess {
  const role = actor.role.trim();
  const no = (code: string, message: string, extra: Partial<HearingAccess> = {}): HearingAccess =>
    ({ view: false, edit: false, hidden: false, code, message, canClaim: false, ...extra });
  if (!actor.active) return no('inactive', 'Your account is not active.');
  if (isVawcType(c.caseType)) {
    if (!canSeeVawc(role)) return no('vawc_restricted', 'Case not found.', { hidden: true });
    // Visible to the VAWC roles, but there is nothing to run: the refusal is the answer.
    return { view: true, edit: false, hidden: false, code: 'vawc_case', message: VAWC_HEARING_REFUSAL, canClaim: false };
  }
  if (VAWC_DESK_ROLES.includes(role)) {
    return no('wrong_desk', 'Hearings are for blotter cases. VAWC officers keep RA 9262 cases in the VAWC workflow - intervention, referral and follow-up.');
  }
  if (BLOTTER_ROLES.includes(role)) {
    if (c.assignedToId === actor.id || presides) return { view: true, edit: true, hidden: false, code: 'assigned', message: null, canClaim: false };
    return no('not_assigned', 'Only the officer assigned to this case (or the official presiding over its hearing) can manage its hearings. Take the case first if it is unassigned.',
      { canClaim: c.assignedToId === null });
  }
  if (role === 'admin') return { view: true, edit: true, hidden: false, code: 'captain', message: null, canClaim: false };
  if (role === 'system_admin') {
    return { view: true, edit: false, hidden: false, code: 'oversight', canClaim: false,
      message: 'You can view hearings. Scheduling and recording them is for the barangay officials.' };
  }
  return no('role_not_permitted', 'Your role cannot manage hearings.');
}

/** What the hearing routes need about the case. */
export async function loadHearingCase(caseId: string) {
  return prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, assignedToId: true, residentId: true, residentName: true,
      reportPath: true, reporterIdentityWithheld: true, municipality: true, province: true,
      resident: { select: { firstName: true, lastName: true } },
      intake: { select: { suggestedCaseCategory: true } },
    },
  });
}
export type HearingCase = NonNullable<Awaited<ReturnType<typeof loadHearingCase>>>;

export type HearingGate =
  | { error: Response }
  | { actor: Actor; c: HearingCase; access: HearingAccess; log: (outcome: 'permitted' | 'denied', code: string) => Promise<void> };

/** May this official see (or run) this case's hearings? */
export async function gateHearings(req: NextRequest, caseId: string, need: 'view' | 'edit'): Promise<HearingGate> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor) return { error: errorResponse('Unauthorized', 401) };
  let c: HearingCase | null;
  let presides = false;
  try {
    c = await loadHearingCase(caseId);
    if (c && BLOTTER_ROLES.includes(actor.role) && c.assignedToId !== actor.id) {
      presides = (await prisma.caseHearing.count({ where: { caseId, assignedOfficialId: actor.id, status: { not: 'CANCELLED' } } })) > 0;
    }
  } catch {
    return { error: errorResponse('The case could not be loaded right now. Nothing was changed.', 503) };
  }
  const log = (outcome: 'permitted' | 'denied', code: string) => prisma.reporterAccessLog.create({
    data: { actorId: actor.id, actorRole: actor.role, caseId: caseId.slice(0, 64), caseNumber: c?.caseNumber ?? null,
      fields: ['hearings'], outcome, code: need === 'edit' ? `${code}:edit` : code },
  }).then(() => undefined).catch(() => undefined);
  if (!c) { await log('denied', 'not_found'); return { error: errorResponse('Case not found', 404) }; }
  const access = decideHearingAccess(actor, c, presides);
  if (access.hidden) { await log('denied', access.code); return { error: errorResponse('Case not found', 404) }; }
  if (!access.view || (need === 'edit' && !access.edit)) {
    await log('denied', access.code);
    const status = access.code === 'vawc_case' ? 422 : 403;
    return { error: noStore({ success: false, error: access.message ?? 'Not permitted', code: access.code, canClaim: access.canClaim }, status) };
  }
  return { actor, c, access, log };
}

/** The case's eligibility for an ordinary hearing, from what the officials recorded. */
export async function eligibilityOf(c: HearingCase): Promise<Eligibility> {
  const [category, review] = await Promise.all([
    prisma.assessmentHistory.findFirst({
      where: { caseId: c.id, kind: { in: ['category_confirm', 'category_change', 'walk_in'] }, actorId: { not: null } },
      orderBy: { createdAt: 'desc' }, select: { caseType: true, createdAt: true },
    }),
    prisma.caseKpReview.findFirst({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const by = review ? await prisma.user.findUnique({ where: { id: review.reviewedById }, select: { name: true } }) : null;
  const suggested = c.intake?.suggestedCaseCategory ?? null;
  return hearingEligibility({
    caseType: c.caseType, status: c.status,
    verifiedCategory: category ? { caseType: category.caseType, at: category.createdAt } : null,
    review: review ? { decision: review.decision, caseType: review.caseType, at: review.createdAt, note: review.note, by: by?.name ?? null } : null,
    reportPath: c.reportPath,
    aiSuggestedCategory: suggested && suggested !== c.caseType ? suggested : null,
  });
}

/** Officials a hearing may be assigned to. */
export async function presidingOfficials() {
  return prisma.user.findMany({
    where: { active: true, role: { in: PRESIDING_ROLES } },
    select: { id: true, name: true, role: true }, orderBy: { name: 'asc' },
  });
}

/** The complainant as the case records them: the chosen party, or the reporter. */
export function complainantName(c: { reporterIdentityWithheld: boolean; residentName: string; resident: { firstName: string; lastName: string } | null },
  party: { fullName: string | null } | null): string {
  if (party?.fullName) return party.fullName;
  if (c.reporterIdentityWithheld) return 'The Complainant';
  const r = c.resident ? `${c.resident.firstName} ${c.resident.lastName}`.trim() : '';
  return r || c.residentName || 'The Complainant';
}
export const respondentName = (party: { fullName: string | null } | null) => party?.fullName || 'The Respondent';

/** A row in the hearing's history. Insert-only: the database refuses any change to it. */
export async function recordEvent(tx: Prisma.TransactionClient, e: {
  hearingId: string; caseId: string; kind: string; actorType: 'official' | 'resident' | 'system'; actorId: string | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; note?: string | null;
}) {
  return tx.caseHearingEvent.create({ data: {
    hearingId: e.hearingId, caseId: e.caseId, kind: e.kind, actorType: e.actorType, actorId: e.actorId,
    before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
    after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
    note: e.note ?? null,
  } });
}

/**
 * The case-timeline line for an event. Linked to the event, so the
 * complainant's feed tells them about it in its own words (lib/hearings.ts
 * residentHearingMessage) - never this line, which names the official.
 */
export async function hearingActivity(tx: Prisma.TransactionClient, eventId: string, caseId: string, actorId: string | null, message: string) {
  await tx.activity.create({ data: {
    type: 'hearing', message, entityId: eventId, entityType: 'CaseHearingEvent', userId: actorId, caseId, color: '#0369a1',
  } });
}

/**
 * Tell the officials handling a hearing: the presiding official and the
 * case's officer, or the desk as a whole when neither is set. The message
 * carries no note or reason - the hearing record has those.
 */
export async function notifyOfficials(tx: Prisma.TransactionClient, h: { assignedOfficialId: string | null }, c: { id: string; assignedToId: string | null },
  title: string, message: string, type = 'info') {
  const to = [...new Set([h.assignedOfficialId, c.assignedToId].filter((x): x is string => Boolean(x)))];
  const targets: (string | null)[] = to.length ? to : [null];
  for (const userId of targets) await tx.notification.create({ data: { title, message, type, userId, caseId: c.id } });
}

export async function actorName(id: string) {
  return (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'an official';
}

/** Was this a unique-key collision (a second open hearing, a duplicate request)? */
export const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

// ── Scheduling input, shared by create, edit and new-date ─────────────────────

export const scheduleFields = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the hearing date').optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the hearing time').optional(),
  /** Accepted as one ISO instant instead of date + time. */
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  venue: z.string().trim().max(200).optional(),
  /** The official saw the conflict warning and chose to go ahead. */
  confirmConflicts: z.boolean().optional(),
};


/** One instant from date + time (Philippine time), or the ISO value. */
export function instantOf(d: { date?: string; time?: string; scheduledAt?: string }): Date | null {
  if (d.date && d.time) return phInstant(d.date, d.time);
  return d.scheduledAt ? new Date(d.scheduledAt) : null;
}

/** The chosen parties and official must be this case's records and an official who may preside. */
export async function checkPeople(caseId: string, d: { assignedOfficialId?: string | null; complainantPartyId?: string | null; respondentPartyId?: string | null }): Promise<string | null> {
  if (d.complainantPartyId) {
    const p = await prisma.caseParty.findFirst({ where: { id: d.complainantPartyId, caseId, role: 'AFFECTED' }, select: { id: true } });
    if (!p) return 'The complainant must be the reporter or a person affected recorded on this case.';
  }
  if (d.respondentPartyId) {
    const p = await prisma.caseParty.findFirst({ where: { id: d.respondentPartyId, caseId, role: 'REPORTED' }, select: { id: true } });
    if (!p) return 'The respondent must be a person reported on this case.';
  }
  if (d.assignedOfficialId) {
    const u = await prisma.user.findFirst({ where: { id: d.assignedOfficialId, active: true, role: { in: PRESIDING_ROLES } }, select: { id: true } });
    if (!u) return 'The assigned official must be an active blotter officer or the barangay captain.';
  }
  return null;
}

// ── Notices ──────────────────────────────────────────────────────────────────

/** What a notice prints, from the hearing and the case as they are now. */
export function noticeInputFor(c: HearingCase, h: { reference: string; hearingNumber: number; scheduledAt: Date; venue: string | null },
  n: { noticeNumber: string | null; recipientRole: 'COMPLAINANT' | 'RESPONDENT'; recipientName: string; scheduledAt?: Date; venue?: string | null; issuedAt: Date | null },
  state: NoticeInput['state'], issuingOfficer: string | null): NoticeInput {
  return {
    noticeNumber: n.noticeNumber, caseNumber: c.caseNumber, hearingReference: h.reference, hearingNumber: h.hearingNumber,
    // A stored notice prints the date it was made for, even after a new date.
    scheduledAt: n.scheduledAt ?? h.scheduledAt, venue: n.venue === undefined ? h.venue : n.venue,
    recipient: n.recipientName, recipientRole: n.recipientRole, issuingOfficer, issuedAt: n.issuedAt,
    barangay: BARANGAY_CONTEXT.name, municipality: c.municipality || 'Bocaue', province: c.province || 'Bulacan',
    officeContact: EMERGENCY_CONTACTS.find(x => /barangay/i.test(x.label))?.number ?? null,
    state,
  };
}

export const pdfResponse = (bytes: Uint8Array, filename: string, inline = false) => new Response(Buffer.from(bytes), { headers: {
  'Content-Type': 'application/pdf',
  'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
  'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
} });

// ── Schedule conflicts ───────────────────────────────────────────────────────

/**
 * Other open hearings (drafts included) that this date and time would clash
 * with: the same official, or the same venue, within one slot
 * (HEARING_SLOT_MINUTES). Nothing is moved - the official is told, and
 * decides. A hearing the official may not view is described without its
 * reference.
 */
export async function findConflicts(actor: Actor, p: { at: Date; venue: string | null; officialId: string | null; excludeId?: string | null }): Promise<ScheduleConflict[]> {
  const slot = HEARING_SLOT_MINUTES * 60_000;
  const rows = await prisma.caseHearing.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      scheduledAt: { gt: new Date(p.at.getTime() - slot), lt: new Date(p.at.getTime() + slot) },
      ...(p.excludeId && { id: { not: p.excludeId } }),
    },
    select: { id: true, reference: true, scheduledAt: true, venue: true, assignedOfficialId: true,
      assignedOfficial: { select: { name: true } }, case: { select: { caseType: true, assignedToId: true } } },
    orderBy: { scheduledAt: 'asc' },
  });
  const out: ScheduleConflict[] = [];
  for (const r of rows) {
    const visible = decideHearingAccess(actor, r.case, r.assignedOfficialId === actor.id).view;
    const ref = visible ? r.reference : null;
    const at = formatHearingWhen(r.scheduledAt);
    if (p.officialId && r.assignedOfficialId === p.officialId) {
      out.push({ kind: 'official', reference: ref, scheduledAt: r.scheduledAt.toISOString(),
        message: `${r.assignedOfficial?.name ?? 'The assigned official'} already has a hearing at ${at}${ref ? ` (${ref})` : ''}.` });
    }
    if (sameVenue(r.venue, p.venue)) {
      out.push({ kind: 'venue', reference: ref, scheduledAt: r.scheduledAt.toISOString(),
        message: `${r.venue || 'Barangay Hall'} is already reserved at ${at}${ref ? ` for ${ref}` : ' for another hearing'}.` });
    }
  }
  return out;
}

/** The answer when conflicts were found and the official has not chosen to go ahead. */
export const conflictResponse = (conflicts: ScheduleConflict[]) => noStore({
  success: false, code: 'schedule_conflict', conflicts,
  error: `Scheduling conflict: ${conflicts[0].message}${conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : ''} Nothing was changed.`,
}, 409);
