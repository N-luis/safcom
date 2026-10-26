import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { notificationsVisibleTo } from '@/lib/caseAccess';

/**
 * One notification, found only among those this user can see - someone
 * else's, or one about a case this role may not read, is "not found", as it
 * is in their list. Without this any staff login could mark read or delete
 * any notice by its id.
 */
async function visibleNotification(id: string, user: { userId: string; role?: string | null }) {
  return prisma.notification.findFirst({ where: { id, ...notificationsVisibleTo(user) }, select: { id: true } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const notification = await visibleNotification(id, auth.user);
    if (!notification) return errorResponse('Notification not found', 404);

    const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const notification = await visibleNotification(id, auth.user);
    if (!notification) return errorResponse('Notification not found', 404);

    await prisma.notification.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch {
    return errorResponse('Server error', 500);
  }
}
