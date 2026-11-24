import { rSuccess, rError } from '@/lib/residentAuth';
import { loadJurisdiction } from '@/lib/jurisdictionServer';

export const dynamic = 'force-dynamic';

/**
 * The jurisdiction the registration form checks against: the names, and the
 * official boundary when one is configured (public geography - no person, no
 * case). The server checks every registration again itself.
 */
export async function GET() {
  try {
    const cfg = await loadJurisdiction();
    return rSuccess({ barangay: cfg.barangay, barangayAliases: cfg.barangayAliases, municipality: cfg.municipality, province: cfg.province,
      boundary: cfg.boundary ?? null, boundaryConfigured: Boolean(cfg.boundary) });
  } catch {
    return rError('The jurisdiction could not be loaded right now.', 503);
  }
}
