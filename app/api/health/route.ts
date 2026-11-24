import { NextResponse } from 'next/server';
import { checkEnv, checkDatabase } from '@/lib/configCheck';
import { emailLoginStatus, emailSettingsReport } from '@/lib/email';

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
function emailAdvice(login: string) {
  const r = emailSettingsReport();
  const problems = [...r.problems];
  if (login.startsWith('server_name_not_found')) problems.unshift('The server in EMAIL_SERVER does not exist on the internet - check its spelling (Gmail: smtp.gmail.com)');
  if (login.startsWith('login_rejected')) problems.unshift('The mail server refused EMAIL_USERNAME / EMAIL_PASSWORD - for Gmail: the full Gmail address and a Google app password from that same account');
  return { ...r, problems };
}

export async function GET() {
  const env = checkEnv();
  const [db, emailLogin] = await Promise.all([checkDatabase(), emailLoginStatus().catch(() => 'unreachable')]);

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
      residentSignInAvailable: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
        .every(n => env.find(v => v.name === n)?.configured === true),
      // Whether the mail server accepts the login (checked without sending; at most every 5 minutes):
      // ok | login_rejected (wrong username or app password) | unreachable | not_configured.
      emailLogin,
      // What is wrong with the email settings - categories only, never a value (a public provider's server name at most).
      emailSettings: emailAdvice(emailLogin),
      hint: ok
        ? undefined
        : 'Set these in Vercel → Settings → Environments → Production → Environment Variables, then redeploy with the build cache turned off.',
    },
    { status: ok ? 200 : 503 },
  );
}
