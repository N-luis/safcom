/**
 * Server side of residency and the jurisdiction: the configured jurisdiction,
 * who may verify residents or change the boundary, the residency gate every
 * standard resident report passes, and the residency history.
 */
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { BARANGAY_CENTER } from './geo';
import { EMERGENCY_CONTACTS } from './safecommConfig';
import { setActiveJurisdiction } from './aiJurisdiction';
import {
  DEFAULT_JURISDICTION, boundaryProblem, boundaryGeometry, checkLocation, isVerifiedResident, RESIDENCY_STATUSES,
  type JurisdictionConfig, type LocationInput, type ResidencyStatus,
} from './jurisdiction';

/**
 * Who approves, rejects or asks a resident for more information: the
 * Barangay Captain. Not the blotter or VAWC desks, and not the system
 * administrator (an IT role, with no reason to read residents' home
 * locations).
 */
export const RESIDENCY_VERIFIER_ROLES = ['admin'];
/** Who may change the jurisdiction's names and boundary. */
export const JURISDICTION_ADMIN_ROLES = ['admin', 'system_admin'];

let cache: { at: number; cfg: JurisdictionConfig } | null = null;
const TTL = 60_000;

/** The configured jurisdiction, or the defaults (no boundary) when none is saved. Cached for a minute. */
export async function loadJurisdiction(fresh = false): Promise<JurisdictionConfig> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.cfg;
  let cfg = DEFAULT_JURISDICTION;
  try {
    const row = await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } });
    if (row) {
      cfg = {
        barangay: row.barangay, barangayAliases: row.barangayAliases, municipality: row.municipality, province: row.province,
        // A stored boundary that no longer passes the check is not used - never half a polygon.
        boundary: row.boundary && !boundaryProblem(row.boundary) ? boundaryGeometry(row.boundary) : null,
        boundarySource: row.boundarySource,
      };
    }
  } catch {
    // The table not reachable: the defaults, which never place a pin inside anything.
  }
  cache = { at: Date.now(), cfg };
  // The AI is told about the same jurisdiction the checks use.
  setActiveJurisdiction(cfg);
  return cfg;
}
export const forgetJurisdiction = () => { cache = null; };

/** Check a location against the configured jurisdiction. */
export async function checkAgainstJurisdiction(input: LocationInput, kind: 'residence' | 'incident') {
  return checkLocation(input, await loadJurisdiction(), kind, BARANGAY_CENTER);
}

/** A row in the residency history. Insert-only: the database refuses any change. */
export function recordResidencyEvent(tx: Prisma.TransactionClient, e: {
  residentId: string; kind: string; actorType: 'resident' | 'official' | 'system'; actorId: string | null;
  fromStatus?: string | null; toStatus?: string | null; note?: string | null; snapshot?: unknown;
}) {
  return tx.residencyEvent.create({ data: {
    residentId: e.residentId, kind: e.kind, actorType: e.actorType, actorId: e.actorId,
    fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null, note: e.note ?? null,
    snapshot: e.snapshot === undefined ? undefined : (JSON.parse(JSON.stringify(e.snapshot)) as Prisma.InputJsonValue),
  } });
}

/** The answer when an account that is not a verified resident tries a standard resident report. */
export function notVerifiedBody(status: string) {
  const label = RESIDENCY_STATUSES[status as ResidencyStatus] ?? status;
  return {
    success: false,
    code: 'RESIDENCY_NOT_VERIFIED',
    residencyStatus: status,
    error: `Standard reporting through the Resident Portal is limited to verified residents within SafeComm's jurisdiction. Your residency is: ${label}. Complete or check your verification under Residency, or contact the barangay hall.`,
    // An urgent concern is never left without somewhere to go.
    emergencyContacts: EMERGENCY_CONTACTS,
    referralAvailable: true,
  };
}

/**
 * The resident's residency, read fresh from the database on every request -
 * never from the session token, so a status changed a minute ago (approved,
 * or an address changed) applies at once.
 */
export async function residencyOf(residentId: string): Promise<{ status: string; verified: boolean } | null> {
  const r = await prisma.resident.findUnique({ where: { id: residentId }, select: { residencyStatus: true } });
  return r ? { status: r.residencyStatus, verified: isVerifiedResident(r.residencyStatus) } : null;
}

/** The residential fields a resident's own record carries, for checks and display. */
export const RESIDENCE_SELECT = {
  id: true, residentNumber: true, firstName: true, lastName: true, birthDate: true, age: true, gender: true, contactNumber: true, email: true,
  emailVerified: true, status: true, registeredAt: true, updatedAt: true,
  province: true, municipality: true, barangay: true, street: true, houseNumber: true, purok: true, address: true,
  homeLatitude: true, homeLongitude: true, homeLocationSource: true, addressCheck: true, addressVerificationStatus: true,
  residencyStatus: true, residencySubmittedAt: true, residencyVerifiedAt: true, residencyVerifiedById: true, residencyNote: true,
} satisfies Prisma.ResidentSelect;

/**
 * The residential address on the registration form, checked before any
 * record is made: outside the jurisdiction it is refused with where to go
 * instead (nothing is stored); incomplete, it says what is missing. Used by
 * /api/residents/register, and tested on its own.
 */
export async function registrationAddressRefusal(a: LocationInput): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const check = await checkAgainstJurisdiction(a, 'residence');
  if (check.status === 'OUTSIDE') return { status: 422, body: { success: false, code: 'OUTSIDE_JURISDICTION', error: check.explanation, destination: check.destination, jurisdiction: check.jurisdiction } };
  if (check.status === 'INCOMPLETE') return { status: 400, body: { success: false, code: 'ADDRESS_INCOMPLETE', error: check.explanation, missing: check.missing } };
  return null;
}
