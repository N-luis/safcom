import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore } from '@/lib/caseRecordsServer';
import { rateLimit } from '@/lib/rateLimit';
import { residencyOf, checkAgainstJurisdiction, RESIDENCY_VERIFIER_ROLES } from '@/lib/jurisdictionServer';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';
import { REFERRAL_KINDS, REFERRAL_STATUSES, type ReferralKind, type ReferralStatus } from '@/lib/jurisdiction';
import { roundCoord } from '@/lib/geo';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * A referral record: what a resident could not file as a standard SafeComm
 * report - the incident is outside the jurisdiction, they are not (yet) a
 * verified resident, or it is an urgent safety concern - kept so it is not
 * silently lost. It is never a case and is never classified or assessed.
 * The Barangay Captain reviews it (/api/residency/referrals) and, where it is
 * the barangay's to act on, has staff take it in through the Walk-in Report.
 *
 * The kind is decided here, never taken from the request: urgent when the
 * resident says so; otherwise "unverified reporter" for an account that is
 * not verified, "outside the jurisdiction" for an incident outside it. A
 * verified resident with an incident inside is told to file the report.
 *
 *   GET  - the resident's own referral records (status only, no review notes)
 *   POST - save one; the answer says where to go and repeats the emergency numbers
 */
const text = (max: number) => z.string().trim().max(max).optional();
const schema = z.object({
  urgent: z.boolean().optional(),
  reportingRelationship: z.string().trim().max(40).optional(),
  province: text(80), municipality: text(80), barangay: text(80), street: text(120), locationDetails: text(300),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  summary: text(2000),
}).strict();

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const rows = await prisma.jurisdictionReferral.findMany({ where: { residentId: auth.resident.residentId }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, kind: true, urgent: true, status: true, barangay: true, municipality: true, createdAt: true } });
  return noStore({ success: true, data: rows.map(r => ({ ...r, kindLabel: REFERRAL_KINDS[r.kind as ReferralKind], statusLabel: REFERRAL_STATUSES[r.status as ReferralStatus] })) });
}

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const me = auth.resident.residentId;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  const d = parsed.data;
  if (!rateLimit(`referral:${me}`, { max: 5, windowMs: 86_400_000 }).allowed) {
    return noStore({ success: false, error: 'You have saved several referral records today. For anything urgent, call the numbers below.', emergencyContacts: EMERGENCY_CONTACTS }, 429);
  }
  try {
    const residency = await residencyOf(me);
    if (!residency) return rError('Resident not found', 404);
    const pin = typeof d.latitude === 'number' && typeof d.longitude === 'number' ? { latitude: roundCoord(d.latitude), longitude: roundCoord(d.longitude) } : null;
    const check = await checkAgainstJurisdiction({ province: d.province, municipality: d.municipality, barangay: d.barangay, street: d.street,
      details: d.locationDetails, latitude: pin?.latitude, longitude: pin?.longitude }, 'incident');
    const kind: ReferralKind | null = d.urgent ? 'URGENT' : !residency.verified ? 'UNVERIFIED_REPORTER' : check.status === 'OUTSIDE' ? 'OUTSIDE_JURISDICTION' : null;
    if (!kind) {
      return noStore({ success: false, code: 'FILE_A_REPORT', error: 'Your account is verified and this location is within SafeComm\'s jurisdiction - file it as a report instead (File a Report).' }, 409);
    }
    const row = await prisma.$transaction(async tx => {
      const r = await tx.jurisdictionReferral.create({ data: {
        residentId: me, kind, urgent: Boolean(d.urgent), reportingRelationship: d.reportingRelationship || null,
        province: d.province || null, municipality: d.municipality || null, barangay: d.barangay || null, street: d.street || null,
        locationDetails: d.locationDetails || null, latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null,
        summary: d.summary || null, locationCheck: JSON.parse(JSON.stringify(check)),
      } });
      // The captain is told a referral is waiting - not what it says.
      const verifiers = await tx.user.findMany({ where: { active: true, role: { in: RESIDENCY_VERIFIER_ROLES } }, select: { id: true } });
      for (const v of verifiers) {
        await tx.notification.create({ data: { userId: v.id, type: d.urgent ? 'warning' : 'info',
          title: d.urgent ? 'Urgent referral received' : 'Referral received',
          message: `${REFERRAL_KINDS[kind]}. Open Resident Verification - Referrals to review it.` } });
      }
      return r;
    });
    const where = check.destination ? [check.destination.barangay, check.destination.municipality, check.destination.province].filter(Boolean).join(', ') : null;
    return noStore({ success: true, data: {
      id: row.id, kind, kindLabel: REFERRAL_KINDS[kind],
      guidance: [
        ...(d.urgent ? ['Kung may agarang panganib, tumawag kaagad sa mga numero sa ibaba. (If anyone is in immediate danger, call the numbers below now.)'] : []),
        where && kind === 'OUTSIDE_JURISDICTION'
          ? `Makipag-ugnayan sa barangay o awtoridad ng ${where}. (Contact the barangay or local authority of ${where}.)`
          : 'Ang barangay ang susuri sa record na ito; hindi pa ito isang SafeComm case. (The barangay reviews this record; it is not a SafeComm case.)',
      ],
      emergencyContacts: EMERGENCY_CONTACTS,
    } }, 201);
  } catch (e) {
    logRouteError('POST /api/resident/referrals', e);
    return noStore({ success: false, error: 'The record could not be saved right now. For anything urgent, call the numbers below.', emergencyContacts: EMERGENCY_CONTACTS }, 503);
  }
}
