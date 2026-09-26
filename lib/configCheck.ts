/**
 * Deployment configuration checks.
 *
 * When the app is deployed without its environment variables every request
 * failed with a bare "Server error", which gave no clue which variable was
 * missing. These helpers report *whether* each variable is present — never its
 * value — so a misconfigured deployment can be diagnosed from the outside.
 */

export interface VarStatus {
  name: string;
  configured: boolean;
  required: boolean;
  purpose: string;
}

export function checkEnv(): VarStatus[] {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim());
  return [
    { name: 'DATABASE_URL', configured: has('DATABASE_URL'), required: true,
      purpose: 'Postgres connection — every sign-in and query needs it' },
    { name: 'JWT_SECRET', configured: has('JWT_SECRET'), required: true,
      purpose: 'Signs staff and resident session cookies' },
    { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', configured: has('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'), required: false,
      purpose: 'Resident sign-up / sign-in (inlined at build time)' },
    { name: 'CLERK_SECRET_KEY', configured: has('CLERK_SECRET_KEY'), required: false,
      purpose: 'Resident session verification on the server' },
  ];
}

/** True when the database can actually be reached, not merely configured. */
export async function checkDatabase(): Promise<{ ok: boolean; reason?: string }> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { ok: false, reason: 'DATABASE_URL is not set' };
  }
  try {
    const { prisma } = await import('./prisma');
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    // Surface the class of failure, never the connection string.
    const msg = err instanceof Error ? err.message : String(err);
    const reason =
      /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg) ? 'database host could not be resolved'
      : /ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg) ? 'database refused the connection or timed out'
      : /password|authentication|SASL/i.test(msg) ? 'database rejected the credentials'
      : /too many clients|connection limit/i.test(msg) ? 'database connection limit reached — use the pooler URL'
      : 'database query failed';
    return { ok: false, reason };
  }
}

/**
 * Cheap guard for request handlers: returns a message when the app cannot
 * possibly work, so the user sees the cause instead of "Server error".
 */
export function missingRequired(): string | null {
  const missing = checkEnv().filter(v => v.required && !v.configured).map(v => v.name);
  return missing.length
    ? `Server is not configured: ${missing.join(', ')} missing. Set these in your hosting environment variables and redeploy.`
    : null;
}
