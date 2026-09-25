import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const createSchema = z.object({
  name: z.string().min(2),
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,20}$/, 'Username must be 3–20 characters (letters, numbers, . _ -)').optional(),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'officer', 'vawc_officer']),
  barangay: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const role = searchParams.get('role');
  const search = searchParams.get('search') ?? '';
  const includeInactive = searchParams.get('all') === 'true';

  try {
    const users = await prisma.user.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        ...(role ? { role } : {}),
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true, name: true, email: true, username: true, role: true,
        barangay: true, phone: true, active: true, createdAt: true,
        _count: { select: { assignedCases: true } },
      },
      orderBy: { name: 'asc' },
    });
    return successResponse(users);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const { name, email, username, password, role, barangay, phone } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return errorResponse('Email already in use', 409);

    if (username) {
      const taken = await prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
        select: { id: true },
      });
      if (taken) return errorResponse('That username is already taken', 409);
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, username: username ?? null, password: hashed, role, barangay, phone },
      select: { id: true, name: true, email: true, username: true, role: true, barangay: true, phone: true, active: true, createdAt: true },
    });

    await prisma.activity.create({
      data: {
        type: 'user_created',
        message: `New user "${name}" (${role}) was added`,
        userId: auth.user.userId,
        color: '#8b5cf6',
      },
    });

    return successResponse(user, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
