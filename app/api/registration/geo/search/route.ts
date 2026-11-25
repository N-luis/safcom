import { NextRequest } from 'next/server';
import { rSuccess, rError } from '@/lib/residentAuth';
import { searchPlaces } from '@/lib/geocoder';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Street and landmark search for the home pin during registration (before
 * there is an account). Public, so limited per connection; the geocoder is
 * cached and throttled (lib/geocoder.ts).
 */
export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!(await rateLimit(`reg-geo:${ip}`, { max: 40, windowMs: 10 * 60_000 })).allowed) return rError('Too many searches - wait a few minutes.', 429);
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 3) return rError('Type at least 3 characters', 400);
  if (q.length > 120) return rError('Search is too long', 400);
  return rSuccess({ results: await searchPlaces(q) });
}
