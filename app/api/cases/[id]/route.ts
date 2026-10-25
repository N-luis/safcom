import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { isVawcCaseHidden } from '@/lib/caseAccess';
import { computeRisk } from '@/lib/riskEngine';
import { checkAssignmentChange } from '@/lib/reporterAccess';

const updateSchema = z.object({
  residentName: z.string().optional(),
  caseType: z.string().optional(),
  status: z.string().optional(),
  barangay: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  residentId: z.string().optional().nullable(),
  resolvedAt: z.string().optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const c = await prisma.case.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
        resident: { select: { id: true, firstName: true, lastName: true } },
        activities: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true } } },
        },
        followUps: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, role: true } } },
        },
        // `select` on purpose: including the row would carry every photo's
        // bytes in the case detail response.
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
        },
        // What the resident told the assisted intake, and every assessment
        // the case has had, so an officer sees the trail and not just a level.
        intake: true,
        // The official intake's state only - never its answers, which are
        // served (and logged) by /official-intake to those allowed to see them.
        officialIntake: { select: { id: true, status: true, version: true, updatedAt: true, completedAt: true } },
        assessmentHistory: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { name: true, role: true } } },
        },
      },
    });
    if (!c) return errorResponse('Case not found', 404);
    // Not found, rather than forbidden: confirming a VAWC case exists at this
    // id tells someone without access more than they should have.
    if (isVawcCaseHidden(auth.user.role, c.caseType)) return errorResponse('Case not found', 404);
    // An anonymous report keeps its reporter out of the response entirely.
    if (c.reporterIdentityWithheld) Object.assign(c, { resident: null, residentId: null });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [barangayCaseCount, residentPriorCases] = await Promise.all([
      prisma.case.count({ where: { barangay: c.barangay, filedAt: { gte: thirtyDaysAgo }, NOT: { id } } }),
      c.residentId
        ? prisma.case.count({ where: { residentId: c.residentId, NOT: { id } } })
        : prisma.case.count({ where: { residentName: { equals: c.residentName, mode: 'insensitive' }, NOT: { id } } }),
    ]);
    const aiRiskAssessment = computeRisk({
      caseType: c.caseType, barangay: c.barangay, description: c.description,
      filedAt: c.filedAt, residentId: c.residentId, status: c.status,
      barangayCaseCount, residentPriorCases,
    });

    return successResponse({ ...c, aiRiskAssessment });
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
    // The level and the triage status change only through the assessment
    // review, which records who decided and why - not through a general edit.
    if (body && typeof body === 'object' && ['riskLevel', 'triageStatus'].some(f => f in body)) {
      return errorResponse('Risk level and triage status are set through the assessment review', 400);
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const existing = await prisma.case.findUnique({ where: { id } });
    if (!existing) return errorResponse('Case not found', 404);
    if (isVawcCaseHidden(auth.user.role, existing.caseType)) return errorResponse('Case not found', 404);
    // A case may not be edited into or out of the VAWC desk's hands by someone
    // who cannot see it there.
    if (parsed.data.caseType && isVawcCaseHidden(auth.user.role, parsed.data.caseType)) {
      return errorResponse('This case type is handled by the VAWC desk', 403);
    }
    // Assignment decides who may see the reporter's contact details, so it is
    // checked like that access: on the server, against the official's account.
    if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== existing.assignedToId) {
      const refused = await checkAssignmentChange(auth.user.userId,
        { caseType: parsed.data.caseType ?? existing.caseType, assignedToId: existing.assignedToId }, parsed.data.assignedToId);
      if (refused) return errorResponse(refused.message, refused.status);
    }

    // The stored level is NOT recomputed here. It used to be: every status or
    // notes change re-ran the category-weighted engine and wrote its answer
    // over riskLevel - replacing the grounded preliminary level and silently
    // erasing any level an officer had set. A level now changes only through
    // the assessment review, which records who changed it and why.
    const merged = { ...existing, ...parsed.data };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [barangayCaseCount, residentCount] = await Promise.all([
      prisma.case.count({ where: { barangay: merged.barangay, filedAt: { gte: thirtyDaysAgo } } }),
      merged.residentId
        ? prisma.case.count({ where: { residentId: merged.residentId } })
        : prisma.case.count({ where: { residentName: { equals: merged.residentName, mode: 'insensitive' } } }),
    ]);
    const aiRisk = computeRisk({
      caseType: merged.caseType, barangay: merged.barangay, description: merged.description, filedAt: existing.filedAt,
      residentId: merged.residentId ?? null, status: merged.status,
      barangayCaseCount, residentPriorCases: Math.max(0, residentCount - 1),
    });

    const data = { ...parsed.data } as Record<string, unknown>;
    if (parsed.data.resolvedAt) data.resolvedAt = new Date(parsed.data.resolvedAt);

    const updated = await prisma.case.update({ where: { id }, data });

    // Assignment decides who may see the reporter's contact details, so every
    // change of hands is on the case's record.
    if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== existing.assignedToId) {
      const to = parsed.data.assignedToId
        ? await prisma.user.findUnique({ where: { id: parsed.data.assignedToId }, select: { name: true } })
        : null;
      await prisma.activity.create({
        data: {
          type: 'assignment',
          message: to ? `Case ${existing.caseNumber} assigned to ${to.name}` : `Case ${existing.caseNumber} unassigned`,
          entityId: id, entityType: 'Case', userId: auth.user.userId, caseId: id, color: '#0ea5e9',
        },
      });
    }

    if (parsed.data.status && parsed.data.status !== existing.status) {
      await prisma.activity.create({
        data: {
          type: 'case',
          message: `Case ${existing.caseNumber} status changed to ${parsed.data.status}`,
          entityId: id,
          entityType: 'Case',
          userId: auth.user.userId,
          caseId: id,
          color: '#f59e0b',
        },
      });
    }

    return successResponse({ ...updated, aiRiskAssessment: aiRisk });
  } catch {
    return errorResponse('Server error', 500);
  }
}

// Officer "Update Case" UI saves partial changes (status and/or notes) via PATCH
export const PATCH = PUT;

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (auth.user.role !== 'admin') return errorResponse('Forbidden', 403);
  const { id } = await params;

  try {
    const existing = await prisma.case.findUnique({ where: { id } });
    if (!existing) return errorResponse('Case not found', 404);

    await prisma.activity.deleteMany({ where: { caseId: id } });
    await prisma.case.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch {
    return errorResponse('Server error', 500);
  }
}
