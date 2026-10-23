import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { vawcFilter } from '@/lib/caseAccess';

/**
 * Case counts for whoever is asking.
 *
 * Filtered by role like every other case query. Without it the totals and the
 * per-type breakdown counted VAWC cases for everyone, so a blotter officer
 * could read "Domestic Violence 6, Child Abuse 2" off an endpoint that never
 * shows them a single one of those cases. A count is a smaller disclosure
 * than a narrative, but in a barangay of this size it is still one.
 *
 * `scope=vawc` narrows it to the VAWC caseload, for that desk's own pages;
 * it is refused to anyone the filter would have hidden those cases from.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const visible = vawcFilter(auth.user.role);
  const wantsVawc = req.nextUrl.searchParams.get('scope') === 'vawc';
  if (wantsVawc && Object.keys(visible).length > 0) {
    return errorResponse('Not found', 404);
  }

  const { VAWC_TYPES } = await import('@/lib/vawcTypes');
  const where = wantsVawc
    ? { caseType: { in: [...VAWC_TYPES] } }
    : visible;

  try {
    const [total, open, inProgress, resolved, closed, byType] = await Promise.all([
      prisma.case.count({ where }),
      prisma.case.count({ where: { ...where, status: 'Open' } }),
      prisma.case.count({ where: { ...where, status: 'In Progress' } }),
      prisma.case.count({ where: { ...where, status: 'Resolved' } }),
      prisma.case.count({ where: { ...where, status: 'Closed' } }),
      prisma.case.groupBy({
        by: ['caseType'],
        where,
        _count: { _all: true },
        orderBy: { _count: { caseType: 'desc' } },
      }),
    ]);

    // Two equal windows, so a trend can be stated rather than guessed. The
    // classification page used to print invented percentages beside each
    // category; these are the barangay's own filings.
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const [recent, previous] = await Promise.all([
      prisma.case.groupBy({
        by: ['caseType'], where: { ...where, filedAt: { gte: new Date(now - 30 * DAY) } },
        _count: { _all: true },
      }),
      prisma.case.groupBy({
        by: ['caseType'],
        where: { ...where, filedAt: { gte: new Date(now - 60 * DAY), lt: new Date(now - 30 * DAY) } },
        _count: { _all: true },
      }),
    ]);
    const countIn = (rows: typeof recent, type: string) =>
      rows.find(r => r.caseType === type)?._count._all ?? 0;

    const byCaseType = byType.map(t => ({
      caseType: t.caseType,
      count: t._count._all,
      last30: countIn(recent, t.caseType),
      prev30: countIn(previous, t.caseType),
    }));

    return successResponse({ total, open, inProgress, resolved, closed, byCaseType });
  } catch {
    return errorResponse('Server error', 500);
  }
}
