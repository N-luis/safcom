import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore, residentHearingWhere, partyRoleOf, hearingPartySelect } from '@/lib/hearingsServer';
import {
  isLive, phDay, sessionTitle, kpFormName, residentHearingMessage, LIVE_NOTICE, NOTICE_STATUSES, HEARING_OUTCOMES, KP_STAGES, RESIDENT_STATUS_LABELS,
  RESIDENT_INSTRUCTIONS, RESIDENT_EVENT_KINDS, RESCHEDULE_REQUESTS_PER_HEARING, isKpStage, type HearingOutcome, type NoticeStatus,
} from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * My Hearings & Notices: the Katarungang Pambarangay proceedings the
 * resident is a party to - as the complainant on a case they filed (or were
 * linked to), or as the respondent an official linked to their account -
 * with their own KP notices, their requests, what changed, and a short
 * outcome. Never the proceedings notes, attendance, agreements, the other
 * party's notice or contact details, or the case narrative. A draft is not
 * shown until an official schedules it.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const me = auth.resident.residentId;
  try {
    const hearings = await prisma.caseHearing.findMany({
      where: residentHearingWhere(me),
      orderBy: [{ scheduledAt: 'asc' }],
      select: {
        id: true, reference: true, hearingNumber: true, stage: true, session: true, scheduledAt: true, venue: true, status: true, outcome: true, outcomeSummary: true,
        residentInstructions: true, residentIntent: true, residentIntentAt: true, rescheduleCount: true, updatedAt: true,
        case: { select: { id: true, caseNumber: true, residentId: true } },
        ...hearingPartySelect,
        notices: { where: { status: { in: [...LIVE_NOTICE] }, recipientRole: { in: ['COMPLAINANT', 'RESPONDENT'] } }, orderBy: { generatedAt: 'desc' },
          select: { id: true, formNo: true, recipientRole: true, noticeNumber: true, status: true, issuedAt: true, acknowledgedAt: true, seenAt: true, scheduledAt: true, issuedById: true } },
        requests: { where: { residentId: me }, orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, requesterRole: true, reason: true, preferredSchedule: true, reviewNote: true, createdAt: true, reviewedAt: true } },
        events: { where: { kind: { in: [...RESIDENT_EVENT_KINDS] } }, orderBy: { createdAt: 'desc' }, take: 40, select: { id: true, kind: true, after: true, createdAt: true } },
      },
    });
    const issuers = [...new Set(hearings.flatMap(h => h.notices.map(n => n.issuedById)).filter((x): x is string => Boolean(x)))];
    const users = issuers.length ? await prisma.user.findMany({ where: { id: { in: issuers } }, select: { id: true, name: true } }) : [];
    const today = phDay(new Date());
    const view = hearings.map(h => {
      const role = partyRoleOf(h, me);
      const live = isLive(h.status);
      const notPast = phDay(h.scheduledAt) >= today;
      // Only the notices addressed to this side.
      const notices = h.notices.filter(n => n.recipientRole === role);
      const pending = h.requests.find(r => r.status === 'PENDING');
      const updates = h.events.flatMap(e => { const m = residentHearingMessage(e, role); return m ? [{ id: e.id, message: m, at: e.createdAt }] : []; });
      const stage = isKpStage(h.stage) ? h.stage : 'MEDIATION';
      return {
        id: h.id, reference: h.reference, stage, stageLabel: KP_STAGES[stage].label, session: h.session, title: sessionTitle(stage, h.session),
        role, roleLabel: role === 'RESPONDENT' ? 'Respondent' : 'Complainant',
        // A respondent reaches the proceeding only, never the complainant's case record.
        case: { id: role === 'COMPLAINANT' && h.case.residentId === me ? h.case.id : null, caseNumber: h.case.caseNumber },
        scheduledAt: h.scheduledAt, venue: h.venue || 'Barangay Hall',
        status: h.status, statusLabel: RESIDENT_STATUS_LABELS[h.status] ?? h.status,
        upcoming: live && notPast,
        rescheduled: h.rescheduleCount > 0,
        notices: notices.map(n => ({
          id: n.id, formNo: n.formNo, formName: kpFormName(n.formNo), noticeNumber: n.noticeNumber, status: n.status,
          statusLabel: NOTICE_STATUSES[n.status as NoticeStatus], issuedAt: n.issuedAt, acknowledgedAt: n.acknowledgedAt, seenAt: n.seenAt,
          issuedBy: users.find(u => u.id === n.issuedById)?.name ?? null,
          canAcknowledge: live && n.status !== 'ACKNOWLEDGED',
        })),
        // The attendance reply is the complainant's; a respondent acknowledges the summons and may ask for a new date.
        intent: role === 'COMPLAINANT' ? h.residentIntent : null, intentAt: role === 'COMPLAINANT' ? h.residentIntentAt : null,
        canConfirm: role === 'COMPLAINANT' && live && notPast,
        requests: h.requests.filter(r => r.requesterRole === role),
        canRequest: live && notPast && !pending && h.requests.length < RESCHEDULE_REQUESTS_PER_HEARING,
        outcome: h.status === 'COMPLETED' && h.outcome && h.outcome in HEARING_OUTCOMES
          ? { text: HEARING_OUTCOMES[h.outcome as HearingOutcome].resident, summary: h.outcomeSummary } : null,
        instructions: live ? [...RESIDENT_INSTRUCTIONS[role], ...(h.residentInstructions ? [h.residentInstructions] : [])] : [],
        updates, latestUpdate: updates[0] ?? null,
        updatedAt: h.updatedAt,
      };
    });
    // The history, case by case, with the next date still to come.
    const byCase = new Map<string, { case: { id: string | null; caseNumber: string }; role: string; hearings: typeof view; next: (typeof view)[number] | null }>();
    for (const h of view) {
      const key = `${h.case.caseNumber}:${h.role}`;
      const entry = byCase.get(key) ?? { case: h.case, role: h.role, hearings: [], next: null };
      entry.hearings.push(h);
      if (h.upcoming && !entry.next) entry.next = h;
      byCase.set(key, entry);
    }
    return noStore({ success: true, data: {
      upcoming: view.filter(h => h.upcoming),
      history: [...byCase.values()].map(e => ({ ...e, hearings: [...e.hearings].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)) })),
    } });
  } catch (e) {
    logRouteError('GET /api/resident/hearings', e);
    return rError('Your hearings could not be loaded right now.', 503);
  }
}
