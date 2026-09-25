import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,20}$/, 'Username must be 3–20 characters (letters, numbers, . _ -)').optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'officer', 'vawc_officer']).optional(),
  barangay: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, username: true, role: true,
        barangay: true, phone: true, active: true, createdAt: true,
        _count: { select: { assignedCases: true, createdReports: true } },
      },
    });
    if (!user) return errorResponse('User not found', 404);
    return successResponse(user);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const { password, email, ...rest } = parsed.data;

    if (email) {
      const conflict = await prisma.user.findFirst({ where: { email, NOT: { id } } });
      if (conflict) return errorResponse('Email already in use', 409);
    }

    if (rest.username) {
      const taken = await prisma.user.findFirst({
        where: { username: { equals: rest.username, mode: 'insensitive' }, NOT: { id } },
        select: { id: true },
      });
      if (taken) return errorResponse('That username is already taken', 409);
    }

    const updateData: Record<string, unknown> = { ...rest };
    if (email) updateData.email = email;
    if (password) updateData.password = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, username: true, role: true, barangay: true, phone: true, active: true },
    });

    await prisma.activity.create({
      data: {
        type: 'user_updated',
        message: `User "${user.name}" was updated`,
        userId: auth.user.userId,
        color: '#3b82f6',
      },
    });

    return successResponse(user);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  if (id === auth.user.userId) return errorResponse('Cannot deactivate your own account', 400);

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { active: false },
      select: { name: true },
    });

    await prisma.activity.create({
      data: {
        type: 'user_deactivated',
        message: `User "${user.name}" was deactivated`,
        userId: auth.user.userId,
        color: '#ef4444',
      },
    });

    return successResponse({ message: 'User deactivated' });
  } catch {
    return errorResponse('Server error', 500);
  }
}
