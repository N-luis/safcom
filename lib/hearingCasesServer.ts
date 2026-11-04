import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { VAWC_TYPES } from './vawcTypes';
import { BLOTTER_ROLES } from './reporterAccess';
import { complainantName } from './hearingsServer';
import {
  hearingEligibility, nextStep, sessionTitle, partyFormsFor, kpFormName, isOpen, CLOSED_CASE_STATUSES, HEARING_STATUSES, KP_ELIGIBILITY_LABELS,
  type HearingStatus, type KpStage, type KpEligibilityState,
} from './hearings';

/**
 * The blotter cases Hearing Management lists - every case on the blotter
 * desk, scheduled or not, with where it stands for Katarungang Pambarangay
 * proceedings: its eligibility (from the officials' category decision and
 * eligibility review - never assumed), its proceedings so far, and what the
 * official looking may do with it.
 *
 * Listing follows Case Management: a blotter officer sees every blotter
 * case. Managing a case's hearings stays with the officer it is assigned to
 * (lib/hearingsServer.ts decideHearingAccess); an unassigned case shows the
 * officer they can take it. VAWC cases are never listed (RA 9262).
 */

export type { KpEligibilityState };
export type CaseHearingState = 'NOT_SCHEDULED' | 'IN_PROGRESS' | 'AWAITING_NEXT' | 'ENDED';

export const CASE_HEARING_LABELS: Record<CaseHearingState, string> = {
  NOT_SCHEDULED: 'No hearing yet', IN_PROGRESS: 'Proceeding open', AWAITING_NEXT: 'Next stage due', ENDED: 'Proceedings ended',
};

export interface HearingCaseFilters {
  q?: string | null;
  /** 'OPEN' (default: not resolved or closed), 'ANY', or one case status. */
  status?: string | null;
  eligibility?: KpEligibilityState | null;
  hearing?: CaseHearingState | null;
  page?: number;
  pageSize?: number;
}

/** At most this many cases are looked at per request - a barangay blotter is far smaller. */
const SCAN_LIMIT = 2000;

const caseSelect = {
  id: true, caseNumber: true, caseType: true, status: true, filedAt: true, assignedToId: true, residentId: true, residentName: true,
  reporterIdentityWithheld: true, reportPath: true,
  assignedTo: { select: { id: true, name: true } },
  resident: { select: { firstName: true, lastName: true } },
  intake: { select: { suggestedCaseCategory: true } },
  parties: { where: { role: 'REPORTED' }, orderBy: [{ source: 'desc' as const }, { createdAt: 'asc' as const }], select: { id: true, fullName: true, residentId: true } },
  hearings: { orderBy: [{ hearingNumber: 'asc' as const }, { createdAt: 'asc' as const }],
    select: { id: true, hearingNumber: true, stage: true, session: true, status: true, outcome: true, scheduledAt: true, assignedOfficialId: true } },
  pangkat: { select: { constitutedAt: true } },
  assessmentHistory: { where: { kind: { in: ['category_confirm', 'category_change', 'walk_in'] }, actorId: { not: null } },
    orderBy: { createdAt: 'desc' as const }, take: 1, select: { caseType: true, createdAt: true } },
  kpReviews: { orderBy: { createdAt: 'desc' as const }, take: 1,
    select: { decision: true, caseType: true, createdAt: true, note: true, version: true, checklist: true, approvedById: true } },
} satisfies Prisma.CaseSelect;

export async function listHearingCases(actor: { id: string; role: string }, f: HearingCaseFilters) {
  const role = actor.role.trim();
  const blotter = BLOTTER_ROLES.includes(role);
  const q = f.q?.trim().slice(0, 60) || null;
  const statusFilter = !f.status || f.status === 'OPEN' ? { notIn: CLOSED_CASE_STATUSES } : f.status === 'ANY' ? undefined : { equals: f.status };

  const where: Prisma.CaseWhereInput = {
    caseType: { notIn: [...VAWC_TYPES] },
    ...(statusFilter && { status: statusFilter }),
    ...(q && { OR: [
      { caseNumber: { contains: q, mode: 'insensitive' } },
      // A withheld reporter's name is never searchable - it is not shown either.
      { residentName: { contains: q, mode: 'insensitive' }, reporterIdentityWithheld: false },
      { parties: { some: { fullName: { contains: q, mode: 'insensitive' } } } },
    ] }),
  };
  const cases = await prisma.case.findMany({ where, orderBy: { filedAt: 'desc' }, take: SCAN_LIMIT, select: caseSelect });

  // Officers presiding over a case's hearing may manage it too.
  const presiding = blotter
    ? new Set(cases.filter(c => c.hearings.some(h => h.assignedOfficialId === actor.id && h.status !== 'CANCELLED')).map(c => c.id))
    : new Set<string>();

  const rows = cases.map(c => {
    const category = c.assessmentHistory[0] ?? null;
    const review = c.kpReviews[0] ?? null;
    const eligibility = hearingEligibility({
      caseType: c.caseType, status: c.status,
      verifiedCategory: category ? { caseType: category.caseType, at: category.createdAt } : null,
      review: review ? { decision: review.decision, caseType: review.caseType, at: review.createdAt, note: review.note,
        version: review.version, checklist: review.checklist, approvedById: review.approvedById } : null,
      reportPath: c.reportPath,
      aiSuggestedCategory: c.intake?.suggestedCaseCategory && c.intake.suggestedCaseCategory !== c.caseType ? c.intake.suggestedCaseCategory : null,
    });
    const eligibilityState: KpEligibilityState = eligibility.state;

    const step = nextStep(c.caseType, c.hearings, Boolean(c.pangkat?.constitutedAt));
    const open = c.hearings.filter(h => isOpen(h.status)).at(-1) ?? null;
    const held = c.hearings.filter(h => h.status === 'COMPLETED');
    const hearingState: CaseHearingState = open ? 'IN_PROGRESS'
      : !c.hearings.some(h => h.status !== 'CANCELLED') ? 'NOT_SCHEDULED'
        : step.stage ? 'AWAITING_NEXT' : 'ENDED';
    const latest = open ?? c.hearings.filter(h => h.status !== 'CANCELLED').at(-1) ?? null;

    const mine = c.assignedToId === actor.id || presiding.has(c.id);
    const canManage = role === 'admin' || (blotter && mine);
    return {
      id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status, filedAt: c.filedAt,
      complainant: complainantName(c, null),
      respondents: c.parties.map(p => ({ id: p.id, name: p.fullName || 'Not named', hasAccount: Boolean(p.residentId) })),
      eligibility: { state: eligibilityState, label: KP_ELIGIBILITY_LABELS[eligibilityState], reasons: eligibility.reasons, warnings: eligibility.warnings,
        categoryVerified: eligibility.categoryVerified },
      hearing: {
        state: hearingState, label: CASE_HEARING_LABELS[hearingState],
        latest: latest ? { id: latest.id, title: sessionTitle(latest.stage, latest.session), status: latest.status as HearingStatus,
          statusLabel: HEARING_STATUSES[latest.status as HearingStatus] ?? latest.status, scheduledAt: latest.scheduledAt } : null,
        held: held.length,
      },
      next: step.stage ? { stage: step.stage as KpStage, session: step.session, title: sessionTitle(step.stage, step.session),
        forms: partyFormsFor(step.stage).map(x => ({ ...x, name: kpFormName(x.formNo) })) } : null,
      refusal: step.refusal,
      assignedTo: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.name, me: c.assignedTo.id === actor.id } : null,
      canManage,
      canClaim: blotter && c.assignedToId === null,
    };
  });

  const counts = {
    eligibility: { PENDING_REVIEW: 0, NEEDS_VERIFICATION: 0, ELIGIBLE: 0, NOT_ELIGIBLE: 0 } as Record<KpEligibilityState, number>,
    hearing: { NOT_SCHEDULED: 0, IN_PROGRESS: 0, AWAITING_NEXT: 0, ENDED: 0 } as Record<CaseHearingState, number>,
  };
  for (const r of rows) { counts.eligibility[r.eligibility.state]++; counts.hearing[r.hearing.state]++; }

  const filtered = rows.filter(r => (!f.eligibility || r.eligibility.state === f.eligibility) && (!f.hearing || r.hearing.state === f.hearing));
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length, page, pageSize, pages, counts,
    statuses: [...new Set(rows.map(r => r.status))].sort(),
    truncated: cases.length === SCAN_LIMIT,
  };
}
export type HearingCaseRow = Awaited<ReturnType<typeof listHearingCases>>['rows'][number];

/**
 * A failed database call, for the server log: which route, the Prisma error
 * code and the last line of its message (the reason) - never the query's
 * values, which can hold names.
 */
export function logRouteError(where: string, e: unknown) {
  const err = e as { name?: string; code?: string; message?: string };
  const reason = (err?.message ?? String(e)).split('\n').map(s => s.trim()).filter(Boolean).at(-1)?.slice(0, 300);
  console.error(`[${where}]`, err?.name ?? 'Error', err?.code ?? '', reason ?? '');
}
