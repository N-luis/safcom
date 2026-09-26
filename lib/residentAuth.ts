import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './jwtSecret';


const COOKIE = 'resident_token';

export interface ResidentPayload {
  residentId: string;
  email: string;
  name: string;
  role: 'resident';
}

export function signResidentToken(payload: ResidentPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
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
  if (!payload || payload.role !== 'resident') {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  return { resident: payload };
}

export function setResidentCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
}

export function clearResidentCookie(res: NextResponse) {
  res.cookies.set(COOKIE, '', { maxAge: 0, path: '/' });
}

export function rSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function rError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}
