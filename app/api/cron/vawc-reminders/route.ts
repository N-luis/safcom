import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/auth';
import { logRouteError } from '@/lib/hearingCasesServer';
import { runVawcReminders } from '@/lib/vawcProceedingsServer';

export const dynamic = 'force-dynamic';

/**
 * VAWC reminders, for the officials only (lib/vawcProceedingsServer.ts
 * runVawcReminders): BPO steps and last effective day, court dates, referral
 * follow-ups and appointments - each sent once. Run it on a schedule (e.g.
 * hourly) with CRON_SECRET, like the other cron routes. Counts only in the
 * reply - never a case detail.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('key');
  if (!secret) return errorResponse('The VAWC reminders are not configured', 503);
  if (provided !== secret) return errorResponse('Unauthorized', 401);
  try {
    return successResponse(await runVawcReminders());
  } catch (e) {
    logRouteError('GET /api/cron/vawc-reminders', e);
    return errorResponse('The reminders could not run right now.', 503);
  }
}
