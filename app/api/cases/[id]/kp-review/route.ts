import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, eligibilityOf, actorName } from '@/lib/hearingsServer';
import { KP_KEYS, KP_CHECKLIST } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';

/**
 * An official's review of whether a dispute may go to Katarungang
 * Pambarangay proceedings - each point on the checklist confirmed or not.
 * Kept as history (a new review never edits an old one), and tied to the
 * category it was made under: change the category and it must be done again.
 * A VAWC case is refused outright (lib/hearingsServer.ts gateHearings).
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const reviews = await prisma.caseKpReview.findMany({ where: { caseId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
    const ids = [...new Set(reviews.map(r => r.reviewedById))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      eligibility: await eligibilityOf(g.c),
      reviews: reviews.map(r => ({ ...r, reviewedBy: users.find(u => u.id === r.reviewedById)?.name ?? 'Former official' })),
    } });
  } catch (e) {
    logRouteError('GET /api/cases/[id]/kp-review', e);
    return errorResponse('The review could not be loaded right now.', 503);
  }
}

const schema = z.object({
  checklist: z.object(Object.fromEntries(KP_KEYS.map(k => [k, z.boolean()])) as Record<(typeof KP_KEYS)[number], z.ZodBoolean>),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Answer every point on the eligibility checklist', 400);
  const failed = KP_CHECKLIST.filter(c => !parsed.data.checklist[c.key]);
  const decision = failed.length ? 'NOT_ELIGIBLE' : 'ELIGIBLE';
  if (decision === 'NOT_ELIGIBLE' && !parsed.data.note) return errorResponse('Say briefly why the dispute is not eligible.', 400);
  try {
    const by = await actorName(g.actor.id);
    const review = await prisma.$transaction(async tx => {
      const r = await tx.caseKpReview.create({ data: {
        caseId: id, decision, caseType: g.c.caseType, checklist: parsed.data.checklist, note: parsed.data.note || null, reviewedById: g.actor.id,
      } });
      await tx.activity.create({ data: {
        type: 'hearing', message: `Katarungang Pambarangay eligibility reviewed by ${by}: ${decision === 'ELIGIBLE' ? 'eligible for barangay conciliation' : 'not eligible'}`,
        entityId: r.id, entityType: 'CaseKpReview', userId: g.actor.id, caseId: id, color: '#0369a1',
      } });
      return r;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: { review, eligibility: await eligibilityOf(g.c) } }, 201);
  } catch (e) {
    logRouteError('POST /api/cases/[id]/kp-review', e);
    return errorResponse('The review could not be saved right now.', 503);
  }
}
