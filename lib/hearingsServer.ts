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
  hearingEligibility, vawcHearingEligibility, phInstant, formatHearingWhen, sameVenue, statusFromNotices, partyFormsFor, noticeNumber, kpFormName, sessionTitle,
  isKpStage, isHearingKind, isVawcHearingType, hasRespondent, trackOf, OPEN_STATUSES, NOTICE_RECIPIENTS,
  type Eligibility, type ScheduleConflict, type KpFormNo, type PartyRole, type CaseTrack, type HearingKind,
} from './hearings';
import { VAWC_TYPES } from './vawcTypes';
import { BARANGAY_CONTEXT, HEARING_SLOT_MINUTES } from './safecommConfig';
import { buildKpNoticePdf, type KpNoticeInput } from './kpNoticesPdf';
import { buildVawcNoticePdf } from './vawcNoticePdf';

export { noStore };

/** A KP record asked for on a VAWC case. */
export const VAWC_KP_REFUSAL = 'VAWC cases under RA 9262 are not subject to barangay mediation or conciliation: no Katarungang Pambarangay eligibility review or Pangkat is recorded on one.';

/** Who presides over a hearing: a blotter officer or the captain. */
export const PRESIDING_ROLES = [...BLOTTER_ROLES, 'admin'];
/** Who presides over a VAWC case's hearing: the VAWC desk or the captain. */
export const VAWC_PRESIDING_ROLES = [...VAWC_DESK_ROLES, 'admin'];
export const presidingRolesFor = (track: CaseTrack) => (track === 'VAWC' ? VAWC_PRESIDING_ROLES : PRESIDING_ROLES);

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
 * The rule, on its own so it can be tested. The same for both case types,
 * each on its own desk:
 *   - blotter officer (blotter case) / VAWC officer (VAWC case): the case's
 *     assigned officer, or the official presiding over one of its hearings,
 *     runs them;
 *   - captain: runs hearings on any case (and reads VAWC cases already);
 *   - system administrator: may view blotter hearings, never schedule or
 *     record - and never a VAWC case's;
 *   - a VAWC case is not found for anyone outside the VAWC roles (RA 9262
 *     sec. 44), and a VAWC officer has no blotter hearings to run.
 */
export function decideHearingAccess(actor: Actor, c: { caseType: string; assignedToId: string | null }, presides = false): HearingAccess {
  const role = actor.role.trim();
  const no = (code: string, message: string, extra: Partial<HearingAccess> = {}): HearingAccess =>
    ({ view: false, edit: false, hidden: false, code, message, canClaim: false, ...extra });
  if (!actor.active) return no('inactive', 'Your account is not active.');
  if (isVawcType(c.caseType)) {
    if (!canSeeVawc(role)) return no('vawc_restricted', 'Case not found.', { hidden: true });
    if (VAWC_DESK_ROLES.includes(role)) {
      if (c.assignedToId === actor.id || presides) return { view: true, edit: true, hidden: false, code: 'assigned', message: null, canClaim: false };
      return no('not_assigned', 'Only the officer assigned to this case (or the official presiding over its hearing) can manage its hearings. Take the case first if it is unassigned.',
        { canClaim: c.assignedToId === null });
    }
    if (role === 'admin') return { view: true, edit: true, hidden: false, code: 'captain', message: null, canClaim: false };
    return no('role_not_permitted', 'Your role cannot manage hearings.');
  }
  if (VAWC_DESK_ROLES.includes(role)) {
    return no('wrong_desk', 'This is a blotter case. VAWC officers manage hearings on VAWC cases only - blotter cases are the Blotter desk\'s.');
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

/**
 * May this official see (or run) this case's hearings? kpOnly: a
 * Katarungang Pambarangay record (the eligibility review, the Pangkat) -
 * refused on a VAWC case (422), whoever asks: RA 9262 sec. 33.
 */
export async function gateHearings(req: NextRequest, caseId: string, need: 'view' | 'edit', opts: { kpOnly?: boolean } = {}): Promise<HearingGate> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor) return { error: errorResponse('Unauthorized', 401) };
  let c: HearingCase | null;
  let presides = false;
  try {
    c = await loadHearingCase(caseId);
    if (c && [...BLOTTER_ROLES, ...VAWC_DESK_ROLES].includes(actor.role) && c.assignedToId !== actor.id) {
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
    return { error: noStore({ success: false, error: access.message ?? 'Not permitted', code: access.code, canClaim: access.canClaim }, 403) };
  }
  if (opts.kpOnly && isVawcType(c.caseType)) {
    await log('denied', 'vawc_case');
    return { error: noStore({ success: false, error: VAWC_KP_REFUSAL, code: 'vawc_case' }, 422) };
  }
  return { actor, c, access, log };
}

/**
 * The case's eligibility for a hearing, from what the officials recorded. A
 * VAWC case needs no KP review (it is never mediated): only a closed case
 * has no hearing.
 */
export async function eligibilityOf(c: HearingCase): Promise<Eligibility> {
  if (isVawcType(c.caseType)) return vawcHearingEligibility(c.status);
  const [category, review] = await Promise.all([
    prisma.assessmentHistory.findFirst({
      where: { caseId: c.id, kind: { in: ['category_confirm', 'category_change', 'walk_in'] }, actorId: { not: null } },
      orderBy: { createdAt: 'desc' }, select: { caseType: true, createdAt: true },
    }),
    prisma.caseKpReview.findFirst({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const ids = review ? [review.reviewedById, review.approvedById].filter((x): x is string => Boolean(x)) : [];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (uid: string | null | undefined) => (uid ? users.find(u => u.id === uid)?.name ?? 'Former official' : null);
  const suggested = c.intake?.suggestedCaseCategory ?? null;
  return hearingEligibility({
    caseType: c.caseType, status: c.status,
    verifiedCategory: category ? { caseType: category.caseType, at: category.createdAt } : null,
    review: review ? { decision: review.decision, caseType: review.caseType, at: review.createdAt, note: review.note, by: name(review.reviewedById),
      version: review.version, checklist: review.checklist, approvedById: review.approvedById, approvedBy: name(review.approvedById) } : null,
    reportPath: c.reportPath,
    aiSuggestedCategory: suggested && suggested !== c.caseType ? suggested : null,
  });
}

/** Officials a hearing may be assigned to: the case's own desk, or the captain. */
export async function presidingOfficials(track: CaseTrack = 'BLOTTER') {
  return prisma.user.findMany({
    where: { active: true, role: { in: presidingRolesFor(track) } },
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

/** The chosen parties and official must be this case's records and an official who may preside (on the case's own desk). */
export async function checkPeople(caseId: string, d: { assignedOfficialId?: string | null; complainantPartyId?: string | null; respondentPartyId?: string | null },
  track: CaseTrack = 'BLOTTER'): Promise<string | null> {
  if (d.complainantPartyId) {
    const p = await prisma.caseParty.findFirst({ where: { id: d.complainantPartyId, caseId, role: 'AFFECTED' }, select: { id: true } });
    if (!p) return 'The complainant must be the reporter or a person affected recorded on this case.';
  }
  if (d.respondentPartyId) {
    const p = await prisma.caseParty.findFirst({ where: { id: d.respondentPartyId, caseId, role: 'REPORTED' }, select: { id: true } });
    if (!p) return 'The respondent must be a person reported on this case.';
  }
  if (d.assignedOfficialId) {
    const u = await prisma.user.findFirst({ where: { id: d.assignedOfficialId, active: true, role: { in: presidingRolesFor(track) } }, select: { id: true } });
    if (!u) return track === 'VAWC' ? 'The assigned official must be an active VAWC officer or the barangay captain.' : 'The assigned official must be an active blotter officer or the barangay captain.';
  }
  return null;
}

// ── The parties and their accounts ───────────────────────────────────────────

/** The parties of one proceeding as the server needs them. */
export const hearingPartySelect = {
  complainantParty: { select: { id: true, fullName: true } },
  respondentParty: { select: { id: true, fullName: true } },
} as const;
type PartyRef = { id: string; fullName: string | null } | null;

/**
 * Whose SafeComm account each side's notices go to: the complainant's go to
 * the reporter who filed the case; the respondent's are handed over or served
 * by an officer. No other person's account is ever involved.
 */
export function partyAccounts(c: { residentId: string | null }) {
  return { COMPLAINANT: c.residentId ?? null, RESPONDENT: null } as Record<PartyRole, string | null>;
}

/**
 * The proceedings a resident takes part in: those on the cases they filed,
 * blotter and VAWC alike (a VAWC case's own complainant is a party to it).
 * Never a draft.
 */
export function residentHearingWhere(residentId: string) {
  return {
    status: { not: 'DRAFT' },
    case: { residentId },
  } satisfies Prisma.CaseHearingWhereInput;
}

/**
 * The hearings an official may list, for one case type: a blotter or VAWC
 * officer's own cases (or those they preside over), every one for the
 * captain - and for the system administrator, blotter hearings only. Null
 * when the role may not list that case type at all.
 */
export function hearingListScope(actor: Actor, track: CaseTrack): Prisma.CaseHearingWhereInput | null {
  const role = actor.role.trim();
  const ofTrack = { case: { caseType: track === 'VAWC' ? { in: [...VAWC_TYPES] } : { notIn: [...VAWC_TYPES] } } };
  const own = { OR: [{ case: { assignedToId: actor.id } }, { assignedOfficialId: actor.id }] };
  if (track === 'VAWC') {
    if (!canSeeVawc(role)) return null;
    return VAWC_DESK_ROLES.includes(role) ? { AND: [ofTrack, own] } : ofTrack;
  }
  if (BLOTTER_ROLES.includes(role)) return { AND: [ofTrack, own] };
  if (role === 'admin' || role === 'system_admin') return ofTrack;
  return null;
}

/** The case types a role works with, its own desk first. */
export function tracksFor(role: string): CaseTrack[] {
  const r = role.trim();
  if (VAWC_DESK_ROLES.includes(r)) return ['VAWC'];
  if (r === 'admin') return ['BLOTTER', 'VAWC'];
  if (BLOTTER_ROLES.includes(r) || r === 'system_admin') return ['BLOTTER'];
  return [];
}

/** What every event about a proceeding carries, so a party's message can be told from it alone. */
export const hearingSnap = (h: { hearingNumber: number; stage: string; session: number }, at: Date, venue: string | null) =>
  ({ hearingNumber: h.hearingNumber, stage: h.stage, session: h.session, scheduledAt: at.toISOString(), venue });

/** The Pangkat on a case, with every member recorded (removed ones too). */
export async function loadPangkat(caseId: string, db: Prisma.TransactionClient = prisma) {
  return db.casePangkat.findUnique({ where: { caseId }, include: { members: { orderBy: { createdAt: 'asc' } } } });
}
export const pangkatConstituted = (p: { constitutedAt: Date | null } | null) => Boolean(p?.constitutedAt);

/**
 * Why the Pangkat cannot be recorded as constituted yet, or null: three
 * serving members (RA 7160 sec. 410(b)), and a chairman and a secretary
 * chosen from among them (sec. 410(c)).
 */
export function pangkatRefusal(p: { chairmanMemberId: string | null; secretaryMemberId: string | null; members: { id: string; removedAt: Date | null }[] } | null): string | null {
  const serving = (p?.members ?? []).filter(m => !m.removedAt);
  if (serving.length < 3) return `Record the three Pangkat members first (${serving.length} of 3 recorded).`;
  if (serving.length > 3) return 'A Pangkat has three members. Remove the extra member first.';
  const ids = serving.map(m => m.id);
  if (!p?.chairmanMemberId || !ids.includes(p.chairmanMemberId)) return 'Choose the Pangkat chairman from among its members.';
  if (!p.secretaryMemberId || !ids.includes(p.secretaryMemberId)) return 'Choose the Pangkat secretary from among its members.';
  if (p.chairmanMemberId === p.secretaryMemberId) return 'The chairman and the secretary must be different members.';
  return null;
}

// ── Notices ──────────────────────────────────────────────────────────────────

type HearingForNotice = { id: string; caseId: string; reference: string; hearingNumber: number; stage: string; session: number; scheduledAt: Date; venue: string | null;
  status: string; rescheduleCount: number; complainantParty: PartyRef; respondentParty: PartyRef };

/** The proceeding's stage as one the workflow knows. */
export const kindOf = (stage: string): HearingKind => (isHearingKind(stage) ? stage : 'MEDIATION');

/**
 * The stage's notices to the parties, made when a proceeding is scheduled or
 * its date changes - one per party, for the one schedule: KP 8 and KP 9 for
 * mediation, KP 10 to both for the constitution of the Pangkat, KP 12 to
 * both for conciliation. A party with a SafeComm account gets theirs in the
 * account at once (issued, channel SAFECOMM_ACCOUNT); for one without, the
 * notice waits for an officer to hand it over or serve it (generated,
 * channel OFFICER). Nothing is sent by text or email.
 */
export async function issueStageNotices(tx: Prisma.TransactionClient, c: HearingCase, h: HearingForNotice, actorId: string, by: string,
  only?: PartyRole[]) {
  const stage = kindOf(h.stage);
  const accounts = partyAccounts(c);
  const now = new Date();
  const made = [];
  for (const f of partyFormsFor(stage).filter(f => !only || only.includes(f.recipientRole))) {
    const role = f.recipientRole;
    const account = accounts[role];
    const seq = (await tx.caseHearingNotice.count({ where: { hearingId: h.id, recipientRole: role } })) + 1;
    const name = role === 'COMPLAINANT' ? complainantName(c, h.complainantParty) : respondentName(h.respondentParty);
    const n = await tx.caseHearingNotice.create({ data: {
      hearingId: h.id, caseId: h.caseId, formNo: f.formNo, recipientRole: role, recipientName: name,
      noticeNumber: noticeNumber(h.reference, f.formNo, role, seq),
      scheduledAt: h.scheduledAt, venue: h.venue, generatedById: actorId,
      ...(account
        ? { status: 'ISSUED', channel: 'SAFECOMM_ACCOUNT', recipientResidentId: account, issueMethod: 'SAFECOMM', issuedById: actorId, issuedAt: now }
        : { status: 'GENERATED', channel: 'OFFICER' }),
    } });
    const after = { ...hearingSnap(h, h.scheduledAt, h.venue), formNo: f.formNo, recipientRole: role, noticeNumber: n.noticeNumber, channel: n.channel };
    const e = await recordEvent(tx, { hearingId: h.id, caseId: h.caseId, kind: account ? 'notice_issued' : 'notice_generated', actorType: 'official', actorId,
      after: account ? { ...after, method: 'SAFECOMM' } : after });
    await hearingActivity(tx, e.id, h.caseId, actorId, account
      ? `${kpFormName(f.formNo)} (${n.noticeNumber}) delivered to the ${NOTICE_RECIPIENTS[role].toLowerCase()}'s SafeComm account - ${sessionTitle(stage, h.session)}, by ${by}`
      : `${kpFormName(f.formNo)} (${n.noticeNumber}) generated for the ${NOTICE_RECIPIENTS[role].toLowerCase()} - no SafeComm account, to be handed over or served by an officer`);
    made.push(n);
  }
  await syncHearingStatus(tx, h, actorId);
  return made;
}

/** The proceeding's status, from its notices to the parties (lib/hearings.ts statusFromNotices). */
export async function syncHearingStatus(tx: Prisma.TransactionClient, h: { id: string; status: string; rescheduleCount: number }, actorId: string | null) {
  const current = await tx.caseHearingNotice.findMany({ where: { hearingId: h.id, status: { not: 'SUPERSEDED' }, recipientRole: { not: 'PANGKAT_MEMBER' } }, select: { status: true } });
  const status = statusFromNotices(h, current);
  if (status !== h.status) await tx.caseHearing.update({ where: { id: h.id }, data: { status, ...(actorId && { updatedById: actorId }) } });
  return status;
}

/** The notices to the parties that no longer hold - on a new date, or a cancellation. KP 11 stays: it is not about a date. */
export const supersedePartyNotices = (tx: Prisma.TransactionClient, hearingId: string) =>
  tx.caseHearingNotice.updateMany({ where: { hearingId, status: { not: 'SUPERSEDED' }, recipientRole: { not: 'PANGKAT_MEMBER' } }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });

/**
 * A notice as a PDF: the KP form on a blotter case, the VAWC Notice of
 * Hearing on a VAWC case (a hearing type with no KP form).
 */
export async function noticePdfFor(c: HearingCase,
  h: { reference: string; stage: string; scheduledAt: Date; venue: string | null; complainantParty: PartyRef; respondentParty: PartyRef },
  n: { formNo: number | null; noticeNumber: string | null; recipientRole: string; recipientName: string; scheduledAt?: Date; venue?: string | null;
    issuedAt: Date | null; generatedAt?: Date | null },
  state: KpNoticeInput['state'], preparedBy: string | null): Promise<Uint8Array> {
  if (!n.formNo && isVawcHearingType(h.stage)) {
    return buildVawcNoticePdf({
      noticeNumber: n.noticeNumber, caseNumber: c.caseNumber, hearingType: h.stage,
      complainant: complainantName(c, h.complainantParty), respondent: hasRespondent(h.stage) ? respondentName(h.respondentParty) : null,
      recipient: n.recipientName, recipientRole: n.recipientRole === 'RESPONDENT' ? 'RESPONDENT' : 'COMPLAINANT', hearingReference: h.reference,
      scheduledAt: n.scheduledAt ?? h.scheduledAt, venue: n.venue === undefined ? h.venue : n.venue,
      datedAt: n.issuedAt ?? n.generatedAt ?? null, issuedBy: preparedBy,
      barangay: BARANGAY_CONTEXT.name, municipality: c.municipality || 'Bocaue', province: c.province || 'Bulacan', state,
    });
  }
  return buildKpNoticePdf(await kpNoticeInputFor(c, h, n, state, preparedBy));
}

/** What a KP form prints, from the proceeding and the case as they are now. */
export async function kpNoticeInputFor(c: HearingCase,
  h: { reference: string; stage: string; scheduledAt: Date; venue: string | null; complainantParty: PartyRef; respondentParty: PartyRef },
  n: { formNo: number | null; noticeNumber: string | null; recipientRole: string; recipientName: string; scheduledAt?: Date; venue?: string | null;
    issuedAt: Date | null; generatedAt?: Date | null },
  state: KpNoticeInput['state'], preparedBy: string | null): Promise<KpNoticeInput> {
  const stage = isKpStage(h.stage) ? h.stage : 'MEDIATION';
  const formNo = (n.formNo ?? (stage === 'MEDIATION' ? (n.recipientRole === 'RESPONDENT' ? 9 : 8) : stage === 'CONSTITUTION' ? 10 : 12)) as KpFormNo;
  // KP 12 is signed by the Pangkat chairman: printed when recorded.
  let signatoryName: string | null = null;
  if (formNo === 12) {
    const p = await loadPangkat(c.id);
    signatoryName = p?.members.find(m => m.id === p.chairmanMemberId)?.name ?? null;
  }
  return {
    formNo, noticeNumber: n.noticeNumber, caseNumber: c.caseNumber, nature: c.caseType,
    complainants: [complainantName(c, h.complainantParty)], respondents: [respondentName(h.respondentParty)],
    recipient: n.recipientName, recipientRole: n.recipientRole as KpNoticeInput['recipientRole'], hearingReference: h.reference,
    // A stored notice prints the date it was made for, even after a new date.
    scheduledAt: n.scheduledAt ?? h.scheduledAt, venue: n.venue === undefined ? h.venue : n.venue,
    datedAt: n.issuedAt ?? n.generatedAt ?? null, signatoryName, preparedBy,
    barangay: BARANGAY_CONTEXT.name, municipality: c.municipality || 'Bocaue', province: c.province || 'Bulacan',
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

// ── A case moved to the other desk ───────────────────────────────────────────

/**
 * When an official moves a case between the Blotter and VAWC desks, its open
 * hearings no longer fit: a KP mediation may not go on once the case is VAWC
 * (RA 9262 sec. 33), and a VAWC hearing skips the KP eligibility review on a
 * blotter case. So each open one (draft or scheduled) is cancelled, with the
 * reason, in its history and on the case timeline; pending requests for a new
 * date are answered. Notices already issued stay on record as issued - they
 * are not regenerated - and new notices follow the new case type. Access
 * follows the case type at once: it is read from the case on every request.
 * Returns how many were cancelled. Run inside the reclassification's
 * transaction, so both happen or neither.
 */
export async function closeHearingsOnReclassification(tx: Prisma.TransactionClient, caseId: string, fromType: string, toType: string, actorId: string) {
  const from = trackOf(fromType), to = trackOf(toType);
  if (from === to) return 0;
  const open = await tx.caseHearing.findMany({ where: { caseId, status: { in: [...OPEN_STATUSES] } } });
  const reason = `The case was reclassified from ${fromType} (${from === 'VAWC' ? 'VAWC' : 'Blotter'}) to ${toType} (${to === 'VAWC' ? 'VAWC' : 'Blotter'}). Schedule a new hearing under the new case type.`;
  const now = new Date();
  for (const h of open) {
    await tx.caseHearing.update({ where: { id: h.id }, data: {
      status: 'CANCELLED', activeKey: null, openKey: null, statusReason: reason.slice(0, 300), cancelledAt: now, cancelledById: actorId, updatedById: actorId,
    } });
    await tx.caseHearingRequest.updateMany({ where: { hearingId: h.id, status: 'PENDING' },
      data: { status: 'DECLINED', pendingKey: null, reviewedById: actorId, reviewedAt: now, reviewNote: 'The hearing was cancelled.' } });
    const e = await recordEvent(tx, { hearingId: h.id, caseId, kind: 'cancelled', actorType: 'official', actorId,
      before: { status: h.status, caseType: fromType },
      after: { ...hearingSnap(h, h.scheduledAt, h.venue), wasDraft: h.status === 'DRAFT', reclassified: true, caseType: toType }, note: reason });
    await hearingActivity(tx, e.id, caseId, actorId, `${sessionTitle(h.stage, h.session)} cancelled - ${reason}`);
  }
  return open.length;
}
