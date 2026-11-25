import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { issueResidentSession, setResidentCookie, rSuccess, rError } from '@/lib/residentAuth';
import { supabaseAuthMissing, verifyLink, residentForUser, AuthError } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

/**
 * The confirmation link from the registration email (or a resent one):
 * Supabase Auth confirms the email, and the resident is signed in. Their
 * residency is unchanged - it still waits for an official.
 */
const schema = z.object({
  token_hash: z.string().trim().min(10).max(500),
  type: z.enum(['signup', 'magiclink']),
}).strict();

export async function POST(req: NextRequest) {
  const missing = supabaseAuthMissing();
  if (missing) return rError(`Resident sign-in is not configured on this server yet (${missing.join(', ')} missing).`, 503);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, code: 'INVALID_LINK', error: 'This confirmation link is incomplete. Ask for a new one.' }, { status: 400 });
  try {
    const user = await verifyLink(parsed.data.token_hash, parsed.data.type);
    const resident = await residentForUser(user);
    if (!resident) return NextResponse.json({ success: false, code: 'PROFILE_NOT_FOUND', error: 'Your email is confirmed, but no resident profile is linked to it. Register to create one.' }, { status: 404 });
    await prisma.resident.update({ where: { id: resident.id }, data: { emailVerified: true } });
    const name = `${resident.firstName} ${resident.lastName}`;
    const res = rSuccess({ status: 'confirmed', name, residencyStatus: resident.residencyStatus });
    setResidentCookie(res as NextResponse, await issueResidentSession({ residentId: resident.id, email: resident.email ?? user.email ?? '', name }, req.headers.get('user-agent')));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.status });
    console.error('[Verify email]', err instanceof Error ? err.message : 'failed');
    return rError('Your email could not be confirmed right now. Try the link again in a moment.', 503);
  }
}
