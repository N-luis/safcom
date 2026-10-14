/**
 * Streets and subdivisions within the barangay, as supplied by the Public
 * Safety Office. Used to keep incident locations consistent across forms so
 * they group correctly in reports and the street risk heatmap — free-typed
 * values like "purok 2nd" and "malabo street near nico place" were producing
 * one bucket per spelling.
 */
export const BARANGAY_STREETS = [
  'Ortega Compound',
  // The barangay's own hazard map spells this "Eugenio Comp."; the list had
  // "Eudenio". ALIASES below keeps the old spelling working for the cases
  // already filed under it.
  'Eugenio Compound',
  'Violeta Metroville Subd.',
  'J.P. Rizal St.',
  'Gov. F. Halili Ext.',
  'J. Benedicto St.',
  'A. Mendoza St.',
  'P. Lazaro St.',
  'Gov. F. Halili Ave.',
  'Ayukit',
  'Granville Subd.',
  // On the hazard map and running through the barangay, but missing from this
  // list, so reports on it were being filed as "Other" or as the barangay name.
  'MacArthur Highway',
] as const;

export type BarangayStreet = (typeof BARANGAY_STREETS)[number];

/** Chosen in the dropdown when the location isn't on the list above. */
export const OTHER_STREET = 'Other';

/**
 * Spellings that mean a street on the list above.
 *
 * Cases filed before a label was corrected keep the words they were filed
 * with, and they are still that street.
 */
export const STREET_ALIASES: Record<string, BarangayStreet> = {
  'Eudenio Compound': 'Eugenio Compound',
  'Mc Arthur Hi-way': 'MacArthur Highway',
  'McArthur Highway': 'MacArthur Highway',
  'MacArthur Hi-way': 'MacArthur Highway',
};

export function isKnownStreet(value: string): boolean {
  return (BARANGAY_STREETS as readonly string[]).includes(value)
    || value in STREET_ALIASES;
}

/** The current label for a street, following an alias if it is an old one. */
export function canonicalStreet(value: string): string {
  return STREET_ALIASES[value] ?? value;
}
