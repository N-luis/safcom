/**
 * Rules for the case timeline: who may write to it, what a follow-up means for
 * the case's progress, and when one is serious enough to re-assess the risk.
 *
 * Kept out of the routes so the resident side and the officer side cannot drift
 * apart on what "worsening" does, and so the rules can be tested without a
 * database.
 */

export const PROGRESS_VALUES = ['still_happening', 'improving', 'worsening', 'resolved'] as const;
export type Progress = (typeof PROGRESS_VALUES)[number];

export const PROGRESS_STATES = ['improving', 'no_change', 'worsening', 'resolved'] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];

export const UPDATE_TYPES = ['follow_up', 'officer_action', 'status_change', 'risk_change'] as const;
export type UpdateType = (typeof UPDATE_TYPES)[number];

export const OFFICER_ACTIONS = [
  'called_the_person',
  'warning_issued',
  'mediation_scheduled',
  'referred_to_pnp',
  'resolved',
] as const;
export type OfficerAction = (typeof OFFICER_ACTIONS)[number];

/** Labels live here so the resident form and the timeline cannot disagree. */
export const PROGRESS_LABELS: Record<Progress, { en: string; tl: string }> = {
  still_happening: { en: 'Still happening', tl: 'Nagpapatuloy pa rin' },
  improving: { en: 'Getting better', tl: 'Bumubuti na' },
  worsening: { en: 'Getting worse', tl: 'Lumalala' },
  resolved: { en: 'Resolved', tl: 'Naayos na' },
};

export const OFFICER_ACTION_LABELS: Record<OfficerAction, string> = {
  called_the_person: 'Called the person involved',
  warning_issued: 'Warning issued',
  mediation_scheduled: 'Mediation scheduled',
  referred_to_pnp: 'Referred to PNP',
  resolved: 'Resolved',
};

export const PROGRESS_STATE_LABELS: Record<ProgressState, { en: string; tl: string }> = {
  improving: { en: 'Improving', tl: 'Bumubuti' },
  no_change: { en: 'No change', tl: 'Walang pagbabago' },
  worsening: { en: 'Worsening', tl: 'Lumalala' },
  resolved: { en: 'Resolved', tl: 'Naayos na' },
};

/** A resident's choice maps onto the case's headline state. */
export function progressToState(p: Progress): ProgressState {
  return p === 'still_happening' ? 'no_change' : p;
}

/** Days of silence before a reminder, configurable per deployment. */
export const REMINDER_AFTER_DAYS = Number(process.env.FOLLOWUP_REMINDER_DAYS ?? 2);

/** Days without an officer action before a case counts as overdue. */
export const OVERDUE_AFTER_DAYS = Number(process.env.OFFICER_OVERDUE_DAYS ?? 3);

/** Follow-ups one resident may add to one case in a day. */
export const MAX_FOLLOW_UPS_PER_DAY = 5;

/** A new report within this window may be a duplicate of an open case. */
export const SIMILAR_CASE_WINDOW_DAYS = 14;

export const MAX_NOTE_LENGTH = 1000;

/**
 * Strips control characters and HTML angle brackets, and caps the length.
 * Notes are rendered as text everywhere, so this is defence in depth rather
 * than the only thing standing between a note and the page.
 */
export function sanitizeNote(raw: string): string {
  return (raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

/** Words that make a follow-up worth re-reading the whole case for. */
const ESCALATING_TERMS = [
  // injury
  'sugat', 'pasa', 'dumudugo', 'nagdugo', 'nabali', 'ospital', 'nasaktan', 'sinaktan',
  'injury', 'injured', 'bleeding', 'bruise', 'hospital', 'wound', 'broken',
  // weapon
  'kutsilyo', 'baril', 'itak', 'armas', 'knife', 'gun', 'weapon', 'bladed',
  // minor or dependent
  'bata', 'anak', 'menor', 'buntis', 'matanda', 'child', 'minor', 'kid', 'baby', 'elderly', 'pregnant',
];

/**
 * A follow-up triggers re-assessment when it says things are getting worse, or
 * when the note mentions injury, a weapon, or a minor. The note is checked even
 * on an "improving" update: someone can report improvement and still mention a
 * child was hurt last week.
 */
export function shouldReassess(progress: Progress | null, note: string): boolean {
  if (progress === 'worsening') return true;
  const text = (note ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ESCALATING_TERMS.some(t => text.includes(t));
}

/**
 * Risk is never lowered automatically. An officer can reduce it deliberately;
 * an algorithm reading a hopeful sentence must not.
 */
const LEVEL_RANK: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

export function isHigherLevel(next: string, current: string): boolean {
  return (LEVEL_RANK[next] ?? 0) > (LEVEL_RANK[current] ?? 0);
}

/** A resident marking it resolved asks for closure; an officer grants it. */
export const PENDING_CONFIRMATION_STATUS = 'Pending officer confirmation';

export interface TimelineEntry {
  id: string;
  createdAt: string;
  updateType: UpdateType | string;
  authorRole: string;
  authorName: string;
  progress?: string | null;
  content: string;
  visibleToReporter: boolean;
  hidden: boolean;
}

/** What a resident is allowed to see: their own entries and anything shared. */
export function visibleToResident<T extends { visibleToReporter: boolean; hiddenAt?: Date | null }>(
  entries: T[],
): T[] {
  return entries.filter(e => e.visibleToReporter && !e.hiddenAt);
}
