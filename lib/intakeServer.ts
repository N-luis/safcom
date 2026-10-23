import 'server-only';
import { z } from 'zod';
import { prisma } from './prisma';
import { analyzeIntake, SLOT_ORDER, type IntakeAnalysis, type IntakeAnswer, type SlotId } from './intake';
import { searchMatrix, levelChunk, type KbDb, type SearchStatus } from './knowledgeBase';
import { readWithAi, type AiReading, type ReadDeps } from './aiClassifier';

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
}, ai: AiReading | null = null): Promise<IntakeAnalysis> {
  const hints = ai?.used ? ai.hints : null;
  // First pass to learn what the words describe; recurrence is then counted
  // against that, not against whatever was picked in the dropdown.
  const first = analyzeIntake({
    narrative: params.narrative,
    answers: params.answers,
    selectedCategory: params.selectedCategory,
    gender: params.gender,
    ai: hints,
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
    answers: params.answers,
    selectedCategory: params.selectedCategory,
    gender: params.gender,
    priorSameType,
    areaRecentSameType,
    ai: hints,
  });
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
  // The AI reader first, so its checked facts are part of the reading. It
  // never throws and never blocks: on any trouble the rules run alone.
  const ai = params.useAi
    ? await readWithAi({
      narrative: params.narrative, answers: params.answers,
      residentId: params.residentId, residentNames: params.residentNames,
    }, aiDeps).catch((): AiReading | null => null)
    : null;
  const analysis = await analyse(params, ai);
  const r = analysis.result;
  r.aiAssist = { used: Boolean(ai?.used), model: ai?.used ? ai.model : null };

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
