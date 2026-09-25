import crypto from 'crypto';
import { prisma } from './prisma';

export const TOKEN_TTL_MINUTES = Number(process.env.EMAIL_TOKEN_TTL_MINUTES ?? 30);
export const RESEND_COOLDOWN_SECONDS = Number(process.env.EMAIL_RESEND_COOLDOWN_SECONDS ?? 60);
export const RESEND_DAILY_MAX = Number(process.env.EMAIL_RESEND_DAILY_MAX ?? 5);

/**
 * The raw token only ever travels in the verification URL. Only its SHA-256
 * hash is persisted, so a database leak cannot be replayed as a valid link.
 */
function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export type RateLimit =
  | { ok: true }
  | { ok: false; reason: 'cooldown'; retryAfterSeconds: number }
  | { ok: false; reason: 'daily_limit' };

export async function checkResendRateLimit(residentId: string): Promise<RateLimit> {
  const now = Date.now();

  const last = await prisma.emailVerificationToken.findFirst({
    where: { residentId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (last) {
    const elapsed = (now - last.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }

  const since = new Date(now - 24 * 60 * 60 * 1000);
  const issuedToday = await prisma.emailVerificationToken.count({
    where: { residentId, createdAt: { gte: since } },
  });
  if (issuedToday >= RESEND_DAILY_MAX) return { ok: false, reason: 'daily_limit' };

  return { ok: true };
}

/**
 * Issues a fresh token and invalidates every previous one for that resident,
 * so only the most recent email in someone's inbox can ever work.
 */
export async function issueVerificationToken(residentId: string): Promise<string> {
  const raw = generateRawToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { residentId, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { residentId, tokenHash: hash(raw), expiresAt },
    }),
  ]);

  return raw;
}

export type VerifyResult =
  | { status: 'success'; email: string | null; name: string }
  | { status: 'expired' }
  | { status: 'invalid' }
  | { status: 'already_verified' };

export async function consumeVerificationToken(rawToken: string): Promise<VerifyResult> {
  if (!rawToken) return { status: 'invalid' };

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hash(rawToken) },
    include: {
      resident: { select: { id: true, email: true, firstName: true, lastName: true, emailVerified: true } },
    },
  });

  if (!record || !record.resident) return { status: 'invalid' };

  const name = `${record.resident.firstName} ${record.resident.lastName}`;

  if (record.resident.emailVerified && record.usedAt) {
    return { status: 'already_verified' };
  }
  // Single use: a consumed token is never valid again.
  if (record.usedAt) return { status: 'invalid' };
  if (record.expiresAt.getTime() < Date.now()) return { status: 'expired' };

  await prisma.$transaction([
    prisma.resident.update({ where: { id: record.residentId }, data: { emailVerified: true } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return { status: 'success', email: record.resident.email, name };
}
