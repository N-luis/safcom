import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const updateSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.number().int().min(0).optional(),
  gender: z.string().optional(),
  barangay: z.string().optional(),
  address: z.string().optional(),
  contactNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  status: z.string().optional(),
  riskLevel: z.string().optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const resident = await prisma.resident.findUnique({
      where: { id },
      // Explicit select: `include` alone returns every scalar, which sent the
      // bcrypt password hash to the browser.
      select: {
        id: true, residentNumber: true, firstName: true, lastName: true,
        age: true, gender: true, barangay: true, address: true,
        contactNumber: true, email: true, username: true, emailVerified: true,
        clerkId: true, idDocument: true, status: true, riskLevel: true,
        notes: true, registeredAt: true, updatedAt: true,
        cases: {
          orderBy: { filedAt: 'desc' },
          take: 10,
          select: {
            id: true, caseNumber: true, caseType: true, status: true,
            riskLevel: true, barangay: true, filedAt: true, resolvedAt: true,
            assignedTo: { select: { name: true, role: true } },
          },
        },
        _count: { select: { cases: true } },
      },
    });
    if (!resident) return errorResponse('Resident not found', 404);

    // Whether a local password exists is useful to an admin, but the hash
    // itself must never leave the server — count instead of selecting it.
    const [localPasswords, openCases, resolvedCases] = await Promise.all([
      prisma.resident.count({ where: { id, password: { not: null } } }),
      prisma.case.count({ where: { residentId: id, status: { notIn: ['Resolved', 'Closed'] } } }),
      prisma.case.count({ where: { residentId: id, status: { in: ['Resolved', 'Closed'] } } }),
    ]);

    const { clerkId, ...rest } = resident;
    return successResponse({
      ...rest,
      openCases,
      resolvedCases,
      // Clerk owns credentials for accounts created since the migration; older
      // ones still carry a local hash. Report which, never the id or the hash.
      signInMethod: clerkId ? 'clerk' : localPasswords > 0 ? 'password' : 'none',
    });
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const existing = await prisma.resident.findUnique({ where: { id } });
    if (!existing) return errorResponse('Resident not found', 404);

    const updated = await prisma.resident.update({ where: { id }, data: parsed.data });
    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (auth.user.role !== 'admin' && auth.user.role !== 'system_admin') {
    return errorResponse('Forbidden', 403);
  }
  const { id } = await params;

  try {
    const existing = await prisma.resident.findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, email: true, residentNumber: true },
    });
    if (!existing) return errorResponse('Resident not found', 404);

    const linkedCases = await prisma.case.count({ where: { residentId: id } });

    // Detach cases rather than cascade-deleting them: blotter history must
    // survive, but the account (and its email) has to be fully released so the
    // same address can register again.
    const [, tokens] = await prisma.$transaction([
      prisma.case.updateMany({ where: { residentId: id }, data: { residentId: null } }),
      prisma.emailVerificationToken.deleteMany({ where: { residentId: id } }),
      prisma.resident.delete({ where: { id } }),
    ]);

    await prisma.activity.create({
      data: {
        type: 'resident_deleted',
        message: `Resident account ${existing.firstName} ${existing.lastName} (${existing.residentNumber}) was deleted${linkedCases ? ` — ${linkedCases} case(s) kept and unlinked` : ''}`,
        entityId: id,
        entityType: 'Resident',
        userId: auth.user.userId,
        color: '#ef4444',
      },
    });

    return successResponse({
      deleted: true,
      email: existing.email,
      casesUnlinked: linkedCases,
      tokensRemoved: tokens.count,
    });
  } catch (err) {
    console.error('[Delete Resident]', err);
    return errorResponse('Server error', 500);
  }
}
