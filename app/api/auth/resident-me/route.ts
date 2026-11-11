import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';

const RESIDENT_SELECT = {
  id: true, residentNumber: true, firstName: true, lastName: true,
  age: true, gender: true, barangay: true, address: true,
  contactNumber: true, email: true, status: true, riskLevel: true,
  registeredAt: true,
} as const;

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  try {
    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId },
      select: RESIDENT_SELECT,
    });
    if (!resident) return rError('Resident not found', 404);
    return rSuccess(resident);
  } catch {
    return rError('Server error', 500);
  }
}

const patchSchema = z.object({
  contactNumber: z.string().min(7).max(20).optional(),
  address: z.string().min(5).max(300).optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return rError('Invalid JSON', 400); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Invalid data', 400);

  const { contactNumber, address } = parsed.data;
  if (!contactNumber && !address) return rError('Nothing to update', 400);

  try {
    const updated = await prisma.resident.update({
      where: { id: auth.resident.residentId },
      data: {
        ...(contactNumber !== undefined && { contactNumber }),
        ...(address !== undefined && { address }),
      },
      select: RESIDENT_SELECT,
    });
    return rSuccess(updated);
  } catch {
    return rError('Server error', 500);
  }
}
