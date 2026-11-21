import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore } from '@/lib/caseRecordsServer';
import { loadJurisdiction, checkAgainstJurisdiction, recordResidencyEvent, RESIDENCE_SELECT } from '@/lib/jurisdictionServer';
import {
  RESIDENCY_STATUSES, BOCAUE_BARANGAYS, BULACAN_MUNICIPALITIES, BARANGAY_STREETS_FOR_FORM, addressLine,
  type ResidencyStatus, type LocationCheck,
} from '@/lib/jurisdiction';
import { roundCoord } from '@/lib/geo';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * The resident's own residency: their residential address, its confirmed
 * location, and where the verification stands.
 *
 *   GET - the record, what the server's check says about it, the verifier's
 *         latest reason or request, and the jurisdiction (names, the lists the
 *         form offers, and the official boundary when one is configured).
 *   PUT - change the address or location, and optionally submit it for
 *         verification. Changing the address of a verified resident takes
 *         the verification away until an official checks the new one.
 *
 * The status is never taken from the request: a resident can submit, never
 * verify. A submission outside the jurisdiction is refused with where to go
 * instead; anything else goes to an official (Pending Verification).
 */

/** Fields only the server sets: a request carrying any of them is refused, not quietly stripped. */
const SERVER_ONLY = ['residencyStatus', 'residencyVerifiedAt', 'residencyVerifiedById', 'residencyNote', 'residencySubmittedAt',
  'addressCheck', 'addressVerificationStatus', 'status', 'verified'];

const text = (max: number) => z.string().trim().max(max);
const putSchema = z.object({
  province: text(80), municipality: text(80), barangay: text(80), street: text(120),
  houseNumber: text(40).optional().default(''), purok: text(80).optional().default(''),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  /** How the pin was placed. NONE: no location - verified by a person from the address. */
  locationSource: z.enum(['MAP', 'SEARCH', 'DEVICE', 'NONE']).optional(),
  submit: z.boolean().optional(),
}).strict();

async function view(residentId: string) {
  const [r, events, cfg] = await Promise.all([
    prisma.resident.findUnique({ where: { id: residentId }, select: RESIDENCE_SELECT }),
    prisma.residencyEvent.findMany({ where: { residentId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, kind: true, actorType: true, fromStatus: true, toStatus: true, note: true, createdAt: true } }),
    loadJurisdiction(),
  ]);
  if (!r) return null;
  const check = await checkAgainstJurisdiction({ ...r, latitude: r.homeLatitude, longitude: r.homeLongitude }, 'residence');
  return {
    residency: {
      status: r.residencyStatus, statusLabel: RESIDENCY_STATUSES[r.residencyStatus as ResidencyStatus] ?? r.residencyStatus,
      submittedAt: r.residencySubmittedAt, verifiedAt: r.residencyVerifiedAt, note: r.residencyNote,
    },
    address: { province: r.province, municipality: r.municipality, barangay: r.barangay, street: r.street, houseNumber: r.houseNumber, purok: r.purok,
      line: addressLine(r), legacyAddress: r.address },
    // Their own home location - shown to them, and to the officials who verify it, never to anyone else.
    location: r.homeLatitude !== null && r.homeLongitude !== null ? { latitude: r.homeLatitude, longitude: r.homeLongitude, source: r.homeLocationSource } : null,
    check,
    // Officials are not named to the resident.
    history: events.map(e => ({ ...e, actorType: e.actorType === 'official' ? 'official' : e.actorType })),
    jurisdiction: {
      barangay: cfg.barangay, municipality: cfg.municipality, province: cfg.province,
      boundary: cfg.boundary, boundaryConfigured: Boolean(cfg.boundary),
      lists: { municipalities: BULACAN_MUNICIPALITIES, barangays: BOCAUE_BARANGAYS, streets: BARANGAY_STREETS_FOR_FORM },
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  try {
    const v = await view(auth.resident.residentId);
    if (!v) return rError('Resident not found', 404);
    return noStore({ success: true, data: v });
  } catch (e) {
    logRouteError('GET /api/resident/residency', e);
    return rError('Your residency could not be loaded right now.', 503);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const body = await req.json().catch(() => null);
  const forbidden = body && typeof body === 'object' ? SERVER_ONLY.filter(f => f in body) : [];
  if (forbidden.length) return rError(`Only an authorised barangay official can set: ${forbidden.join(', ')}.`, 403);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check the address', 400);
  const d = parsed.data;
  const me = auth.resident.residentId;
  try {
    const r = await prisma.resident.findUnique({ where: { id: me }, select: RESIDENCE_SELECT });
    if (!r) return rError('Resident not found', 404);
    const pin = d.locationSource === 'NONE' ? null
      : typeof d.latitude === 'number' && typeof d.longitude === 'number' ? { lat: roundCoord(d.latitude), lng: roundCoord(d.longitude) } : null;
    const next = {
      province: d.province, municipality: d.municipality, barangay: d.barangay, street: d.street,
      houseNumber: d.houseNumber || null, purok: d.purok || null,
      homeLatitude: pin?.lat ?? null, homeLongitude: pin?.lng ?? null,
      homeLocationSource: pin ? (d.locationSource && d.locationSource !== 'NONE' ? d.locationSource : 'MAP') : 'NONE',
    };
    const changedKeys = (Object.keys(next) as (keyof typeof next)[]).filter(k => (r[k] ?? null) !== (next[k] ?? null));
    const check: LocationCheck = await checkAgainstJurisdiction({ ...next, latitude: next.homeLatitude, longitude: next.homeLongitude }, 'residence');
    const from = r.residencyStatus;

    if (d.submit) {
      if (check.status === 'INCOMPLETE') {
        return noStore({ success: false, code: 'ADDRESS_INCOMPLETE', error: check.explanation, missing: check.missing, check }, 400);
      }
      if (check.status === 'OUTSIDE') {
        // Not approved, not saved as an application: the resident is told where to go, and may correct it.
        await prisma.$transaction(tx => recordResidencyEvent(tx, { residentId: me, kind: 'outside_refused', actorType: 'resident', actorId: me,
          fromStatus: from, toStatus: from, snapshot: { selection: check.selection, destination: check.destination } }));
        return noStore({ success: false, code: 'OUTSIDE_JURISDICTION', error: check.explanation, destination: check.destination, check }, 422);
      }
      if (from === 'PENDING_VERIFICATION' && !changedKeys.length) return noStore({ success: true, data: await view(me), unchanged: true });
    }

    // Unchanged and not submitting: nothing to do.
    if (!d.submit && !changedKeys.length) return noStore({ success: true, data: await view(me), unchanged: true });
    // A verified (or pending) resident who changes the address goes back for verification.
    const to: ResidencyStatus = d.submit ? 'PENDING_VERIFICATION'
      : from === 'VERIFIED' || from === 'PENDING_VERIFICATION' ? 'INCOMPLETE' : from as ResidencyStatus;
    await prisma.$transaction(async tx => {
      await tx.resident.update({ where: { id: me }, data: {
        ...next,
        address: addressLine(next) || r.address,
        addressCheck: JSON.parse(JSON.stringify(check)),
        addressVerificationStatus: check.status,
        residencyStatus: to,
        ...(to !== 'VERIFIED' && { residencyVerifiedAt: null, residencyVerifiedById: null }),
        ...(d.submit && { residencySubmittedAt: new Date(), residencyNote: null, status: 'Pending' }),
      } });
      if (changedKeys.length) {
        await recordResidencyEvent(tx, { residentId: me, kind: 'address_changed', actorType: 'resident', actorId: me, fromStatus: from, toStatus: to,
          snapshot: { changed: changedKeys, before: Object.fromEntries(changedKeys.map(k => [k, k === 'homeLatitude' || k === 'homeLongitude' ? (r[k] === null ? null : 'set') : r[k]])) } });
      }
      if (d.submit) {
        await recordResidencyEvent(tx, { residentId: me, kind: 'submitted', actorType: 'resident', actorId: me, fromStatus: from, toStatus: to,
          snapshot: { status: check.status, selection: check.selection, boundary: check.boundary, flags: check.flags, street: check.street } });
        await tx.activity.create({ data: { type: 'residency_submitted', message: `Residency submitted for verification: ${r.residentNumber}`,
          entityId: me, entityType: 'Resident', color: '#0f766e' } });
      }
    });
    return noStore({ success: true, data: await view(me), status: to }, d.submit ? 201 : 200);
  } catch (e) {
    logRouteError('PUT /api/resident/residency', e);
    return rError('Your address could not be saved right now.', 503);
  }
}
