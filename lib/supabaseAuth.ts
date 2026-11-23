import 'server-only';
/**
 * Resident sign-in through Supabase Auth - on the server only.
 *
 * Supabase Auth owns the resident's email and password: it hashes and checks
 * the password and records that the email was confirmed. SafeComm never stores
 * a resident password. The barangay profile, the residency and every case stay
 * on "Resident", linked by Resident.supabaseUserId.
 *
 * Every call happens here, on the server:
 *   - the service-role key (SUPABASE_SERVICE_ROLE_KEY) creates users and the
 *     one-time links, and never leaves the server;
 *   - the links are SafeComm's own (/auth/confirm?token_hash=...), sent by
 *     SafeComm's mailer, so the Supabase dashboard needs no redirect URLs or
 *     SMTP;
 *   - a password is checked with the public key on a fresh client per request
 *     (no session kept between requests), and the Supabase session is closed
 *     at once: the resident's session in SafeComm is its own httpOnly cookie
 *     (lib/residentAuth.ts), so no Supabase token ever reaches the browser.
 *
 * Nothing here decides a role or a residency: Supabase user metadata is never
 * read for access. The residency is the database's, set by an official.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { prisma } from './prisma';

export type AuthLinkType = 'signup' | 'recovery' | 'invite';

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || '';

/** What is missing for resident sign-in to work - names only, never a value. null when ready. */
export function supabaseAuthMissing(): string[] | null {
  const missing = [
    ...(url() ? [] : ['NEXT_PUBLIC_SUPABASE_URL']),
    ...(anonKey() ? [] : ['NEXT_PUBLIC_SUPABASE_ANON_KEY']),
    ...(serviceKey() ? [] : ['SUPABASE_SERVICE_ROLE_KEY']),
  ];
  return missing.length ? missing : null;
}

export class AuthUnavailable extends Error {
  constructor(public missing: string[]) { super('Resident sign-in is not configured on this server.'); }
}

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** The admin client (service role). One per process: it holds no user session. */
let adminClient: SupabaseClient | null = null;
function admin(): SupabaseClient {
  const missing = supabaseAuthMissing();
  if (missing) throw new AuthUnavailable(missing);
  if (!adminClient) adminClient = createClient(url(), serviceKey(), OPTIONS);
  return adminClient;
}
/** A fresh public client for one request: a session it receives dies with it. */
function publicClient(): SupabaseClient {
  const missing = supabaseAuthMissing();
  if (missing) throw new AuthUnavailable(missing);
  return createClient(url(), anonKey(), OPTIONS);
}

/** Where SafeComm's links point: the site the request came to. */
export function authLink(origin: string, type: AuthLinkType, tokenHash: string): string {
  const base = origin.replace(/\/$/, '');
  return type === 'signup'
    ? `${base}/verify-email?token_hash=${encodeURIComponent(tokenHash)}&type=signup`
    : `${base}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

export const PASSWORD_RULE = 'At least 8 characters, with a letter and a number';
export const passwordProblem = (p: string) =>
  p.length < 8 ? 'Password must be at least 8 characters' : p.length > 72 ? 'Password must be at most 72 characters'
    : !/[A-Za-z]/.test(p) || !/[0-9]/.test(p) ? 'Password must contain a letter and a number' : null;

export class AuthError extends Error { constructor(message: string, public code: string, public status: number) { super(message); } }

function mapAuthError(e: { message?: string; code?: string; status?: number } | null | undefined): AuthError {
  const msg = e?.message ?? 'Sign-in service error';
  const code = e?.code ?? '';
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/i.test(msg)) {
    return new AuthError('An account with this email already exists. Sign in, or reset your password.', 'EMAIL_TAKEN', 409);
  }
  if (code === 'weak_password' || /password/i.test(msg) && /weak|short|characters/i.test(msg)) return new AuthError(PASSWORD_RULE, 'WEAK_PASSWORD', 400);
  if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(msg)) return new AuthError('Enter a valid email address.', 'INVALID_EMAIL', 400);
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e?.status === 429) return new AuthError('Too many attempts - wait a minute and try again.', 'RATE_LIMITED', 429);
  if (code === 'otp_expired' || /expired|invalid.*(token|otp)|token.*(invalid|expired)/i.test(msg)) return new AuthError('This link has expired or was already used. Ask for a new one.', 'LINK_EXPIRED', 400);
  return new AuthError('The sign-in service could not complete this right now. Try again in a moment.', 'AUTH_SERVICE', 503);
}

/**
 * A new Supabase user for a registration, unconfirmed, with the link that
 * confirms the email. The password is hashed by Supabase Auth.
 */
export async function createUserWithConfirmLink(email: string, password: string): Promise<{ userId: string; tokenHash: string }> {
  const { data, error } = await admin().auth.admin.generateLink({ type: 'signup', email, password });
  if (error || !data?.user || !data.properties?.hashed_token) throw mapAuthError(error);
  return { userId: data.user.id, tokenHash: data.properties.hashed_token };
}

/** A fresh confirmation link for an unconfirmed user (resend). null when there is no such user or it is confirmed. */
export async function confirmLinkFor(email: string): Promise<{ userId: string; tokenHash: string } | null> {
  const user = await findUserByEmail(email);
  if (!user || user.email_confirmed_at) return null;
  // A magic link confirms the email when used, without needing the password again.
  const { data, error } = await admin().auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) throw mapAuthError(error);
  return { userId: user.id, tokenHash: data.properties.hashed_token };
}

/** The Supabase user with this email, if any (the admin API, paged). */
export async function findUserByEmail(email: string): Promise<User | null> {
  const want = email.trim().toLowerCase();
  // A resident's link is the quickest way; the paged listing is the fallback.
  const linked = await prisma.resident.findFirst({ where: { email: { equals: want, mode: 'insensitive' }, supabaseUserId: { not: null } }, select: { supabaseUserId: true } });
  if (linked?.supabaseUserId) {
    const { data } = await admin().auth.admin.getUserById(linked.supabaseUserId);
    if (data?.user && data.user.email?.toLowerCase() === want) return data.user;
  }
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw mapAuthError(error);
    const hit = data.users.find(u => u.email?.toLowerCase() === want);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * The emailed link used: the email is confirmed (signup / magic link) or the
 * person may now choose a password (recovery / invite). Returns the user.
 */
export async function verifyLink(tokenHash: string, type: AuthLinkType | 'magiclink'): Promise<User> {
  const client = publicClient();
  const otpType = type === 'signup' || type === 'magiclink' ? 'email' : type;
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
  if (error || !data?.user) throw mapAuthError(error ?? { message: 'invalid token' });
  if (data.session) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return data.user;
}

/** Set a user's password (after a recovery or set-up link proved they own the email). */
export async function setUserPassword(userId: string, password: string) {
  const { error } = await admin().auth.admin.updateUserById(userId, { password });
  if (error) throw mapAuthError(error);
}

/**
 * Check an email and password with Supabase Auth. The user when they match
 * (and the email is confirmed); an AuthError otherwise - the same one for a
 * wrong email and a wrong password.
 */
export async function checkPassword(email: string, password: string): Promise<User> {
  const client = publicClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    if (error?.code === 'email_not_confirmed' || /not confirmed/i.test(error?.message ?? '')) {
      throw new AuthError('Confirm your email address first - open the link we sent you, or ask for a new one.', 'EMAIL_NOT_VERIFIED', 403);
    }
    if (error?.status === 429 || error?.code === 'over_request_rate_limit') throw mapAuthError(error);
    if (error && (error.status ?? 0) >= 500) throw mapAuthError(error);
    throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }
  // SafeComm keeps no Supabase session: its own cookie is the session.
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (!data.user.email_confirmed_at) throw new AuthError('Confirm your email address first - open the link we sent you, or ask for a new one.', 'EMAIL_NOT_VERIFIED', 403);
  return data.user;
}

/**
 * A recovery link for an email: a reset link for an existing Supabase user;
 * for a resident from before Supabase Auth (Clerk or the old password), a
 * set-up link that creates their sign-in. null when neither exists - the
 * caller says the same thing either way.
 */
export async function recoveryLinkFor(email: string): Promise<{ type: 'recovery' | 'invite'; tokenHash: string; name: string } | null> {
  const want = email.trim().toLowerCase();
  const resident = await prisma.resident.findFirst({ where: { email: { equals: want, mode: 'insensitive' } }, select: { firstName: true, lastName: true, supabaseUserId: true } });
  const user = await findUserByEmail(want);
  if (user) {
    const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email: want });
    if (error || !data?.properties?.hashed_token) throw mapAuthError(error);
    return { type: 'recovery', tokenHash: data.properties.hashed_token, name: resident ? `${resident.firstName} ${resident.lastName}` : 'resident' };
  }
  if (!resident) return null;
  // An account from before: its sign-in is created now, confirmed when the link is used.
  const { data, error } = await admin().auth.admin.generateLink({ type: 'invite', email: want });
  if (error || !data?.properties?.hashed_token) throw mapAuthError(error);
  return { type: 'invite', tokenHash: data.properties.hashed_token, name: `${resident.firstName} ${resident.lastName}` };
}

/**
 * The resident profile for a Supabase user: by the link, or - once Supabase
 * has confirmed the email - the profile with that email that has no sign-in
 * yet (a resident from before Supabase Auth), which is then linked. Never by
 * name. null when there is none.
 */
export async function residentForUser(user: User) {
  const select = { id: true, firstName: true, lastName: true, email: true, status: true, residentNumber: true, residencyStatus: true, supabaseUserId: true } as const;
  const linked = await prisma.resident.findUnique({ where: { supabaseUserId: user.id }, select });
  if (linked) return linked;
  if (!user.email || !user.email_confirmed_at) return null;
  const byEmail = await prisma.resident.findFirst({ where: { email: { equals: user.email, mode: 'insensitive' }, supabaseUserId: null }, select: { id: true } });
  if (!byEmail) return null;
  const r = await prisma.resident.updateMany({ where: { id: byEmail.id, supabaseUserId: null }, data: { supabaseUserId: user.id, emailVerified: true } });
  if (!r.count) return prisma.resident.findUnique({ where: { supabaseUserId: user.id }, select });
  await prisma.residencyEvent.create({ data: { residentId: byEmail.id, kind: 'sign_in_linked', actorType: 'resident', actorId: byEmail.id,
    note: 'Signed in with the new SafeComm sign-in (Supabase Auth) after confirming the email.' } }).catch(() => undefined);
  return prisma.resident.findUnique({ where: { id: byEmail.id }, select });
}

/** Remove a Supabase user (a registration that could not be completed; tests). */
export async function deleteAuthUser(userId: string) {
  await admin().auth.admin.deleteUser(userId).catch(() => undefined);
}
