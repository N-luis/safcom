/**
 * Map points for the barangay's own street list.
 *
 * Choosing a street in the form moves the map to it. That cannot rely on a
 * geocoder alone: of the eleven labels the Public Safety Office uses, only
 * four are in OpenStreetMap at all. Compounds, puroks and subdivision names
 * that everyone here navigates by - Ortega Compound, Ayukit - are simply not
 * in the map data, and no amount of query rewriting conjures them up.
 *
 * So the ones that could be verified are written down, and the rest are left
 * empty on purpose. An incident pinned to a guessed coordinate is worse than
 * one with no pin at all: it sends an officer to the wrong street while
 * looking exactly as trustworthy as a real one. A street with no entry here
 * asks the resident to tap the spot instead.
 *
 * To add one: open the resident form, tap the street on the map, and copy the
 * latitude and longitude out of the selected-location panel.
 */

import type { BarangayStreet } from './streets';

export interface StreetPoint {
  lat: number;
  lng: number;
  /** Where the coordinate came from, so a wrong one can be traced. */
  source: string;
}

/**
 * Verified against Nominatim on 2026-10-14. The `source` is the full address
 * it returned, which is also the evidence that the match is the right road:
 * several of these streets run through neighbouring barangays, which is
 * expected - a road does not stop at a boundary.
 */
export const STREET_POINTS: Partial<Record<BarangayStreet, StreetPoint>> = {
  'J.P. Rizal St.': {
    lat: 14.795271, lng: 120.926539,
    source: 'J. P. Rizal Street, Sulucan, Bocaue, Bulacan',
  },
  'A. Mendoza St.': {
    lat: 14.797485, lng: 120.928336,
    source: 'A. Mendoza Street, Biñang 1st, Bocaue, Bulacan',
  },
  'Gov. F. Halili Ave.': {
    lat: 14.807230, lng: 120.939901,
    source: 'Governor F. Halili Avenue, Greenview Subdivision, Turo, Bocaue, Bulacan',
  },
  'Violeta Metroville Subd.': {
    lat: 14.797752, lng: 120.931551,
    source: 'Violeta Avenue, Violeta Metroville, Biñang 1st, Bocaue, Bulacan',
  },

  // Deliberately absent, having been looked for and not found:
  //   Ortega Compound, Eudenio Compound, Gov. F. Halili Ext.,
  //   J. Benedicto St., P. Lazaro St., Ayukit
  // "Granville Subd." is absent for a different reason: the only match was
  // "AFP/PNP Granville Homes" in Tambubong, a different barangay, which may
  // well be somewhere else entirely. A wrong pin is not worth the convenience.
};

/** The written-down point for a street, if there is one. */
export function pointForStreet(street: string): StreetPoint | null {
  return STREET_POINTS[street as BarangayStreet] ?? null;
}

/**
 * How the barangay abbreviates versus how map data spells it.
 *
 * Applied before asking a geocoder about a street that has no entry above:
 * "J.P. Rizal St." finds nothing, "J. P. Rizal Street" finds the road.
 */
const EXPANSIONS: [RegExp, string][] = [
  [/\bSubd\.?/gi, 'Subdivision'],
  [/\bExt\.?/gi, 'Extension'],
  [/\bAve\.?/gi, 'Avenue'],
  [/\bSt\.?(?=\s|$)/gi, 'Street'],
  [/\bGov\.?/gi, 'Governor'],
  [/\bBrgy\.?/gi, 'Barangay'],
];

export function expandStreetName(name: string): string {
  let out = (name ?? '').trim();
  for (const [from, to] of EXPANSIONS) out = out.replace(from, to);
  // OSM spaces initials: "J.P." is written "J. P.".
  out = out.replace(/\b([A-Z])\.([A-Z])\./g, '$1. $2.');
  return out.replace(/\s+/g, ' ').trim();
}
