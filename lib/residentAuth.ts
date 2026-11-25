import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './jwtSecret';
import { startSession, sessionActive, sessionlessTokensAllowed, SESSION_SECONDS } from './sessions';


const COOKIE = 'resident_token';

export interface ResidentPayload {
  residentId: string;
  email: string;
  name: string;
  role: 'resident';
  /** The AuthSession this token belongs to (lib/sessions.ts) - checked on every request. */
  sid?: string;
}

export function signResidentToken(payload: ResidentPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SESSION_SECONDS.resident });
}

/** Sign a resident in: a new session (7 days) and the token that carries it. */
export async function issueResidentSession(p: Omit<ResidentPayload, 'sid' | 'role'>, userAgent?: string | null) {
  const { sid } = await startSession('resident', p.residentId, userAgent);
  return signResidentToken({ ...p, role: 'resident', sid });
}

export function verifyResidentToken(token: string): ResidentPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as ResidentPayload;
  } catch {
    return null;
  }
}

export async function requireResidentAuth(
  req: NextRequest,
): Promise<{ resident: ResidentPayload } | NextResponse> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = verifyResidentToken(token);
  if (!payload || payload.role !== 'resident' || typeof payload.residentId !== 'string' || !payload.residentId) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  if (payload.sid ? !(await sessionActive('resident', payload.sid, payload.residentId)) : !sessionlessTokensAllowed()) {
    return NextResponse.json({ error: 'Your session has ended. Sign in again.', code: 'SESSION_ENDED' }, { status: 401 });
  }
  return { resident: payload };
}

export function setResidentCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_SECONDS.resident,
    path: '/',
  });
}

export function clearResidentCookie(res: NextResponse) {
  res.cookies.set(COOKIE, '', { maxAge: 0, path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
}

export function rSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function rError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
