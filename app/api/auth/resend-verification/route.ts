import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rSuccess, rError } from '@/lib/residentAuth';
import { rateLimit } from '@/lib/rateLimit';
import { sendAuthEmail, emailDeliverable, EMAIL_NOT_DELIVERABLE } from '@/lib/email';
import { supabaseAuthMissing, confirmLinkFor, authLink } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

/**
 * A new confirmation link for an unconfirmed registration. Always the same
 * answer, whether or not the email has an account, so it cannot be used to
 * find out who is registered.
 */
const schema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254) }).strict();
const SAME = 'If this email has an account that is not confirmed yet, a new confirmation link is on its way. Check your inbox and spam folder.';

export async function POST(req: NextRequest) {
  const missing = supabaseAuthMissing();
  if (missing) return rError(`Resident sign-in is not configured on this server yet (${missing.join(', ')} missing).`, 503);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Enter your email', 400);
  const email = parsed.data.email;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!rateLimit(`resend:${email}`, { max: 3, windowMs: 3_600_000 }).allowed || !rateLimit(`resend-ip:${ip}`, { max: 10, windowMs: 3_600_000 }).allowed) {
    return rError('Too many requests - wait a while before asking again.', 429);
  }
  try {
    const link = await confirmLinkFor(email);
    if (link) {
      const r = await prisma.resident.findFirst({ where: { supabaseUserId: link.userId }, select: { firstName: true, lastName: true } });
      await sendAuthEmail('confirm', email, r ? `${r.firstName} ${r.lastName}` : 'resident', authLink(req.nextUrl.origin, 'signup', link.tokenHash).replace('type=signup', 'type=magiclink'));
    }
    return rSuccess({ message: SAME, ...(!emailDeliverable() && { deliveryWarning: EMAIL_NOT_DELIVERABLE }) });
  } catch (err) {
    console.error('[Resend confirmation]', err instanceof Error ? err.message : 'failed');
    return rSuccess({ message: SAME, ...(!emailDeliverable() && { deliveryWarning: EMAIL_NOT_DELIVERABLE }) });
  }
}
