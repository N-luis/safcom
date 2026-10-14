import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { CASE_PRIORITY, assessCase, priorityToRiskLevel, type CasePriority } from '@/lib/caseAssessment';
import { isVawcCaseHidden } from '@/lib/caseAccess';

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
  // The summary and reason are drawn from the report's own words, so the
  // assessment is as confidential as the case it belongs to.
  const owner = await prisma.case.findUnique({ where: { id }, select: { caseType: true } });
  if (!owner) return errorResponse('Case not found', 404);
  if (isVawcCaseHidden(auth.user.role, owner.caseType)) return errorResponse('Case not found', 404);

  const assessment = await prisma.caseAssessment.findUnique({
    where: { caseId: id },
    include: { overriddenBy: { select: { id: true, name: true, role: true } } },
  });
  if (!assessment) return errorResponse('No assessment recorded for this case', 404);
  return successResponse(assessment);
}

const overrideSchema = z.object({
  priority: z.enum(CASE_PRIORITY),
  reason: z.string().max(500).optional(),
  /**
   * True when the officer is accepting the assessment as it stands. Confirming
   * and changing are both decisions worth recording, but only a change needs
   * explaining - requiring a reason to agree would just produce "ok" forever.
   */
  confirm: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  // Overruling the assessment on a case you may not read is the same breach
  // as reading it, so the same gate applies to the write.
  const owner = await prisma.case.findUnique({ where: { id }, select: { caseType: true } });
  if (!owner) return errorResponse('Case not found', 404);
  if (isVawcCaseHidden(auth.user.role, owner.caseType)) return errorResponse('Case not found', 404);

  const confirming = parsed.data.confirm === true;
  const reason = (parsed.data.reason ?? '').trim();
  if (!confirming && reason.length < 5) {
    return errorResponse('Give a short reason for the change', 400);
  }

  let existing = await prisma.caseAssessment.findUnique({ where: { caseId: id } });

  // A case filed at the counter never went through the resident flow, so it has
  // no assessment to agree with or overrule. One is produced from the report's
  // own words first, by the same reading the resident flow uses, so the officer
  // decides against a baseline rather than against nothing.
  if (!existing) {
    const full = await prisma.case.findUnique({
      where: { id },
      select: { description: true, caseType: true, residentId: true, residentName: true },
    });
    if (!full) return errorResponse('Case not found', 404);

    const priorSameType = await prisma.case.count({
      where: full.residentId
        ? { residentId: full.residentId, caseType: full.caseType }
        : { residentName: { equals: full.residentName, mode: 'insensitive' }, caseType: full.caseType },
    });
    const baseline = assessCase(full.description ?? '', { priorSameType });

    existing = await prisma.caseAssessment.create({
      data: {
        caseId: id,
        priority: baseline.priority,
        immediateThreat: baseline.factors.immediateThreat,
        incidentSeverity: baseline.factors.incidentSeverity,
        recurrence: baseline.factors.recurrence,
        vulnerability: baseline.factors.vulnerability,
        escalationPotential: baseline.factors.escalationPotential,
        urgency: baseline.factors.urgency,
        summary: baseline.summary,
        reason: baseline.reason,
        detail: JSON.parse(JSON.stringify({
          detectedFactors: baseline.analysis.detectedFactors,
          recommendations: baseline.recommendations,
          missingInformation: baseline.missingInformation,
          assessedAtReview: true,
        })),
      },
    });
  }

  const from = existing.overridePriority ?? existing.priority;
  const note = confirming
    ? (reason || 'Confirmed as assessed.')
    : reason;

  try {
    // One decision, three rows: the assessment, the level the rest of the app
    // reads, and the audit line. Either all of it lands or none does.
    const updated = await prisma.$transaction(async tx => {
      const assessment = await tx.caseAssessment.update({
        where: { caseId: id },
        data: {
          overridePriority: parsed.data.priority,
          overrideReason: note,
          overriddenById: auth.user.userId,
          overriddenAt: new Date(),
        },
        include: { overriddenBy: { select: { id: true, name: true, role: true } } },
      });

      // The case row carries the coarse level the rest of the app reads, so it
      // has to follow the officer's decision rather than the original scoring.
      await tx.case.update({
        where: { id },
        data: { riskLevel: priorityToRiskLevel(parsed.data.priority as CasePriority) },
      });

      const who = assessment.overriddenBy?.name ?? 'an officer';
      await tx.activity.create({
        data: {
          type: confirming ? 'assessment_confirmed' : 'assessment_override',
          message: confirming
            ? `Assessment confirmed at ${parsed.data.priority} by ${who}.`
            : `Case priority changed from ${from} to ${parsed.data.priority} by ${who} — ${note}`,
          entityId: id,
          entityType: 'Case',
          userId: auth.user.userId,
          color: confirming ? '#0f766e' : '#7c3aed',
        },
      });

      return assessment;
    });

    return successResponse(updated);
  } catch {
    return errorResponse('Server error', 500);
  }
}
