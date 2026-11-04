/**
 * The Analytics figures, read from the database.
 *
 * Which cases a figure may draw on is decided here, per request, from the
 * caller's role - never from the page asking:
 *   - counts may include VAWC cases for the roles allowed VAWC statistics;
 *   - rows (a case number, an officer, a recommendation) include VAWC cases
 *     only for the roles that may open them;
 *   - everyone else is held to the blotter caseload, whatever they ask for.
 *
 * No narrative, name, contact detail or coordinate leaves through here.
 */
import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { requireAuth, errorResponse } from './auth';
import { canSeeVawc, canSeeVawcStatistics } from './caseAccess';
import { VAWC_TYPES } from './vawcTypes';
import {
  STATUS_GROUPS, CLOSED_STATUSES, parseRange, latestAi, emergencyReasons, isHighPriority, priorityOrder,
  completenessOf, categoryVerdict, deskOf, KP_STAGES, KP_STAGE_KEYS, type AnalyticsScope, type StatusGroup,
} from './analytics';
import { sessionTitle } from './hearings';

type Where = Record<string, unknown>;

export interface AnalyticsContext {
  scope: AnalyticsScope;
  /** Cases a count may include. */
  countsWhere: Where;
  /** Cases a row may show. */
  rowsWhere: Where;
  maySeeVawcRows: boolean;
  from: Date | null;
  to: Date | null;
  category: string | null;
}

/** The caller, the cases they may draw on, and the filters asked for - or a response refusing it. */
export async function analyticsContext(req: NextRequest): Promise<AnalyticsContext | { error: Response }> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const sp = req.nextUrl.searchParams;
  const role = auth.user.role;
  const counts = canSeeVawcStatistics(role);
  const rows = canSeeVawc(role);
  const asked = sp.get('scope');
  const requested: AnalyticsScope = asked === 'vawc' || asked === 'blotter' ? asked : 'all';
  // A scope is a request, not a permission.
  const scope: AnalyticsScope = counts ? requested : 'blotter';

  const typeWhere = (s: AnalyticsScope): Where =>
    s === 'vawc' ? { caseType: { in: [...VAWC_TYPES] } } : s === 'blotter' ? { caseType: { notIn: [...VAWC_TYPES] } } : {};
  const notVawc: Where = { caseType: { notIn: [...VAWC_TYPES] } };

  // A category outside the scope (a VAWC type on the blotter board) matches nothing.
  const category = sp.get('category')?.trim() || null;
  const categoryWhere: Where = category ? { caseType: category } : {};

  const countsWhere: Where = { AND: [typeWhere(scope), categoryWhere] };
  const rowsWhere: Where = rows ? countsWhere : { AND: [typeWhere(scope), categoryWhere, notVawc] };
  const { from, to } = parseRange(sp.get('from'), sp.get('to'));
  return { scope, countsWhere, rowsWhere, maySeeVawcRows: rows, from, to, category };
}

const filedIn = (ctx: AnalyticsContext): Where =>
  ctx.from || ctx.to ? { filedAt: { ...(ctx.from && { gte: ctx.from }), ...(ctx.to && { lte: ctx.to }) } } : {};

export function failed(): Response {
  return errorResponse('These figures could not be loaded right now.', 503);
}

// ── 1. Case overview ─────────────────────────────────────────────────────────

export async function caseOverview(ctx: AnalyticsContext) {
  const [byStatus, newReports, urgentOpen] = await Promise.all([
    prisma.case.groupBy({ by: ['status'], where: ctx.countsWhere, _count: true }),
    prisma.case.count({ where: { AND: [ctx.countsWhere, filedIn(ctx)] } }),
    prisma.case.count({ where: { AND: [ctx.countsWhere, { triageStatus: 'URGENT_REVIEW', status: { notIn: CLOSED_STATUSES } }] } }),
  ]);
  const total = byStatus.reduce((n, s) => n + s._count, 0);
  const groups = Object.fromEntries(Object.entries(STATUS_GROUPS).map(([k, g]) => [k,
    byStatus.filter(s => (g.statuses as readonly string[]).includes(s.status)).reduce((n, s) => n + s._count, 0)])) as Record<StatusGroup, number>;
  const other = total - Object.values(groups).reduce((a, b) => a + b, 0);
  return { total, ...groups, other, newReports, urgentOpen, range: { from: ctx.from, to: ctx.to } };
}

// ── 3. High-priority cases ───────────────────────────────────────────────────

export async function highPriority(ctx: AnalyticsContext) {
  // Candidates: open, and flagged or high anywhere it is recorded. The final
  // test is isHighPriority, the same rule the page explains.
  const cases = await prisma.case.findMany({
    where: {
      AND: [ctx.rowsWhere, { status: { notIn: CLOSED_STATUSES } }, {
        OR: [
          { triageStatus: 'URGENT_REVIEW' },
          { riskLevel: { in: ['High', 'Critical'] } },
          { intake: { is: { OR: [{ immediateSafetyConcern: true }, { urgentReview: true }, { matrixLevel: { gte: 4 } }] } } },
          { safetyAssessment: { is: { OR: [{ immediateConcern: 'yes' }, { urgentAssistance: 'yes' }] } } },
          { assessmentHistory: { some: { kind: 'ai_reassessment', matrixLevel: { gte: 4 } } } },
          // An AI urgent recommendation lives in the stored reading: fetched and checked below.
          { intake: { isNot: null } },
          { assessmentHistory: { some: { kind: 'ai_reassessment' } } },
        ],
      }],
    },
    take: 3000,
    orderBy: { filedAt: 'desc' },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, triageStatus: true,
      filedAt: true, updatedAt: true, lastOfficerActionAt: true,
      assignedTo: { select: { name: true } },
      intake: { select: { createdAt: true, framework: true, matrixLevel: true, matrixLabel: true, assessmentStatus: true,
        aiReading: true, immediateSafetyConcern: true, urgentReview: true } },
      safetyAssessment: { select: { immediateConcern: true, urgentAssistance: true } },
      assessmentHistory: {
        where: { kind: 'ai_reassessment' }, orderBy: { createdAt: 'desc' }, take: 1,
        select: { createdAt: true, framework: true, matrixLevel: true, matrixLabel: true, rationale: true },
      },
      activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });
  const rows = cases.map(c => {
    const ai = latestAi(c.intake, c.assessmentHistory[0] ?? null);
    const input = { status: c.status, riskLevel: c.riskLevel, triageStatus: c.triageStatus,
      intake: c.intake ? { immediateSafetyConcern: c.intake.immediateSafetyConcern, urgentReview: c.intake.urgentReview } : null,
      safety: c.safetyAssessment, ai };
    const latest = [c.updatedAt, c.lastOfficerActionAt, c.activities[0]?.createdAt].filter((d): d is Date => Boolean(d))
      .reduce((a, b) => (b > a ? b : a));
    return { input, filedAt: c.filedAt, row: {
      id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, desk: deskOf(c.caseType), status: c.status,
      officialRiskLevel: c.riskLevel, triageStatus: c.triageStatus,
      ai, emergency: emergencyReasons(input),
      assignedOfficer: c.assignedTo?.name ?? null, filedAt: c.filedAt, latestUpdate: latest,
    } };
  }).filter(x => isHighPriority(x.input));
  rows.sort((a, b) => priorityOrder({ ...a.input, filedAt: a.filedAt }, { ...b.input, filedAt: b.filedAt }));
  return {
    total: rows.length,
    emergencies: rows.filter(r => r.row.emergency.length > 0).length,
    cases: rows.slice(0, 100).map(r => r.row),
  };
}

// ── 4. Correct reporting ─────────────────────────────────────────────────────

export async function correctReporting(ctx: AnalyticsContext) {
  const cases = await prisma.case.findMany({
    where: { AND: [ctx.countsWhere, filedIn(ctx)] },
    take: 5000,
    select: {
      id: true, caseNumber: true, caseType: true, status: true, triageStatus: true, informationCompleteness: true, filedAt: true,
      intake: { select: { assessmentStatus: true, informationCompleteness: true } },
      assessmentHistory: {
        where: { kind: { in: ['category_confirm', 'category_change', 'officer_confirm', 'officer_override', 'preliminary', 'walk_in', 'ai_reassessment'] } },
        orderBy: { createdAt: 'desc' },
        select: { kind: true, caseType: true, previousCaseType: true },
      },
    },
  });
  const count = { complete: 0, incomplete: 0, unassessed: 0, awaitingClarification: 0, confirmed: 0, misrouted: 0, recategorized: 0,
    categoryUnreviewed: 0, aiAgreed: 0, aiRevised: 0, aiAwaitingReview: 0, aiReruns: 0 };
  const awaiting: { id: string; caseNumber: string; caseType: string; desk: string; filedAt: Date }[] = [];
  const misrouted: typeof awaiting = [];
  const vawcRowOk = (t: string) => ctx.maySeeVawcRows || deskOf(t) !== 'VAWC';
  for (const c of cases) {
    count[completenessOf(c.informationCompleteness ?? c.intake?.informationCompleteness)]++;
    const open = !CLOSED_STATUSES.includes(c.status);
    if (open && (c.triageStatus === 'NEEDS_FOLLOW_UP' || c.intake?.assessmentStatus === 'NEEDS_MORE_INFORMATION')) {
      count.awaitingClarification++;
      if (vawcRowOk(c.caseType)) awaiting.push({ id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, desk: deskOf(c.caseType), filedAt: c.filedAt });
    }
    const verdict = categoryVerdict(c.assessmentHistory);
    if (verdict) {
      count[verdict]++;
      if (verdict === 'misrouted' && vawcRowOk(c.caseType)) misrouted.push({ id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, desk: deskOf(c.caseType), filedAt: c.filedAt });
    } else count.categoryUnreviewed++;
    // The officer's decision on the level: the latest one counts.
    const decision = c.assessmentHistory.find(h => h.kind === 'officer_confirm' || h.kind === 'officer_override');
    const assessed = c.assessmentHistory.some(h => h.kind === 'preliminary' || h.kind === 'walk_in' || h.kind === 'ai_reassessment') || Boolean(c.intake);
    if (decision?.kind === 'officer_confirm') count.aiAgreed++;
    else if (decision?.kind === 'officer_override') count.aiRevised++;
    else if (assessed) count.aiAwaitingReview++;
    count.aiReruns += c.assessmentHistory.filter(h => h.kind === 'ai_reassessment').length;
  }
  return {
    total: cases.length, ...count,
    awaiting: awaiting.slice(0, 15), misroutedCases: misrouted.slice(0, 15),
    range: { from: ctx.from, to: ctx.to },
  };
}

// ── 5. Hearing management (and the VAWC desk's separate track) ───────────────

export async function hearingManagement(ctx: AnalyticsContext) {
  const now = new Date();
  // Hearings are blotter-only by construction; the filter keeps it so if a
  // case is later moved to the VAWC desk.
  const blotterRows: Where = { AND: [ctx.rowsWhere, { caseType: { notIn: [...VAWC_TYPES] } }] };
  const inRange = ctx.from || ctx.to ? { scheduledAt: { ...(ctx.from && { gte: ctx.from }), ...(ctx.to && { lte: ctx.to }) } } : {};
  const blotterInScope = ctx.scope !== 'vawc';

  // Every count follows the date range, on the hearing's date, except the
  // upcoming ones: a hearing still to come is counted whatever the range.
  // Drafts are not hearings yet and are left out.
  const LIVE = ['SCHEDULED', 'NOTICE_ISSUED', 'ACKNOWLEDGED', 'RESCHEDULED'];
  const [hearings, upcoming] = blotterInScope ? await Promise.all([
    prisma.caseHearing.findMany({
      where: { case: blotterRows, ...inRange, status: { not: 'DRAFT' } },
      select: { stage: true, status: true, outcome: true, scheduledAt: true, rescheduleCount: true },
    }),
    prisma.caseHearing.findMany({
      where: { case: blotterRows, status: { in: LIVE } },
      orderBy: { scheduledAt: 'asc' }, take: 1000,
      select: { id: true, hearingNumber: true, stage: true, session: true, scheduledAt: true, venue: true, status: true,
        case: { select: { id: true, caseNumber: true, caseType: true } } },
    }),
  ]) : [[], []];
  const count = (f: (h: (typeof hearings)[number]) => boolean, stage?: string) => hearings.filter(h => (stage === undefined || h.stage === stage) && f(h)).length;
  const isUpcoming = (h: { status: string; scheduledAt: Date }) => LIVE.includes(h.status) && h.scheduledAt >= now;
  // The Katarungang Pambarangay stages: mediation, constitution of the Pangkat, conciliation.
  const byStage = KP_STAGE_KEYS.map(stage => ({
    stage, label: KP_STAGES[stage].label,
    total: count(() => true, stage),
    // Still to come, whatever the range.
    scheduled: upcoming.filter(h => h.stage === stage && h.scheduledAt >= now).length,
    completed: count(h => h.status === 'COMPLETED', stage),
    rescheduled: count(h => h.rescheduleCount > 0, stage),
    cancelled: count(h => h.status === 'CANCELLED', stage),
  }));

  // The VAWC desk's own track: referrals, interventions and follow-ups -
  // never hearings. Counts only, for the roles allowed them.
  let vawc = null;
  if (ctx.scope !== 'blotter') {
    const vawcCases: Where = { AND: [ctx.countsWhere, { caseType: { in: [...VAWC_TYPES] } }] };
    const [referrals, interventions, followUpsDue] = await Promise.all([
      prisma.caseReferral.groupBy({ by: ['status'], where: { case: vawcCases }, _count: true }),
      prisma.caseFollowUp.count({ where: { case: vawcCases, type: 'intervention', ...(ctx.from || ctx.to ? { createdAt: { ...(ctx.from && { gte: ctx.from }), ...(ctx.to && { lte: ctx.to }) } } : {}) } }),
      prisma.caseSafetyAssessment.count({ where: { case: vawcCases, followUpAt: { gte: now } } }),
    ]);
    vawc = {
      referrals: Object.fromEntries(referrals.map(r => [r.status, r._count])),
      interventions, followUpsDue,
    };
  }

  return {
    applicable: blotterInScope,
    byStage,
    upcoming: upcoming.filter(isUpcoming).slice(0, 20).map(h => ({ ...h, title: sessionTitle(h.stage, h.session), case: { ...h.case, desk: deskOf(h.case.caseType) } })),
    overdue: upcoming.filter(h => h.scheduledAt < now).length,
    // Hearings set for a date in the range (drafts aside), and what became of them.
    totalScheduled: hearings.length,
    upcomingCount: upcoming.filter(isUpcoming).length,
    completed: count(h => h.status === 'COMPLETED'),
    settled: count(h => h.status === 'COMPLETED' && h.outcome === 'SETTLED'),
    rescheduled: count(h => h.rescheduleCount > 0),
    cancelled: count(h => h.status === 'CANCELLED'),
    vawc,
    range: { from: ctx.from, to: ctx.to },
  };
}

// ── 6. Acknowledgement letters ───────────────────────────────────────────────

export async function acknowledgementLetters(ctx: AnalyticsContext) {
  const genIn = ctx.from || ctx.to ? { generatedAt: { ...(ctx.from && { gte: ctx.from }), ...(ctx.to && { lte: ctx.to }) } } : {};
  const [byStatus, withoutLetter, recent] = await Promise.all([
    prisma.acknowledgementLetter.groupBy({ by: ['status'], where: { case: ctx.countsWhere, ...genIn }, _count: true }),
    prisma.case.count({ where: { AND: [ctx.countsWhere, filedIn(ctx), { acknowledgement: { is: null } }] } }),
    prisma.acknowledgementLetter.findMany({
      where: { case: ctx.rowsWhere, ...genIn }, orderBy: { generatedAt: 'desc' }, take: 10,
      select: { id: true, letterNumber: true, status: true, generatedAt: true, issuedAt: true,
        case: { select: { id: true, caseNumber: true, caseType: true } } },
    }),
  ]);
  const n = (s: string) => byStatus.find(b => b.status === s)?._count ?? 0;
  return {
    generated: n('GENERATED') + n('ISSUED'), issued: n('ISSUED'), pending: n('GENERATED'), withoutLetter,
    recent: recent.map(l => ({ ...l, case: { ...l.case, desk: deskOf(l.case.caseType) } })),
    range: { from: ctx.from, to: ctx.to },
  };
}
