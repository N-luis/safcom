import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { issueResidentSession, setResidentCookie, rSuccess, rError } from '@/lib/residentAuth';
import { rateLimit } from '@/lib/rateLimit';
import { supabaseAuthMissing, checkPassword, residentForUser, AuthError } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

/**
 * Resident sign-in: the email and password are checked by Supabase Auth (on
 * the server), then SafeComm's own session cookie is set for the resident
 * portal. A username from before still works: it is looked up to its email.
 *
 * Signing in says nothing about the residency: an unverified resident signs
 * in and sees where their verification stands; standard reporting stays
 * closed to them (the routes read the residency from the database).
 */
const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(254),
  password: z.string().min(1, 'Enter your password').max(72),
}).strict();

/** Said on every wrong email or password, so it cannot tell which accounts exist. */
const SETUP_HINT = 'Had a SafeComm account before the new sign-in? Use "Forgot password or set up" to choose a password for it.';

export async function POST(req: NextRequest) {
  const missing = supabaseAuthMissing();
  if (missing) return rError(`Resident sign-in is not configured on this server yet (${missing.join(', ')} missing).`, 503);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Enter your email and password', 400);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  const id = parsed.data.email.toLowerCase();
  if (!(await rateLimit(`resident-login:${ip}:${id}`, { max: 10, windowMs: 15 * 60_000 })).allowed) return rError('Too many attempts - wait a few minutes and try again.', 429);

  try {
    // A username from before the new sign-in: its email.
    let email = id;
    if (!email.includes('@')) {
      const r = await prisma.resident.findFirst({ where: { username: { equals: id, mode: 'insensitive' } }, select: { email: true } });
      if (!r?.email) return NextResponse.json({ success: false, code: 'INVALID_CREDENTIALS', error: 'Invalid email or password', hint: SETUP_HINT }, { status: 401 });
      email = r.email.toLowerCase();
    }
    const user = await checkPassword(email, parsed.data.password);
    const resident = await residentForUser(user);
    if (!resident) {
      return NextResponse.json({ success: false, code: 'PROFILE_NOT_FOUND', error: 'No resident profile is linked to this account. Register to create one.' }, { status: 404 });
    }
    if (resident.status === 'Inactive' || resident.status === 'Suspended') return rError('This account is not active. Contact the barangay office.', 403);
    await prisma.resident.update({ where: { id: resident.id }, data: { emailVerified: true } }).catch(() => undefined);
    const name = `${resident.firstName} ${resident.lastName}`;
    const res = rSuccess({ resident: { id: resident.id, name, email: resident.email, status: resident.status, residentNumber: resident.residentNumber, residencyStatus: resident.residencyStatus } });
    setResidentCookie(res as NextResponse, await issueResidentSession({ residentId: resident.id, email: resident.email ?? email, name }, req.headers.get('user-agent')));
    return res;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ success: false, code: err.code, error: err.message, ...(err.code === 'INVALID_CREDENTIALS' && { hint: SETUP_HINT }) }, { status: err.status });
    }
    console.error('[Resident login]', err instanceof Error ? err.message : 'failed');
    return rError('Sign-in is not available right now. Try again in a moment.', 503);
  }
}
