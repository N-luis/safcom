import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, eligibilityOf, actorName } from '@/lib/hearingsServer';
import { KP_KEYS, KP_ANSWERS, KP_REVIEW_VERSION, KP_ELIGIBILITY_LABELS, decideKpReview, kpAnswersRefusal, type KpAnswers } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';

/**
 * An official's review of whether a dispute may go to Katarungang
 * Pambarangay proceedings: each point on the checklist answered Yes, No,
 * Unknown or Not applicable - or not yet (lib/hearings.ts decideKpReview).
 *
 *   - a No records a legal exclusion: NOT_ELIGIBLE, with the official's basis;
 *   - an Unknown leaves a fact to verify: NEEDS_VERIFICATION;
 *   - an unanswered point leaves the review unfinished: PENDING_REVIEW;
 *   - every point cleared is ELIGIBLE only when the official approves it.
 *
 * Every save is a new row (insert-only table): continuing a review never
 * edits the earlier one. A review is tied to the category it was made under:
 * change the category and it must be done again. A VAWC case is refused
 * outright (lib/hearingsServer.ts gateHearings).
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const reviews = await prisma.caseKpReview.findMany({ where: { caseId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    const ids = [...new Set(reviews.flatMap(r => [r.reviewedById, r.approvedById]).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const name = (uid: string | null) => (uid ? users.find(u => u.id === uid)?.name ?? 'Former official' : null);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      eligibility: await eligibilityOf(g.c),
      reviews: reviews.map(r => ({ ...r, reviewedBy: name(r.reviewedById), approvedBy: name(r.approvedById) })),
    } });
  } catch (e) {
    logRouteError('GET /api/cases/[id]/kp-review', e);
    return errorResponse('The review could not be loaded right now.', 503);
  }
}

const answer = z.enum(KP_ANSWERS).nullable().optional();
const schema = z.object({
  answers: z.object(Object.fromEntries(KP_KEYS.map(k => [k, answer])) as Record<(typeof KP_KEYS)[number], typeof answer>),
  /** The official approves the case for KP proceedings - only counts when every point is cleared. */
  approve: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Answer each point with Yes, No, Unknown or Not applicable - or leave it for later', 400);
  const answers: KpAnswers = Object.fromEntries(KP_KEYS.filter(k => parsed.data.answers[k]).map(k => [k, parsed.data.answers[k]]));
  const refusal = kpAnswersRefusal(answers);
  if (refusal) return errorResponse(refusal, 400);
  const outcome = decideKpReview(answers, parsed.data.approve === true);
  const note = parsed.data.note || null;
  if (outcome.decision === 'NOT_ELIGIBLE' && !note) {
    return errorResponse('Say what the exclusion rests on - what was checked, and how.', 400);
  }
  if (parsed.data.approve && outcome.decision !== 'ELIGIBLE') {
    return errorResponse('Only a review with every point cleared can be approved.', 400);
  }
  try {
    // A case found not eligible is only cleared by a review that says what changed.
    const last = await prisma.caseKpReview.findFirst({ where: { caseId: id }, orderBy: { createdAt: 'desc' } });
    if (last && last.version >= 2 && last.decision === 'NOT_ELIGIBLE' && last.caseType === g.c.caseType && outcome.decision !== 'NOT_ELIGIBLE' && !note) {
      return errorResponse('An earlier review recorded a legal exclusion. Say what changed - what was verified since - before clearing it.', 400);
    }
    const by = await actorName(g.actor.id);
    const approved = outcome.decision === 'ELIGIBLE';
    const review = await prisma.$transaction(async tx => {
      const r = await tx.caseKpReview.create({ data: {
        caseId: id, decision: outcome.decision, caseType: g.c.caseType, checklist: answers, note, reviewedById: g.actor.id,
        version: KP_REVIEW_VERSION, approvedById: approved ? g.actor.id : null, approvedAt: approved ? new Date() : null,
      } });
      await tx.activity.create({ data: {
        type: 'hearing',
        message: `Katarungang Pambarangay eligibility ${approved ? 'approved' : 'reviewed'} by ${by}: ${KP_ELIGIBILITY_LABELS[outcome.decision].toLowerCase()}`,
        entityId: r.id, entityType: 'CaseKpReview', userId: g.actor.id, caseId: id, color: '#0369a1',
      } });
      return r;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: { review, outcome, eligibility: await eligibilityOf(g.c) } }, 201);
  } catch (e) {
    logRouteError('POST /api/cases/[id]/kp-review', e);
    return errorResponse('The review could not be saved right now.', 503);
  }
}
