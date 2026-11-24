/**
 * The address SafeComm's emailed links point to.
 *
 * Never taken from the request alone: a request sent with a forged Host header
 * could otherwise make a password-reset email carry a link to someone else's
 * site ("password reset poisoning"). In order:
 *   1. APP_URL, when set (e.g. https://barangaysafcom.vercel.app);
 *   2. on Vercel, the production domain Vercel provides
 *      (VERCEL_PROJECT_PRODUCTION_URL);
 *   3. otherwise (this computer, while developing) the request's own origin.
 */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();

export function siteOrigin(requestOrigin: string): string {
  const app = clean(process.env.APP_URL);
  if (/^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(app)) return app.replace(/\/$/, '');
  const vercel = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (/^[a-z0-9.-]+$/i.test(vercel)) return `https://${vercel}`;
  return requestOrigin.replace(/\/$/, '');
}
