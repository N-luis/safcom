/**
 * The public Emergency Hotlines shown on the landing page. The one place to
 * change a name or a number: each number is shown and copied exactly as
 * written here, so keep its formatting.
 */
export interface Hotline {
  name: string;
  numbers: readonly string[];
}

export const EMERGENCY_HOTLINES: readonly Hotline[] = [
  { name: 'Barangay Office', numbers: ['0922-709-0700'] },
  { name: 'PNP Bocaue', numbers: ['0998-598-5376', '(044) 309-3314'] },
  { name: 'Bureau of Fire Protection', numbers: ['0917-804-6722', '0947-732-5198'] },
  { name: 'Bocaue Water District', numbers: ['0933-829-5903', '(044) 692-1659'] },
  { name: 'Bocaue Rescue / Ambulance', numbers: ['0936-330-9020'] },
  { name: 'Philippine Red Cross', numbers: ['(044) 662-5922'] },
  { name: 'Meralco', numbers: ['0917-551-6211', '0920-971-6211'] },
];

export type QuickKind = 'police' | 'fire' | 'rescue';

/** The first number of the named hotline, so the big buttons never hold a second copy of it. */
function quick(kind: QuickKind, label: string, name: string) {
  const hotline = EMERGENCY_HOTLINES.find(h => h.name === name);
  if (!hotline) throw new Error(`No hotline named ${name}`);
  return { kind, label, name, number: hotline.numbers[0] };
}

/** The three big buttons at the top of the card. */
export const QUICK_HOTLINES = [
  quick('police', 'Police', 'PNP Bocaue'),
  quick('fire', 'Fire', 'Bureau of Fire Protection'),
  quick('rescue', 'Rescue', 'Bocaue Rescue / Ambulance'),
];
