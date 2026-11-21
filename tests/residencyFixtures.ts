/**
 * Shared by the suites that file resident reports: since residency
 * verification (lib/jurisdiction.ts), only a verified resident may file a
 * standard report, and every report says where the incident happened. These
 * fixtures make a test resident a verified one and place the incident in the
 * barangay - the suites test what happens after that gate, which
 * tests/residency.test.ts tests itself.
 */
import { NextRequest } from 'next/server';

/** Spread into prisma.resident.create's data: a resident verified by a (fictional) verifier. */
export const VERIFIED_RESIDENT = {
  residencyStatus: 'VERIFIED', residencyVerifiedAt: new Date(), residencyVerifiedById: 'PROBE-VERIFIER',
  province: 'Bulacan', municipality: 'Bocaue',
} as const;

/** The incident place a report needs: inside the configured barangay. */
export const INCIDENT_IN_BARANGAY = { incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd', incidentLocationDetails: 'Fictional test location' };

/**
 * The filing route with the incident placed in the barangay unless the test
 * gave a place itself. The request is rebuilt with the same URL, method and
 * headers (the resident cookie).
 */
export function inBarangay<A extends unknown[]>(post: (req: NextRequest, ...rest: A) => Promise<Response>) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    const raw = await req.text();
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const merged = body && typeof body === 'object' && !Array.isArray(body) ? { ...INCIDENT_IN_BARANGAY, ...(body as object) } : body;
    const next = new NextRequest(req.url, { method: req.method, headers: req.headers, body: merged === null ? raw || undefined : JSON.stringify(merged) });
    return post(next, ...rest);
  };
}
