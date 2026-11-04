import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, BLOTTER_ROLES, VAWC_DESK_ROLES } from '@/lib/reporterAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { parseRange } from '@/lib/analytics';
import { noStore, decideHearingAccess, complainantName, respondentName } from '@/lib/hearingsServer';
import { HEARING_STATUSES, CALENDAR_STATUS_GROUPS, isLive, isKpStage, sessionTitle, LIVE_NOTICE, type CalendarStatusGroup } from '@/lib/hearings';

export const dynamic = 'force-dynamic';

/**
 * Hearing Management: the hearings an official may see, for the records
 * table and the calendar.
 *
 *   blotter officer  hearings on their own cases, or that they preside over
 *   captain          every blotter case's hearings
 *   system admin     the same, to view
 *   VAWC desk        none - RA 9262 cases are never heard at the barangay
 *
 * Filters: stage=MEDIATION,CONSTITUTION,CONCILIATION; status=A,B (a hearing status or a calendar group -
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
  if (VAWC_DESK_ROLES.includes(role)) {
    return noStore({ success: false, error: 'Hearing Management is for blotter disputes. VAWC cases under RA 9262 stay in the VAWC workflow - intervention, referral and follow-up.', code: 'wrong_desk' }, 403);
  }
  const blotter = BLOTTER_ROLES.includes(role);
  if (!blotter && role !== 'admin' && role !== 'system_admin') return noStore({ success: false, error: 'Your role cannot view hearings.' }, 403);

  const sp = req.nextUrl.searchParams;
  const stages = (sp.get('stage') ?? '').split(',').map(s => s.trim()).filter(isKpStage);
  const statuses = [...new Set((sp.get('status') ?? '').split(',').map(s => s.trim()).flatMap(s =>
    s in CALENDAR_STATUS_GROUPS ? [...CALENDAR_STATUS_GROUPS[s as CalendarStatusGroup].statuses] as string[] : s in HEARING_STATUSES ? [s] : []))];
  // A VAWC category asked for here matches nothing: the scope below excludes them.
  const category = sp.get('category')?.trim().slice(0, 80) || null;
  const official = sp.get('official')?.trim().slice(0, 64) || null;
  const { from, to } = parseRange(sp.get('from'), sp.get('to'));
  const q = sp.get('q')?.trim().slice(0, 60) || null;

  // What this official may see at all: blotter cases only, and for a blotter
  // officer only their own cases or the hearings they preside over.
  const scope = {
    AND: [
      // Hearings are blotter-only by construction; kept so if a case moves desks.
      { case: { caseType: { notIn: [...VAWC_TYPES] } } },
      blotter ? { OR: [{ case: { assignedToId: actor.id } }, { assignedOfficialId: actor.id }] } : {},
    ],
  };
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
        noticesPending: count(r => isLive(r.status) && [r.notices.complainant, r.notices.respondent].some(n => !(LIVE_NOTICE as string[]).includes(n ?? ''))),
        completed: count(r => r.status === 'COMPLETED'),
        rescheduled: count(r => r.rescheduleCount > 0),
        cancelled: count(r => r.status === 'CANCELLED'),
        pendingRequests: data.reduce((n, r) => n + r.pendingRequests, 0),
      },
      canCreate: blotter || role === 'admin',
      // The filter choices, from what this official may see.
      filters: await filterOptions(scope),
    } });
  } catch {
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
