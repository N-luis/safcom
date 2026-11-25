import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
import { endSession, endAllSessions } from '@/lib/sessions';

/**
 * Signing an official out ends the session itself (lib/sessions.ts), not just
 * the cookie: the token stops working everywhere. `{ everywhere: true }` ends
 * every session of that official - "sign out of all devices".
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { everywhere?: boolean } | null;
  const payload = (() => { const t = getTokenFromRequest(req); return t ? verifyToken(t) : null; })();
  if (payload?.userId) {
    if (body?.everywhere) await endAllSessions('staff', payload.userId, 'signed_out_everywhere');
    else if (payload.sid) await endSession(payload.sid, 'logout');
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set('safcom_token', '', { maxAge: 0, path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  return res;
}
