import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * /auth/confirm?token_hash=...&type=...  - one address for every emailed sign-in link.
 *
 * SafeComm's own emails link straight to /verify-email and /reset-password; this
 * route sends any link written in Supabase's format (for example from an email
 * template set up in the Supabase dashboard) to the same pages:
 *   recovery, invite         -> /reset-password  (choose a password)
 *   signup, email, magiclink -> /verify-email    (confirm the email)
 * The token is checked there, by the server, never here.
 *
 * Only these SafeComm pages: a "next" or "redirect_to" parameter is ignored, so a
 * link can never send anyone to another site.
 */
export function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash')?.trim() ?? '';
  const type = req.nextUrl.searchParams.get('type')?.trim() ?? '';
  const to = req.nextUrl.clone();
  to.search = '';
  if (!/^[A-Za-z0-9_-]{10,500}$/.test(tokenHash)) {
    to.pathname = type === 'recovery' || type === 'invite' ? '/forgot-password' : '/verify-email';
    return NextResponse.redirect(to, 303);
  }
  if (type === 'recovery' || type === 'invite') {
    to.pathname = '/reset-password';
    to.searchParams.set('token_hash', tokenHash);
    to.searchParams.set('type', type);
  } else if (type === 'signup' || type === 'email' || type === 'magiclink') {
    to.pathname = '/verify-email';
    to.searchParams.set('token_hash', tokenHash);
    to.searchParams.set('type', type === 'magiclink' ? 'magiclink' : 'signup');
  } else {
    to.pathname = '/resident-login';
  }
  return NextResponse.redirect(to, 303);
}
