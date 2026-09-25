/**
 * Streets and subdivisions within the barangay, as supplied by the Public
 * Safety Office. Used to keep incident locations consistent across forms so
 * they group correctly in reports and the street risk heatmap — free-typed
 * values like "purok 2nd" and "malabo street near nico place" were producing
 * one bucket per spelling.
 */
export const BARANGAY_STREETS = [
  'Ortega Compound',
  'Eudenio Compound',
  'Violeta Metroville Subd.',
  'J.P. Rizal St.',
  'Gov. F. Halili Ext.',
  'J. Benedicto St.',
  'A. Mendoza St.',
  'P. Lazaro St.',
  'Gov. F. Halili Ave.',
  'Ayukit',
  'Granville Subd.',
] as const;

export type BarangayStreet = (typeof BARANGAY_STREETS)[number];

/** Chosen in the dropdown when the location isn't on the list above. */
export const OTHER_STREET = 'Other';

export function isKnownStreet(value: string): boolean {
  return (BARANGAY_STREETS as readonly string[]).includes(value);
}
