import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { CASE_PRIORITY, priorityToRiskLevel, type CasePriority } from '@/lib/caseAssessment';

/**
 * The AI-assisted assessment for a case, and the officer's ability to overrule
 * it.
 *
 * The override never erases the original: both are kept, with who changed it,
 * when, and why, so the audit trail shows the assessment as produced and the
 * decision a person took on top of it.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { id } = await ctx.params;
  const assessment = await prisma.caseAssessment.findUnique({
    where: { caseId: id },
    include: { overriddenBy: { select: { id: true, name: true, role: true } } },
  });
  if (!assessment) return errorResponse('No assessment recorded for this case', 404);
  return successResponse(assessment);
}

const overrideSchema = z.object({
  priority: z.enum(CASE_PRIORITY),
  reason: z.string().min(5, 'Give a short reason for the change').max(500),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  const existing = await prisma.caseAssessment.findUnique({ where: { caseId: id } });
  if (!existing) return errorResponse('No assessment recorded for this case', 404);

  try {
    const updated = await prisma.caseAssessment.update({
      where: { caseId: id },
      data: {
        overridePriority: parsed.data.priority,
        overrideReason: parsed.data.reason,
        overriddenById: auth.user.userId,
        overriddenAt: new Date(),
      },
      include: { overriddenBy: { select: { id: true, name: true, role: true } } },
    });

    // The case row carries the coarse level the rest of the app reads, so it
    // has to follow the officer's decision rather than the original scoring.
    await prisma.case.update({
      where: { id },
      data: { riskLevel: priorityToRiskLevel(parsed.data.priority as CasePriority) },
    });

    await prisma.activity.create({
      data: {
        type: 'assessment_override',
        message: `Case priority changed from ${existing.priority} to ${parsed.data.priority} by ${updated.overriddenBy?.name ?? 'an officer'} — ${parsed.data.reason}`,
        entityId: id,
        entityType: 'Case',
        userId: auth.user.userId,
        color: '#7c3aed',
      },
    });

    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}
