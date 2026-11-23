import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login', '/register',
  '/api/auth/login', '/api/residents/register',
  // Not public any more: /api/auth/check-email told anyone whether an email was registered (unused since one-step registration).
  '/resident-login', '/api/auth/resident-login',
  '/vawc-login',
  // Resident sign-in (Supabase Auth, on the server): confirm the email, reset or set up a password.
  '/verify-email', '/api/auth/verify-email', '/api/auth/resend-verification',
  '/reset-password', '/api/auth/resident-password',
  // Registration's own address search and the jurisdiction (public, rate-limited; no account yet).
  '/api/registration/',
  // Old Clerk addresses, kept as redirects so links in old emails still land somewhere.
  '/sign-in', '/sign-up', '/complete-profile',
  // Deployment diagnostics - must be reachable before anyone can sign in.
  '/api/health',
];

/**
 * Routes that authorise themselves because they serve both audiences, each
 * carrying a different cookie. The proxy cannot pick one: gating them as staff
 * locks residents out, and gating them as resident locks officers out. These
 * are NOT public - the handler checks the caller and returns 401/403 itself.
 */
const SELF_AUTHORISED_PATHS = [
  // Report photos: barangay staff see any case's, a resident sees only theirs.
  '/api/attachments',
  // A scheduler has no session; this one checks a shared secret itself and
  // refuses outright when none is configured.
  '/api/cron',
];

// paths that require resident_token instead of safcom_token
// Reading a photographed document is part of filing a report, so it is gated by
// the resident token like the rest of that flow.
const RESIDENT_PATHS = [
  '/resident/', '/api/resident/', '/api/auth/resident-me', '/api/auth/resident-logout',
  '/api/transcribe',
];

function isResidentPath(pathname: string): boolean {
  return pathname === '/resident' || pathname === '/api/resident' || RESIDENT_PATHS.some(p => pathname.startsWith(p));
}

function readToken(token: string): { role?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload !== 'object' || payload === null) return null;
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Each staff role owns one module. The captain oversees both field modules, so
// their dashboard can link into Blotter and VAWC; officers stay in their own.
const MODULE_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: '/dashboard',        roles: ['admin', 'system_admin'] },
  { prefix: '/blotter-officer',  roles: ['officer', 'blotter_officer', 'admin', 'system_admin'] },
  { prefix: '/vawc',             roles: ['vawc_officer', 'vawc', 'vawc_lead', 'admin', 'system_admin'] },
  { prefix: '/admin',            roles: ['system_admin'] },
];

function homeFor(role: string | undefined): string {
  switch (role) {
    case 'vawc_officer':
    case 'vawc':
    case 'vawc_lead':
      return '/vawc';
    case 'officer':
    case 'blotter_officer':
      return '/blotter-officer';
    case 'system_admin':
      return '/admin';
    case 'admin':
      return '/dashboard';
    default:
      return '/login';
  }
}

/** The routing and role gating: residents by resident_token, staff by safcom_token and their role. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (SELF_AUTHORISED_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next();

  // Resident portal — check resident_token
  if (isResidentPath(pathname)) {
    const token = req.cookies.get('resident_token')?.value;
    if (!token || !readToken(token)) {
      return NextResponse.redirect(new URL('/resident-login', req.url));
    }
    return NextResponse.next();
  }

  // Admin/officer portal — check safcom_token
  const token = req.cookies.get('safcom_token')?.value;
  const payload = token ? readToken(token) : null;
  if (!payload) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Keep each account inside the module it was created for. Sending them to
  // their own module (rather than /login) avoids a confusing forced logout.
  const rule = MODULE_ACCESS.find(m => pathname === m.prefix || pathname.startsWith(m.prefix + '/'));
  if (rule && !rule.roles.includes(payload.role ?? '')) {
    return NextResponse.redirect(new URL(homeFor(payload.role), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
