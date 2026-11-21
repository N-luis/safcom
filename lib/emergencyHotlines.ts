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

/**
 * The tel: link for a number as written above, or null when it is not a
 * number a phone can dial - so a bad entry shows as text to copy, never as a
 * broken link. Philippine numbers are written locally (09XX-XXX-XXXX mobile,
 * (0XX) XXX-XXXX landline): the leading 0 becomes +63, which dials the same
 * number from any phone. A number already in +63 form is kept. An extension
 * ("loc. 123", "ext. 123") is dialled after a pause (","). Spaces, dashes,
 * dots and brackets are dropped; anything else makes it invalid. The short
 * national emergency codes (911, 112, 117) are dialled as they are.
 */
export function telHref(number: string | null | undefined): string | null {
  const raw = (number ?? '').trim();
  if (!raw) return null;
  const ext = /\s*(?:ext\.?|loc\.?|local|x)\s*(\d{1,6})\s*$/i.exec(raw);
  const main = (ext ? raw.slice(0, ext.index) : raw).replace(/[\s\-.()]/g, '');
  // The national short emergency codes are dialled as they are.
  if (!ext && /^(911|112|117)$/.test(main)) return `tel:${main}`;
  let e164: string | null = null;
  if (/^\+63\d{9,10}$/.test(main)) e164 = main;
  else if (/^0\d{9,10}$/.test(main)) e164 = `+63${main.slice(1)}`;
  else if (/^63\d{9,10}$/.test(main)) e164 = `+${main}`;
  if (!e164) return null;
  return `tel:${e164}${ext ? `,${ext[1]}` : ''}`;
}

/** The kind of help a hotline is, when it is one of the three big ones (Police, Fire, Rescue). */
export const hotlineKind = (name: string) => QUICK_HOTLINES.find(q => q.name === name)?.label ?? null;
