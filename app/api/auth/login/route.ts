import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken, successResponse, errorResponse } from '@/lib/auth';
import { identifierWhere } from '@/lib/identifier';

// `email` stays the wire field name for backwards compatibility, but it now
// accepts a username too.
const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email or username'),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return errorResponse('Invalid credentials', 400);

    const { email: identifier, password } = parsed.data;
    const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
    if (!user || !user.active) return errorResponse('Invalid credentials', 401);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return errorResponse('Invalid credentials', 401);

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    const res = successResponse({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, barangay: user.barangay, avatar: user.avatar },
      token,
    });
    res.cookies.set('safcom_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return res;
  } catch {
    return errorResponse('Server error', 500);
  }
}
