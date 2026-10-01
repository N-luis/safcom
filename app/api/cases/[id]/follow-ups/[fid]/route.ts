import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const editSchema = z.object({
  content: z.string().min(1).optional(),
  outcome: z.string().optional().nullable(),
});

type Params = { params: Promise<{ id: string; fid: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id, fid } = await params;

  try {
    const body = await req.json();
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const existing = await prisma.caseFollowUp.findUnique({ where: { id: fid } });
    if (!existing) return errorResponse('Follow-up not found', 404);
    if (existing.caseId !== id) return errorResponse('Not found', 404);

    const isOwn = existing.userId === auth.user.userId;
    const isAdmin = auth.user.role === 'admin' || auth.user.role === 'system_admin';
    if (!isOwn && !isAdmin) return errorResponse('Forbidden', 403);

    const updated = await prisma.caseFollowUp.update({
      where: { id: fid },
      data: { ...parsed.data },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}

/**
 * Hiding replaces deleting. The row stays so the audit trail is complete; an
 * officer records why it is hidden and that is logged as an activity.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id, fid } = await params;

  try {
    const existing = await prisma.caseFollowUp.findUnique({ where: { id: fid } });
    if (!existing) return errorResponse('Follow-up not found', 404);
    if (existing.caseId !== id) return errorResponse('Not found', 404);

    const isOwn = existing.userId === auth.user.userId;
    const isAdmin = auth.user.role === 'admin' || auth.user.role === 'system_admin';
    if (!isOwn && !isAdmin) return errorResponse('Forbidden', 403);

    // A reason is required because hiding removes something from a resident's
    // view of their own case, and the audit trail has to say why.
    const reason = (new URL(req.url).searchParams.get('reason') ?? '').trim();
    if (reason.length < 5) {
      return errorResponse('Give a short reason for hiding this entry', 400);
    }

    const hidden = await prisma.caseFollowUp.update({
      where: { id: fid },
      data: { hiddenAt: new Date(), hiddenById: auth.user.userId, hiddenReason: reason },
    });

    await prisma.activity.create({
      data: {
        type: 'follow_up_hidden',
        message: `Timeline entry hidden on case ${id} — ${reason}`,
        entityId: id,
        entityType: 'Case',
        userId: auth.user.userId,
        color: '#64748b',
      },
    });

    return successResponse({ hidden: true, id: hidden.id });
  } catch {
    return errorResponse('Server error', 500);
  }
}
