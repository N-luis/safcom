import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/auth';
import { REMINDER_AFTER_DAYS } from '@/lib/followUps';

export const dynamic = 'force-dynamic';

/**
 * Reminds residents whose open case has gone quiet.
 *
 * Idempotent by design: `reminderSentAt` is stamped when a reminder goes out
 * and cleared whenever the resident adds a follow-up, so a case that stays
 * silent is reminded once, not every time this runs. That is the difference
 * between a helpful nudge and a daily nag about a case someone has decided not
 * to pursue.
 *
 * Protected by a shared secret rather than a session, because a scheduler has
 * no user. Add to vercel.json:
 *   { "crons": [{ "path": "/api/cron/case-reminders", "schedule": "0 9 * * *" }] }
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? req.nextUrl.searchParams.get('key');

  // Without a secret configured the endpoint stays shut, so an unprotected
  // deployment cannot have it triggered from outside.
  if (!secret) return errorResponse('Reminders are not configured', 503);
  if (provided !== secret) return errorResponse('Unauthorized', 401);

  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000);

  try {
    const stale = await prisma.case.findMany({
      where: {
        status: { notIn: ['Resolved', 'Closed', 'Pending officer confirmation'] },
        residentId: { not: null },
        reminderSentAt: null,
        OR: [
          { lastResidentUpdateAt: { lt: cutoff } },
          { lastResidentUpdateAt: null, filedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, caseNumber: true, residentId: true },
      take: 200,
    });

    for (const c of stale) {
      await prisma.notification.create({
        data: {
          title: `Any update on case ${c.caseNumber}?`,
          message: 'Let the barangay know whether this is still happening or has been resolved. Open the case to add a quick update.',
          type: 'info',
          // Resident-addressed notifications are keyed by the case, which the
          // resident portal resolves; staff broadcasts use userId: null.
          userId: null,
        },
      });
      await prisma.case.update({ where: { id: c.id }, data: { reminderSentAt: new Date() } });
    }

    return successResponse({ remindersSent: stale.length, afterDays: REMINDER_AFTER_DAYS });
  } catch {
    return errorResponse('Server error', 500);
  }
}
