import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { RESIDENCY_VERIFIER_ROLES } from '@/lib/jurisdictionServer';
import { REFERRAL_KINDS, REFERRAL_STATUSES, type ReferralKind, type ReferralStatus } from '@/lib/jurisdiction';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * Referral records (reports that could not be standard SafeComm cases), for
 * the Barangay Captain only: they may describe violence, so they are kept
 * off the blotter and VAWC desks' lists until the captain decides what the
 * barangay does with one (often: staff take it in through the Walk-in
 * Report, or the person is referred elsewhere).
 *
 *   GET   ?status=NEW (default) | REVIEWED | CLOSED | ALL
 *   PATCH { id, status: REVIEWED | CLOSED, note }
 */
async function gate(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return { error: errorResponse('Unauthorized', 401) };
  if (!RESIDENCY_VERIFIER_ROLES.includes(actor.role.trim())) return { error: noStore({ success: false, error: 'Only the Barangay Captain reviews referral records.' }, 403) };
  return { actor };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const s = req.nextUrl.searchParams.get('status') ?? 'NEW';
  try {
    const [rows, counts] = await Promise.all([
      prisma.jurisdictionReferral.findMany({ where: s === 'ALL' ? {} : { status: s in REFERRAL_STATUSES ? s : 'NEW' }, orderBy: [{ urgent: 'desc' }, { createdAt: 'desc' }], take: 200,
        include: { resident: { select: { id: true, residentNumber: true, firstName: true, lastName: true, contactNumber: true, residencyStatus: true } } } }),
      prisma.jurisdictionReferral.groupBy({ by: ['status'], _count: true }),
    ]);
    return noStore({ success: true, data: {
      counts: Object.fromEntries(Object.keys(REFERRAL_STATUSES).map(k => [k, counts.find(c => c.status === k)?._count ?? 0])),
      rows: rows.map(r => ({ ...r, kindLabel: REFERRAL_KINDS[r.kind as ReferralKind], statusLabel: REFERRAL_STATUSES[r.status as ReferralStatus],
        resident: r.resident ? { id: r.resident.id, residentNumber: r.resident.residentNumber, name: `${r.resident.firstName} ${r.resident.lastName}`,
          contactNumber: r.resident.contactNumber, residencyStatus: r.resident.residencyStatus } : null })),
    } });
  } catch (e) {
    logRouteError('GET /api/residency/referrals', e);
    return errorResponse('The referral records could not be loaded right now.', 503);
  }
}

const patch = z.object({ id: z.string().min(1).max(64), status: z.enum(['REVIEWED', 'CLOSED']), note: z.string().trim().min(3, 'Write what was done').max(500) });

export async function PATCH(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);
  const d = parsed.data;
  try {
    const r = await prisma.jurisdictionReferral.findUnique({ where: { id: d.id }, select: { status: true, kind: true } });
    if (!r) return errorResponse('Referral record not found', 404);
    if (r.status === 'CLOSED') return errorResponse('This record is already closed.', 409);
    await prisma.$transaction(async tx => {
      await tx.jurisdictionReferral.update({ where: { id: d.id }, data: { status: d.status, reviewNote: d.note, reviewedById: g.actor.id, reviewedAt: new Date() } });
      await tx.activity.create({ data: { type: 'referral_reviewed', userId: g.actor.id, entityType: 'JurisdictionReferral', entityId: d.id, color: '#0f766e',
        message: `Referral record (${REFERRAL_KINDS[r.kind as ReferralKind]}) marked ${REFERRAL_STATUSES[d.status].toLowerCase()}` } });
    });
    return noStore({ success: true });
  } catch (e) {
    logRouteError('PATCH /api/residency/referrals', e);
    return errorResponse('The record could not be updated right now.', 503);
  }
}
