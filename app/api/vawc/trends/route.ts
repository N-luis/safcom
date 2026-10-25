import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { canSeeVawc } from '@/lib/caseAccess';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildMonths(count: number) {
  const result: { key: string; month: string; start: Date; end: Date }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    result.push({ key: `${d.getFullYear()}-${d.getMonth() + 1}`, month: MONTH_SHORT[d.getMonth()], start: d, end });
  }
  return result;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  // The VAWC desk, the captain and the system administrator - nobody else.
  // These endpoints sit outside the /vawc prefix the proxy gates by role, so
  // without this a blotter officer's own session read every survivor
  // narrative straight from the API. 404 rather than 403: whether a VAWC case
  // exists is itself part of what is being kept.
  if (!canSeeVawc(auth.user.role)) return errorResponse('Not found', 404);

  const period = req.nextUrl.searchParams.get('period') === '12' ? 12 : 6;

  try {
    const months = buildMonths(period);
    const oldest = months[0].start;

    const cases = await prisma.case.findMany({
      where: { caseType: { in: [...VAWC_TYPES] }, filedAt: { gte: oldest } },
      select: { filedAt: true, status: true, riskLevel: true },
    });

    const data = months.map(({ month, start, end }) => {
      const inRange = cases.filter(c => c.filedAt >= start && c.filedAt < end);
      return {
        month,
        total: inRange.length,
        resolved: inRange.filter(c => ['Resolved', 'Closed'].includes(c.status)).length,
        highRisk: inRange.filter(c => ['High', 'Critical'].includes(c.riskLevel ?? '')).length,
      };
    });

    return successResponse(data);
  } catch {
    return errorResponse('Server error', 500);
  }
}
