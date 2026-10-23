import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { canSeeVawc } from '@/lib/caseAccess';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  // The VAWC desk, the captain and the system administrator - nobody else.
  // These endpoints sit outside the /vawc prefix the proxy gates by role, so
  // without this a blotter officer's own session read every survivor
  // narrative straight from the API. 404 rather than 403: whether a VAWC case
  // exists is itself part of what is being kept.
  if (!canSeeVawc(auth.user.role)) return errorResponse('Not found', 404);

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

  try {
    const [cases, totalUrgent, newCount] = await Promise.all([
      prisma.case.findMany({
        where: {
          caseType: { in: [...VAWC_TYPES] },
          riskLevel: { in: ['High', 'Critical'] },
          status: { notIn: ['Resolved', 'Closed'] },
        },
        orderBy: { filedAt: 'desc' },
        take: limit,
        select: {
          id: true, caseNumber: true, residentName: true, caseType: true,
          riskLevel: true, status: true, barangay: true, filedAt: true, updatedAt: true,
        },
      }),
      prisma.case.count({
        where: {
          caseType: { in: [...VAWC_TYPES] },
          riskLevel: { in: ['High', 'Critical'] },
          status: { notIn: ['Resolved', 'Closed'] },
        },
      }),
      prisma.case.count({
        where: {
          caseType: { in: [...VAWC_TYPES] },
          riskLevel: { in: ['High', 'Critical'] },
          status: 'Open',
          filedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
      }),
    ]);

    // Anonymise subject name: "Maria Clara S." for VAWC privacy
    const anonymised = cases.map(c => {
      const parts = c.residentName.trim().split(/\s+/);
      const last = parts.length > 1 ? parts[parts.length - 1][0] + '.' : '';
      const first = parts.slice(0, parts.length > 1 ? -1 : 1).join(' ');
      return { ...c, subjectName: last ? `${first} ${last}` : first };
    });

    return successResponse({ cases: anonymised, totalUrgent, newCount });
  } catch {
    return errorResponse('Server error', 500);
  }
}
