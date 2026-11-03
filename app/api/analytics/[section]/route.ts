import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import {
  analyticsContext, caseOverview, highPriority, correctReporting, hearingManagement, acknowledgementLetters, failed,
} from '@/lib/analyticsServer';

/**
 * Analytics - one section per request, so each part of
 * the page loads, fails and retries on its own.
 *
 *   /api/analytics/overview | priority | reporting | hearings | letters
 *   ?scope=blotter|vawc|all &from=YYYY-MM-DD &to=YYYY-MM-DD &category=<case type>
 *
 * The scope is narrowed to what the caller's role allows (lib/analyticsServer).
 * Staff only: a resident session is refused by requireAuth.
 */

const SECTIONS = {
  overview: caseOverview,
  priority: highPriority,
  reporting: correctReporting,
  hearings: hearingManagement,
  letters: acknowledgementLetters,
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const run = SECTIONS[section as keyof typeof SECTIONS];
  if (!run) return errorResponse('Not found', 404);
  const ctx = await analyticsContext(req);
  if ('error' in ctx) return ctx.error;
  try {
    const data = await run(ctx);
    return NextResponse.json({ success: true, data, scope: ctx.scope }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch {
    return failed();
  }
}
