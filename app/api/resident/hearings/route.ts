import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { noStore } from '@/lib/hearingsServer';
import {
  isLive, phDay, LIVE_NOTICE, NOTICE_STATUSES, HEARING_OUTCOMES, HEARING_TITLES, RESIDENT_STATUS_LABELS, RESIDENT_HEARING_INSTRUCTIONS,
  RESCHEDULE_REQUESTS_PER_HEARING, type HearingOutcome, type NoticeStatus,
} from '@/lib/hearings';

export const dynamic = 'force-dynamic';

/**
 * My Hearings: the hearings on the resident's own cases, as the complainant
 * may see them - date, time, venue, their own notice, their reply, their
 * requests, and a short outcome. Never the proceedings notes, attendance,
 * agreements, the presiding official, or anything about the other party.
 * A draft is not shown until an official schedules it.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  try {
    const hearings = await prisma.caseHearing.findMany({
      where: { status: { not: 'DRAFT' }, case: { residentId: auth.resident.residentId, caseType: { notIn: [...VAWC_TYPES] } } },
      orderBy: [{ scheduledAt: 'asc' }],
      select: {
        id: true, reference: true, hearingNumber: true, scheduledAt: true, venue: true, status: true, outcome: true, outcomeSummary: true,
        residentInstructions: true, residentIntent: true, residentIntentAt: true, rescheduleCount: true, updatedAt: true,
        case: { select: { id: true, caseNumber: true, caseType: true, status: true } },
        notices: { where: { recipientRole: 'COMPLAINANT', status: { in: [...LIVE_NOTICE] } }, orderBy: { generatedAt: 'desc' }, take: 1,
          select: { id: true, noticeNumber: true, status: true, issuedAt: true, acknowledgedAt: true, scheduledAt: true } },
        requests: { where: { residentId: auth.resident.residentId }, orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, reason: true, preferredSchedule: true, reviewNote: true, createdAt: true, reviewedAt: true } },
      },
    });
    const today = phDay(new Date());
    const view = hearings.map(h => {
      const live = isLive(h.status);
      const notPast = phDay(h.scheduledAt) >= today;
      const notice = h.notices[0] ?? null;
      const pending = h.requests.find(r => r.status === 'PENDING');
      return {
        id: h.id, reference: h.reference, hearingNumber: h.hearingNumber, title: HEARING_TITLES[h.hearingNumber],
        case: { id: h.case.id, caseNumber: h.case.caseNumber },
        scheduledAt: h.scheduledAt, venue: h.venue || 'Barangay Hall',
        status: h.status, statusLabel: RESIDENT_STATUS_LABELS[h.status] ?? h.status,
        upcoming: live && notPast,
        rescheduled: h.rescheduleCount > 0,
        notice: notice ? {
          id: notice.id, noticeNumber: notice.noticeNumber, status: notice.status, statusLabel: NOTICE_STATUSES[notice.status as NoticeStatus],
          issuedAt: notice.issuedAt, acknowledgedAt: notice.acknowledgedAt,
          canAcknowledge: live && notice.status !== 'ACKNOWLEDGED',
        } : null,
        intent: h.residentIntent, intentAt: h.residentIntentAt,
        canConfirm: live && notPast,
        requests: h.requests,
        canRequest: live && notPast && !pending && h.requests.length < RESCHEDULE_REQUESTS_PER_HEARING,
        outcome: h.status === 'COMPLETED' && h.outcome && h.outcome in HEARING_OUTCOMES
          ? { text: HEARING_OUTCOMES[h.outcome as HearingOutcome].resident, summary: h.outcomeSummary } : null,
        instructions: live ? [...RESIDENT_HEARING_INSTRUCTIONS, ...(h.residentInstructions ? [h.residentInstructions] : [])] : [],
        updatedAt: h.updatedAt,
      };
    });
    // The history, case by case, with the next date still to come.
    const byCase = new Map<string, { case: { id: string; caseNumber: string }; hearings: typeof view; next: (typeof view)[number] | null }>();
    for (const h of view) {
      const entry = byCase.get(h.case.id) ?? { case: h.case, hearings: [], next: null };
      entry.hearings.push(h);
      if (h.upcoming && !entry.next) entry.next = h;
      byCase.set(h.case.id, entry);
    }
    return noStore({ success: true, data: {
      upcoming: view.filter(h => h.upcoming),
      history: [...byCase.values()].map(e => ({ ...e, hearings: [...e.hearings].sort((a, b) => a.hearingNumber - b.hearingNumber || +new Date(a.scheduledAt) - +new Date(b.scheduledAt)) })),
    } });
  } catch {
    return rError('Your hearings could not be loaded right now.', 503);
  }
}
