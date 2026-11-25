import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken, successResponse, errorResponse } from '@/lib/auth';
import { identifierWhere } from '@/lib/identifier';
import { missingRequired, checkDatabase } from '@/lib/configCheck';
import { failuresExceeded, recordFailure, clearFailures } from '@/lib/rateLimit';

// `email` stays the wire field name for backwards compatibility, but it now
// accepts a username too.
const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email or username').max(254),
  password: z.string().min(1).max(200),
});

/**
 * Wrong passwords are limited, so an official's password cannot be guessed by
 * trying many: 5 failures for one account, or 30 from one connection, within
 * 15 minutes, and sign-in is refused until the window passes. A correct
 * sign-in clears that account's count. Only failures count.
 */
const WINDOW_MS = 15 * 60_000;
const PER_ACCOUNT = { max: 5, windowMs: WINDOW_MS };
const PER_CONNECTION = { max: 30, windowMs: WINDOW_MS };

function tooMany(retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return NextResponse.json(
    { success: false, code: 'TOO_MANY_ATTEMPTS', error: `Too many failed sign-in attempts. Wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again, or ask the system administrator to reset your password.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

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
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
    const accountKey = `staff-login-fail:acct:${identifier.trim().toLowerCase()}`;
    const ipKey = `staff-login-fail:ip:${ip}`;
    const blocked = [failuresExceeded(accountKey, PER_ACCOUNT), failuresExceeded(ipKey, PER_CONNECTION)].find(r => r.limited);
    if (blocked) return tooMany(blocked.retryAfterSeconds);
    const failed = () => { recordFailure(accountKey); recordFailure(ipKey); return errorResponse('Invalid credentials', 401); };

    const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
    if (!user || !user.active) return failed();

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return failed();
    clearFailures(accountKey);

    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    // The session lives only in the httpOnly cookie: it is not returned in the body, where a page script could read it.
    const res = successResponse({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, barangay: user.barangay, avatar: user.avatar },
    });
    res.cookies.set('safcom_token', token, {
      httpOnly: true,
      // Sent over HTTPS only on the live site; local development runs on plain http.
      secure: process.env.NODE_ENV === 'production',
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
