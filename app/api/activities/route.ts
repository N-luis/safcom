import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { canSeeVawc } from '@/lib/caseAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 10)));

  try {
    /**
     * The feed, without anything about a case this role may not read.
     *
     * It returned every activity to every staff login, and an activity line
     * names its case: "Resident filed case SC-2026-0038: Domestic Violence -
     * High risk" reached the blotter's dashboard feed. VAWC activity is tied
     * to its case three ways in older rows - caseId, entityId, or a vawc_
     * type - so all three are excluded.
     */
    let where = {};
    if (!canSeeVawc(auth.user.role)) {
      const vawcIds = (await prisma.case.findMany({
        where: { caseType: { in: [...VAWC_TYPES] } }, select: { id: true },
      })).map(c => c.id);
      where = {
        AND: [
          { NOT: { type: { startsWith: 'vawc_' } } },
          { OR: [{ caseId: null }, { caseId: { notIn: vawcIds } }] },
          { OR: [{ entityId: null }, { entityId: { notIn: vawcIds } }] },
        ],
      };
    }

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    });
    return successResponse(activities);
  } catch {
    return errorResponse('Server error', 500);
  }
}
