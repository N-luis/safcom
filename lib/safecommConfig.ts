/**
 * Deployment settings for case triage.
 *
 * Emergency numbers and the threshold that reveals them are configuration, not
 * constants scattered through the UI: a different barangay deploys this with
 * different numbers, and the point at which a resident is shown them is a
 * policy decision rather than a styling one.
 *
 * Every value can be overridden by an environment variable, so a deployment
 * changes them without a code edit.
 */

export interface EmergencyContact {
  label: string;
  number: string;
}

/** Parses "PNP:0998-598-5376|Station:(044) 309-3314" from the environment. */
function parseContacts(raw: string | undefined): EmergencyContact[] | null {
  if (!raw?.trim()) return null;
  const parsed = raw.split('|')
    .map(pair => {
      const i = pair.indexOf(':');
      if (i === -1) return null;
      const label = pair.slice(0, i).trim();
      const number = pair.slice(i + 1).trim();
      return label && number ? { label, number } : null;
    })
    .filter((c): c is EmergencyContact => c !== null);
  return parsed.length ? parsed : null;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] =
  parseContacts(process.env.NEXT_PUBLIC_EMERGENCY_CONTACTS) ?? [
    { label: 'PNP Contact', number: '0998-598-5376' },
    { label: 'Station', number: '(044) 309-3314' },
    // The barangay's own line, listed separately from the station: the
    // guidance card points people here first, and the two are not the same
    // office to ring.
    { label: 'Barangay Hall', number: '0922-709-0700' },
  ];

/**
 * The priority at or above which the emergency contacts are shown. Deliberately
 * not shown on every case: a number that appears on a routine noise complaint
 * stops meaning anything by the time it matters.
 */
export const EMERGENCY_PRIORITY_THRESHOLD =
  process.env.NEXT_PUBLIC_EMERGENCY_THRESHOLD ?? 'Urgent Attention';

/**
 * Barangay context handed to the classifier. These are local facts, not
 * judgements: a noise complaint at 1am means something different where the
 * ordinance sets quiet hours at 10pm.
 */
export const BARANGAY_CONTEXT = {
  name: process.env.NEXT_PUBLIC_BARANGAY_NAME ?? 'Biñang 2nd',
  quietHours: process.env.NEXT_PUBLIC_QUIET_HOURS ?? '10:00 PM – 5:00 AM',
  localNotes: process.env.NEXT_PUBLIC_LOCAL_NOTES ?? '',
};

/**
 * Gender options a resident may choose. Never inferred, never scored.
 *
 * "Prefer not to say" is the one way to decline, and it is also what a blank
 * field is stored as. There used to be a second, "Not specified", which read
 * as the same thing and left people choosing between two identical answers.
 */
export const GENDER_OPTIONS = [
  'Female',
  'Male',
  'Non-binary / Other',
  'Prefer not to say',
] as const;

/** What a blank field is recorded as, so the column never holds an empty string. */
export const GENDER_UNDISCLOSED = 'Prefer not to say';

export type GenderOption = (typeof GENDER_OPTIONS)[number];

/**
 * True when the resident chose not to disclose, so feedback stays neutral.
 *
 * Still answers for "not specified": that option is gone from the list, but
 * rows recorded under it are still in the database and mean the same thing.
 */
export function isUndisclosedGender(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '' || v === 'prefer not to say' || v === 'not specified';
}
