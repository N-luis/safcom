import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { computeRisk } from '@/lib/riskEngine';

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
      },
    });
    if (!c) return errorResponse('Case not found', 404);

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
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const existing = await prisma.case.findUnique({ where: { id } });
    if (!existing) return errorResponse('Case not found', 404);

    // Risk level is never set manually — SafComm AI re-analyzes it on every update,
    // factoring in the (possibly new) status/type/location/description, case age,
    // repeat-incident history, and barangay hotspot density, so the flag stays
    // current as the case progresses.
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

    const data = { ...parsed.data, riskLevel: aiRisk.level } as Record<string, unknown>;
    if (parsed.data.resolvedAt) data.resolvedAt = new Date(parsed.data.resolvedAt);

    const updated = await prisma.case.update({ where: { id }, data });

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

    if (aiRisk.level !== existing.riskLevel) {
      await prisma.activity.create({
        data: {
          type: 'case',
          message: `AI re-flagged case ${existing.caseNumber} risk: ${existing.riskLevel} → ${aiRisk.level} (${aiRisk.score}/100)`,
          entityId: id,
          entityType: 'Case',
          userId: auth.user.userId,
          caseId: id,
          color: '#7c3aed',
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
