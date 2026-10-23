import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { canSeeVawc } from '@/lib/caseAccess';
import { loadActor, isVawcType, BLOTTER_ROLES, VAWC_DESK_ROLES } from '@/lib/reporterAccess';

/**
 * "Take this case": an officer assigns an unassigned case on their own desk
 * to themselves. Assignment is what lets an officer see the reporter's
 * contact details, so it is recorded in the case's activity, and a case
 * someone else already holds cannot be taken this way.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const actor = await loadActor(auth.user.userId);
    if (!actor?.active) return errorResponse('Unauthorized', 401);
    const c = await prisma.case.findUnique({ where: { id }, select: { id: true, caseNumber: true, caseType: true, assignedToId: true } });
    if (!c) return errorResponse('Case not found', 404);
    const vawc = isVawcType(c.caseType);
    if (vawc && !canSeeVawc(actor.role)) return errorResponse('Case not found', 404);

    const ownDesk = (BLOTTER_ROLES.includes(actor.role) && !vawc) || (VAWC_DESK_ROLES.includes(actor.role) && vawc);
    if (!ownDesk) return errorResponse('Only an officer on this case’s desk can take it', 403);
    if (c.assignedToId === actor.id) return successResponse({ assigned: true });

    // Only if still unassigned at the moment of writing - two officers
    // pressing at once cannot both get it.
    const taken = await prisma.case.updateMany({ where: { id, assignedToId: null }, data: { assignedToId: actor.id } });
    if (taken.count === 0) return errorResponse('This case is already assigned to another official', 409);

    const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    await prisma.activity.create({
      data: {
        type: 'assignment', message: `${me?.name ?? 'An officer'} took case ${c.caseNumber}`,
        entityId: id, entityType: 'Case', userId: actor.id, caseId: id, color: '#0ea5e9',
      },
    });
    return successResponse({ assigned: true });
  } catch (err) {
    console.error('[Case claim]', err instanceof Error ? err.message : 'failed');
    return errorResponse('Server error', 500);
  }
}
