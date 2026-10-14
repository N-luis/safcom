/**
 * Map points for the barangay's own street list.
 *
 * Choosing a street in the form moves the map to it. That cannot rely on a
 * geocoder alone: of the eleven labels the Public Safety Office uses, four are
 * in OpenStreetMap and seven are not. Compounds, puroks and subdivision names
 * that everyone here navigates by - Ortega Compound, Ayukit - are simply not
 * in the map data, and no amount of query rewriting conjures them up.
 *
 * The four that exist are written down as coordinates that were checked by
 * reading them back. Picking a point by rule did not work: roads here run
 * alongside each other, and the nearest stretch of Governor F. Halili Avenue
 * to the barangay is a node it shares with the Ciudad de Victoria Bypass Road,
 * which is the name that came back. Each point below is the closest one to the
 * barangay that the geocoder confirms as that road.
 *
 * The other seven are left unmapped on purpose. An incident pinned to a
 * guessed coordinate is worse than one with no pin: it sends an officer to the
 * wrong street while looking exactly as trustworthy as a real one. A street
 * with no entry asks the resident to tap the spot instead.
 */

import type { BarangayStreet } from './streets';

export interface StreetPoint {
  lat: number;
  lng: number;
  /** The address the geocoder returned for this exact point. */
  source: string;
}

/**
 * Verified on 2026-10-14 by reverse-geocoding each candidate point along the
 * road, nearest the barangay first, and keeping the first that answered with
 * the road itself.
 *
 * Absent, having been searched for in both the place index and the raw road
 * data and not found: Ortega Compound, Eudenio Compound, Gov. F. Halili Ext.,
 * J. Benedicto St., P. Lazaro St., Ayukit, Granville Subd.
 *
 * To add one once the barangay knows the spot: open the resident form, tap the
 * street on the map, and read the coordinates off the selected-location panel.
 */
export const STREET_POINTS: Partial<Record<BarangayStreet, StreetPoint>> = {
  'J.P. Rizal St.': {
    lat: 14.795832, lng: 120.929938,
    source: 'J. P. Rizal Street, Biñang 1st, Bocaue, Bulacan',
  },
  'A. Mendoza St.': {
    lat: 14.797403, lng: 120.928349,
    source: 'A. Mendoza Street, Biñang 1st, Bocaue, Bulacan',
  },
  'Gov. F. Halili Ave.': {
    lat: 14.799496, lng: 120.930732,
    source: 'Governor F. Halili Avenue, Biñang 1st, Bocaue, Bulacan',
  },
  // The subdivision is not a road; the avenue running through it is, and the
  // address returned there names Violeta Metroville.
  'Violeta Metroville Subd.': {
    lat: 14.797899, lng: 120.931853,
    source: 'Violeta Avenue, Violeta Metroville, Biñang 1st, Bocaue, Bulacan',
  },
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
