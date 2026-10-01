import { NextRequest, NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

const PUBLIC_PATHS = [
  '/login', '/register',
  '/api/auth/login', '/api/residents/register',
  '/api/auth/check-email', '/api/upload/id',
  '/resident-login', '/api/auth/resident-login',
  '/vawc-login',
  '/verify-email', '/api/auth/verify-email', '/api/auth/resend-verification',
  // Clerk handles resident identity + verification emails.
  '/sign-in', '/sign-up', '/__clerk', '/api/auth/clerk-session', '/complete-profile',
  // Deployment diagnostics - must be reachable before anyone can sign in.
  '/api/health',
  '/uploads',
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

/**
 * The routing and role gating. Clerk marks nothing protected by itself — the
 * staff checks below are unchanged and remain the only thing guarding the
 * officer modules, so this logic is identical with or without Clerk.
 */
async function route(req: NextRequest) {
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

/**
 * Clerk is wrapped around the routing above so `auth()` works server-side for
 * the resident flow — but only when its keys are actually configured.
 *
 * clerkMiddleware() throws "Missing secretKey" when they aren't, and because
 * this middleware matches every path that turned a missing env var into a
 * site-wide blank "Internal Server Error". Staff sign-in doesn't depend on
 * Clerk at all, so when the keys are absent we run the same routing without it:
 * the Blotter, VAWC, Captain and System Admin modules keep working and only the
 * resident Clerk pages are unavailable.
 */
const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

export const proxy = clerkConfigured
  ? clerkMiddleware(async (_auth, req: NextRequest) => route(req))
  : (req: NextRequest) => route(req);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
