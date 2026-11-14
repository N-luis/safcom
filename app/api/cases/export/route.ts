import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { canExportCases, parseExportPeriod } from '@/lib/caseExport';
import { buildCaseExport } from '@/lib/caseExportServer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cases/export?mode=date&date=YYYY-MM-DD
 *                      ?mode=month&month=1-12&year=YYYY
 *                      ?mode=range&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * The cases whose INCIDENT date falls in the period, as a CSV - for officials
 * only. The session and the role are checked here (a resident has no staff
 * session; the system administrator's role is not an exporting one), every row
 * is checked again (lib/caseExportServer), and each export is written to the
 * access log. The file is built in memory and sent once - never stored.
 * No match: 404 "No cases found for the selected period", and no file.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor || !actor.active) return errorResponse('Unauthorized', 401);
  if (!canExportCases(actor.role)) return errorResponse('Your role cannot export case records.', 403);

  const sp = req.nextUrl.searchParams;
  const period = parseExportPeriod({ mode: sp.get('mode'), date: sp.get('date'), month: sp.get('month'), year: sp.get('year'), start: sp.get('start'), end: sp.get('end') });
  if ('error' in period) return errorResponse(period.error, 400);

  try {
    const r = await buildCaseExport(actor, period);
    if (!r.ok) {
      const res = NextResponse.json({ success: false, error: r.error, undated: r.undated ?? null }, { status: r.status });
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    return new NextResponse(r.csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${period.filename}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Export-Count': String(r.count),
      'X-Export-Restricted': String(r.respondentsRestricted),
    } });
  } catch (err) {
    console.error('[Case export]', err);
    return errorResponse('The export could not be made right now. Nothing was exported - try again.', 503);
  }
}
