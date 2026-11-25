import { NextRequest, NextResponse } from 'next/server';
import { clearResidentCookie, rSuccess, verifyResidentToken } from '@/lib/residentAuth';
import { endSession, endAllSessions } from '@/lib/sessions';

/**
 * Signing a resident out ends the session itself (lib/sessions.ts), not just
 * the cookie. `{ everywhere: true }` ends every session of that resident.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { everywhere?: boolean } | null;
  const token = req.cookies.get('resident_token')?.value;
  const payload = token ? verifyResidentToken(token) : null;
  if (payload?.residentId) {
    if (body?.everywhere) await endAllSessions('resident', payload.residentId, 'signed_out_everywhere');
    else if (payload.sid) await endSession(payload.sid, 'logout');
  }
  const res = rSuccess({ message: 'Logged out' });
  clearResidentCookie(res as NextResponse);
  return res;
}
