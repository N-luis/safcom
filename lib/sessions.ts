import { prisma } from './prisma';

/**
 * Signed-in sessions that can be ended (029).
 *
 * Every sign-in makes an AuthSession row, and its id travels in the session
 * token (`sid`). Each request checks the row is still active, so a session
 * ends the moment it is revoked - signing out, a password change, an account
 * deactivated or suspended - on every device, instead of lasting until the
 * token expires.
 *
 * How long: officials 12 hours (they open confidential case files - a
 * forgotten browser should not stay signed in for a week); residents 7 days.
 *
 * The check is cached for 30 seconds per server instance to spare the
 * database one query per request; a revocation applies at once on the
 * instance that made it and within 30 seconds everywhere else.
 */

export type SessionKind = 'staff' | 'resident';
export const SESSION_SECONDS: Record<SessionKind, number> = { staff: 12 * 60 * 60, resident: 7 * 24 * 60 * 60 };
const CACHE_MS = 30_000;

const cache = new Map<string, { ok: boolean; until: number }>();

export async function startSession(kind: SessionKind, subjectId: string, userAgent?: string | null): Promise<{ sid: string; maxAge: number }> {
  const maxAge = SESSION_SECONDS[kind];
  const row = await prisma.authSession.create({ data: {
    kind, subjectId, expiresAt: new Date(Date.now() + maxAge * 1000), userAgent: userAgent ? userAgent.slice(0, 200) : null,
  }, select: { id: true } });
  // Now and then, forget sessions that ended more than 30 days ago.
  if (Math.random() < 0.02) {
    await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } }).catch(() => undefined);
  }
  return { sid: row.id, maxAge };
}

/** Is this session still active for this person? */
export async function sessionActive(kind: SessionKind, sid: string, subjectId: string): Promise<boolean> {
  const hit = cache.get(sid);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const s = await prisma.authSession.findUnique({ where: { id: sid }, select: { kind: true, subjectId: true, expiresAt: true, revokedAt: true } });
    ok = Boolean(s && s.kind === kind && s.subjectId === subjectId && !s.revokedAt && s.expiresAt.getTime() > Date.now());
  } catch {
    // The sessions table cannot be read: refuse, never wave a token through unchecked.
    return false;
  }
  cache.set(sid, { ok, until: Date.now() + CACHE_MS });
  if (cache.size > 5000) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
  return ok;
}

export async function endSession(sid: string, reason: string): Promise<void> {
  cache.set(sid, { ok: false, until: Date.now() + CACHE_MS });
  await prisma.authSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }).catch(() => undefined);
}

/** End every active session of one person (all devices), except `keep` - the one just made. */
export async function endAllSessions(kind: SessionKind, subjectId: string, reason: string, keep?: string): Promise<number> {
  const active = await prisma.authSession.findMany({ where: { kind, subjectId, revokedAt: null, ...(keep && { id: { not: keep } }) }, select: { id: true } });
  for (const s of active) cache.set(s.id, { ok: false, until: Date.now() + CACHE_MS });
  if (!active.length) return 0;
  const r = await prisma.authSession.updateMany({ where: { id: { in: active.map(s => s.id) }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  return r.count;
}

/** A token without a session id is only accepted outside production (tests and local tools that sign their own). */
export const sessionlessTokensAllowed = () => process.env.NODE_ENV !== 'production';
