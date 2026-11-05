import 'server-only';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { searchMatrix, type KbDb, type MatrixHit } from './knowledgeBase';
import { runIntake, answersFromTranscript, type GroundedAnalysis } from './intakeServer';
import { recommendDesk, DESK_VERSION, type DeskRecommendation, type DeskSource } from './reportDesk';
import { isVawcType } from './reporterAccess';
import type { InterviewTurn } from './interviewTypes';

/**
 * The desk recommendation for a report, on the server: the existing intake
 * reading (rules + the Groq reader, lib/intakeServer.ts runIntake) plus the
 * knowledge base's BLOTTER and VAWC source text it is read against, turned
 * into a recommendation by lib/reportDesk.ts. Every recommendation is kept
 * in the case's history (AssessmentHistory, kind desk_recommendation) - the
 * table is insert-only, so an earlier one is never lost.
 */

const toSource = (h: MatrixHit): DeskSource => ({
  framework: h.documentType === 'VAWC' ? 'VAWC' : 'BLOTTER', sectionTitle: h.sectionTitle, pageNumber: h.pageNumber,
  riskLevel: h.riskLevel, riskLabel: h.riskLabel, strength: h.strength,
});

/** Both desks' matrices, searched with the report: only chunks actually found are cited. */
export async function deskSources(narrative: string, facts: string[], db: KbDb = prisma) {
  const [b, v] = await Promise.all([
    searchMatrix('BLOTTER', narrative, { facts, limit: 2 }, db),
    searchMatrix('VAWC', narrative, { facts, limit: 2 }, db),
  ]);
  return {
    available: b.status !== 'unavailable' && v.status !== 'unavailable',
    sources: [...b.hits, ...v.hits].sort((x, y) => y.score - x.score).map(toSource),
  };
}

export async function deskFor(analysis: GroundedAnalysis, narrative: string, aiRequested: boolean, db: KbDb = prisma,
  reporterChoseVawc = false): Promise<DeskRecommendation> {
  const ai = analysis.grounding.ai;
  const kb = await deskSources(narrative, analysis.facts, db);
  return recommendDesk({
    result: analysis.result,
    ai: {
      requested: aiRequested, used: Boolean(ai?.used), status: ai?.status ?? (aiRequested ? 'error' : null), model: ai?.model ?? null,
      category: ai?.hints?.category ?? null, categoryConfidence: ai?.hints?.categoryConfidence ?? null,
      alternativeCategories: ai?.hints?.alternativeCategories ?? [],
    },
    sources: kb.sources,
    facts: analysis.facts,
    knowledgeBaseAvailable: kb.available,
    reporterChoseVawc,
  });
}

/** The history row for a recommendation. */
export function deskHistoryRow(caseId: string, rec: DeskRecommendation, caseType: string, previousCaseType: string | null = null): Prisma.AssessmentHistoryUncheckedCreateInput {
  return {
    caseId, kind: 'desk_recommendation', caseType, previousCaseType,
    rationale: JSON.parse(JSON.stringify(rec)), engineVersion: DESK_VERSION, actorId: null,
  };
}

/** The latest recommendation on a case, as stored. */
export async function latestDesk(caseId: string) {
  const row = await prisma.assessmentHistory.findFirst({ where: { caseId, kind: 'desk_recommendation' }, orderBy: { createdAt: 'desc' } });
  return row ? (row.rationale as unknown as DeskRecommendation) : null;
}

export interface RetryOutcome { caseNumber: string; result: 'classified' | 'still_waiting' | 'skipped'; moved?: boolean }

/**
 * The controlled retry for reports filed while the Groq reader could not
 * run: at most `limit` cases a run, oldest first, only open ones, only while
 * no official has decided the category, and within 14 days of filing. A
 * reading that may concern VAWC moves the case to the VAWC desk at once;
 * one never moves a case off the VAWC desk - that is a VAWC officer's call.
 */
export async function retryAwaitingDesk(limit = 5, now = new Date()): Promise<RetryOutcome[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const waiting = await prisma.case.findMany({
    where: {
      status: { notIn: ['Resolved', 'Closed'] }, filedAt: { gte: since },
      assessmentHistory: { some: { kind: 'desk_recommendation', rationale: { path: ['awaitingAi'], equals: true } } },
    },
    orderBy: { filedAt: 'asc' }, take: limit * 3,
    select: {
      id: true, caseNumber: true, caseType: true, residentId: true, reportingRelationship: true, barangay: true,
      intake: { select: { narrative: true, turns: true } },
      resident: { select: { firstName: true, lastName: true, gender: true } },
      assessmentHistory: { where: { kind: { in: ['desk_recommendation', 'category_confirm', 'category_change'] } }, orderBy: { createdAt: 'desc' }, take: 1,
        select: { kind: true, rationale: true } },
    },
  });
  const out: RetryOutcome[] = [];
  for (const c of waiting) {
    if (out.length >= limit) break;
    const last = c.assessmentHistory[0];
    // Only while the latest word on the desk is still the one waiting for the AI.
    if (!last || last.kind !== 'desk_recommendation' || !(last.rationale as { awaitingAi?: boolean })?.awaitingAi || !c.intake) {
      out.push({ caseNumber: c.caseNumber, result: 'skipped' }); continue;
    }
    const turns = (c.intake.turns ?? []) as unknown as InterviewTurn[];
    const analysis = await runIntake({
      residentId: c.residentId ?? 'walk-in', narrative: c.intake.narrative, answers: answersFromTranscript(c.intake.turns),
      selectedCategory: null, street: c.barangay, gender: c.resident?.gender ?? null, useAi: true,
      residentNames: c.resident ? [c.resident.firstName, c.resident.lastName] : [],
      relationship: (c.reportingRelationship ?? 'SELF') as 'SELF', turns,
    });
    const rec = await deskFor(analysis, c.intake.narrative, true);
    if (rec.awaitingAi) { out.push({ caseNumber: c.caseNumber, result: 'still_waiting' }); continue; }
    // Moving onto the VAWC desk only - never off it.
    const move = rec.desk === 'VAWC' && !isVawcType(c.caseType);
    const newType = move ? rec.filedCategory : c.caseType;
    await prisma.$transaction(async tx => {
      if (move) {
        const done = await tx.case.updateMany({ where: { id: c.id, caseType: c.caseType }, data: { caseType: newType, requiresOfficerReview: true } });
        if (!done.count) throw new Error('changed');
      }
      await tx.assessmentHistory.create({ data: deskHistoryRow(c.id, rec, newType, move ? c.caseType : null) });
      await tx.activity.create({ data: {
        type: 'classification', entityId: c.id, entityType: 'Case', caseId: c.id, color: '#7c3aed',
        message: move
          ? `SafeComm AI classified case ${c.caseNumber} after a delay and moved it to the VAWC desk for confidential review`
          : `SafeComm AI classified case ${c.caseNumber} after a delay: ${rec.decision.toLowerCase().replace(/_/g, ' ')}`,
      } });
    }).catch(e => { if (!(e instanceof Error && e.message === 'changed')) throw e; });
    out.push({ caseNumber: c.caseNumber, result: 'classified', moved: move });
  }
  return out;
}
