import { NextRequest } from 'next/server';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { reverseGeocode } from '@/lib/geocoder';
import { isValidCoordinate } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/**
 * The address at a point, for the incident location picker.
 *
 * Behind the resident session like the rest of the reporting flow, so the
 * barangay's geocoding quota is spent on residents filing reports rather than
 * on anyone who finds the URL.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  if (!isValidCoordinate(lat, lng)) return rError('Invalid coordinates', 400);

  const location = await reverseGeocode(lat, lng);
  // Not an error: a point with no address is a real answer, and the form lets
  // the resident name the street themselves.
  return rSuccess({ location });
}
