import { createHash } from 'node:crypto';
import { prisma } from './prisma';

/**
 * Rate limits, counted in the database so every server instance shares them.
 *
 * On Vercel each request can land on a different instance; counts kept in
 * memory let a script that spreads its requests get many times the limit.
 * The counts are kept in RateLimitCounter (029), one row per limit key, in a
 * fixed window: the key is stored as a SHA-256 hash, never the email, IP
 * address or account id it was made from.
 *
 * Where: the database on the live site (Vercel, or NODE_ENV=production), memory
 * in local development and the test suites (one process, and a run never
 * inherits another run's counts). RATE_LIMIT_STORE=db|memory overrides. If
 * the database cannot be reached, the memory store answers for that request -
 * a limit is never what takes the site down.
 *
 * Deliberately NOT used on filing a report. A limit there is a limit on
 * someone asking for help, and the person most likely to hit it is the one
 * in the worst situation.
 */

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}
export interface LimitResult { allowed: boolean; retryAfterSeconds: number }

/** The intake: generous for a person answering questions, tight for a loop. */
export const INTAKE_LIMIT: Limit = { max: 40, windowMs: 10 * 60 * 1000 };

const storeInDatabase = () => {
  const forced = process.env.RATE_LIMIT_STORE;
  if (forced === 'db' || forced === 'memory') return forced === 'db';
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
};
const hashKey = (key: string) => createHash('sha256').update(`safecomm-rate-limit:${key}`).digest('hex');
let warned = false;
const fallback = (e: unknown) => {
  if (!warned) { warned = true; console.warn('[rateLimit] database store unavailable - counting in memory for now:', e instanceof Error ? e.message.slice(0, 120) : 'error'); }
};

// ── The memory store (local, tests, and the fallback) ──────────────────────

const hits = new Map<string, number[]>();
function memHit(key: string, { max, windowMs }: Limit, now: number): LimitResult {
  const since = now - windowMs;
  const recent = (hits.get(key) ?? []).filter(t => t > since);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > since)) hits.delete(k);
  return { allowed: true, retryAfterSeconds: 0 };
}
function memCount(key: string, windowMs: number, now: number) {
  const recent = (hits.get(key) ?? []).filter(t => t > now - windowMs);
  hits.set(key, recent);
  return { count: recent.length, oldest: recent[0] ?? now };
}

// ── The database store ─────────────────────────────────────────────────────

/** Count one hit; a window older than windowMs starts again at 1. Atomic, so two instances never lose a hit. */
async function dbHit(key: string, windowMs: number): Promise<{ count: number; windowStart: Date }> {
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "updatedAt") VALUES (${hashKey(key)}, now(), 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitCounter"."windowStart" < now() - make_interval(secs => ${windowMs / 1000}) THEN 1 ELSE "RateLimitCounter"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitCounter"."windowStart" < now() - make_interval(secs => ${windowMs / 1000}) THEN now() ELSE "RateLimitCounter"."windowStart" END,
      "updatedAt" = now()
    RETURNING "count", "windowStart"`;
  // Now and then, forget counters nobody has touched for two days.
  if (Math.random() < 0.01) await prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "updatedAt" < now() - interval '2 days'`.catch(() => undefined);
  return { count: Number(rows[0].count), windowStart: new Date(rows[0].windowStart) };
}
const retryAfter = (windowStart: Date, windowMs: number) => Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));

/** One request against a limit: counted, and allowed while the count is within `max`. */
export async function rateLimit(key: string, limit: Limit): Promise<LimitResult> {
  if (storeInDatabase()) {
    try {
      const { count, windowStart } = await dbHit(key, limit.windowMs);
      return count <= limit.max ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: retryAfter(windowStart, limit.windowMs) };
    } catch (e) { fallback(e); }
  }
  return memHit(key, limit, Date.now());
}

/**
 * Failure counting, for sign-in: only failed attempts count, so a person who
 * signs in correctly is never slowed down, and a run of wrong passwords is
 * stopped - on every instance at once.
 */
export async function failuresExceeded(key: string, { max, windowMs }: Limit): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  if (storeInDatabase()) {
    try {
      const row = await prisma.rateLimitCounter.findUnique({ where: { key: hashKey(key) } });
      if (!row || row.windowStart.getTime() < Date.now() - windowMs || row.count < max) return { limited: false, retryAfterSeconds: 0 };
      return { limited: true, retryAfterSeconds: retryAfter(row.windowStart, windowMs) };
    } catch (e) { fallback(e); }
  }
  const { count, oldest } = memCount(key, windowMs, Date.now());
  return count >= max ? { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000)) } : { limited: false, retryAfterSeconds: 0 };
}
export async function recordFailure(key: string, { windowMs }: Pick<Limit, 'windowMs'>): Promise<void> {
  if (storeInDatabase()) {
    try { await dbHit(key, windowMs); return; } catch (e) { fallback(e); }
  }
  hits.set(key, [...(hits.get(key) ?? []), Date.now()]);
}
export async function clearFailures(key: string): Promise<void> {
  hits.delete(key);
  if (storeInDatabase()) await prisma.rateLimitCounter.deleteMany({ where: { key: hashKey(key) } }).catch(fallback);
}
