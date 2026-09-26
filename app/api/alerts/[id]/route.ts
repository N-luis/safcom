import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const patchSchema = z.object({
  active: z.boolean(),
});

/** Same roles that may publish may take a post down again. */
const CAN_PUBLISH = [
  'officer', 'blotter_officer',
  'vawc_officer', 'vawc', 'vawc_lead',
  'admin', 'system_admin',
];

/** Take an announcement down (or put it back up) without losing the record. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (!CAN_PUBLISH.includes(auth.user.role)) return errorResponse('Forbidden', 403);

  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return errorResponse('Invalid data', 400);

    const existing = await prisma.alert.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!existing) return errorResponse('Announcement not found', 404);

    const alert = await prisma.alert.update({
      where: { id },
      data: { active: parsed.data.active },
    });

    await prisma.activity.create({
      data: {
        type: parsed.data.active ? 'announcement_reposted' : 'announcement_taken_down',
        message: `Announcement ${parsed.data.active ? 'reposted' : 'taken down'}: ${existing.title}`,
        entityId: id,
        entityType: 'Alert',
        userId: auth.user.userId,
        color: '#64748b',
      },
    });

    return successResponse(alert);
  } catch {
    return errorResponse('Server error', 500);
  }
}

/** Permanently remove an announcement. Only the captain / system admin. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (auth.user.role !== 'admin' && auth.user.role !== 'system_admin') {
    return errorResponse('Only the Barangay Captain or System Admin can delete an announcement', 403);
  }

  const { id } = await params;

  try {
    const existing = await prisma.alert.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!existing) return errorResponse('Announcement not found', 404);

    await prisma.alert.delete({ where: { id } });

    await prisma.activity.create({
      data: {
        type: 'announcement_deleted',
        message: `Announcement deleted: ${existing.title}`,
        entityId: id,
        entityType: 'Alert',
        userId: auth.user.userId,
        color: '#ef4444',
      },
    });

    return successResponse({ deleted: true });
  } catch {
    return errorResponse('Server error', 500);
  }
}
