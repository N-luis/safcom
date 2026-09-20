import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login', '/register',
  '/api/auth/login', '/api/residents/register',
  '/api/auth/check-email', '/api/upload/id',
  '/resident-login', '/api/auth/resident-login',
  '/vawc-login',
  '/uploads',
];

// paths that require resident_token instead of safcom_token
const RESIDENT_PATHS = ['/resident/', '/api/resident/', '/api/auth/resident-me', '/api/auth/resident-logout'];

function isResidentPath(pathname: string): boolean {
  return pathname === '/resident' || pathname === '/api/resident' || RESIDENT_PATHS.some(p => pathname.startsWith(p));
}

function isTokenValid(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload === 'object' && payload !== null && (!payload.exp || payload.exp * 1000 > Date.now());
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next();

  // Resident portal — check resident_token
  if (isResidentPath(pathname)) {
    const token = req.cookies.get('resident_token')?.value;
    if (!token || !isTokenValid(token)) {
      return NextResponse.redirect(new URL('/resident-login', req.url));
    }
    return NextResponse.next();
  }

  // Admin/officer portal — check safcom_token
  const token = req.cookies.get('safcom_token')?.value;
  if (!token || !isTokenValid(token)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
