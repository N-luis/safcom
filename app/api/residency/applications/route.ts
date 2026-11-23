import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { RESIDENCY_VERIFIER_ROLES } from '@/lib/jurisdictionServer';
import { RESIDENCY_STATUSES, RESIDENCY_STATUS_KEYS, addressLine, type ResidencyStatus } from '@/lib/jurisdiction';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * Resident Verification, for the Barangay Captain: the counts by residency
 * status, and the applicants in one status (?status=PENDING_VERIFICATION by
 * default; &q= name, resident number or street). The list carries the
 * address and what the server's check flagged - the exact home location is
 * only in one applicant's record (./[id]), opened on purpose.
 *
 * Blotter and VAWC officers and the system administrator get 403: verifying
 * residents is not their responsibility.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  if (!RESIDENCY_VERIFIER_ROLES.includes(actor.role.trim())) {
    return noStore({ success: false, error: 'Only the Barangay Captain verifies residents.' }, 403);
  }
  const sp = req.nextUrl.searchParams;
  const status = (RESIDENCY_STATUS_KEYS as string[]).includes(sp.get('status') ?? '') ? sp.get('status')! : 'PENDING_VERIFICATION';
  const q = sp.get('q')?.trim().slice(0, 60) || null;
  try {
    const [groups, rows] = await Promise.all([
      prisma.resident.groupBy({ by: ['residencyStatus'], _count: true }),
      prisma.resident.findMany({
        where: {
          residencyStatus: status,
          ...(q && { OR: [
            { firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } },
            { residentNumber: { contains: q, mode: 'insensitive' } }, { street: { contains: q, mode: 'insensitive' } },
          ] }),
        },
        orderBy: [{ residencySubmittedAt: 'asc' }, { registeredAt: 'asc' }], take: 200,
        select: {
          id: true, residentNumber: true, firstName: true, lastName: true, registeredAt: true, residencySubmittedAt: true, residencyVerifiedAt: true,
          residencyStatus: true, residencyNote: true, province: true, municipality: true, barangay: true, street: true, houseNumber: true, purok: true,
          address: true, addressVerificationStatus: true, addressCheck: true, homeLocationSource: true, emailVerified: true,
          email: true, contactNumber: true, altContactNumber: true, postalCode: true,
        },
      }),
    ]);
    const counts = Object.fromEntries(RESIDENCY_STATUS_KEYS.map(k => [k, groups.find(g => g.residencyStatus === k)?._count ?? 0])) as Record<ResidencyStatus, number>;
    return noStore({ success: true, data: {
      counts, total: Object.values(counts).reduce((a, b) => a + b, 0), status,
      rows: rows.map(r => {
        const check = (r.addressCheck ?? {}) as { flags?: string[]; boundary?: string; selection?: string };
        return {
          id: r.id, residentNumber: r.residentNumber, name: `${r.firstName} ${r.lastName}`, registeredAt: r.registeredAt,
          submittedAt: r.residencySubmittedAt, verifiedAt: r.residencyVerifiedAt, status: r.residencyStatus,
          statusLabel: RESIDENCY_STATUSES[r.residencyStatus as ResidencyStatus] ?? r.residencyStatus, note: r.residencyNote,
          address: [addressLine(r) || r.address, r.postalCode].filter(Boolean).join(' '), addressStatus: r.addressVerificationStatus, emailVerified: r.emailVerified,
          // The captain only (RESIDENCY_VERIFIER_ROLES): to reach the person about their application.
          email: r.email, contactNumber: r.contactNumber, altContactNumber: r.altContactNumber,
          located: r.homeLocationSource !== null && r.homeLocationSource !== 'NONE',
          flags: check.flags ?? [], boundary: check.boundary ?? null, selection: check.selection ?? null,
        };
      }),
    } });
  } catch (e) {
    logRouteError('GET /api/residency/applications', e);
    return errorResponse('The applications could not be loaded right now.', 503);
  }
}
