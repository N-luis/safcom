import { NextRequest } from 'next/server';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { evidenceForResident } from '@/lib/evidenceServer';

export const dynamic = 'force-dynamic';

/**
 * GET - the photos on the resident's own report: those they sent, and those on
 * updates shared with them. Another resident's case is not found.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;
  try {
    const items = await evidenceForResident(id, auth.resident.residentId);
    if (!items) return rError('Case not found', 404);
    const res = rSuccess({ items });
    res.headers.set('Cache-Control', 'no-store, private');
    return res;
  } catch {
    return rError('Your photos could not be loaded right now.', 503);
  }
}
