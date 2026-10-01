/**
 * One source of truth for the risk level, its score band, and the sentence
 * that explains it.
 *
 * This exists because the level and the explanation used to be decided in two
 * different places: the text analysis wrote "Classified Low because ..." into
 * its own reason string, and the engine then raised the level afterwards for a
 * rule the analysis knows nothing about. The badge said High and the sentence
 * underneath still said Low.
 *
 * The rule now is that a reason never names a level. It is only ever the
 * "because ..." clause, and the sentence is composed from whatever the FINAL
 * level turns out to be.
 */

export type RiskLevelName = 'Low' | 'Medium' | 'High' | 'Critical';

/** Score bands. A level and its score must always agree with this table. */
export const SCORE_BANDS: Record<RiskLevelName, { min: number; max: number }> = {
  Low: { min: 0, max: 24 },
  Medium: { min: 25, max: 49 },
  High: { min: 50, max: 74 },
  Critical: { min: 75, max: 100 },
};

const ORDER: RiskLevelName[] = ['Low', 'Medium', 'High', 'Critical'];

export const rankLevel = (l: RiskLevelName): number => ORDER.indexOf(l);

export function higherLevel(a: RiskLevelName, b: RiskLevelName): RiskLevelName {
  return rankLevel(a) >= rankLevel(b) ? a : b;
}

/** The level a score falls in. */
export function levelForScore(score: number): RiskLevelName {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= SCORE_BANDS.Critical.min) return 'Critical';
  if (s >= SCORE_BANDS.High.min) return 'High';
  if (s >= SCORE_BANDS.Medium.min) return 'Medium';
  return 'Low';
}

/** Lowest score consistent with a level - what a rule-raised level must reach. */
export const minScoreForLevel = (l: RiskLevelName): number => SCORE_BANDS[l].min;

/**
 * Forces a score into its level's band, so the two can never contradict.
 * A rule that raises the level raises the score with it.
 */
export function reconcileScore(rawScore: number, level: RiskLevelName): number {
  const { min, max } = SCORE_BANDS[level];
  return Math.max(min, Math.min(max, Math.round(rawScore)));
}

// Not followed by a hyphen, so a compound like "High-Risk Zone" - a place on
// the heat map rather than a classification - survives intact.
const LEVEL_WORD = /\b(low|medium|high|critical)(?!-)\s*(risk)?\b/gi;

/**
 * Removes a level name from a reason clause. A safety net: reasons are built
 * without one, but anything generated elsewhere passes through here so a stale
 * level can never reach the sentence and contradict the badge.
 */
export function stripLevelWords(detail: string): string {
  return (detail ?? '')
    .replace(/^\s*classified\s+(low|medium|high|critical)\s*(risk)?\s*(because|[—-])?\s*/i, '')
    .replace(LEVEL_WORD, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([;,.])/g, '$1')
    .trim();
}

/**
 * The one place the explanation sentence is built. Both the badge and this
 * sentence read the same `level`, so they cannot disagree.
 */
export function explainLevel(level: RiskLevelName, detail: string): string {
  const clause = stripLevelWords(detail).replace(/\.\s*$/, '');
  if (!clause) return `Classified ${level}.`;
  return `Classified ${level} because ${clause}.`;
}
