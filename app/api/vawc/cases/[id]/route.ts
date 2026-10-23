import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { canSeeVawc } from '@/lib/caseAccess';
import { computeRisk } from '@/lib/riskEngine';

const updateSchema = z.object({
  status: z.enum(['Open', 'In Progress', 'Resolved', 'Closed']).optional(),
  notes: z.string().optional(),
  description: z.string().min(5).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth(_req);
  if ('status' in auth) return auth;

  // The VAWC desk, the captain and the system administrator - nobody else.
  // These endpoints sit outside the /vawc prefix the proxy gates by role, so
  // without this a blotter officer's own session read every survivor
  // narrative straight from the API. 404 rather than 403: whether a VAWC case
  // exists is itself part of what is being kept.
  if (!canSeeVawc(auth.user.role)) return errorResponse('Not found', 404);

  try {
    const c = await prisma.case.findFirst({
      where: { id, caseType: { in: [...VAWC_TYPES] } },
      include: { assignedTo: { select: { name: true, email: true } }, activities: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    if (!c) return errorResponse('Case not found', 404);
    return successResponse(c);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  // The VAWC desk, the captain and the system administrator - nobody else.
  // These endpoints sit outside the /vawc prefix the proxy gates by role, so
  // without this a blotter officer's own session read every survivor
  // narrative straight from the API. 404 rather than 403: whether a VAWC case
  // exists is itself part of what is being kept.
  if (!canSeeVawc(auth.user.role)) return errorResponse('Not found', 404);

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  try {
    const existing = await prisma.case.findFirst({ where: { id, caseType: { in: [...VAWC_TYPES] } } });
    if (!existing) return errorResponse('Case not found', 404);

    // The stored level is NOT recomputed here. It used to be: every status or
    // notes change re-ran the category-weighted engine and wrote its answer
    // over riskLevel - replacing the grounded preliminary level and silently
    // erasing any level an officer had set. A level now changes only through
    // the assessment review, which records who changed it and why.
    const status = parsed.data.status ?? existing.status;
    const description = parsed.data.description ?? existing.description;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [barangayCaseCount, residentCount] = await Promise.all([
      prisma.case.count({ where: { barangay: existing.barangay, filedAt: { gte: thirtyDaysAgo } } }),
      prisma.case.count({ where: { residentName: { equals: existing.residentName, mode: 'insensitive' } } }),
    ]);
    const aiRisk = computeRisk({
      caseType: existing.caseType, barangay: existing.barangay, description, filedAt: existing.filedAt,
      residentId: existing.residentId, status,
      barangayCaseCount, residentPriorCases: Math.max(0, residentCount - 1),
    });

    const isNowResolved = ['Resolved', 'Closed'].includes(status);
    const wasResolved = ['Resolved', 'Closed'].includes(existing.status);

    const updated = await prisma.case.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(isNowResolved && !wasResolved && { resolvedAt: new Date() }),
        ...(!isNowResolved && wasResolved && { resolvedAt: null }),
      },
    });

    if (parsed.data.status && parsed.data.status !== existing.status) {
      await prisma.activity.create({
        data: {
          type: 'vawc_status_changed',
          message: `VAWC case ${existing.caseNumber} status: ${existing.status} → ${parsed.data.status}`,
          entityId: id, entityType: 'Case',
          caseId: id, userId: auth.user.userId,
          color: parsed.data.status === 'Resolved' ? '#22c55e' : '#7c3aed',
        },
      });
    }

    return successResponse({ ...updated, aiRiskAssessment: aiRisk });
  } catch {
    return errorResponse('Server error', 500);
  }
}
