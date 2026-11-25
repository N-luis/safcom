import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { getJwtSecret } from './jwtSecret';
import { startSession, sessionActive, sessionlessTokensAllowed } from './sessions';



export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  /** The AuthSession this token belongs to (lib/sessions.ts) - checked on every request. */
  sid?: string;
}

export function signToken(payload: JwtPayload, expiresInSeconds = 7 * 24 * 60 * 60): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: expiresInSeconds });
}

/** Sign an official in: a new session (12 hours) and the token that carries it. */
export async function issueStaffSession(user: { id: string; email: string; role: string }, userAgent?: string | null) {
  const { sid, maxAge } = await startSession('staff', user.id, userAgent);
  return { token: signToken({ userId: user.id, email: user.email, role: user.role, sid }, maxAge), maxAge, sid };
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  const cookie = req.cookies.get('safcom_token')?.value;
  return cookie || null;
}

export async function requireAuth(req: NextRequest): Promise<{ user: JwtPayload } | NextResponse> {
  const token = getTokenFromRequest(req);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const payload = verifyToken(token);
  // A resident's token is never an official's: it has no userId.
  if (!payload || typeof payload.userId !== 'string' || !payload.userId) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  // The session must still be active - signed out, password changed or deactivated ends it at once.
  if (payload.sid ? !(await sessionActive('staff', payload.sid, payload.userId)) : !sessionlessTokensAllowed()) {
    return NextResponse.json({ error: 'Your session has ended. Sign in again.', code: 'SESSION_ENDED' }, { status: 401 });
  }
  return { user: payload };
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}
