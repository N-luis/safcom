/**
 * Reporting analytics: how each figure is counted. Pure - shared by the
 * server (lib/reportingAnalyticsServer.ts), the page and the tests.
 *
 * Nothing here guesses. Sex is what an official recorded, never read from a
 * name or the narrative; age is at the incident, from a birthdate or as
 * recorded; an abuse type is what an official recorded or confirmed, never an
 * AI keyword match. Whatever is not recorded is counted as "not recorded".
 */
import { VAWC_TYPES } from './vawcTypes';
import { CLOSED_STATUSES, completenessOf, categoryVerdict } from './analytics';

export const isVawcType = (t: string) => (VAWC_TYPES as readonly string[]).includes(t);

// ── Filters ──────────────────────────────────────────────────────────────────

export const PERIODS = { d7: 'Last 7 days', d30: 'Last 30 days', d90: 'Last 90 days', year: 'This year', custom: 'Custom date range' } as const;
export type Period = keyof typeof PERIODS;
export const DESKS = { all: 'All desks', BLOTTER: 'Blotter', VAWC: 'VAWC' } as const;
export type DeskFilter = keyof typeof DESKS;
export const GROUPS = { all: 'All', women: 'Women', children: 'Children', both: 'Women and children' } as const;
export type GroupFilter = keyof typeof GROUPS;

// ── RA 9262 abuse types ──────────────────────────────────────────────────────

/** The four forms of violence in RA 9262 sec. 3(a). */
export const ABUSE_TYPES = {
  physical: 'Physical abuse',
  psychological: 'Psychological abuse',
  sexual: 'Sexual abuse',
  economic: 'Economic abuse',
} as const;
export type AbuseType = keyof typeof ABUSE_TYPES;
export const ABUSE_KEYS = Object.keys(ABUSE_TYPES) as AbuseType[];

/** The VAWC intake form's item 31, "Intimate partner violence against women and their children" - the RA 9262 options only. */
const INTAKE_TYPES: Record<string, AbuseType> = {
  ipv_physical: 'physical', ipv_psychological: 'psychological', ipv_sexual: 'sexual', ipv_economic: 'economic',
};
/** Case categories that name one RA 9262 type exactly. Others (Domestic Violence, Stalking, ...) name none of the four on their own. */
const CATEGORY_TYPES: Record<string, AbuseType> = {
  'Physical Abuse': 'physical', 'Emotional Abuse': 'psychological', 'Sexual Violence': 'sexual', 'Economic Abuse': 'economic',
};

export type AbuseBasis = 'recorded' | 'awaiting_review' | 'other_category';
/**
 * A VAWC case's RA 9262 types, from what officials recorded: the types ticked
 * on a completed VAWC intake form, and the case category once an official
 * confirmed or changed it. One case may have several. An AI-suggested
 * category that no official reviewed adds nothing.
 */
export function abuseTypesOf(c: { caseType: string; categoryReviewed: boolean; intakeCompleted: boolean; intakeViolence: unknown }):
  { types: AbuseType[]; basis: AbuseBasis } {
  const set = new Set<AbuseType>();
  if (c.intakeCompleted && Array.isArray(c.intakeViolence)) {
    for (const v of c.intakeViolence) if (typeof v === 'string' && INTAKE_TYPES[v]) set.add(INTAKE_TYPES[v]);
  }
  if (c.categoryReviewed && CATEGORY_TYPES[c.caseType]) set.add(CATEGORY_TYPES[c.caseType]);
  const types = ABUSE_KEYS.filter(k => set.has(k));
  if (types.length) return { types, basis: 'recorded' };
  return { types, basis: c.categoryReviewed || c.intakeCompleted ? 'other_category' : 'awaiting_review' };
}

// ── Victim-survivors: women and children ─────────────────────────────────────

/** Under 18 at the incident - RA 9262 sec. 3(h), as the intake form uses it. */
export const CHILD_UNDER = 18;

/** Full years between a birthdate and a day. */
export function ageOn(birth: Date, on: Date): number {
  const b = new Date(birth), d = new Date(on);
  let a = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

export interface VictimRecord {
  /** The row's own id (or the case's, for one read from the intake form). */
  id: string;
  sexAtBirth: string | null;
  birthDate: Date | null;
  ageAtIncident: number | null;
  clientCode: string | null;
}

/**
 * Age at the incident: as recorded; else from the birthdate and the incident
 * date. Without an incident date, the age on the day reported decides only
 * when it already shows a child (the incident came before the report) -
 * otherwise it is not known.
 */
export function ageAtIncident(v: VictimRecord, incidentDate: Date | null, reportedAt: Date): { age: number | null; childByReportDate: boolean } {
  if (v.ageAtIncident !== null && v.ageAtIncident !== undefined) return { age: v.ageAtIncident, childByReportDate: false };
  if (v.birthDate && incidentDate) return { age: ageOn(v.birthDate, incidentDate), childByReportDate: false };
  if (v.birthDate && ageOn(v.birthDate, reportedAt) < CHILD_UNDER) return { age: null, childByReportDate: true };
  return { age: null, childByReportDate: false };
}

export type Demographic = 'woman' | 'child' | 'other_adult' | 'female_age_unknown' | 'not_recorded';
/**
 * Which group a victim-survivor was in at the incident. A woman: recorded
 * female, 18 or over. A child: under 18, whatever the sex. Anyone whose sex or
 * age is missing where it matters is "not recorded" - never zero, never guessed.
 */
export function demographicOf(v: VictimRecord, incidentDate: Date | null, reportedAt: Date): Demographic {
  const { age, childByReportDate } = ageAtIncident(v, incidentDate, reportedAt);
  if (childByReportDate || (age !== null && age < CHILD_UNDER)) return 'child';
  if (age !== null) return v.sexAtBirth === 'female' ? 'woman' : v.sexAtBirth ? 'other_adult' : 'not_recorded';
  return v.sexAtBirth === 'female' ? 'female_age_unknown' : 'not_recorded';
}

/** One person across cases: the same VAWC client code. Never a name. Without a code, the record counts as its own person. */
export const normalizeClientCode = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ') || null;
export const personKeyOf = (v: VictimRecord) => (normalizeClientCode(v.clientCode) ? `code:${normalizeClientCode(v.clientCode)}` : `rec:${v.id}`);

/** Read the victim-survivor from a completed VAWC intake form (Section B) - used only while no victim-survivor is recorded on the case. */
export function victimFromIntake(caseId: string, responses: unknown): VictimRecord | null {
  const r = (responses ?? {}) as Record<string, { value?: unknown } | undefined>;
  const str = (k: string) => (typeof r[k]?.value === 'string' ? (r[k]!.value as string).trim() : '');
  const sex = str('sexAtBirth');
  const birth = str('birthdate');
  const ageText = str('age');
  const age = /^\d{1,3}$/.test(ageText) ? Number(ageText) : null;
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birth) ? new Date(`${birth}T00:00:00Z`) : null;
  if (!sex && !birthDate && age === null) return null;
  return { id: `intake:${caseId}`, sexAtBirth: ['female', 'male', 'intersex'].includes(sex) ? sex : null, birthDate,
    // The form's age is the age at the interview, not at the incident; it is used only through the birthdate rule.
    ageAtIncident: null, clientCode: normalizeClientCode(str('clientCode')) };
}
/** The intake form's own incident date (item 33), when recorded. */
export function intakeIncidentDate(responses: unknown): Date | null {
  const v = ((responses ?? {}) as Record<string, { value?: unknown } | undefined>).incidentDate?.value;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
}

// ── Small counts ─────────────────────────────────────────────────────────────

/** Below this, an aggregate shown to someone who may not open the cases is withheld. */
export const SUPPRESS_BELOW = 3;
/** A count for an aggregate-only viewer: exact at 0 or SUPPRESS_BELOW and over, otherwise null (shown "fewer than 3"). */
export const shownCount = (n: number, exact: boolean): number | null => (exact || n === 0 || n >= SUPPRESS_BELOW ? n : null);

// ── Completeness, classification and AI review, one case at a time ───────────

export type CompletenessBucket = 'complete' | 'incomplete' | 'awaitingClarification' | 'unassessed';
/**
 * Each report in exactly one segment. An open report waiting for the
 * reporter's clarification is shown there, whatever its completeness; the
 * rest by how much detail the report gives - never whether it is true.
 */
export function completenessBucket(c: { status: string; triageStatus: string | null; informationCompleteness: string | null;
  intake: { assessmentStatus: string | null; informationCompleteness: string | null } | null }): CompletenessBucket {
  const open = !CLOSED_STATUSES.includes(c.status);
  if (open && (c.triageStatus === 'NEEDS_FOLLOW_UP' || c.intake?.assessmentStatus === 'NEEDS_MORE_INFORMATION')) return 'awaitingClarification';
  return completenessOf(c.informationCompleteness ?? c.intake?.informationCompleteness);
}

export type ClassificationBucket = 'confirmed' | 'misrouted' | 'recategorized' | 'unreviewed';
export function classificationBucket(history: { kind: string; caseType: string | null; previousCaseType: string | null }[]): ClassificationBucket {
  return categoryVerdict(history) ?? 'unreviewed';
}

export type AiBucket = 'confirmed' | 'revised' | 'awaiting' | 'none';
/** The officer's latest word on the AI assessment, kept apart from the AI's own result. */
export function aiBucket(history: { kind: string }[], hasIntake: boolean): AiBucket {
  const decision = history.find(h => h.kind === 'officer_confirm' || h.kind === 'officer_override');
  if (decision?.kind === 'officer_confirm') return 'confirmed';
  if (decision?.kind === 'officer_override') return 'revised';
  const assessed = hasIntake || history.some(h => h.kind === 'preliminary' || h.kind === 'walk_in' || h.kind === 'ai_reassessment');
  return assessed ? 'awaiting' : 'none';
}
