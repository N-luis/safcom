import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { canSeeVawc, isVawcCaseHidden } from '@/lib/caseAccess';
import { categoryByName } from '@/lib/classificationSchema';

/**
 * An officer confirms or changes a case's category.
 *
 * The category the intake suggested is preliminary; this is where a person
 * decides. Every decision is a new AssessmentHistory row - who, when, what it
 * was before, what it is now, and why - and the original suggestion stays on
 * the intake record untouched.
 *
 * Moving a case between desks is allowed in both directions, because that is
 * how a misrouted report reaches the right officer: a blotter officer can
 * refer a case to the VAWC desk (and then no longer sees it), and the VAWC
 * desk can send one back.
 */
const schema = z.object({
  caseType: z.string().min(1).max(120),
  confirm: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  const current = await prisma.case.findUnique({
    where: { id },
    select: { caseType: true, caseNumber: true, riskLevel: true, informationCompleteness: true },
  });
  // Deciding about a case you may not read is the same breach as reading it.
  if (!current || isVawcCaseHidden(auth.user.role, current.caseType)) return errorResponse('Case not found', 404);

  const target = categoryByName(parsed.data.caseType);
  if (!target) return errorResponse('That is not a category in the classification matrix', 400);

  const confirming = parsed.data.confirm === true;
  const reason = (parsed.data.reason ?? '').trim();
  if (confirming && target.category !== current.caseType) {
    return errorResponse('Confirming keeps the current category; to change it, give a reason', 400);
  }
  if (!confirming) {
    if (target.category === current.caseType) return errorResponse('That is already the category', 400);
    if (reason.length < 5) return errorResponse('Give a short reason for the change', 400);
  }

  const referredAway = !confirming && isVawcCaseHidden(auth.user.role, target.category);

  try {
    await prisma.$transaction(async tx => {
      await tx.case.update({
        where: { id },
        data: { caseType: target.category, requiresOfficerReview: false },
      });
      await tx.assessmentHistory.create({
        data: {
          caseId: id,
          kind: confirming ? 'category_confirm' : 'category_change',
          riskLevel: current.riskLevel,
          informationCompleteness: current.informationCompleteness,
          caseType: target.category,
          previousCaseType: current.caseType,
          rationale: { desk: target.desk },
          actorId: auth.user.userId,
          reason: reason || null,
        },
      });
      await tx.activity.create({
        data: {
          type: confirming ? 'category_confirmed' : 'category_changed',
          // The category names only - never the narrative.
          message: confirming
            ? `Case ${current.caseNumber}: category confirmed as ${target.category}.`
            : `Case ${current.caseNumber}: category changed from ${current.caseType} to ${target.category}.`,
          entityId: id, entityType: 'Case', caseId: id, userId: auth.user.userId,
          color: target.desk === 'VAWC' ? '#7c3aed' : '#0f766e',
        },
      });
      // A case handed to the other desk is announced there - the feed shows a
      // VAWC case only to the VAWC desk, so naming it here leaks nothing.
      if (!confirming && (target.desk === 'VAWC') !== (current.caseType && categoryByName(current.caseType)?.desk === 'VAWC')) {
        await tx.notification.create({
          data: {
            title: `Case ${current.caseNumber} referred to the ${target.desk === 'VAWC' ? 'VAWC desk' : 'blotter desk'}`,
            message: `Reclassified as ${target.category}. Open the case to review it.`,
            type: 'warning', userId: null, caseId: id,
          },
        });
      }
    });

    return successResponse({
      caseType: target.category,
      desk: target.desk,
      // The officer who referred it no longer has access; the page needs to know.
      referredAway,
      stillVisible: !referredAway && (canSeeVawc(auth.user.role) || target.desk === 'Blotter'),
    });
  } catch {
    return errorResponse('Server error', 500);
  }
}
