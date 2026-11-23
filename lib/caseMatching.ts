/**
 * Duplicate and related case detection - the rules, shared by the server
 * (which runs them), the screens (which explain them) and the tests.
 *
 * How a pair is judged, in order:
 *   1. the database picks the candidates (lib/caseMatchingServer.ts): the same
 *      desk only (blotter with blotter, VAWC with VAWC - never across), within
 *      a year, and something in common - similar wording, the same incident
 *      day, the same street or a nearby pin, or a similar name among the people;
 *   2. these rules turn the evidence into five indicators (HIGH / MEDIUM / LOW)
 *      and a first classification;
 *   3. Groq (when on) reads the two narratives, with names taken out, and may
 *      explain, name differences and uncertainties, and lower the
 *      classification - but its answer is used only where it is consistent
 *      with the evidence (finalClassification), and it never decides.
 *
 * Nothing here merges, deletes, rejects or confirms anything: every match is
 * a suggestion for an official, who decides (lib/caseMatchingServer.ts).
 * A shared name, a shared address or a shared category alone is never a
 * duplicate.
 */

export type Level = 'HIGH' | 'MEDIUM' | 'LOW';
export const LEVELS: Level[] = ['HIGH', 'MEDIUM', 'LOW'];
export type Classification = 'POTENTIAL_DUPLICATE' | 'RELATED_CASE' | 'NO_MATCH';
export const CLASSIFICATIONS: Classification[] = ['POTENTIAL_DUPLICATE', 'RELATED_CASE', 'NO_MATCH'];

export const INDICATOR_LABELS = {
  narrative: 'Narrative similarity',
  incident_date: 'Incident date similarity',
  location: 'Location similarity',
  people_involved: 'People involved similarity',
  circumstances: 'Incident circumstance similarity',
} as const;
export type IndicatorKey = keyof typeof INDICATOR_LABELS;
export const INDICATOR_KEYS = Object.keys(INDICATOR_LABELS) as IndicatorKey[];
export type Indicators = Record<IndicatorKey, Level>;

/** The evidence about one pair, as the database measured it. */
export interface PairEvidence {
  /** pg_trgm similarity of the two narratives (0-1), lower-cased. */
  narrativeSimilarity: number;
  /** Days between the incident dates; null when either is unknown. */
  dayGap: number | null;
  /** The same street, as the barangay's list names it. */
  sameStreet: boolean;
  /** Metres between the two pins; null when either has none. */
  metres: number | null;
  /** The best name similarity between a person on one and a person on the other (0-1); null when either names nobody. */
  peopleSimilarity: number | null;
  sameCategory: boolean;
  /** Both reports name a street, and not the same one. */
  differentStreet?: boolean;
}

/**
 * What the two reports plainly disagree on: both give an incident date and
 * they are more than 3 days apart; both name a street, the streets differ,
 * and no map pins put them within 500 m. Either one means two incidents,
 * however alike the stories - related at most, never a duplicate.
 */
export interface Conflicts { datesDiffer: boolean; placesDiffer: boolean }
export function conflictsOf(e: PairEvidence): Conflicts {
  return {
    datesDiffer: e.dayGap !== null && e.dayGap > 3,
    placesDiffer: Boolean(e.differentStreet) && !(e.metres !== null && e.metres <= 500),
  };
}
const NO_CONFLICTS: Conflicts = { datesDiffer: false, placesDiffer: false };

export const THRESHOLDS = {
  narrative: { high: 0.45, medium: 0.25 },
  people: { high: 0.8, medium: 0.6 },
  /** A candidate needs at least one of these to be looked at all. */
  candidate: { narrative: 0.2, people: 0.6, days: 7, metres: 300 },
};

export function indicatorsOf(e: PairEvidence): Indicators {
  const narrative: Level = e.narrativeSimilarity >= THRESHOLDS.narrative.high ? 'HIGH' : e.narrativeSimilarity >= THRESHOLDS.narrative.medium ? 'MEDIUM' : 'LOW';
  const incident_date: Level = e.dayGap === null ? 'LOW' : e.dayGap === 0 ? 'HIGH' : e.dayGap <= 3 ? 'MEDIUM' : 'LOW';
  const location: Level = e.sameStreet || (e.metres !== null && e.metres <= 100) ? 'HIGH' : e.metres !== null && e.metres <= 500 ? 'MEDIUM' : 'LOW';
  const people_involved: Level = e.peopleSimilarity === null ? 'LOW'
    : e.peopleSimilarity >= THRESHOLDS.people.high ? 'HIGH' : e.peopleSimilarity >= THRESHOLDS.people.medium ? 'MEDIUM' : 'LOW';
  // The rules can only see the category; the AI may say more about the circumstances.
  const circumstances: Level = e.sameCategory ? (narrative === 'LOW' ? 'MEDIUM' : 'HIGH') : narrative === 'HIGH' ? 'MEDIUM' : 'LOW';
  return { narrative, incident_date, location, people_involved, circumstances };
}

const rank = (l: Level) => (l === 'HIGH' ? 2 : l === 'MEDIUM' ? 1 : 0);
const atLeast = (l: Level, min: Level) => rank(l) >= rank(min);

/**
 * The rules' classification. A duplicate needs the same story told about the
 * same moment or place: the narrative at least MEDIUM, and the same day or
 * the same place - with the narrative HIGH, or the day, the place and the
 * people all agreeing. Related needs the same people and one more thing in
 * common (the category, the place, or the story) - the same people on another
 * day is a related case, not a duplicate. A name, an address or a category
 * on its own is never enough.
 */
export function ruleClassification(i: Indicators, c: Conflicts = NO_CONFLICTS): Classification {
  const sameMoment = i.incident_date === 'HIGH';
  const samePlace = i.location === 'HIGH';
  if (!c.datesDiffer && !c.placesDiffer && atLeast(i.narrative, 'MEDIUM') && (sameMoment || samePlace)
    && (i.narrative === 'HIGH' || (sameMoment && samePlace && atLeast(i.people_involved, 'MEDIUM')))) return 'POTENTIAL_DUPLICATE';
  if (i.people_involved === 'HIGH' && (atLeast(i.circumstances, 'MEDIUM') || atLeast(i.location, 'MEDIUM') || atLeast(i.narrative, 'MEDIUM'))) return 'RELATED_CASE';
  if (i.narrative === 'HIGH' && atLeast(i.incident_date, 'MEDIUM')) return 'RELATED_CASE';
  // The same story at the same place on another day: a recurring problem, not the same incident.
  if (i.narrative === 'HIGH' && i.location === 'HIGH') return 'RELATED_CASE';
  return 'NO_MATCH';
}

/**
 * The matching estimate (0-1): how much the two reports have in common, by
 * the indicators. Not a probability that they are duplicates - it is shown as
 * an estimate, beside the indicators that make it up.
 */
export function matchingEstimate(i: Indicators): number {
  const w: Record<IndicatorKey, number> = { narrative: 0.35, incident_date: 0.2, location: 0.2, people_involved: 0.15, circumstances: 0.1 };
  const v = INDICATOR_KEYS.reduce((s, k) => s + w[k] * (rank(i[k]) / 2), 0);
  return Math.round(v * 100) / 100;
}

/** The rules' own explanation, for when the AI is off, failed, or disagreed with the evidence. */
export function ruleExplanation(i: Indicators, e: PairEvidence, c: Classification): { matching: string[]; differences: string[]; uncertainties: string[]; explanation: string } {
  const matching: string[] = [], differences: string[] = [], uncertainties: string[] = [];
  if (i.narrative !== 'LOW') matching.push(`The descriptions are ${i.narrative === 'HIGH' ? 'very ' : ''}similarly worded.`); else differences.push('The descriptions are worded differently.');
  if (e.dayGap === null) uncertainties.push('One of the reports has no incident date, so the dates could not be compared.');
  else if (e.dayGap === 0) matching.push('The same incident date.');
  else if (e.dayGap <= 3) matching.push(`Incident dates ${e.dayGap} day${e.dayGap === 1 ? '' : 's'} apart.`);
  else differences.push(`Incident dates ${e.dayGap} days apart.`);
  if (e.sameStreet) matching.push('The same street.');
  else if (e.metres !== null && e.metres <= 500) matching.push(`Map locations about ${Math.round(e.metres)} m apart.`);
  else if (e.metres !== null) differences.push(`Map locations about ${Math.round(e.metres / 10) * 10} m apart.`);
  else differences.push('A different street (or no map location to compare).');
  if (e.peopleSimilarity === null) uncertainties.push('One of the reports names no person involved.');
  else if (i.people_involved !== 'LOW') matching.push(i.people_involved === 'HIGH' ? 'A person involved has the same or a very similar name.' : 'A person involved has a similar name.');
  if (e.sameCategory) matching.push('The same incident category.'); else differences.push('A different incident category.');
  uncertainties.push('Compared by SafeComm\'s rules only - a person must check whether these describe the same incident.');
  const explanation = c === 'POTENTIAL_DUPLICATE'
    ? 'These reports may describe the same incident: similar descriptions of an incident on the same day or at the same place.'
    : c === 'RELATED_CASE' ? 'These reports may be connected - the same people or similar circumstances - but may describe different incidents.'
      : 'No significant match.';
  return { matching, differences, uncertainties, explanation };
}

// ── The AI's answer ──────────────────────────────────────────────────────────

export interface AiPairAnalysis {
  classification: Classification;
  similarity_indicators: Indicators;
  matching_information: string[];
  differences: string[];
  explanation: string;
  uncertainties: string[];
  requires_human_review: true;
}

export const AI_PAIR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['classification', 'similarity_indicators', 'matching_information', 'differences', 'explanation', 'uncertainties', 'requires_human_review'],
  properties: {
    classification: { type: 'string', enum: CLASSIFICATIONS },
    similarity_indicators: {
      type: 'object', additionalProperties: false, required: INDICATOR_KEYS,
      properties: Object.fromEntries(INDICATOR_KEYS.map(k => [k, { type: 'string', enum: LEVELS }])),
    },
    matching_information: { type: 'array', items: { type: 'string' } },
    differences: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
    uncertainties: { type: 'array', items: { type: 'string' } },
    requires_human_review: { type: 'boolean' },
  },
} as const;

const strings = (v: unknown, max: number, each = 240) => Array.isArray(v)
  ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim().slice(0, each)).slice(0, max) : null;

/**
 * The AI's answer, checked: every field present and of its kind, the
 * classification and every indicator one of the allowed values. Anything else
 * is null - the rules' result stands. requires_human_review is always true,
 * whatever the AI said.
 */
export function validateAiPair(raw: unknown): AiPairAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!CLASSIFICATIONS.includes(r.classification as Classification)) return null;
  const ind = r.similarity_indicators as Record<string, unknown> | undefined;
  if (!ind || typeof ind !== 'object' || !INDICATOR_KEYS.every(k => LEVELS.includes(ind[k] as Level))) return null;
  const matching = strings(r.matching_information, 8), differences = strings(r.differences, 8), uncertainties = strings(r.uncertainties, 6);
  if (!matching || !differences || !uncertainties || typeof r.explanation !== 'string' || !r.explanation.trim()) return null;
  return {
    classification: r.classification as Classification,
    similarity_indicators: Object.fromEntries(INDICATOR_KEYS.map(k => [k, ind[k]])) as Indicators,
    matching_information: matching, differences, uncertainties,
    explanation: r.explanation.trim().slice(0, 800),
    requires_human_review: true,
  };
}

/**
 * The classification kept: the AI may lower the rules' reading (it read the
 * stories and they differ), or raise "related" to "duplicate" - but only when
 * the evidence the database measured allows it (the narrative at least
 * MEDIUM, and the same day or place). It can never make a match out of
 * nothing: when the rules see no match, there is none.
 */
export function finalClassification(rule: Classification, ai: Classification | null, i: Indicators, c: Conflicts = NO_CONFLICTS): Classification {
  if (rule === 'NO_MATCH' || ai === null) return rule;
  if (ai === 'POTENTIAL_DUPLICATE') {
    const allowed = !c.datesDiffer && !c.placesDiffer && atLeast(i.narrative, 'MEDIUM') && (i.incident_date === 'HIGH' || i.location === 'HIGH');
    return allowed ? 'POTENTIAL_DUPLICATE' : rule;
  }
  return ai;
}

// ── Review ───────────────────────────────────────────────────────────────────

export const MATCH_STATUSES = {
  PENDING_REVIEW: 'Pending Review',
  FURTHER_REVIEW: 'Further Review Requested',
  VERIFIED_DUPLICATE: 'Verified Duplicate',
  RELATED: 'Related Case',
  NOT_DUPLICATE: 'Not a Duplicate',
} as const;
export type MatchStatus = keyof typeof MATCH_STATUSES;
export const OPEN_MATCH: MatchStatus[] = ['PENDING_REVIEW', 'FURTHER_REVIEW'];
export const isOpenMatch = (s: string) => (OPEN_MATCH as string[]).includes(s);

export const REVIEW_ACTIONS = {
  confirm_duplicate: { to: 'VERIFIED_DUPLICATE', label: 'Confirm duplicate' },
  mark_related: { to: 'RELATED', label: 'Mark as related' },
  not_duplicate: { to: 'NOT_DUPLICATE', label: 'Not a duplicate' },
  further_review: { to: 'FURTHER_REVIEW', label: 'Request further review' },
} as const;
export type ReviewAction = keyof typeof REVIEW_ACTIONS;

/** What a decision may be taken from: an open match - or a decided one, to correct it (with a reason). */
export const canReview = (status: string, action: ReviewAction) =>
  action === 'further_review' ? status !== 'FURTHER_REVIEW' : REVIEW_ACTIONS[action].to !== status;

/**
 * The label a case carries in Case Monitoring, from its matches: the most
 * pressing first. null when no check has run yet.
 */
export type CaseMatchLabel = 'POTENTIAL_DUPLICATE' | 'RELATED_FOUND' | 'PENDING_REVIEW' | 'VERIFIED_DUPLICATE' | 'NOT_DUPLICATE' | 'NO_MATCH';
export const CASE_MATCH_LABELS: Record<CaseMatchLabel, string> = {
  POTENTIAL_DUPLICATE: 'Potential Duplicate', RELATED_FOUND: 'Related Case Found', PENDING_REVIEW: 'Pending Review',
  VERIFIED_DUPLICATE: 'Verified Duplicate', NOT_DUPLICATE: 'Not a Duplicate', NO_MATCH: 'No Match Found',
};
export function caseMatchLabel(scanned: boolean, matches: { status: string; classification: string }[]): CaseMatchLabel | null {
  const open = matches.filter(m => isOpenMatch(m.status));
  if (open.some(m => m.status === 'PENDING_REVIEW' && m.classification === 'POTENTIAL_DUPLICATE')) return 'POTENTIAL_DUPLICATE';
  if (open.some(m => m.status === 'PENDING_REVIEW')) return 'RELATED_FOUND';
  if (open.length) return 'PENDING_REVIEW';
  if (matches.some(m => m.status === 'VERIFIED_DUPLICATE')) return 'VERIFIED_DUPLICATE';
  if (matches.some(m => m.status === 'RELATED')) return 'RELATED_FOUND';
  if (matches.length) return 'NOT_DUPLICATE';
  return scanned ? 'NO_MATCH' : null;
}

/** One key per pair, whichever way round: the database keeps one record per pair. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
