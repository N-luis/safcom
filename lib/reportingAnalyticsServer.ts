/**
 * Reporting analytics, read from the database: the summary, completeness,
 * officer-reviewed classification, AI review, reported case types, and the
 * VAWC women-and-children statistics - all from one filtered set of reports,
 * so every chart answers the same question.
 *
 * The date basis is the date reported (Case.filedAt) throughout; age is taken
 * at the incident. Which cases may be counted, and which may be listed, comes
 * from the caller's role (lib/analyticsServer analyticsContext), never from
 * the page: VAWC figures only for roles allowed VAWC statistics, VAWC case
 * rows only for roles that may open VAWC cases, and small VAWC counts
 * withheld from everyone else. No name, address, contact or narrative is read
 * for or returned by any figure here.
 */
import type { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { VAWC_TYPES } from './vawcTypes';
import { BLOTTER_CATEGORIES } from './classificationSchema';
import type { AnalyticsContext } from './analyticsServer';
import {
  ABUSE_KEYS, ABUSE_TYPES, abuseTypesOf, aiBucket, classificationBucket, completenessBucket, demographicOf, intakeIncidentDate,
  isVawcType, personKeyOf, shownCount, victimFromIntake, type AbuseType, type DeskFilter, type GroupFilter, type VictimRecord,
} from './reportingStats';

type Where = Record<string, unknown>;

export interface ReportingFilters { desk: 'BLOTTER' | 'VAWC' | 'all'; group: GroupFilter; type: string }

/** The filters asked for, narrowed to what the role and the page allow. */
export function reportingFilters(req: NextRequest, ctx: AnalyticsContext): ReportingFilters {
  const sp = req.nextUrl.searchParams;
  const askedDesk = (sp.get('desk') ?? 'all') as DeskFilter;
  let group = (['women', 'children', 'both'].includes(sp.get('group') ?? '') ? sp.get('group') : 'all') as GroupFilter;
  let desk: ReportingFilters['desk'] = askedDesk === 'BLOTTER' || askedDesk === 'VAWC' ? askedDesk : 'all';
  if (ctx.scope === 'blotter') desk = 'BLOTTER';
  if (ctx.scope === 'vawc') desk = 'VAWC';
  // Women and children are recorded on VAWC cases only: the group narrows to
  // the VAWC desk, and means nothing on the blotter's (it is not applied there).
  if (desk === 'BLOTTER') group = 'all';
  else if (group !== 'all') desk = 'VAWC';
  const type = (sp.get('type') ?? '').trim().slice(0, 80);
  return { desk, group, type };
}

const deskWhere = (desk: ReportingFilters['desk']): Where =>
  desk === 'VAWC' ? { caseType: { in: [...VAWC_TYPES] } } : desk === 'BLOTTER' ? { caseType: { notIn: [...VAWC_TYPES] } } : {};

const HISTORY_KINDS = ['category_confirm', 'category_change', 'officer_confirm', 'officer_override', 'preliminary', 'walk_in', 'ai_reassessment'];

/** Every report in the filters, with what each figure needs - and nothing that identifies a person. */
async function loadReports(ctx: AnalyticsContext, f: ReportingFilters) {
  const scopeWhere: Where = ctx.scope === 'vawc' ? { caseType: { in: [...VAWC_TYPES] } } : ctx.scope === 'blotter' ? { caseType: { notIn: [...VAWC_TYPES] } } : {};
  const filed: Where = ctx.from || ctx.to ? { filedAt: { ...(ctx.from && { gte: ctx.from }), ...(ctx.to && { lte: ctx.to }) } } : {};
  const blotterType = f.type && !f.type.startsWith('abuse:') ? { caseType: f.type } : {};
  const rows = await prisma.case.findMany({
    where: { AND: [scopeWhere, deskWhere(f.desk), filed, blotterType] },
    orderBy: { filedAt: 'desc' },
    take: 5000,
    select: {
      id: true, caseNumber: true, caseType: true, status: true, triageStatus: true, informationCompleteness: true, filedAt: true, incidentDate: true,
      intake: { select: { assessmentStatus: true, informationCompleteness: true } },
      assessmentHistory: { where: { kind: { in: HISTORY_KINDS } }, orderBy: { createdAt: 'desc' }, select: { kind: true, caseType: true, previousCaseType: true } },
      officialIntake: { select: { formType: true, status: true, responses: true } },
      victimSurvivors: { where: { removedAt: null }, select: { id: true, sexAtBirth: true, birthDate: true, ageAtIncident: true, clientCode: true } },
    },
  });

  const reports = rows.map(c => {
    const vawc = isVawcType(c.caseType);
    const intakeDone = vawc && c.officialIntake?.formType === 'VAWC_INTAKE' && c.officialIntake.status === 'COMPLETED';
    const responses = intakeDone ? c.officialIntake!.responses : null;
    const categoryReviewed = c.assessmentHistory.some(h => h.kind === 'category_confirm' || h.kind === 'category_change');
    const abuse = vawc ? abuseTypesOf({ caseType: c.caseType, categoryReviewed, intakeCompleted: Boolean(intakeDone),
      intakeViolence: (responses as Record<string, { value?: unknown }> | null)?.typeOfViolence?.value }) : null;
    // Recorded victim-survivors; while none is recorded, the person on a completed intake form.
    const fromIntake = vawc && !c.victimSurvivors.length && intakeDone ? victimFromIntake(c.id, responses) : null;
    const victims: VictimRecord[] = vawc ? (c.victimSurvivors.length ? c.victimSurvivors : fromIntake ? [fromIntake] : []) : [];
    const incident = (responses ? intakeIncidentDate(responses) : null) ?? c.incidentDate ?? null;
    const people = victims.map(v => ({ key: personKeyOf(v), group: demographicOf(v, incident, c.filedAt), coded: Boolean(v.clientCode) }));
    return {
      id: c.id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status, filedAt: c.filedAt, desk: vawc ? 'VAWC' as const : 'BLOTTER' as const,
      completeness: completenessBucket(c),
      classification: classificationBucket(c.assessmentHistory),
      ai: aiBucket(c.assessmentHistory, Boolean(c.intake)),
      reruns: c.assessmentHistory.filter(h => h.kind === 'ai_reassessment').length,
      abuse, people,
      hasWoman: people.some(p => p.group === 'woman'),
      hasChild: people.some(p => p.group === 'child'),
    };
  });

  // The filters that need the records themselves.
  const abuseType = f.type.startsWith('abuse:') ? f.type.slice(6) as AbuseType : null;
  return reports.filter(r =>
    (!abuseType || (r.abuse?.types.includes(abuseType) ?? false))
    && (f.group === 'all' || (f.group === 'women' ? r.hasWoman : f.group === 'children' ? r.hasChild : r.hasWoman && r.hasChild)));
}
type Report = Awaited<ReturnType<typeof loadReports>>[number];

const tally = <K extends string>(list: Report[], keys: readonly K[], of: (r: Report) => string) =>
  Object.fromEntries(keys.map(k => [k, list.filter(r => of(r) === k).length])) as Record<K, number>;

export async function reportingAnalytics(ctx: AnalyticsContext, f: ReportingFilters) {
  const list = await loadReports(ctx, f);
  const exact = ctx.maySeeVawcRows;
  const vawcList = list.filter(r => r.desk === 'VAWC');
  const blotterList = list.filter(r => r.desk === 'BLOTTER');
  const vawcInScope = f.desk !== 'BLOTTER' && ctx.scope !== 'blotter';
  const blotterInScope = f.desk !== 'VAWC' && ctx.scope !== 'vawc';
  // A VAWC count shown to someone who may not open the cases: small ones withheld.
  const vc = (n: number) => shownCount(n, exact);

  const completeness = tally(list, ['complete', 'incomplete', 'awaitingClarification', 'unassessed'] as const, r => r.completeness);
  const classification = tally(list, ['confirmed', 'misrouted', 'recategorized', 'unreviewed'] as const, r => r.classification);
  const ai = tally(list, ['confirmed', 'revised', 'awaiting', 'none'] as const, r => r.ai);

  // ── Reported case types ──
  const blotterTypes = new Map<string, number>();
  for (const r of blotterList) blotterTypes.set(r.caseType, (blotterTypes.get(r.caseType) ?? 0) + 1);
  const abuseCount = Object.fromEntries(ABUSE_KEYS.map(k => [k, vawcList.filter(r => r.abuse?.types.includes(k)).length])) as Record<AbuseType, number>;
  const vawcCategories = new Map<string, number>();
  for (const r of vawcList) vawcCategories.set(r.caseType, (vawcCategories.get(r.caseType) ?? 0) + 1);

  // ── Women and children: people counted once each, cases once each ──
  const keysOf = (g: string) => new Set(vawcList.flatMap(r => r.people.filter(p => p.group === g).map(p => p.key)));
  const allPeople = new Set(vawcList.flatMap(r => r.people.map(p => p.key)));
  const women = keysOf('woman'), children = keysOf('child');
  const notRecorded = new Set([...keysOf('not_recorded'), ...keysOf('female_age_unknown')]);

  return {
    range: { from: ctx.from, to: ctx.to }, dateBasis: 'reported' as const,
    // What this role may draw on - the page offers only these desks.
    scope: ctx.scope, maySeeVawcRows: ctx.maySeeVawcRows,
    filters: { desk: f.desk, group: f.group, type: f.type },
    total: list.length,
    summary: { total: list.length, complete: completeness.complete, awaitingClarification: completeness.awaitingClarification, awaitingReview: ai.awaiting },
    completeness, classification,
    ai: { ...ai, reruns: list.reduce((n, r) => n + r.reruns, 0), rerunCases: list.filter(r => r.reruns > 0).length },
    caseTypes: {
      blotter: blotterInScope ? {
        cases: blotterList.length,
        types: [...blotterTypes.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      } : null,
      vawc: vawcInScope ? {
        cases: vc(vawcList.length),
        types: ABUSE_KEYS.map(k => ({ key: k, label: ABUSE_TYPES[k], count: vc(abuseCount[k]) })),
        withAnyType: vc(vawcList.filter(r => r.abuse?.basis === 'recorded').length),
        multiType: vc(vawcList.filter(r => (r.abuse?.types.length ?? 0) > 1).length),
        awaitingReview: vc(vawcList.filter(r => r.abuse?.basis === 'awaiting_review').length),
        otherCategory: vc(vawcList.filter(r => r.abuse?.basis === 'other_category').length),
        categories: [...vawcCategories.entries()].map(([type, count]) => ({ type, count: vc(count) }))
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.type.localeCompare(b.type)),
      } : null,
    },
    people: vawcInScope ? {
      exact,
      persons: {
        women: vc(women.size), children: vc(children.size), notRecorded: vc(notRecorded.size),
        total: vc(allPeople.size),
        withoutClientCode: vc(new Set(vawcList.flatMap(r => r.people.filter(p => !p.coded).map(p => p.key))).size),
      },
      cases: {
        total: vc(vawcList.length),
        withWomen: vc(vawcList.filter(r => r.hasWoman).length),
        withChildren: vc(vawcList.filter(r => r.hasChild).length),
        withBoth: vc(vawcList.filter(r => r.hasWoman && r.hasChild).length),
        noVictimRecorded: vc(vawcList.filter(r => r.people.length === 0).length),
        someNotRecorded: vc(vawcList.filter(r => r.people.some(p => p.group === 'not_recorded' || p.group === 'female_age_unknown')).length),
        multipleVictims: vc(vawcList.filter(r => r.people.length > 1).length),
      },
    } : null,
  };
}

/** The filter's case-type choices: the blotter categories in use or defined, and the four RA 9262 types for the VAWC desk. */
export async function reportingTypeOptions(ctx: AnalyticsContext) {
  const inUse = ctx.scope === 'vawc' ? [] : await prisma.case.groupBy({ by: ['caseType'], where: { caseType: { notIn: [...VAWC_TYPES] } }, _count: true });
  const blotter = [...new Set([...BLOTTER_CATEGORIES.map(c => c.category), ...inUse.map(r => r.caseType)])].sort((a, b) => a.localeCompare(b));
  return { blotter, vawc: ABUSE_KEYS.map(k => ({ value: `abuse:${k}`, label: ABUSE_TYPES[k] })) };
}

// ── The filtered case list behind a chart segment ────────────────────────────

const SEGMENT = /^(all|completeness:(complete|incomplete|awaitingClarification|unassessed)|classification:(confirmed|misrouted|recategorized|unreviewed)|ai:(confirmed|revised|awaiting|none|rerun)|blotterType:.{1,80}|vawcCategory:.{1,80}|abuse:(physical|psychological|sexual|economic|awaiting_review|other_category)|people:(women|children|both|none|not_recorded))$/;
export const isSegment = (s: string) => SEGMENT.test(s);

function inSegment(r: Report, seg: string): boolean {
  const [kind, value] = [seg.slice(0, seg.indexOf(':') < 0 ? seg.length : seg.indexOf(':')), seg.slice(seg.indexOf(':') + 1)];
  switch (kind) {
    case 'all': return true;
    case 'completeness': return r.completeness === value;
    case 'classification': return r.classification === value;
    case 'ai': return value === 'rerun' ? r.reruns > 0 : r.ai === value;
    case 'blotterType': return r.desk === 'BLOTTER' && r.caseType === value;
    case 'vawcCategory': return r.desk === 'VAWC' && r.caseType === value;
    case 'abuse': return r.desk === 'VAWC' && (value === 'awaiting_review' || value === 'other_category' ? r.abuse?.basis === value : (r.abuse?.types.includes(value as AbuseType) ?? false));
    case 'people': return r.desk === 'VAWC' && (value === 'women' ? r.hasWoman : value === 'children' ? r.hasChild : value === 'both' ? r.hasWoman && r.hasChild
      : value === 'none' ? r.people.length === 0 : r.people.some(p => p.group === 'not_recorded' || p.group === 'female_age_unknown'));
    default: return false;
  }
}

/**
 * The cases behind one segment, for the people allowed to open them: a case
 * reference, its category, desk, status and date reported - nothing about a
 * person. VAWC cases are listed only for roles that may open them; the rest
 * are counted as not shown.
 */
/** Segments made only of VAWC cases - listed only for roles that may open VAWC cases. */
export const isVawcOnlySegment = (s: string) => /^(abuse|people|vawcCategory):/.test(s);

export async function reportingCases(ctx: AnalyticsContext, f: ReportingFilters, segment: string) {
  const list = (await loadReports(ctx, f)).filter(r => inSegment(r, segment));
  const listable = list.filter(r => r.desk !== 'VAWC' || ctx.maySeeVawcRows);
  return {
    segment, total: listable.length,
    // Never how many were left out: for a role without VAWC case access that
    // number would itself say something about the VAWC caseload.
    vawcWithheld: !ctx.maySeeVawcRows && f.desk !== 'BLOTTER' && ctx.scope !== 'blotter',
    cases: listable.slice(0, 200).map(r => ({ id: r.id, caseNumber: r.caseNumber, caseType: r.caseType, desk: r.desk, status: r.status, filedAt: r.filedAt })),
  };
}
