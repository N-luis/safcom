import { NextRequest } from 'next/server';
import { rSuccess, rError } from '@/lib/residentAuth';
import { reverseGeocode } from '@/lib/geocoder';
import { isValidCoordinate } from '@/lib/geo';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** The address at a point, for the home pin during registration. Public, so limited per connection. */
export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!(await rateLimit(`reg-geo:${ip}`, { max: 40, windowMs: 10 * 60_000 })).allowed) return rError('Too many lookups - wait a few minutes.', 429);
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  if (!isValidCoordinate(lat, lng)) return rError('Invalid coordinates', 400);
  return rSuccess({ location: await reverseGeocode(lat, lng) });
}
