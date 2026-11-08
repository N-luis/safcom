import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/auth';
import {
  analyticsContext, caseOverview, highPriority, hearingManagement, acknowledgementLetters, failed, type AnalyticsContext,
} from '@/lib/analyticsServer';
import {
  reportingAnalytics, reportingCases, reportingFilters, reportingTypeOptions, isSegment, isVawcOnlySegment,
} from '@/lib/reportingAnalyticsServer';

/**
 * Analytics - one section per request, so each part of
 * the page loads, fails and retries on its own.
 *
 *   /api/analytics/overview | priority | reporting | reporting-cases | hearings | letters
 *   ?scope=blotter|vawc|all &from=YYYY-MM-DD &to=YYYY-MM-DD &category=<case type>
 *   reporting, reporting-cases: &desk=all|BLOTTER|VAWC &group=all|women|children|both &type=<blotter category>|abuse:<type>
 *   reporting-cases: &segment=<the chart segment clicked>
 *
 * The scope is narrowed to what the caller's role allows (lib/analyticsServer).
 * Staff only: a resident session is refused by requireAuth.
 */

const SECTIONS: Record<string, (ctx: AnalyticsContext, req: NextRequest) => Promise<unknown>> = {
  overview: ctx => caseOverview(ctx),
  priority: ctx => highPriority(ctx),
  reporting: async (ctx, req) => ({ ...(await reportingAnalytics(ctx, reportingFilters(req, ctx))), typeOptions: await reportingTypeOptions(ctx) }),
  'reporting-cases': (ctx, req) => reportingCases(ctx, reportingFilters(req, ctx), req.nextUrl.searchParams.get('segment') ?? ''),
  hearings: ctx => hearingManagement(ctx),
  letters: ctx => acknowledgementLetters(ctx),
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const run = SECTIONS[section];
  if (!run) return errorResponse('Not found', 404);
  const ctx = await analyticsContext(req);
  if ('error' in ctx) return ctx.error;
  if (section === 'reporting-cases') {
    const segment = req.nextUrl.searchParams.get('segment') ?? '';
    if (!isSegment(segment)) return errorResponse('Unknown chart segment', 400);
    // The cases behind a VAWC-only figure are listed only for roles that may open VAWC cases.
    if (isVawcOnlySegment(segment) && !ctx.maySeeVawcRows) return errorResponse('These cases are listed only for VAWC personnel.', 403);
  }
  try {
    const data = await run(ctx, req);
    return NextResponse.json({ success: true, data, scope: ctx.scope }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch {
    return failed();
  }
}
