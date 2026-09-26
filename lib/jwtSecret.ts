/**
 * Resolves the signing secret for both the staff (`safcom_token`) and resident
 * (`resident_token`) sessions.
 *
 * The old code fell back to a hardcoded string when JWT_SECRET was unset. Now
 * that the repository is public that string is readable by anyone, so anyone
 * could forge an admin session. In production we refuse to sign or verify with
 * it and fail loudly instead.
 *
 * Deliberately resolved lazily (not at module load) so `next build`, which runs
 * with NODE_ENV=production and no runtime env, still succeeds — the check
 * happens on the first request that actually needs a token.
 */
const DEV_ONLY_FALLBACK = 'safcom-local-dev-only-do-not-use-in-production';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim()) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Add it to your hosting environment variables ' +
      '(Vercel → Settings → Environment Variables). Refusing to sign sessions ' +
      'with the public fallback secret.',
    );
  }

  return DEV_ONLY_FALLBACK;
}
