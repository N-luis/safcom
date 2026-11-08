import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/auth';
import { retryAwaitingDesk } from '@/lib/reportDeskServer';
import { retryPendingDrafts } from '@/lib/reportReviewServer';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * The controlled retry for reports filed while the Groq reader could not
 * run (lib/reportDeskServer.ts retryAwaitingDesk): a few cases a run, oldest
 * first, each read once through the same free-tier budget and pace as a new
 * report. Nothing is guessed while the AI is still down - the case simply
 * keeps waiting, on the desk it was kept on, visible to the officials there.
 *
 * Protected by the same shared secret as the other jobs. Add to vercel.json:
 *   { "crons": [{ "path": "/api/cron/desk-classification", "schedule": "*\/15 * * * *" }] }
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('key');
  if (!secret) return errorResponse('The classification retry is not configured', 503);
  if (provided !== secret) return errorResponse('Unauthorized', 401);
  try {
    const results = await retryAwaitingDesk();
    // The same run retries report drafts SafeComm AI could not organize (lib/reportReviewServer).
    const drafts = await retryPendingDrafts();
    // Case numbers and outcomes only - never a narrative.
    return successResponse({ checked: results.length, results, drafts });
  } catch (e) {
    logRouteError('GET /api/cron/desk-classification', e);
    return errorResponse('The retry could not run right now.', 503);
  }
}
