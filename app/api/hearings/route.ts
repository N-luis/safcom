import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, BLOTTER_ROLES, VAWC_DESK_ROLES } from '@/lib/reporterAccess';
import { parseRange } from '@/lib/analytics';
import { noStore, decideHearingAccess, complainantName, respondentName, hearingListScope, tracksFor } from '@/lib/hearingsServer';
import {
  HEARING_STATUSES, CALENDAR_STATUS_GROUPS, isLive, isHearingKind, sessionTitle, stageParties, trackOf, isCaseTrack, LIVE_NOTICE,
  type CalendarStatusGroup, type CaseTrack,
} from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * Hearing Management: the hearings an official may see, for the records
 * table and the calendar - one case type at a time (?track=BLOTTER, the
 * default, or VAWC; ALL for a role that works with both).
 *
 *   blotter officer  blotter hearings on their own cases, or that they preside over
 *   VAWC officer     VAWC hearings on their own cases, or that they preside over
 *   captain          every case's hearings, of the type asked for
 *   system admin     blotter hearings, to view - never a VAWC case's (RA 9262 sec. 44)
 *
 * A role asking for a case type it may not list gets 403, before anything is read.
 *
 * Filters: stage=MEDIATION,... or a VAWC hearing type; status=A,B (a hearing status or a calendar group -
 * scheduled, rescheduled, completed, cancelled, draft); from/to (Philippine
 * days, on the hearing date); category (a blotter category); official (the
 * assigned officer's id); q (case number or hearing reference).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  const role = actor.role.trim();
  const sp = req.nextUrl.searchParams;
  const mine = tracksFor(role);
  if (!mine.length) return noStore({ success: false, error: 'Your role cannot view hearings.' }, 403);
  // Each desk's own case type unless another is asked for; ALL = every type the role works with.
  const asked = sp.get('track')?.trim().toUpperCase() ?? '';
  const tracks: CaseTrack[] = asked === 'ALL' ? mine : isCaseTrack(asked) ? [asked] : [mine[0]];
  if (tracks.some(t => !mine.includes(t))) {
    return noStore({ success: false, code: 'wrong_desk', error: tracks.includes('VAWC')
      ? 'VAWC hearings are confidential (RA 9262 sec. 44): only the VAWC desk and the Punong Barangay may list them.'
      : 'Blotter hearings are for the Blotter desk. VAWC officers manage hearings on VAWC cases.' }, 403);
  }
  const blotter = BLOTTER_ROLES.includes(role);
  const scopes = tracks.map(t => hearingListScope(actor, t)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!scopes.length) return noStore({ success: false, error: 'Your role cannot view hearings.' }, 403);

  const stages = (sp.get('stage') ?? '').split(',').map(s => s.trim()).filter(isHearingKind);
  const statuses = [...new Set((sp.get('status') ?? '').split(',').map(s => s.trim()).flatMap(s =>
    s in CALENDAR_STATUS_GROUPS ? [...CALENDAR_STATUS_GROUPS[s as CalendarStatusGroup].statuses] as string[] : s in HEARING_STATUSES ? [s] : []))];
  // A category of the other case type asked for here matches nothing: the scope below excludes it.
  const category = sp.get('category')?.trim().slice(0, 80) || null;
  const official = sp.get('official')?.trim().slice(0, 64) || null;
  const { from, to } = parseRange(sp.get('from'), sp.get('to'));
  const q = sp.get('q')?.trim().slice(0, 60) || null;

  // What this official may see at all: the case type(s) asked for, and for a
  // desk officer only their own cases or the hearings they preside over.
  const scope = scopes.length === 1 ? scopes[0] : { OR: scopes };
  try {
    const rows = await prisma.caseHearing.findMany({
      where: {
        AND: [
          scope,
          stages.length ? { stage: { in: stages } } : {},
          category ? { case: { caseType: category } } : {},
          official ? { assignedOfficialId: official } : {},
          statuses.length ? { status: { in: statuses } } : {},
          from || to ? { scheduledAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {},
          q ? { OR: [{ reference: { contains: q, mode: 'insensitive' as const } }, { case: { caseNumber: { contains: q, mode: 'insensitive' as const } } }] } : {},
        ],
      },
      orderBy: { scheduledAt: 'asc' }, take: 500,
      include: {
        case: { select: { id: true, caseNumber: true, caseType: true, status: true, assignedToId: true, residentName: true, reporterIdentityWithheld: true,
          resident: { select: { firstName: true, lastName: true } } } },
        assignedOfficial: { select: { id: true, name: true } },
        complainantParty: { select: { fullName: true } },
        respondentParty: { select: { fullName: true } },
        notices: { where: { status: { not: 'SUPERSEDED' } }, select: { recipientRole: true, status: true } },
        requests: { where: { status: 'PENDING' }, select: { id: true } },
      },
    });
    const now = new Date();
    const data = rows.map(h => {
      const access = decideHearingAccess(actor, h.case, h.assignedOfficialId === actor.id);
      const notice = (r: string) => h.notices.find(n => n.recipientRole === r)?.status ?? null;
      return {
        id: h.id, reference: h.reference, hearingNumber: h.hearingNumber, stage: h.stage, session: h.session, title: sessionTitle(h.stage, h.session),
        track: trackOf(h.case.caseType), parties: stageParties(h.stage),
        scheduledAt: h.scheduledAt, venue: h.venue, status: h.status,
        outcome: h.outcome, rescheduleCount: h.rescheduleCount, updatedAt: h.updatedAt,
        case: { id: h.case.id, caseNumber: h.case.caseNumber, caseType: h.case.caseType, status: h.case.status },
        complainant: complainantName(h.case, h.complainantParty),
        respondent: respondentName(h.respondentParty),
        official: h.assignedOfficial,
        attendance: { complainant: h.complainantAttendance, respondent: h.respondentAttendance },
        notices: { complainant: notice('COMPLAINANT'), respondent: notice('RESPONDENT') },
        residentIntent: h.residentIntent,
        pendingRequests: h.requests.length,
        overdue: isLive(h.status) && h.scheduledAt < now,
        approaching: isLive(h.status) && h.scheduledAt >= now && h.scheduledAt.getTime() - now.getTime() < 48 * 3_600_000,
        canEdit: access.edit,
      };
    });
    const count = (f: (r: typeof data[number]) => boolean) => data.filter(f).length;
    return noStore({ success: true, data: {
      rows: data,
      summary: {
        total: data.length,
        drafts: count(r => r.status === 'DRAFT'),
        upcoming: count(r => isLive(r.status) && new Date(r.scheduledAt) >= now),
        overdue: count(r => r.overdue),
        noticesPending: count(r => isLive(r.status) && r.parties.some(p => !(LIVE_NOTICE as string[]).includes(r.notices[p === 'COMPLAINANT' ? 'complainant' : 'respondent'] ?? ''))),
        completed: count(r => r.status === 'COMPLETED'),
        rescheduled: count(r => r.rescheduleCount > 0),
        cancelled: count(r => r.status === 'CANCELLED'),
        pendingRequests: data.reduce((n, r) => n + r.pendingRequests, 0),
      },
      canCreate: blotter || VAWC_DESK_ROLES.includes(role) || role === 'admin',
      // The case types listed, and those this role may switch to.
      tracks, availableTracks: mine,
      // The filter choices, from what this official may see.
      filters: await filterOptions(scope),
    } });
  } catch (e) {
    logRouteError('GET /api/hearings', e);
    return errorResponse('The hearings could not be loaded right now.', 503);
  }
}

async function filterOptions(scope: object) {
  const [cats, officials] = await Promise.all([
    prisma.case.findMany({ where: { hearings: { some: scope } }, distinct: ['caseType'], select: { caseType: true }, orderBy: { caseType: 'asc' } }),
    prisma.user.findMany({ where: { presidedHearings: { some: scope } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return { categories: cats.map(c => c.caseType), officials };
}
