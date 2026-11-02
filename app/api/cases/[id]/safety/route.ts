import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore, raiseUrgent } from '@/lib/caseRecordsServer';
import { safetyAssessmentSchema, safetyIsUrgent } from '@/lib/caseRecords';

/**
 * The officer's initial safety assessment - officer-only.
 *
 * PUT saves it, naming the version it was based on: a stale save is refused
 * (409), never merged. Each save is also kept whole in AssessmentHistory, so
 * an earlier answer stays on record.
 *
 * "Immediate safety concern" or "urgent assistance required" starts the
 * urgent-response workflow at once - the case goes to urgent review and the
 * desks are notified. It does not wait for, or depend on, any AI result.
 */

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'safety');
  if ('error' in g) return g.error;
  const parsed = safetyAssessmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Answer each question - "Not known" is an answer', 400);
  const { expectedVersion, followUpAt, ...answers } = parsed.data;

  try {
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const result = await prisma.$transaction(async tx => {
      const current = await tx.caseSafetyAssessment.findUnique({ where: { caseId: id } });
      if ((current?.version ?? 0) !== expectedVersion) throw new Error('version_conflict');
      const data = {
        ...answers,
        additionalConcerns: answers.additionalConcerns ?? null,
        initialAction: answers.initialAction ?? null,
        assistanceProvided: answers.assistanceProvided ?? null,
        protectionActions: answers.protectionActions ?? null,
        followUpAt: followUpAt ? new Date(followUpAt) : null,
        updatedById: g.actor.id,
      };
      const saved = current
        ? await tx.caseSafetyAssessment.update({ where: { caseId: id }, data: { ...data, version: current.version + 1 } })
        : await tx.caseSafetyAssessment.create({ data: { ...data, caseId: id, version: 1 } });
      await tx.assessmentHistory.create({ data: {
        caseId: id, kind: 'safety_assessment', riskLevel: null, actorId: g.actor.id,
        reason: `Safety assessment version ${saved.version}`,
        rationale: JSON.parse(JSON.stringify({ ...data, version: saved.version })),
      } });
      await tx.activity.create({ data: {
        type: 'safety_assessment',
        message: `Safety assessment ${current ? 'updated' : 'recorded'} by ${me?.name ?? 'an official'}`,
        entityId: id, entityType: 'Case', userId: g.actor.id, caseId: id, color: '#b45309',
      } });
      const urgent = safetyIsUrgent(answers)
        ? await raiseUrgent(tx, g.c, { id: g.actor.id, name: me?.name ?? null },
          answers.immediateConcern === 'yes' ? 'An immediate safety concern was recorded' : 'Urgent assistance was recorded as required')
        : false;
      return { saved, urgent };
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: { safety: result.saved, flaggedUrgent: result.urgent } });
  } catch (e) {
    if (e instanceof Error && e.message === 'version_conflict') {
      return noStore({ success: false, error: 'Someone else saved this assessment meanwhile. Reload to see theirs before saving yours.', code: 'version_conflict' }, 409);
    }
    return errorResponse('The safety assessment could not be saved right now. Your answers are still on your screen - try again.', 503);
  }
}
