import { NextRequest } from 'next/server';
import { rSuccess, rError } from '@/lib/residentAuth';
import { rateLimit } from '@/lib/rateLimit';
import { streetsFor } from '@/lib/verifiedStreets';

export const dynamic = 'force-dynamic';

/**
 * The verified streets of one barangay, for the Street field of File a Report:
 *   GET ?province=&municipality=&barangay=
 *   -> { identified, verified, streets: [{ id, name, aliases }], source }
 * `verified: false` means there is no verified list for that barangay - the
 * form asks for the street name instead. Public geography only (no person, no
 * case), rate-limited; the server checks the chosen street again on submit.
 */
export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!(await rateLimit(`streets:${ip}`, { max: 120, windowMs: 10 * 60_000 })).allowed) return rError('Too many requests - wait a few minutes.', 429);
  const sp = req.nextUrl.searchParams;
  const place = { province: sp.get('province')?.slice(0, 80), municipality: sp.get('municipality')?.slice(0, 80), barangay: sp.get('barangay')?.slice(0, 80) };
  try {
    const r = await streetsFor(place);
    return rSuccess({ identified: r.identified, verified: r.streets.length > 0, streets: r.streets, source: r.source });
  } catch {
    return rError('The street list could not be loaded right now. You can type the street name.', 503);
  }
}
