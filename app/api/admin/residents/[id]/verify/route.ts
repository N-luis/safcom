import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

/** Confirms a resident's email when their provider cannot reach the inbox. */
const schema = z.object({
  action: z.literal('verify_email'),
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

    const resident = await prisma.resident.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } });
    if (!resident) return errorResponse('Resident not found', 404);

    // Lets an admin unblock a resident whose provider can't reach their inbox.
    // Confirms email ownership only — it grants no extra permissions.
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
  } catch {
    return errorResponse('Server error', 500);
  }
}
