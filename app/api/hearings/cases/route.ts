import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, BLOTTER_ROLES, isVawcType } from '@/lib/reporterAccess';
import { canSeeVawc } from '@/lib/caseAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { noStore, loadHearingCase, eligibilityOf } from '@/lib/hearingsServer';
import { hearingRefusal, nextHearingNumber, VAWC_HEARING_REFUSAL, CLOSED_CASE_STATUSES } from '@/lib/hearings';

export const dynamic = 'force-dynamic';

/**
 * Cases a hearing could be created on, each with whether it may have one and
 * why not - for the Create Hearing dialog. A blotter officer sees their own
 * open cases; the captain sees every open blotter case. A VAWC case is never
 * offered: typed in by its number (by a role that may see it), it comes back
 * with the reason it cannot have a hearing.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  const role = actor.role.trim();
  const blotter = BLOTTER_ROLES.includes(role);
  if (!blotter && role !== 'admin') return noStore({ success: false, error: 'Only blotter officers and the barangay captain create hearings.' }, 403);
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 60) || null;
  try {
    const cases = await prisma.case.findMany({
      where: {
        caseType: { notIn: [...VAWC_TYPES] },
        status: { notIn: CLOSED_CASE_STATUSES },
        ...(blotter && { assignedToId: actor.id }),
        ...(q && { caseNumber: { contains: q, mode: 'insensitive' as const } }),
      },
      orderBy: { filedAt: 'desc' }, take: 25, select: { id: true },
    });
    const out = [];
    for (const { id } of cases) {
      const c = await loadHearingCase(id);
      if (!c) continue;
      const [eligibility, hearings] = await Promise.all([
        eligibilityOf(c),
        prisma.caseHearing.findMany({ where: { caseId: id }, select: { hearingNumber: true, status: true, outcome: true } }),
      ]);
      const next = nextHearingNumber(hearings);
      out.push({
        id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status,
        next, refusal: next ? hearingRefusal(c.caseType, hearings, next) : 'All three hearings have been held.',
        eligible: eligibility.eligible, reasons: eligibility.reasons, warnings: eligibility.warnings, needsReview: eligibility.needsReview,
        categoryVerified: eligibility.categoryVerified,
      });
    }
    // The VAWC case asked for by number: shown, with why it never gets a hearing.
    if (q && canSeeVawc(role)) {
      const v = await prisma.case.findFirst({ where: { caseNumber: { equals: q, mode: 'insensitive' }, caseType: { in: [...VAWC_TYPES] } },
        select: { id: true, caseNumber: true, caseType: true, status: true } });
      if (v && isVawcType(v.caseType)) {
        out.unshift({ ...v, next: null, refusal: VAWC_HEARING_REFUSAL, eligible: false, reasons: [VAWC_HEARING_REFUSAL], warnings: [], needsReview: false, categoryVerified: false });
      }
    }
    return noStore({ success: true, data: out });
  } catch {
    return errorResponse('The cases could not be loaded right now.', 503);
  }
}
