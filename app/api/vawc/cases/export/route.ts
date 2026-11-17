import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { buildVawcCaseExport, canExportVawcCases } from '@/lib/vawcCaseExportServer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vawc/cases/export - every VAWC case the official may reach, as a
 * CSV (lib/vawcCaseExportServer). For the VAWC desk and the Punong Barangay
 * only: anyone else is answered "not found", as the other VAWC endpoints do -
 * whether VAWC records exist is itself kept. The file is built in memory and
 * sent once, never stored. Case information only - no evidence or attachment.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor || !actor.active) return errorResponse('Unauthorized', 401);
  if (!canExportVawcCases(actor.role)) return errorResponse('Not found', 404);
  try {
    const r = await buildVawcCaseExport(actor);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
    return new NextResponse(r.csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${r.filename}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Export-Count': String(r.count),
      'X-Export-Restricted': String(r.restricted),
      'X-Export-Filename': r.filename,
    } });
  } catch (err) {
    console.error('[VAWC case export]', err instanceof Error ? err.message.split('\n').at(-1) : err);
    return errorResponse('The export could not be made right now. Nothing was exported - try again.', 503);
  }
}
