import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore, reassess, MAX_AI_RERUNS_PER_DAY } from '@/lib/caseRecordsServer';

/**
 * The AI preliminary assessments of one case, and the official one beside
 * them - never the same thing.
 *
 *   GET  - the assessment made at filing, every re-run since (newest first),
 *          and the official assessment: the case's level and the latest
 *          officer decision on it.
 *   POST - re-run the AI assessment on the report as filed, with any new
 *          information an official records. The earlier results are kept;
 *          the case's level is not changed by it.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'ai_assessment');
  if ('error' in g) return g.error;
  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [intake, reruns, decisions, rerunsToday] = await Promise.all([
      prisma.caseIntake.findUnique({
        where: { caseId: id },
        select: {
          createdAt: true, framework: true, matrixLevel: true, matrixLabel: true, assessmentStatus: true,
          informationCompleteness: true, immediateSafetyConcern: true, suggestedCaseCategory: true,
          matchedCriteria: true, missingInformation: true, recommendedNextSteps: true, matrixReferences: true,
          sourceVerified: true, knowledgeBaseStatus: true, assessedBy: true, aiReading: true, urgentReview: true,
        },
      }),
      prisma.assessmentHistory.findMany({
        where: { caseId: id, kind: 'ai_reassessment' }, orderBy: { createdAt: 'desc' }, take: 20,
        include: { actor: { select: { name: true } } },
      }),
      prisma.assessmentHistory.findMany({
        where: { caseId: id, kind: { in: ['officer_confirm', 'officer_override'] } }, orderBy: { createdAt: 'desc' }, take: 1,
        include: { actor: { select: { name: true } } },
      }),
      prisma.assessmentHistory.count({ where: { caseId: id, kind: 'ai_reassessment', createdAt: { gte: dayAgo } } }),
    ]);
    await g.log('permitted', g.access.code);
    const ai = (intake?.aiReading ?? null) as { used?: boolean; model?: string | null; assessment?: unknown } | null;
    return noStore({ success: true, data: {
      canRerun: g.access.edit,
      rerunsToday, rerunLimit: MAX_AI_RERUNS_PER_DAY,
      official: {
        riskLevel: g.c.riskLevel, triageStatus: g.c.triageStatus,
        decision: decisions[0] ? {
          kind: decisions[0].kind, riskLevel: decisions[0].riskLevel, reason: decisions[0].reason,
          by: decisions[0].actor?.name ?? null, at: decisions[0].createdAt,
        } : null,
      },
      atFiling: intake ? {
        at: intake.createdAt, framework: intake.framework, matrixLevel: intake.matrixLevel, matrixLabel: intake.matrixLabel,
        status: intake.assessmentStatus, informationCompleteness: intake.informationCompleteness,
        immediateSafetyConcern: intake.immediateSafetyConcern || Boolean(intake.urgentReview),
        suggestedCategory: intake.suggestedCaseCategory, matchedCriteria: intake.matchedCriteria,
        missingInformation: intake.missingInformation, recommendedNextSteps: intake.recommendedNextSteps,
        references: intake.matrixReferences, sourceVerified: intake.sourceVerified,
        knowledgeBaseStatus: intake.knowledgeBaseStatus, assessedBy: intake.assessedBy,
        ai: ai ? { used: Boolean(ai.used), model: ai.model ?? null, assessment: ai.assessment ?? null } : null,
      } : null,
      reruns: reruns.map(h => {
        const r = h.rationale as Record<string, unknown>;
        return {
          id: h.id, at: h.createdAt, by: h.actor?.name ?? null, reason: h.reason,
          framework: h.framework, matrixLevel: h.matrixLevel, matrixLabel: h.matrixLabel,
          informationCompleteness: h.informationCompleteness, suggestedCategory: h.caseType,
          status: r.status ?? null, triageStatus: r.triageStatus ?? null,
          immediateSafetyConcern: Boolean(r.immediateSafetyConcern),
          matchedCriteria: r.matchedCriteria ?? [], missingInformation: r.missingInformation ?? [],
          recommendedNextSteps: r.recommendedNextSteps ?? [], references: r.references ?? [],
          sourceVerified: r.sourceVerified ?? null, knowledgeBaseStatus: r.knowledgeBaseStatus ?? null,
          assessedBy: r.assessedBy ?? null, ai: r.ai ?? null, newInformation: r.newInformation ?? null,
        };
      }),
    } });
  } catch {
    return errorResponse('The assessments could not be loaded right now.', 503);
  }
}

const postSchema = z.object({
  reason: z.string().trim().min(5, 'Say why it is being re-run - what is new').max(300),
  newInformation: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'ai_assessment');
  if ('error' in g) return g.error;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the request', 400);
  try {
    const recent = await prisma.assessmentHistory.count({
      where: { caseId: id, kind: 'ai_reassessment', createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= MAX_AI_RERUNS_PER_DAY) {
      return errorResponse(`This case has been re-assessed ${recent} times today, the daily limit. Record new information as a follow-up; the next re-run is available tomorrow.`, 429);
    }
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const out = await reassess(g.c, { ...g.actor, name: me?.name ?? null }, parsed.data);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: out }, 201);
  } catch {
    return errorResponse('The assessment could not be re-run right now. Nothing was changed - try again later.', 503);
  }
}
