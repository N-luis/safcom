import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { runIntake, answersSchema, NARRATIVE_MAX } from '@/lib/intakeServer';
import { rateLimit, INTAKE_LIMIT } from '@/lib/rateLimit';

/**
 * One step of the assisted intake: the narrative and the answers so far in,
 * the next question and the current reading out.
 *
 * Nothing is stored here - the report is only filed when the resident submits.
 * The reading is SafeComm's own rules, joined by the AI reader when it is
 * configured (lib/aiClassifier.ts: Groq free plan, with phone numbers, e-mail
 * addresses and the resident's name removed first, and every fact it returns
 * checked against the text). The narrative is not logged.
 */
const schema = z.object({
  narrative: z.string().trim().min(1, 'Describe what happened first').max(NARRATIVE_MAX),
  selectedCategory: z.string().max(120).optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  answers: answersSchema,
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

  try {
    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId }, select: { gender: true, firstName: true, lastName: true },
    });
    const { result } = await runIntake({
      residentId: auth.resident.residentId,
      narrative: parsed.data.narrative,
      answers: parsed.data.answers,
      selectedCategory: parsed.data.selectedCategory,
      street: parsed.data.street,
      gender: resident?.gender ?? null,
      useAi: true,
      residentNames: resident ? [resident.firstName, resident.lastName] : [],
    });
    return rSuccess(result);
  } catch (err) {
    // The message only, never the request: the body is someone's account of
    // being hurt.
    console.error('[Resident intake]', err instanceof Error ? err.message : 'failed');
    return rError('The assistant could not read this right now. You can still submit your report.', 500);
  }
}
