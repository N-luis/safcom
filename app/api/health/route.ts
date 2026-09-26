import { NextResponse } from 'next/server';
import { checkEnv, checkDatabase } from '@/lib/configCheck';

// Always evaluated per request — a cached answer would report stale config.
export const dynamic = 'force-dynamic';

/**
 * Deployment diagnostics.
 *
 * Reports whether each required environment variable is present and whether
 * the database is reachable. It deliberately returns booleans and a short
 * reason only — never a variable's value, the connection string or a raw
 * driver error — so it is safe to hit on a public deployment while setting the
 * project up.
 */
export async function GET() {
  const env = checkEnv();
  const db = await checkDatabase();

  const missingRequired = env.filter(v => v.required && !v.configured).map(v => v.name);
  const ok = missingRequired.length === 0 && db.ok;

  return NextResponse.json(
    {
      ok,
      summary: ok
        ? 'Configured — staff sign-in should work.'
        : missingRequired.length
          ? `Missing required variables: ${missingRequired.join(', ')}`
          : `Database unreachable: ${db.reason}`,
      database: db,
      env: env.map(({ name, configured, required, purpose }) => ({ name, configured, required, purpose })),
      residentSignInAvailable:
        env.find(v => v.name === 'CLERK_SECRET_KEY')?.configured === true &&
        env.find(v => v.name === 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')?.configured === true,
      hint: ok
        ? undefined
        : 'Set these in Vercel → Settings → Environments → Production → Environment Variables, then redeploy with the build cache turned off.',
    },
    { status: ok ? 200 : 503 },
  );
}
