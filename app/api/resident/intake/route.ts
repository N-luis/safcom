import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { runIntake, answersSchema, relationshipSchema, turnsSchema, NARRATIVE_MAX } from '@/lib/intakeServer';
import { runInterview } from '@/lib/aiInterview';
import { rateLimit, INTAKE_LIMIT } from '@/lib/rateLimit';
import type { InterviewState, InterviewTurn } from '@/lib/interviewTypes';

/**
 * One step of the assisted intake: the narrative, the reporting relationship
 * and the answers so far in; the rules' reading and, when asked for, the next
 * round of AI interview questions out.
 *
 * Nothing is stored here - the report is only filed when the resident submits.
 * The rules run on every call (they are what catch a stated danger, with or
 * without the AI). Groq is called only when `wantQuestions` is set - when the
 * resident has used up the previous round - through lib/aiInterview.ts, with
 * phone numbers, e-mail addresses and the resident's name removed first.
 * The narrative is not logged.
 */
const schema = z.object({
  narrative: z.string().trim().min(1, 'Describe what happened first').max(NARRATIVE_MAX),
  selectedCategory: z.string().max(120).optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  answers: answersSchema,
  relationship: relationshipSchema.optional().nullable(),
  turns: turnsSchema,
  wantQuestions: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const limited = rateLimit(`intake:${auth.resident.residentId}`, INTAKE_LIMIT);
  if (!limited.allowed) {
    const res = rError(
      'Too many requests to the assistant for now. You can still submit your report — nothing you wrote is lost.',
      429,
    );
    res.headers.set('Retry-After', String(limited.retryAfterSeconds));
    return res;
  }

  let body: unknown;
  try { body = await req.json(); } catch { return rError('Invalid request', 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
  const relationship = parsed.data.relationship ?? 'SELF';
  const turns = (parsed.data.turns ?? []) as InterviewTurn[];

  try {
    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId }, select: { gender: true, firstName: true, lastName: true },
    });
    const residentNames = resident ? [resident.firstName, resident.lastName] : [];
    const { result } = await runIntake({
      residentId: auth.resident.residentId,
      narrative: parsed.data.narrative,
      answers: parsed.data.answers,
      selectedCategory: parsed.data.selectedCategory,
      street: parsed.data.street,
      gender: resident?.gender ?? null,
      relationship,
      turns,
    });

    let interview: InterviewState | null = null;
    if (parsed.data.wantQuestions) {
      const asked = new Set([...(parsed.data.answers ?? []).map(a => a.slot), ...turns.map(t => t.slot).filter(Boolean)]);
      interview = await runInterview({
        narrative: parsed.data.narrative, relationship, turns,
        residentId: auth.resident.residentId, residentNames,
        language: result.language === 'english' ? 'en' : 'tl',
        knownSlots: result.slots.filter(s => s.status === 'known' || asked.has(s.id)).map(s => s.id),
      });
      // Danger now is asked first, whatever the AI chose to ask - its own
      // question, or the rules' if it left it out.
      const safetyOpen = result.slots.find(s => s.id === 'safety')?.status === 'unknown' && !asked.has('safety');
      if (interview.used && safetyOpen && !interview.questions.some(q => q.slot === 'safety') && result.nextQuestion?.slot === 'safety') {
        interview.questions.unshift({ id: `r${interview.round}s`, round: interview.round, text: result.nextQuestion.text, answerType: 'yes_no', slot: 'safety' });
        interview.immediateDangerToAssess = true;
        interview.done = false;
      }
    }
    return rSuccess({ ...result, interview });
  } catch (err) {
    // The message only, never the request: the body is someone's account of
    // being hurt.
    console.error('[Resident intake]', err instanceof Error ? err.message : 'failed');
    return rError('The assistant could not read this right now. You can still submit your report.', 500);
  }
}
