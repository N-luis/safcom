import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/auth';
import { sendAuthEmail } from '@/lib/email';
import { siteOrigin } from '@/lib/siteUrl';
import { missingRequired, checkDatabase } from '@/lib/configCheck';
import { GENDER_OPTIONS, GENDER_UNDISCLOSED } from '@/lib/safecommConfig';
import { checkAgainstJurisdiction, recordResidencyEvent, registrationAddressRefusal } from '@/lib/jurisdictionServer';
import { addressLine } from '@/lib/jurisdiction';
import { roundCoord } from '@/lib/geo';
import { rateLimit } from '@/lib/rateLimit';
import { normalizePhMobileStrict, PH_MOBILE_HINT } from '@/lib/phoneNumber';
import { supabaseAuthMissing, createUserWithConfirmLink, deleteAuthUser, authLink, passwordProblem, AuthError } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

/**
 * Resident registration - everything in one step: the account (email and
 * password, kept by Supabase Auth), the person, the residential address part
 * by part, and the home location on the map.
 *
 * The server decides, from what was sent:
 *   - an address outside Barangay Biñang 2nd, Bocaue, Bulacan is refused with
 *     where to go instead - nothing is created;
 *   - an incomplete address is refused with what is missing;
 *   - otherwise the account is created and the residency goes to an official
 *     (Pending Verification). It is never verified here: a map pin or a
 *     dropdown is not proof of residence. A pin that disagrees with the
 *     address, or no pin at all, is flagged for the official.
 * The email must be confirmed (the link SafeComm sends) before signing in.
 */

/** Age in whole years on the Philippine calendar day, from a YYYY-MM-DD birth date. */
function ageFrom(birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const today = new Date(Date.now() + 8 * 3_600_000);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age -= 1;
  return age;
}

/** Fields only the server or an official sets: a request carrying any of them is refused, not quietly stripped. */
const SERVER_ONLY = ['residencyStatus', 'residencyVerifiedAt', 'residencyVerifiedById', 'residencyNote', 'residencySubmittedAt', 'addressCheck',
  'addressVerificationStatus', 'status', 'verified', 'role', 'supabaseUserId', 'clerkId', 'emailVerified', 'residentNumber'];

/**
 * A Philippine mobile number, in whatever spelling was sent (+63 917..., 0917..., 917-...),
 * stored the standard way: "+639XXXXXXXXX". Anything else is refused.
 */
const mobile = (label: string) => z.string().trim().max(24).transform((v, ctx) => {
  const n = normalizePhMobileStrict(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: `${label}: ${PH_MOBILE_HINT}` }); return z.NEVER; }
  return n;
});
const registerSchema = z.object({
  // Account
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().max(72),
  confirmPassword: z.string().max(72),
  // Person
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters').max(80),
  lastName: z.string().trim().min(2, 'Last name must be at least 2 characters').max(80),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth').refine(v => { const a = ageFrom(v); return a >= 1 && a <= 120; }, 'Enter a valid date of birth'),
  gender: z.enum(GENDER_OPTIONS).optional().or(z.literal('')),
  contactNumber: mobile('Contact number'),
  altContactNumber: mobile('Alternative contact number').optional().or(z.literal('')),
  // The residential address, part by part
  province: z.string().trim().min(2, 'Choose your province').max(80),
  municipality: z.string().trim().min(2, 'Choose your municipality or city').max(80),
  barangay: z.string().trim().min(2, 'Choose your barangay').max(80),
  street: z.string().trim().min(2, 'Enter your street').max(120),
  houseNumber: z.string().trim().min(1, 'Enter your house or building number').max(40),
  purok: z.string().trim().max(80).optional().or(z.literal('')),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'A postal code is 4 digits').optional().or(z.literal('')),
  // The home location
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  /** How the pin was placed. NONE: no location - an official verifies from the address. */
  locationSource: z.enum(['MAP', 'SEARCH', 'DEVICE', 'NONE']),
}).strict();

/** Next unissued resident number for the current year. */
async function nextResidentNumber(): Promise<string> {
  const prefix = `RES-${new Date().getFullYear()}-`;
  const latest = await prisma.resident.findFirst({ where: { residentNumber: { startsWith: prefix } }, orderBy: { residentNumber: 'desc' }, select: { residentNumber: true } });
  const highest = latest ? Number(latest.residentNumber.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(highest) ? highest : 0) + 1).padStart(5, '0')}`;
}

const isUnique = (err: unknown, field: string) => {
  const e = err as { code?: string; meta?: { target?: string[] | string } };
  return e?.code === 'P2002' && String(Array.isArray(e.meta?.target) ? e.meta.target.join(',') : e.meta?.target ?? '').includes(field);
};

export async function POST(req: NextRequest) {
  const misconfigured = missingRequired();
  if (misconfigured) return errorResponse(misconfigured, 503);
  const authMissing = supabaseAuthMissing();
  if (authMissing) return errorResponse(`Resident registration is not configured on this server yet (${authMissing.join(', ')} missing).`, 503);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!rateLimit(`register:${ip}`, { max: 20, windowMs: 3_600_000 }).allowed) return errorResponse('Too many registrations from this connection - try again later.', 429);

  const body = await req.json().catch(() => null);
  const forbidden = body && typeof body === 'object' ? SERVER_ONLY.filter(f => f in body) : [];
  if (forbidden.length) return errorResponse(`Only an authorised barangay official can set: ${forbidden.join(', ')}.`, 403);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the form', 400);
  const d = parsed.data;
  const weak = passwordProblem(d.password);
  if (weak) return Response.json({ success: false, code: 'WEAK_PASSWORD', error: weak }, { status: 400 });
  if (d.password !== d.confirmPassword) return Response.json({ success: false, code: 'PASSWORD_MISMATCH', error: 'The passwords do not match' }, { status: 400 });

  const pin = d.locationSource !== 'NONE' && typeof d.latitude === 'number' && typeof d.longitude === 'number'
    ? { lat: roundCoord(d.latitude), lng: roundCoord(d.longitude) } : null;
  if (d.locationSource !== 'NONE' && !pin) return errorResponse('Place your home on the map, or choose to be verified from the address alone.', 400);
  const place = { province: d.province, municipality: d.municipality, barangay: d.barangay, street: d.street, houseNumber: d.houseNumber, purok: d.purok || undefined };

  let createdUser: string | null = null;
  try {
    // The address first: outside the jurisdiction or incomplete, nothing is created.
    const refusal = await registrationAddressRefusal(place);
    if (refusal) return Response.json(refusal.body, { status: refusal.status });
    const check = await checkAgainstJurisdiction({ ...place, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null }, 'residence');
    if (check.status === 'OUTSIDE') return Response.json({ success: false, code: 'OUTSIDE_JURISDICTION', error: check.explanation, destination: check.destination }, { status: 422 });

    const existing = await prisma.resident.findFirst({ where: { email: { equals: d.email, mode: 'insensitive' } }, select: { id: true } });
    if (existing) {
      return Response.json({ success: false, code: 'EMAIL_TAKEN', error: 'An account with this email already exists. Sign in - or, if it was made before the new sign-in, set up your password.' }, { status: 409 });
    }

    // The sign-in, with Supabase Auth: it hashes the password; SafeComm never sees it again.
    const { userId, tokenHash } = await createUserWithConfirmLink(d.email, d.password);
    createdUser = userId;

    const now = new Date();
    let resident: { id: string; residentNumber: string; firstName: string; lastName: string } | null = null;
    let number = await nextResidentNumber();
    for (let attempt = 0; !resident; attempt++) {
      try {
        resident = await prisma.$transaction(async tx => {
          const r = await tx.resident.create({
            data: {
              residentNumber: number, firstName: d.firstName, lastName: d.lastName, age: ageFrom(d.birthDate), gender: d.gender || GENDER_UNDISCLOSED,
              birthDate: new Date(`${d.birthDate}T00:00:00Z`),
              email: d.email, contactNumber: d.contactNumber, altContactNumber: d.altContactNumber || null,
              supabaseUserId: userId, emailVerified: false,
              province: d.province, municipality: d.municipality, barangay: d.barangay, street: d.street, houseNumber: d.houseNumber,
              purok: d.purok || null, postalCode: d.postalCode || null, address: addressLine(place),
              homeLatitude: pin?.lat ?? null, homeLongitude: pin?.lng ?? null, homeLocationSource: pin ? d.locationSource : 'NONE',
              addressCheck: JSON.parse(JSON.stringify(check)), addressVerificationStatus: check.status,
              // Submitted with the registration; only an official verifies it.
              residencyStatus: 'PENDING_VERIFICATION', residencySubmittedAt: now, status: 'Pending', riskLevel: 'Low',
            },
            select: { id: true, residentNumber: true, firstName: true, lastName: true },
          });
          await recordResidencyEvent(tx, { residentId: r.id, kind: 'registered', actorType: 'resident', actorId: r.id, toStatus: 'INCOMPLETE',
            note: 'Registered with the residential address and the home location.' });
          await recordResidencyEvent(tx, { residentId: r.id, kind: 'submitted', actorType: 'resident', actorId: r.id, fromStatus: 'INCOMPLETE', toStatus: 'PENDING_VERIFICATION',
            snapshot: { status: check.status, selection: check.selection, boundary: check.boundary, flags: check.flags, street: check.street } });
          await tx.activity.create({ data: { type: 'resident_registered', message: `New resident registered: ${r.firstName} ${r.lastName} (${r.residentNumber}) - residency awaiting verification`,
            entityId: r.id, entityType: 'Resident', color: '#14b8a6' } });
          return r;
        });
      } catch (err) {
        if (isUnique(err, 'residentNumber') && attempt < 5) { number = await nextResidentNumber(); continue; }
        if (isUnique(err, 'email')) return Response.json({ success: false, code: 'EMAIL_TAKEN', error: 'An account with this email already exists.' }, { status: 409 });
        throw err;
      }
    }
    createdUser = null;   // kept: the profile is saved

    // The confirmation link: SafeComm's own page, sent by SafeComm's mailer. A mail failure never undoes the account.
    const send = await sendAuthEmail('confirm', d.email, `${d.firstName} ${d.lastName}`, authLink(siteOrigin(req.nextUrl.origin), 'signup', tokenHash));
    return successResponse({
      residentNumber: resident.residentNumber, name: `${resident.firstName} ${resident.lastName}`, email: d.email,
      residencyStatus: 'PENDING_VERIFICATION', check: { status: check.status, flags: check.flags, boundary: check.boundary, explanation: check.explanation },
      emailSent: send.ok, emailReason: send.reason, emailDetail: send.detail,
    }, 201);
  } catch (err) {
    if (createdUser) await deleteAuthUser(createdUser);   // no sign-in left without a profile
    if (err instanceof AuthError) return Response.json({ success: false, code: err.code, error: err.message }, { status: err.status });
    console.error('[Resident register]', err instanceof Error ? err.message : 'failed');
    const db = await checkDatabase();
    if (!db.ok) return errorResponse(`Cannot reach the database (${db.reason}).`, 503);
    return errorResponse('Your registration could not be saved. Please try again.', 500);
  }
}
