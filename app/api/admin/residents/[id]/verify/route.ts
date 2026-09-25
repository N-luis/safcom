import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const schema = z.object({
  action: z.enum(['approve', 'reject', 'verify_email']),
  reason: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  if (auth.user.role !== 'system_admin' && auth.user.role !== 'admin') {
    return errorResponse('Insufficient permissions', 403);
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid data', 400);

    const { action, reason } = parsed.data;

    const resident = await prisma.resident.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, status: true } });
    if (!resident) return errorResponse('Resident not found', 404);

    // Lets an admin unblock a resident whose provider can't reach their inbox.
    // Confirms email ownership only — it grants no extra permissions.
    if (action === 'verify_email') {
      const verified = await prisma.resident.update({
        where: { id },
        data: { emailVerified: true },
        select: { id: true, residentNumber: true, firstName: true, lastName: true, status: true, emailVerified: true },
      });
      await prisma.emailVerificationToken.deleteMany({ where: { residentId: id, usedAt: null } });
      await prisma.activity.create({
        data: {
          type: 'resident_email_verified',
          message: `Email for ${resident.firstName} ${resident.lastName} manually verified by admin`,
          entityId: id,
          entityType: 'Resident',
          userId: auth.user.userId,
          color: '#14b8a6',
        },
      });
      return successResponse(verified);
    }

    const newStatus = action === 'approve' ? 'Active' : 'Rejected';
    const updated = await prisma.resident.update({
      where: { id },
      data: {
        status: newStatus,
        notes: action === 'reject' && reason
          ? `Rejected by admin: ${reason}`
          : undefined,
      },
      select: { id: true, residentNumber: true, firstName: true, lastName: true, status: true },
    });

    await prisma.activity.create({
      data: {
        type: action === 'approve' ? 'resident_verified' : 'resident_rejected',
        message: `Resident ${resident.firstName} ${resident.lastName} ID ${action === 'approve' ? 'verified' : 'rejected'}${reason ? `: ${reason}` : ''}`,
        entityId: id,
        entityType: 'Resident',
        userId: auth.user.userId,
        color: action === 'approve' ? '#22c55e' : '#ef4444',
      },
    });

    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}
