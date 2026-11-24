import { NextRequest } from 'next/server';
import { z } from 'zod';
import { normalizePhMobileStrict, PH_MOBILE_HINT } from '@/lib/phoneNumber';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { RESIDENCY_STATUSES, addressLine, type ResidencyStatus } from '@/lib/jurisdiction';

const RESIDENT_SELECT = {
  id: true, residentNumber: true, firstName: true, lastName: true,
  age: true, gender: true, barangay: true, address: true,
  contactNumber: true, email: true, status: true, riskLevel: true,
  registeredAt: true, birthDate: true,
  province: true, municipality: true, street: true, houseNumber: true, purok: true,
  residencyStatus: true, residencyVerifiedAt: true, residencyNote: true,
} as const;

/** The portal reads the residency from here, fresh: it opens fully only for a verified resident. */
const withResidency = <T extends { residencyStatus: string; houseNumber: string | null; street: string | null; purok: string | null; barangay: string; municipality: string | null; province: string | null; address: string }>(r: T) => ({
  ...r, residencyStatusLabel: RESIDENCY_STATUSES[r.residencyStatus as ResidencyStatus] ?? r.residencyStatus,
  verifiedResident: r.residencyStatus === 'VERIFIED', addressLine: addressLine(r) || r.address,
});

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  try {
    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId },
      select: RESIDENT_SELECT,
    });
    if (!resident) return rError('Resident not found', 404);
    return rSuccess(withResidency(resident));
  } catch {
    return rError('Server error', 500);
  }
}

// The contact number only. The residential address is changed through Residency
// (/api/resident/residency), which checks it and sends it back for verification.
// A Philippine mobile number in any spelling, stored the standard way: "+639XXXXXXXXX".
const patchSchema = z.object({
  contactNumber: z.string().trim().max(24).transform((v, ctx) => {
    const n = normalizePhMobileStrict(v);
    if (!n) { ctx.addIssue({ code: 'custom', message: `Contact number: ${PH_MOBILE_HINT}` }); return z.NEVER; }
    return n;
  }).optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return rError('Invalid JSON', 400); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Invalid data', 400);

  if (body && typeof body === 'object' && 'address' in body) {
    return rError('Change your residential address under Residency - a new address is checked and verified again.', 400);
  }
  const { contactNumber } = parsed.data;
  if (!contactNumber) return rError('Nothing to update', 400);

  try {
    const updated = await prisma.resident.update({
      where: { id: auth.resident.residentId },
      data: { contactNumber },
      select: RESIDENT_SELECT,
    });
    return rSuccess(withResidency(updated));
  } catch {
    return rError('Server error', 500);
  }
}
