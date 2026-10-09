import { NextRequest } from 'next/server';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { searchPlaces } from '@/lib/geocoder';

export const dynamic = 'force-dynamic';

/** Street and landmark search for the incident location picker. */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 3) return rError('Type at least 3 characters', 400);
  if (q.length > 120) return rError('Search is too long', 400);

  return rSuccess({ results: await searchPlaces(q) });
}
