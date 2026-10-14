/**
 * Where each street is, in the barangay's own terms.
 *
 * Taken from the Biñang 2nd hazard map on the office wall, which is the only
 * record that has all eleven streets on it. The drawing is a schematic - the
 * landmarks on it are not where a geographic map would put them - so it cannot
 * give coordinates. What it does give, reliably, is what each street runs off
 * and what stands beside it, and that is what a resident needs to find the
 * place on the map.
 *
 * Shown when a street has no point in lib/streetPoints.ts, in place of asking
 * someone to hunt for it unaided.
 */

import type { BarangayStreet } from './streets';

export const STREET_HINTS: Partial<Record<BarangayStreet, string>> = {
  'Ortega Compound':
    'Off MacArthur Highway on the far side from the barangay hall, past the Shell station, '
    + 'along the sapa.',
  'Eugenio Compound':
    'Off MacArthur Highway between the Shell station and Sto. Niño Academy.',
  'Gov. F. Halili Ext.':
    'The stretch of Gov. F. Halili past the flyover, towards the Bocaue River.',
  'J. Benedicto St.':
    'Off Gov. F. Halili Ext. near the Bocaue River, alongside A. Mendoza St.',
  'P. Lazaro St.':
    'Off Gov. F. Halili Ext. at the far end, by Dr. Yanga Colleges.',
  'Ayukit':
    'The houses off Gov. F. Halili Ave. towards Turo, before Granville Subd.',
  'Granville Subd.':
    'Past the PNR crossing on the Turo side, at the end of Gov. F. Halili Ave.',
};

export function hintForStreet(street: string): string | null {
  return STREET_HINTS[street as BarangayStreet] ?? null;
}
