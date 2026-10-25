import 'server-only';
import { z } from 'zod';
import { prisma } from './prisma';
import { analyzeIntake, SLOT_ORDER, type IntakeAnalysis, type IntakeAnswer, type SlotId } from './intake';
import { searchMatrix, levelChunk, type KbDb, type SearchStatus } from './knowledgeBase';
import { type AiReading, type ReadDeps } from './aiClassifier';
import { assessWithSources, type AiAssessment } from './aiAssessment';
import { categoryByName } from './classificationSchema';
import { queueLevelFor, type Framework } from './riskMatrices';
import { REPORTING_RELATIONSHIPS, INTERVIEW_LIMITS, type InterviewTurn, type ReportingRelationship } from './interviewTypes';

/**
 * The intake, run on the server against this resident's own history.
 *
 * Both the live question-by-question endpoint and the final submission call
 * this, so what is stored with the case is computed the same way as what the
 * resident saw - and computed again, never trusted from the browser.
 */

export const NARRATIVE_MAX = 4000;

export const answerSchema = z.object({
  slot: z.enum(SLOT_ORDER as [SlotId, ...SlotId[]]),
  kind: z.enum(['option', 'text', 'skipped', 'declined']),
  value: z.enum(['yes', 'no', 'unsure']).optional(),
  text: z.string().max(1000).optional(),
});

export const answersSchema = z.array(answerSchema).max(SLOT_ORDER.length * 2).optional();

export const relationshipSchema = z.enum(REPORTING_RELATIONSHIPS);

/** An AI interview question as it was asked, with the resident's answer. Bounded: it is client-sent. */
export const turnSchema = z.object({
  id: z.string().regex(/^r\d{1,2}[qs]\d{0,2}$/),
  round: z.number().int().min(1).max(INTERVIEW_LIMITS.maxRounds),
  text: z.string().trim().min(1).max(300),
  answerType: z.enum(['yes_no', 'short_text']),
  slot: z.enum(SLOT_ORDER as [SlotId, ...SlotId[]]).nullable(),
  kind: z.enum(['option', 'text', 'skipped', 'declined']),
  value: z.enum(['yes', 'no', 'unsure']).optional(),
  answerText: z.string().max(1000).optional(),
});
export const turnsSchema = z.array(turnSchema).max(INTERVIEW_LIMITS.maxQuestionsTotal + INTERVIEW_LIMITS.maxRounds).optional();

/**
 * An interview answer as the rules read it. A question tagged with a rules
 * question (slot) answers that question; the rest add only the resident's
 * typed words - a "yes" to an untagged question means nothing to the rules.
 */
export function answersFromTurns(turns: InterviewTurn[] = []): { answers: IntakeAnswer[]; extraText: string[] } {
  const answers: IntakeAnswer[] = [];
  const extraText: string[] = [];
  for (const t of turns) {
    const text = t.answerText?.trim() || undefined;
    if (!t.slot) { if (text) extraText.push(text); continue; }
    if (t.kind === 'skipped' || t.kind === 'declined') answers.push({ slot: t.slot, kind: t.kind });
    else if (t.kind === 'option' && t.value) answers.push({ slot: t.slot, kind: 'option', value: t.value, text });
    else if (text) answers.push({ slot: t.slot, kind: 'text', text });
  }
  return { answers, extraText };
}

async function analyse(params: {
  residentId: string;
  narrative: string;
  answers?: IntakeAnswer[];
  selectedCategory?: string | null;
  street?: string | null;
  gender?: string | null;
  /** Ask the AI reader as well (resident reports). Off: the rules alone. */
  useAi?: boolean;
  /** The resident's own name, removed from the text before the AI sees it. */
  residentNames?: string[];
  /** Who the report is for. */
  relationship?: ReportingRelationship | null;
  /** The AI interview, as asked and answered. */
  turns?: InterviewTurn[];
}, ai: AiReading | null = null): Promise<IntakeAnalysis> {
  const hints = ai?.used ? ai.hints : null;
  const fromTurns = answersFromTurns(params.turns);
  const answers = [...(params.answers ?? []), ...fromTurns.answers];
  const common = { relationship: params.relationship ?? null, extraText: fromTurns.extraText };
  // First pass to learn what the words describe; recurrence is then counted
  // against that, not against whatever was picked in the dropdown.
  const first = analyzeIntake({
    narrative: params.narrative,
    answers,
    selectedCategory: params.selectedCategory,
    gender: params.gender,
    ai: hints,
    ...common,
  });
  const type = first.result.suggestedCaseCategory ?? params.selectedCategory ?? null;
  if (!type) return first;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [priorSameType, areaRecentSameType] = await Promise.all([
    prisma.case.count({ where: { residentId: params.residentId, caseType: type } }),
    params.street
      ? prisma.case.count({
        where: {
          barangay: params.street, caseType: type,
          riskLevel: { in: ['High', 'Critical'] }, filedAt: { gte: thirtyDaysAgo },
        },
      })
      : Promise.resolve(0),
  ]);
  if (!priorSameType && !areaRecentSameType) return first;

  return analyzeIntake({
    narrative: params.narrative,
    answers,
    selectedCategory: params.selectedCategory,
    gender: params.gender,
    priorSameType,
    areaRecentSameType,
    ai: hints,
    ...common,
  });
}

const LEVEL_ORDER = ['Low', 'Medium', 'High', 'Critical'] as const;

/**
 * The AI assessment beside the rules' reading. Where they agree, nothing
 * changes. Where they do not - a different level, the other matrix, an
 * unretrievable source - the case goes to a person with both named, and the
 * queue keeps the more serious of the two until then. The AI never lowers
 * anything, and its level alone never decides the case.
 */
function compareWithAssessment(r: IntakeAnalysis['result'], a: AiAssessment) {
  const push = (reason: string) => { if (!r.reviewReasons.includes(reason)) r.reviewReasons.push(reason); };
  const toReview = () => { if (r.assessmentStatus === 'PRELIMINARY') r.assessmentStatus = 'FOR_REVIEW'; };

  if (a.status === 'ASSESSMENT_UNAVAILABLE') {
    // Only a source that could not be read sends the case to review; the AI
    // simply not being used leaves the rules' reading as it always was.
    if (/knowledge base|not been imported|retriev/i.test(a.unavailableReason ?? '')) {
      push(`AI assessment unavailable: ${a.unavailableReason}`);
      toReview();
    }
  } else {
    if (a.framework && a.framework !== r.framework) {
      push(`The AI assessed this against the ${a.framework} matrix; the rules route it to ${r.framework}`);
      toReview();
    } else if (a.level !== r.matrixLevel) {
      push(`AI assessment: ${a.level ? `Level ${a.level} (${a.criteria.filter(c => c.level === a.level).map(c => c.criterion).join('; ')})` : 'no level'}`
        + `; rules: ${r.matrixLevel ? `Level ${r.matrixLevel}` : 'no level'}`);
      toReview();
      if (a.level) {
        const aiQueue = queueLevelFor(a.level);
        if (LEVEL_ORDER.indexOf(aiQueue) > (r.riskLevel ? LEVEL_ORDER.indexOf(r.riskLevel) : -1)) r.riskLevel = aiQueue;
      }
    }
    if (a.classificationStatus === 'FOR_REVIEW') toReview();
    // The AI's sufficiency check can hold a report back from "preliminary";
    // it can never promote one the rules found incomplete.
    if (a.informationSufficient === false) {
      push(`The AI sufficiency check found essential details missing${a.essentialMissing.length ? `: ${a.essentialMissing.join('; ')}` : ''}`);
      if (r.assessmentStatus !== 'NEEDS_MORE_INFORMATION') r.assessmentStatus = 'NEEDS_MORE_INFORMATION';
    }
    if (a.droppedCriteria) push(`${a.droppedCriteria} AI-cited criteria were not found in the matrix text and were discarded`);
    if (a.urgentHumanReview) push('The AI assessment recommends urgent human review');
  }
  r.requiresOfficerReview = r.reviewReasons.length > 0;
}

/** A cited passage of a matrix, as stored with the case and shown to officers. */
export interface MatrixReference {
  sectionTitle: string;
  riskLevel: number | null;
  riskLabel: string | null;
  pageNumber: number | null;
  score: number;
  strength: 'strong' | 'weak';
  /** The document's own "Suggested Action" for that level, when it is a level row. */
  suggestedAction: string | null;
  links: string[];
  excerpt: string;
}

/** What retrieval added: the cited source, and whether the decision checks out against it. */
export interface Grounding {
  knowledgeBaseStatus: SearchStatus;
  references: MatrixReference[];
  /**
   * True when every criterion the decision rests on is found, word for word,
   * in the stored source row for that level. False: it was not - the case is
   * sent for review. Null: there was nothing to check, or the source could
   * not be reached.
   */
  sourceVerified: boolean | null;
  /** How the assessment was made: the rules alone, or the rules with the AI reader. */
  assessedBy: string;
  /** The AI reader's run, checked; null when it was not asked. */
  ai: AiReading | null;
}

export type GroundedAnalysis = IntakeAnalysis & { grounding: Grounding };

function toReference(h: { sectionTitle: string; riskLevel: number | null; riskLabel: string | null; pageNumber: number | null;
  score: number; strength: 'strong' | 'weak'; content: string; fields: Record<string, unknown> | null }): MatrixReference {
  const f = (h.fields ?? {}) as Record<string, unknown>;
  return {
    sectionTitle: h.sectionTitle, riskLevel: h.riskLevel, riskLabel: h.riskLabel, pageNumber: h.pageNumber,
    score: Math.round(h.score * 100) / 100, strength: h.strength,
    suggestedAction: typeof f['Suggested Action'] === 'string' ? f['Suggested Action'] as string : null,
    links: Array.isArray(f.links) ? (f.links as string[]) : [],
    excerpt: h.content.length > 600 ? h.content.slice(0, 597) + '…' : h.content,
  };
}

/**
 * The intake, run on the server, with the matrix it applied cited from the
 * knowledge base. Retrieval never changes the level: it supplies the source
 * text and checks the decision against it. If the knowledge base is down,
 * the assessment still completes - it just cannot be checked, and says so.
 */
export async function runIntake(
  params: Parameters<typeof analyse>[0],
  db?: KbDb,
  aiDeps?: ReadDeps,
): Promise<GroundedAnalysis> {
  // With the AI: the rules read it first, to know which desk's matrix to
  // retrieve - both, when the desk is unclear. Then one Groq call reads the
  // facts and assesses against that retrieved text. It never throws and
  // never blocks: on any trouble the rules run alone.
  let ai: AiReading | null = null;
  if (params.useAi) {
    const provisional = await analyse(params, null);
    const pr = provisional.result;
    const other: Framework = pr.framework === 'VAWC' ? 'BLOTTER' : 'VAWC';
    const otherDesk = other === 'VAWC' ? 'VAWC' : 'Blotter';
    const unclear = pr.classificationStatus === 'needs_review'
      || pr.alternativeCategories.some(c => categoryByName(c)?.desk === otherDesk);
    ai = await assessWithSources({
      narrative: params.narrative,
      // The rules' own questions; the interview's go in as turns, with the
      // question beside each answer.
      answers: params.answers,
      turns: params.turns,
      relationship: params.relationship ?? 'SELF',
      residentId: params.residentId,
      residentNames: params.residentNames,
      frameworks: unclear ? [pr.framework, other] : [pr.framework],
      searchFacts: provisional.facts,
    }, { ...aiDeps, db }).catch((): AiReading | null => null);
  }
  const analysis = await analyse(params, ai);
  const r = analysis.result;
  r.aiAssist = { used: Boolean(ai?.used), model: ai?.used ? ai.model : null };
  if (ai?.assessment) compareWithAssessment(r, ai.assessment);

  // The facts' names reach the search as the matrices' own English wording,
  // so a Tagalog report finds the English source text.
  const search = await searchMatrix(r.framework, params.narrative, { facts: analysis.facts, limit: 3 }, db);
  const references = search.hits.map(toReference);

  let sourceVerified: boolean | null = null;
  if (r.matrixLevel && search.status !== 'unavailable') {
    const row = await levelChunk(r.framework, r.matrixLevel, db);
    if (row) {
      const text = row.content.toLowerCase();
      sourceVerified = r.matchedCriteria
        .filter(m => m.level === r.matrixLevel)
        .every(m => text.includes(m.indicator.toLowerCase()))
        && (row.riskLabel ?? '') === r.matrixLabel;
      if (!references.some(x => x.riskLevel === r.matrixLevel)) {
        references.unshift(toReference(row));
      }
    } else {
      sourceVerified = false;
    }
  }

  if (sourceVerified === false) {
    r.requiresOfficerReview = true;
    r.reviewReasons.push('The decision could not be matched to the imported matrix text');
    if (r.assessmentStatus === 'PRELIMINARY') r.assessmentStatus = 'FOR_REVIEW';
  }
  if (search.status === 'unavailable') {
    r.requiresOfficerReview = true;
    r.reviewReasons.push('The risk-matrix knowledge base could not be reached; the decision is unchecked');
  }

  return {
    ...analysis,
    grounding: {
      knowledgeBaseStatus: search.status,
      references,
      sourceVerified,
      assessedBy: ai?.used
        ? `${r.engineVersion} with ${ai.version} (Groq free plan, ${ai.model}); AI facts checked against the report text`
          + (ai.assessment?.status === 'COMPLETED' ? `; AI assessment ${ai.assessment.version} against retrieved matrix text` : '')
        : `${r.engineVersion} (rule-based; no external AI provider${ai ? ` - ${ai.note}` : ''})`,
      ai,
    },
  };
}

/** A stored transcript, turned back into the answers it records. */
export function answersFromTranscript(turns: unknown): IntakeAnswer[] {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((t: { slot?: string; outcome?: string; value?: string | null; text?: string | null }): IntakeAnswer[] => {
    if (!t?.slot || !SLOT_ORDER.includes(t.slot as SlotId)) return [];
    const slot = t.slot as SlotId;
    if (t.outcome === 'skipped') return [{ slot, kind: 'skipped' as const }];
    if (t.outcome === 'declined') return [{ slot, kind: 'declined' as const }];
    if (t.outcome === 'not sure') return [{ slot, kind: 'option' as const, value: 'unsure' as const }];
    if (t.value === 'yes' || t.value === 'no') return [{ slot, kind: 'option' as const, value: t.value, text: t.text ?? undefined }];
    return t.text ? [{ slot, kind: 'text' as const, text: t.text }] : [];
  });
}

/** Answers as a transcript: the question's topic, and what happened to it. */
export function transcript(answers: IntakeAnswer[] | undefined, result: IntakeAnalysis['result']) {
  return (answers ?? []).map(a => ({
    slot: a.slot,
    topic: result.slots.find(s => s.id === a.slot)?.label ?? a.slot,
    outcome: a.kind === 'skipped' ? 'skipped'
      : a.kind === 'declined' ? 'declined'
        : a.value === 'unsure' ? 'not sure'
          : 'answered',
    value: a.value ?? null,
    text: a.text ?? null,
  }));
}
