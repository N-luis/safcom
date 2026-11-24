import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signResidentToken, setResidentCookie, rSuccess, rError } from '@/lib/residentAuth';
import { rateLimit } from '@/lib/rateLimit';
import { sendAuthEmail, sendPasswordChangedEmail, emailReady, EMAIL_NOT_DELIVERABLE } from '@/lib/email';
import { siteOrigin } from '@/lib/siteUrl';
import { supabaseAuthMissing, recoveryLinkFor, verifyLink, setUserPassword, residentForUser, authLink, passwordProblem, AuthError } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

/**
 * Forgot password, and the way back in for an account made before the new
 * sign-in (Clerk or the old SafeComm password - neither password could be
 * carried over).
 *
 *   POST { email }  - an emailed link: a reset link for an existing sign-in,
 *                     or a set-up link for a resident from before. The same
 *                     answer whether or not the email has an account.
 *   PUT  { token_hash, type, password, confirmPassword }
 *                   - the link was opened: the new password is set (Supabase
 *                     Auth hashes it), the profile is linked by the confirmed
 *                     email if it was not yet, and the resident is signed in.
 */
const SAME = 'If an account is associated with this email address, you will receive password recovery instructions. Check your inbox and spam folder - it can take a few minutes.';
const askSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254) }).strict();
const setSchema = z.object({
  token_hash: z.string().trim().min(10).max(500),
  type: z.enum(['recovery', 'invite']),
  password: z.string().max(72),
  confirmPassword: z.string().max(72),
}).strict();

export async function POST(req: NextRequest) {
  const missing = supabaseAuthMissing();
  if (missing) return rError(`Resident sign-in is not configured on this server yet (${missing.join(', ')} missing).`, 503);
  const parsed = askSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Enter your email', 400);
  const email = parsed.data.email;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!rateLimit(`pw-ask:${email}`, { max: 3, windowMs: 3_600_000 }).allowed || !rateLimit(`pw-ask-ip:${ip}`, { max: 10, windowMs: 3_600_000 }).allowed) {
    return rError('Too many requests - wait a while before asking again.', 429);
  }
  try {
    const link = await recoveryLinkFor(email);
    if (link) await sendAuthEmail(link.type === 'invite' ? 'setup' : 'reset', email, link.name, authLink(siteOrigin(req.nextUrl.origin), link.type, link.tokenHash));
  } catch (err) {
    console.error('[Password link]', err instanceof Error ? err.message : 'failed');
  }
  return rSuccess({ message: SAME, ...(!(await emailReady()) && { deliveryWarning: EMAIL_NOT_DELIVERABLE }) });
}

export async function PUT(req: NextRequest) {
  const missing = supabaseAuthMissing();
  if (missing) return rError(`Resident sign-in is not configured on this server yet (${missing.join(', ')} missing).`, 503);
  const parsed = setSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, code: 'INVALID_LINK', error: 'This link is incomplete. Ask for a new one.' }, { status: 400 });
  const d = parsed.data;
  const weak = passwordProblem(d.password);
  if (weak) return NextResponse.json({ success: false, code: 'WEAK_PASSWORD', error: weak }, { status: 400 });
  if (d.password !== d.confirmPassword) return NextResponse.json({ success: false, code: 'PASSWORD_MISMATCH', error: 'The passwords do not match' }, { status: 400 });
  try {
    const user = await verifyLink(d.token_hash, d.type);
    await setUserPassword(user.id, d.password);
    const resident = await residentForUser(user);
    // Told by email that the password changed (no link that signs anyone in). Never undoes the change.
    if (user.email) await sendPasswordChangedEmail(user.email, resident ? `${resident.firstName} ${resident.lastName}` : 'resident', `${siteOrigin(req.nextUrl.origin)}/resident-login`).catch(() => undefined);
    if (!resident) return rSuccess({ status: 'password_set', signedIn: false });
    const name = `${resident.firstName} ${resident.lastName}`;
    const res = rSuccess({ status: 'password_set', signedIn: true, name, residencyStatus: resident.residencyStatus });
    setResidentCookie(res as NextResponse, signResidentToken({ residentId: resident.id, email: resident.email ?? user.email ?? '', name, role: 'resident' }));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.status });
    console.error('[Password set]', err instanceof Error ? err.message : 'failed');
    return rError('Your password could not be set right now. Try the link again in a moment.', 503);
  }
}
