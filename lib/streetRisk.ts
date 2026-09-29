import { BARANGAY_STREETS, type BarangayStreet } from './streets';

/**
 * Ties a reported incident location to a place on the street risk heatmap.
 *
 * Cases store their location in `barangay`, which since the street dropdown
 * holds the street itself. Older rows predate the dropdown and hold the
 * barangay name or free text; those cannot be placed on a street and are
 * reported separately rather than quietly dropped or lumped onto a street that
 * did not earn them.
 */

export type RiskLevel = 'High' | 'Medium' | 'Low' | 'None';

/** Which heatmap nodes a street lights up. A street spanning two junctions
 *  lights both, so the whole stretch reads as risky rather than one dot. */
export const STREET_NODES: Record<BarangayStreet, string[]> = {
  'Ortega Compound':          ['ortega-mac'],
  'Eudenio Compound':         ['eugenio-mac'],
  'Violeta Metroville Subd.': ['violeta-mac', 'violeta-fork'],
  'J.P. Rizal St.':           ['rizal-mac'],
  'Gov. F. Halili Ext.':      ['flyover'],
  'J. Benedicto St.':         ['benedicto'],
  'A. Mendoza St.':           ['mendoza'],
  'P. Lazaro St.':            ['lazaro'],
  'Gov. F. Halili Ave.':      ['halili-mid', 'halili-pnr'],
  'Ayukit':                   ['ayukit-pnr'],
  'Granville Subd.':          ['granville-mid'],
};

/** Which shaded district a street sits in, so the block shades too. */
export const STREET_AREAS: Record<BarangayStreet, string[]> = {
  'Ortega Compound':          ['mcarthur'],
  'Eudenio Compound':         ['mcarthur'],
  'Violeta Metroville Subd.': ['mcarthur', 'metroville'],
  'J.P. Rizal St.':           ['civic'],
  'Gov. F. Halili Ext.':      ['civic'],
  'J. Benedicto St.':         ['north-res'],
  'A. Mendoza St.':           ['north-res'],
  'P. Lazaro St.':            ['north-res'],
  'Gov. F. Halili Ave.':      ['halili'],
  'Ayukit':                   ['granville'],
  'Granville Subd.':          ['granville'],
};

/** The barangay's own name is a location, but it is not a street - a case
 *  filed against it tells us nothing about where on the map it happened. */
const NOT_A_STREET = ['binang 2nd', 'binan 2nd', 'binang', 'bocaue', 'bulacan'];

/**
 * Lowercases and flattens the spelling differences that separate the same
 * street into several buckets: the enye, abbreviations, and trailing dots.
 */
export function normaliseLocation(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // enye -> n
    .replace(/[.,]/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bsubdivision\b/g, 'subd')
    .replace(/\bcompound\b/g, 'comp')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bextension\b/g, 'ext')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALISED: [BarangayStreet, string][] = BARANGAY_STREETS.map(
  s => [s, normaliseLocation(s)] as [BarangayStreet, string],
);

/**
 * Finds the street a stored location refers to, or null when it is not one.
 * Exact match first, then containment, so "123 purok Ayukit" still lands on
 * Ayukit while "Binang 2nd" lands nowhere.
 */
export function matchStreet(stored: string | null | undefined): BarangayStreet | null {
  const v = normaliseLocation(stored ?? '');
  if (!v) return null;
  if (NOT_A_STREET.includes(v)) return null;

  const exact = NORMALISED.find(([, n]) => n === v);
  if (exact) return exact[0];

  // Longest candidate first: "gov f halili ave" must win over a shorter name
  // that happens to also appear in the text.
  const contained = [...NORMALISED]
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, n]) => v.includes(n));
  return contained ? contained[0] : null;
}

/**
 * A street is as risky as its worst open case. Critical is folded into High
 * because the map legend only offers three bands.
 */
export function levelFromRisks(risks: string[]): RiskLevel {
  if (!risks.length) return 'None';
  if (risks.some(r => r === 'Critical' || r === 'High')) return 'High';
  if (risks.some(r => r === 'Medium')) return 'Medium';
  return 'Low';
}

/** Worst of two levels, for rolling street levels up into a node or district. */
export function worstLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { None: 0, Low: 1, Medium: 2, High: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export interface StreetRisk {
  street: string;
  total: number;
  level: RiskLevel;
  byLevel: Record<string, number>;
}

export interface StreetRiskResponse {
  streets: StreetRisk[];
  /** Cases that matched a street and are therefore drawn on the map. */
  placed: number;
  /** Cases whose location is not a street on the list - shown as a caveat. */
  unplaced: number;
  /** The distinct location values behind `unplaced`, for the caveat tooltip. */
  unplacedValues: string[];
  total: number;
}
