import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { canSeeDirectoryContacts } from '@/lib/reporterAccess';
import { recordResidencyEvent } from '@/lib/jurisdictionServer';
import { endAllSessions } from '@/lib/sessions';

/**
 * Who may edit a resident's record here: the captain and the system
 * administrator. Never the residency status - that is set only by the
 * residency decision (/api/residency/applications/:id), and a field that
 * tries is refused.
 */
const EDIT_ROLES = ['admin', 'system_admin'];
const RESIDENCY_FIELDS = ['residencyStatus', 'residencyVerifiedAt', 'residencyVerifiedById', 'residencyNote', 'residencySubmittedAt',
  'homeLatitude', 'homeLongitude', 'addressCheck', 'addressVerificationStatus'];

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
        supabaseUserId: true, clerkId: true, status: true, riskLevel: true,
        notes: true, registeredAt: true, updatedAt: true,
        // Anonymous reports are not listed under the resident who filed them.
        cases: {
          where: { reporterIdentityWithheld: false },
          orderBy: { filedAt: 'desc' },
          take: 10,
          select: {
            id: true, caseNumber: true, caseType: true, status: true,
            riskLevel: true, barangay: true, filedAt: true, resolvedAt: true,
            assignedTo: { select: { name: true, role: true } },
          },
        },
        _count: { select: { cases: { where: { reporterIdentityWithheld: false } } } },
      },
    });
    if (!resident) return errorResponse('Resident not found', 404);

    // Whether a local password exists is useful to an admin, but the hash
    // itself must never leave the server — count instead of selecting it.
    const [localPasswords, openCases, resolvedCases] = await Promise.all([
      prisma.resident.count({ where: { id, password: { not: null } } }),
      prisma.case.count({ where: { residentId: id, reporterIdentityWithheld: false, status: { notIn: ['Resolved', 'Closed'] } } }),
      prisma.case.count({ where: { residentId: id, reporterIdentityWithheld: false, status: { in: ['Resolved', 'Closed'] } } }),
    ]);

    const { supabaseUserId, clerkId, ...rest } = resident;
    // As in the list: contact details for the captain and system admin only.
    const contacts = await canSeeDirectoryContacts(auth.user.userId);
    return successResponse({
      ...rest,
      ...(!contacts && { contactNumber: null, email: null, contactRestricted: true }),
      openCases,
      resolvedCases,
      // Supabase Auth owns the sign-in. An account from before (Clerk, or the old
      // SafeComm password - neither carried over) has none until the resident sets
      // a password with "Forgot password or set up". Which, never an id or a hash.
      signInMethod: supabaseUserId ? 'supabase' : clerkId || localPasswords > 0 ? 'needs_setup' : 'none',
    });
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (!EDIT_ROLES.includes(auth.user.role)) return errorResponse('Only the Barangay Captain or the system administrator can edit resident records.', 403);
  const { id } = await params;

  try {
    const body = await req.json();
    const forbidden = body && typeof body === 'object' ? RESIDENCY_FIELDS.filter(f => f in body) : [];
    if (forbidden.length) return errorResponse(`Residency is decided in Resident Verification, not here: ${forbidden.join(', ')}.`, 403);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const existing = await prisma.resident.findUnique({ where: { id } });
    if (!existing) return errorResponse('Resident not found', 404);

    // An address changed on a verified resident goes back for verification.
    const addressChanged = (parsed.data.barangay !== undefined && parsed.data.barangay !== existing.barangay)
      || (parsed.data.address !== undefined && parsed.data.address !== existing.address);
    const reverify = addressChanged && existing.residencyStatus === 'VERIFIED';
    const updated = await prisma.$transaction(async tx => {
      const u = await tx.resident.update({ where: { id }, data: { ...parsed.data,
        ...(reverify && { residencyStatus: 'PENDING_VERIFICATION', residencyVerifiedAt: null, residencyVerifiedById: null, residencySubmittedAt: new Date() }) },
        select: { id: true, residentNumber: true, firstName: true, lastName: true, age: true, gender: true, barangay: true, address: true,
          contactNumber: true, email: true, status: true, riskLevel: true, notes: true, residencyStatus: true, updatedAt: true } });
      if (addressChanged) {
        await recordResidencyEvent(tx, { residentId: id, kind: 'address_changed', actorType: 'official', actorId: auth.user.userId,
          fromStatus: existing.residencyStatus, toStatus: u.residencyStatus, note: 'Address edited by an official in Resident Management.' });
      }
      return u;
    });
    // An account made inactive or suspended is signed out everywhere at once.
    if (parsed.data.status && ['Inactive', 'Suspended'].includes(parsed.data.status) && existing.status !== parsed.data.status) {
      await endAllSessions('resident', id, 'deactivated');
    }
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
