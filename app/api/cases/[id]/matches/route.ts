import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, type Actor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { rateLimit } from '@/lib/rateLimit';
import { logRouteError } from '@/lib/hearingCasesServer';
import { matchAccess, matchesForCase, reviewMatch, detectForCase, ReviewError } from '@/lib/caseMatchingServer';
import { REVIEW_ACTIONS } from '@/lib/caseMatching';

export const dynamic = 'force-dynamic';

/**
 * Potential duplicate and related cases of one case - Blotter and VAWC Case
 * Monitoring.
 *
 *   GET  - the case's matches (the other case's reference, incident date and
 *          category; the indicators, what matches and differs, what is
 *          uncertain, the explanation, the review status and its history),
 *          and whether this official may decide them.
 *   POST - an official's decision on one match (confirm duplicate, mark
 *          related, not a duplicate, request further review), or `recheck`
 *          to run the check on this case again.
 *
 * A VAWC case and its matches are for the VAWC roles only: anyone else gets
 * "Case not found", as for the case itself. Every request is written to the
 * access log, allowed or not. Neither case is ever changed here - only the
 * match.
 */
type Params = { params: Promise<{ id: string }> };

const LOG_FIELD = 'case_matches';

async function gate(req: NextRequest, caseId: string, need: 'view' | 'review') {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor || !actor.active) return { error: errorResponse('Unauthorized', 401) };
  let c: { id: string; caseNumber: string; caseType: string } | null;
  try {
    c = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true, caseNumber: true, caseType: true } });
  } catch {
    return { error: errorResponse('The case could not be loaded right now. Nothing was changed.', 503) };
  }
  const log = (outcome: 'permitted' | 'denied', code: string) => prisma.reporterAccessLog.create({
    data: { actorId: actor.id, actorRole: actor.role, caseId: caseId.slice(0, 64), caseNumber: c?.caseNumber ?? null, fields: [LOG_FIELD], outcome,
      code: need === 'review' ? `${code}:review` : code },
  }).then(() => undefined).catch(() => undefined);
  if (!c) { await log('denied', 'not_found'); return { error: errorResponse('Case not found', 404) }; }
  const access = matchAccess(actor.role, c.caseType);
  // A case this role may not see is not there at all - a VAWC case for a blotter officer included.
  if (!access.view) { await log('denied', 'hidden'); return { error: errorResponse('Case not found', 404) }; }
  if (need === 'review' && !access.review) {
    await log('denied', 'not_reviewer');
    return { error: noStore({ success: false, error: "Only this case's desk or the Punong Barangay decides on its matches.", code: 'not_reviewer' }, 403) };
  }
  return { actor, c, access, log };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gate(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const data = await matchesForCase(id, g.actor.role);
    await g.log('permitted', 'view');
    return noStore({ success: true, data: { ...data, canReview: g.access.review } });
  } catch (e) {
    logRouteError('GET /api/cases/[id]/matches', e);
    return errorResponse('The matches could not be loaded right now.', 503);
  }
}

const reviewSchema = z.object({
  action: z.enum(Object.keys(REVIEW_ACTIONS) as [keyof typeof REVIEW_ACTIONS, ...(keyof typeof REVIEW_ACTIONS)[]]),
  matchId: z.string().min(1).max(64),
  reason: z.string().trim().max(1000).optional(),
  primaryCaseId: z.string().min(1).max(64).optional(),
  expectedStatus: z.string().max(40).optional(),
}).strict();
const recheckSchema = z.object({ action: z.literal('recheck') }).strict();

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const g = await gate(req, id, 'review');
  if ('error' in g) return g.error;
  const actor: Actor = g.actor;

  const recheck = recheckSchema.safeParse(body);
  if (recheck.success) {
    if (!rateLimit(`case-match-recheck:${actor.id}`, { max: 20, windowMs: 3_600_000 }).allowed) return errorResponse('Too many checks - try again in a while.', 429);
    try {
      const r = await detectForCase(id, { force: true, actorId: actor.id });
      await g.log('permitted', 'recheck');
      return noStore({ success: true, data: { ...r, ...(await matchesForCase(id, actor.role)), canReview: true } });
    } catch (e) {
      logRouteError('POST /api/cases/[id]/matches recheck', e);
      return errorResponse('The check could not be run right now. Nothing was changed.', 503);
    }
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the decision', 400);
  try {
    const r = await reviewMatch(parsed.data.matchId, actor.id, { ...parsed.data, role: actor.role, caseId: id });
    await g.log('permitted', parsed.data.action);
    return noStore({ success: true, data: { ...r, ...(await matchesForCase(id, actor.role)), canReview: true } });
  } catch (e) {
    if (e instanceof ReviewError) {
      await g.log('denied', `${parsed.data.action}:${e.status}`);
      return noStore({ success: false, error: e.message }, e.status);
    }
    logRouteError('POST /api/cases/[id]/matches', e);
    return errorResponse('The decision could not be saved right now. Nothing was changed.', 503);
  }
}
