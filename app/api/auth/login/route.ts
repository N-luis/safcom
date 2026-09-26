import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken, successResponse, errorResponse } from '@/lib/auth';
import { identifierWhere } from '@/lib/identifier';
import { missingRequired, checkDatabase } from '@/lib/configCheck';

// `email` stays the wire field name for backwards compatibility, but it now
// accepts a username too.
const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email or username'),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  // A deployment with no env vars used to fail here with a bare "Server error".
  // Say which variable is missing instead — the name alone, never its value.
  const misconfigured = missingRequired();
  if (misconfigured) return errorResponse(misconfigured, 503);

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
  } catch (err) {
    // Log the real cause so it shows in the hosting provider's function logs.
    console.error('[Login]', err);
    // A connection failure is a deployment problem, not a bad password - tell
    // the officer which, so they are not left guessing at "Server error".
    const db = await checkDatabase();
    if (!db.ok) {
      return errorResponse(
        `Cannot reach the database (${db.reason}). Check DATABASE_URL in your hosting environment variables.`,
        503,
      );
    }
    return errorResponse('Server error', 500);
  }
}
