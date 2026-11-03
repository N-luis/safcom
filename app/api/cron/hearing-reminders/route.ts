import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { recordEvent, hearingActivity, notifyOfficials } from '@/lib/hearingsServer';
import { LIVE_STATUSES, formatHearingWhen } from '@/lib/hearings';

export const dynamic = 'force-dynamic';

/** How far ahead a hearing counts as approaching. */
const AHEAD_HOURS = 24;

/**
 * Reminds the officials handling a hearing, and the complainant, that it is
 * within the next day.
 *
 * Idempotent: `reminderSentAt` is stamped when the reminder goes out and
 * cleared when the hearing gets a new date, so each date is reminded once.
 * Protected by the same shared secret as the case reminders. Add to vercel.json:
 *   { "crons": [{ "path": "/api/cron/hearing-reminders", "schedule": "0 8 * * *" }] }
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('key');
  if (!secret) return errorResponse('Reminders are not configured', 503);
  if (provided !== secret) return errorResponse('Unauthorized', 401);

  const now = new Date();
  try {
    const due = await prisma.caseHearing.findMany({
      where: {
        status: { in: [...LIVE_STATUSES] }, reminderSentAt: null,
        scheduledAt: { gte: now, lte: new Date(now.getTime() + AHEAD_HOURS * 3_600_000) },
        case: { caseType: { notIn: [...VAWC_TYPES] } },
      },
      include: { case: { select: { id: true, caseNumber: true, assignedToId: true } } },
      take: 200,
    });
    let sent = 0;
    for (const h of due) {
      await prisma.$transaction(async tx => {
        const r = await tx.caseHearing.updateMany({ where: { id: h.id, reminderSentAt: null, scheduledAt: h.scheduledAt }, data: { reminderSentAt: now } });
        if (!r.count) return;
        const e = await recordEvent(tx, { hearingId: h.id, caseId: h.caseId, kind: 'reminder', actorType: 'system', actorId: null,
          after: { hearingNumber: h.hearingNumber, scheduledAt: h.scheduledAt.toISOString(), venue: h.venue } });
        await hearingActivity(tx, e.id, h.caseId, null, `Reminder sent: Hearing ${h.hearingNumber} is on ${formatHearingWhen(h.scheduledAt)}`);
        await notifyOfficials(tx, h, h.case, `Hearing approaching - ${h.case.caseNumber}`,
          `Hearing ${h.hearingNumber} is on ${formatHearingWhen(h.scheduledAt)}${h.venue ? ` at ${h.venue}` : ''}.`);
        sent++;
      });
    }
    return successResponse({ remindersSent: sent, aheadHours: AHEAD_HOURS });
  } catch {
    return errorResponse('Server error', 500);
  }
}
