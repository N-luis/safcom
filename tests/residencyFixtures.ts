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

/**
 * The incident place a report needs: inside the configured barangay. Since the
 * stricter incident check (028), the barangay named is not enough on its own -
 * a pin inside the official boundary or one of the barangay's own streets has
 * to place it - so this carries a pin at the Biñang 2nd Barangay Hall, inside
 * the configured boundary, and a street from the barangay's list for a
 * database without a boundary. A test's own street or pin still wins.
 */
export const INCIDENT_IN_BARANGAY = {
  incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd', incidentLocationDetails: 'Fictional test location',
  latitude: 14.795956, longitude: 120.9297673,
};

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

/**
 * Remove the referral records of test residents - and the notices they sent.
 * A referral notifies every active captain (and the VAWC desk for a
 * confidential one), so a suite's cleanup must also remove those notices
 * from real officials' inboxes, found by the referral's reference number.
 */
export async function removeTestReferrals(residentIds: string[]) {
  const { prisma } = await import('../lib/prisma');
  const refs = await prisma.jurisdictionReferral.findMany({ where: { residentId: { in: residentIds } }, select: { id: true, referenceNumber: true } });
  const numbers = refs.map(r => r.referenceNumber).filter((n): n is string => Boolean(n));
  if (numbers.length) await prisma.notification.deleteMany({ where: { OR: numbers.map(n => ({ title: { contains: n } })) } });
  await prisma.activity.deleteMany({ where: { entityType: 'JurisdictionReferral', entityId: { in: refs.map(r => r.id) } } });
  await prisma.jurisdictionReferral.deleteMany({ where: { id: { in: refs.map(r => r.id) } } });
}
