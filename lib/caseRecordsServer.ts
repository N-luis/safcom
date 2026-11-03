/**
 * Server side of the case records: who may read or change them, the urgent
 * workflow they can start, and re-running the AI assessment.
 *
 * Every route here re-reads the official's account and the case on each
 * request, decides access with the same rule as the official intake
 * (lib/officialIntake.ts - the assigned desk officer acts; oversight views;
 * a VAWC case is "not found" to anyone outside the VAWC desk and the
 * captain), and logs each look and each refusal. Nothing logged carries an
 * answer, a name or a narrative.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { requireAuth, errorResponse } from './auth';
import { loadActor, type Actor } from './reporterAccess';
import { decideIntakeAccess, type IntakeAccess } from './officialIntake';
import { runIntake, answersFromTranscript, turnsSchema } from './intakeServer';
import { triageStatusFor } from './intake';

export const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

/** What a case-records route needs about the case. */
export async function loadRecordsCase(caseId: string) {
  return prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, triageStatus: true,
      assignedToId: true, residentId: true, reportPath: true, reportingChannel: true,
      incidentDate: true, incidentTimeApprox: true, witnessInfo: true, filedAt: true,
      resolutionType: true, resolutionSummary: true, resolvedById: true, resolvedAt: true,
      reportingRelationship: true, affectedPersonNote: true, reporterIdentityWithheld: true,
    },
  });
}
export type RecordsCase = NonNullable<Awaited<ReturnType<typeof loadRecordsCase>>>;

export type Gate =
  | { error: Response }
  | { actor: Actor; c: RecordsCase; access: IntakeAccess; log: (outcome: 'permitted' | 'denied', code: string) => Promise<void> };

/**
 * May this official see (or change) this case's records? `field` names what
 * the access log records - e.g. 'case_records', 'safety', 'referrals', 'ai_assessment'.
 */
export async function gateCaseRecords(req: NextRequest, caseId: string, need: 'view' | 'edit', field: string): Promise<Gate> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor) return { error: errorResponse('Unauthorized', 401) };
  let c: RecordsCase | null;
  try {
    c = await loadRecordsCase(caseId);
  } catch {
    return { error: errorResponse('The case could not be loaded right now. Nothing was changed.', 503) };
  }
  const log = (outcome: 'permitted' | 'denied', code: string) => prisma.reporterAccessLog.create({
    data: { actorId: actor.id, actorRole: actor.role, caseId: caseId.slice(0, 64), caseNumber: c?.caseNumber ?? null,
      fields: [field], outcome, code: need === 'edit' ? `${code}:edit` : code },
  }).then(() => undefined).catch(() => undefined);
  if (!c) { await log('denied', 'not_found'); return { error: errorResponse('Case not found', 404) }; }
  const access = decideIntakeAccess(actor, c);
  // Same answer as the case page: a VAWC case outside this role does not exist.
  if (access.hidden) { await log('denied', access.code); return { error: errorResponse('Case not found', 404) }; }
  if (!access.view || (need === 'edit' && !access.edit)) {
    await log('denied', access.code);
    const message = access.code === 'not_assigned'
      ? 'Only the officer assigned to this case can do this. Take the case first if it is unassigned.'
      : access.code === 'oversight'
        ? 'You can view this VAWC case. Recording on it is for the officer it is assigned to.'
        : access.message ?? 'Not permitted';
    return { error: noStore({ success: false, error: message, code: access.code, canClaim: access.canClaim }, 403) };
  }
  return { actor, c, access, log };
}

/**
 * Raise a case to urgent review - the configured urgent-response workflow -
 * from inside a transaction. Independent of the risk level: an immediate
 * danger is urgent whatever the matrix says, and whether or not the AI ran.
 * Returns false when the case was already there.
 */
export async function raiseUrgent(tx: Prisma.TransactionClient, c: { id: string; caseNumber: string; triageStatus: string | null },
  by: { id: string; name: string | null }, why: string): Promise<boolean> {
  if (c.triageStatus === 'URGENT_REVIEW') return false;
  await tx.case.update({ where: { id: c.id }, data: { triageStatus: 'URGENT_REVIEW', requiresOfficerReview: true } });
  await tx.activity.create({ data: {
    type: 'urgent', message: `${why} - flagged for urgent review by ${by.name ?? 'an official'}`,
    entityId: c.id, entityType: 'Case', userId: by.id, caseId: c.id, color: '#dc2626',
  } });
  await tx.notification.create({ data: {
    title: `Urgent: ${c.caseNumber} needs immediate attention`,
    message: `${why}. Open the case now.`,
    type: 'error', userId: null, caseId: c.id,
  } });
  return true;
}

/** How many re-runs one case may have in a day - the free AI plan is shared by every case. */
export const MAX_AI_RERUNS_PER_DAY = 10;

/**
 * Run the existing assessment again - the rules, the matrix chunks retrieved
 * from the knowledge base, and one Groq call against them - on the report as
 * filed, with anything new an official has recorded set apart below it.
 *
 * The original narrative and the reading made at filing are not touched, and
 * neither is the case's level: the result is kept as a new history row, for
 * an officer to confirm or not. Only an immediate danger acts on its own.
 */
export async function reassess(c: RecordsCase, actor: Actor & { name: string | null }, input: { reason: string; newInformation?: string }) {
  const full = await prisma.case.findUnique({
    where: { id: c.id },
    select: {
      description: true, barangay: true,
      intake: { select: { narrative: true, turns: true, aiInterview: true, selectedCategory: true } },
      resident: { select: { firstName: true, lastName: true, gender: true } },
    },
  });
  if (!full) throw new Error('not_found');
  const original = full.intake?.narrative ?? full.description;
  const added = input.newInformation?.trim();
  const narrative = added
    ? `${original}\n\nAdditional information recorded by a barangay official (${new Date().toISOString().slice(0, 10)}):\n${added}`
    : original;
  const storedTurns = turnsSchema.safeParse((full.intake?.aiInterview as { turns?: unknown } | null)?.turns ?? []);

  const result = await runIntake({
    // The AI's daily per-person budget is counted to the official asking,
    // not to the resident who filed.
    residentId: `staff:${actor.id}`,
    narrative,
    answers: answersFromTranscript(full.intake?.turns),
    selectedCategory: full.intake?.selectedCategory ?? null,
    street: full.barangay,
    gender: full.resident?.gender ?? null,
    useAi: true,
    residentNames: full.resident ? [full.resident.firstName, full.resident.lastName] : [],
    relationship: (c.reportingRelationship as 'SELF' | 'THIRD_PARTY' | 'ON_BEHALF' | 'ANONYMOUS' | null) ?? 'SELF',
    turns: storedTurns.success ? storedTurns.data ?? [] : [],
  });

  const r = result.result;
  const ai = result.grounding.ai;
  const aiAssessment = ai?.assessment ?? null;
  const triage = triageStatusFor(r, aiAssessment, result.grounding.knowledgeBaseStatus === 'unavailable');
  const rationale = {
    status: r.assessmentStatus,
    triageStatus: triage,
    immediateSafetyConcern: r.immediateSafetyConcern,
    suggestedCategory: r.suggestedCaseCategory,
    classificationStatus: r.classificationStatus,
    matchedCriteria: r.matchedCriteria,
    missingInformation: r.missingInformation,
    recommendedNextSteps: r.recommendedNextSteps,
    reviewReasons: r.reviewReasons,
    levelCaveats: r.levelCaveats,
    references: result.grounding.references,
    sourceVerified: result.grounding.sourceVerified,
    knowledgeBaseStatus: result.grounding.knowledgeBaseStatus,
    assessedBy: result.grounding.assessedBy,
    ai: ai ? { used: ai.used, model: ai.model, status: ai.status, note: ai.note, assessment: aiAssessment } : null,
    newInformation: added || null,
  };

  const row = await prisma.$transaction(async tx => {
    const h = await tx.assessmentHistory.create({ data: {
      caseId: c.id, kind: 'ai_reassessment', riskLevel: r.riskLevel, caseType: r.suggestedCaseCategory,
      previousCaseType: c.caseType, framework: r.framework, matrixLevel: r.matrixLevel, matrixLabel: r.matrixLabel,
      informationCompleteness: r.informationCompleteness, rationale: JSON.parse(JSON.stringify(rationale)),
      actorId: actor.id, reason: input.reason, engineVersion: r.engineVersion,
    } });
    await tx.activity.create({ data: {
      type: 'ai_reassessment',
      message: `AI assessment re-run by ${actor.name ?? 'an official'}: ${r.matrixLevel ? `Level ${r.matrixLevel} ${r.matrixLabel}` : 'no matrix level'} (advisory)`,
      entityId: h.id, entityType: 'AssessmentHistory', userId: actor.id, caseId: c.id, color: '#0f766e',
    } });
    const urgent = triage === 'URGENT_REVIEW'
      ? await raiseUrgent(tx, c, actor, 'The re-run assessment found an immediate safety concern')
      : false;
    return { h, urgent };
  });
  return { historyId: row.h.id, flaggedUrgent: row.urgent };
}
