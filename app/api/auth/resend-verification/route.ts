import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rSuccess, rError } from '@/lib/residentAuth';
import { issueVerificationToken, checkResendRateLimit, RESEND_COOLDOWN_SECONDS } from '@/lib/verification';
import { sendVerificationEmail } from '@/lib/email';

const schema = z.object({ email: z.string().email() });

// Same body for every outcome so this endpoint can't be used to discover
// which email addresses are registered.
const NEUTRAL = {
  status: 'sent' as const,
  message: 'If that email is registered and unverified, a new verification link has been sent.',
};

export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return rError('Enter a valid email address', 400);

    const { email } = parsed.data;
    const resident = await prisma.resident.findFirst({
      where: { email },
      select: { id: true, email: true, firstName: true, lastName: true, emailVerified: true },
    });

    if (!resident || !resident.email || resident.emailVerified) {
      return rSuccess(NEUTRAL);
    }

    const limit = await checkResendRateLimit(resident.id);
    if (!limit.ok) {
      // retryAfterSeconds lets the client run an accurate countdown instead of
      // parsing the message text.
      const retryAfter = limit.reason === 'cooldown' ? limit.retryAfterSeconds : 0;
      return NextResponse.json(
        {
          success: false,
          error: limit.reason === 'cooldown'
            ? `Please wait ${retryAfter}s before requesting another email.`
            : 'Too many verification emails requested today. Please try again tomorrow.',
          code: limit.reason === 'cooldown' ? 'COOLDOWN' : 'DAILY_LIMIT',
          retryAfterSeconds: retryAfter,
        },
        { status: 429, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined },
      );
    }

    const raw = await issueVerificationToken(resident.id);
    const send = await sendVerificationEmail(
      resident.email, `${resident.firstName} ${resident.lastName}`, raw, req.nextUrl.origin,
    );

    return rSuccess({
      ...NEUTRAL,
      delivered: send.ok,
      reason: send.reason,
      detail: send.detail,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    });
  } catch (err) {
    console.error('[Resend Verification]', err);
    return rError('Server error', 500);
  }
}
