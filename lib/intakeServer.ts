import 'server-only';
import { z } from 'zod';
import { prisma } from './prisma';
import { analyzeIntake, SLOT_ORDER, type IntakeAnalysis, type IntakeAnswer, type SlotId } from './intake';

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

export async function runIntake(params: {
  residentId: string;
  narrative: string;
  answers?: IntakeAnswer[];
  selectedCategory?: string | null;
  street?: string | null;
  gender?: string | null;
}): Promise<IntakeAnalysis> {
  // First pass to learn what the words describe; recurrence is then counted
  // against that, not against whatever was picked in the dropdown.
  const first = analyzeIntake({
    narrative: params.narrative,
    answers: params.answers,
    selectedCategory: params.selectedCategory,
    gender: params.gender,
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
