/**
 * A small sliding-window limiter, kept in memory.
 *
 * Used on the assisted intake, which a script could otherwise call in a loop.
 * It is per server instance: on a platform that runs several instances the
 * effective limit is that many times higher. Good enough to stop a runaway
 * loop; not a substitute for a shared store if abuse is ever seen.
 *
 * Deliberately NOT used on filing a report. A limit there is a limit on
 * someone asking for help, and the person most likely to hit it is the one
 * in the worst situation.
 */

const hits = new Map<string, number[]>();

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export function rateLimit(key: string, { max, windowMs }: Limit, now = Date.now()):
  { allowed: boolean; retryAfterSeconds: number } {
  const since = now - windowMs;
  const recent = (hits.get(key) ?? []).filter(t => t > since);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some(t => t > since)) hits.delete(k);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** The intake: generous for a person answering questions, tight for a loop. */
export const INTAKE_LIMIT: Limit = { max: 40, windowMs: 10 * 60 * 1000 };
