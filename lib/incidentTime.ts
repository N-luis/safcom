/**
 * "About what time?" on the resident report: chosen, never typed. Either a part
 * of the day (when the resident only roughly knows) or an exact clock time
 * ("9:05 PM"). Stored as that text in Case.incidentTimeApprox, so officers read
 * it as written and no schema change is needed. Pure - the form and the server
 * check a value the same way.
 */

export interface TimePeriod { value: string; label: string; startHour: number }

/** Parts of the day, in Philippine usage (12 MN = midnight, 12 NN = noon). */
export const TIME_PERIODS: readonly TimePeriod[] = [
  { value: 'Early morning (12 MN - 6 AM)', label: 'Early morning / Madaling-araw', startHour: 0 },
  { value: 'Morning (6 AM - 12 NN)', label: 'Morning / Umaga', startHour: 6 },
  { value: 'Around noon (12 NN - 1 PM)', label: 'Around noon / Tanghali', startHour: 12 },
  { value: 'Afternoon (1 PM - 6 PM)', label: 'Afternoon / Hapon', startHour: 13 },
  { value: 'Evening (6 PM - 9 PM)', label: 'Evening / Gabi', startHour: 18 },
  { value: 'Night (9 PM - 12 MN)', label: 'Late night / Hatinggabi', startHour: 21 },
];

export const HOURS_12 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
/** Every 5 minutes - the resident is estimating, and a shorter list is easier on a phone. */
export const MINUTES_5 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
export const MERIDIEMS = ['AM', 'PM'] as const;

const EXACT = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/;

export const INCIDENT_TIME_HINT = 'Finish the time - hour, minutes and AM or PM - or leave it blank if you are not sure';
export const INCIDENT_TIME_FUTURE = 'That time has not come yet today';

export interface ExactTime { hour: string; minute: string; meridiem: 'AM' | 'PM' }

/** "9:05 PM" -> its parts, or null when it is not an exact time. */
export function parseExactTime(v: string): ExactTime | null {
  const m = EXACT.exec(v.trim());
  return m ? { hour: m[1], minute: m[2], meridiem: m[3] as 'AM' | 'PM' } : null;
}

export function formatExactTime(t: ExactTime): string {
  return `${t.hour}:${t.minute} ${t.meridiem}`;
}

/** A browser time field's value ("21:30", 24-hour) -> "9:30 PM"; '' stays ''. Null when it is not a time. */
export function fromTimeInput(v: string): string | null {
  if (!v) return '';
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(v);
  if (!m) return null;
  const h24 = Number(m[1]);
  return formatExactTime({ hour: String(h24 % 12 || 12), minute: m[2], meridiem: h24 < 12 ? 'AM' : 'PM' });
}

/** "9:30 PM" -> "21:30" for a browser time field; anything else -> ''. */
export function toTimeInput(v: string | null | undefined): string {
  const t = parseExactTime(v ?? '');
  if (!t) return '';
  const h24 = (Number(t.hour) % 12) + (t.meridiem === 'PM' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${t.minute}`;
}

export function periodOf(v: string): TimePeriod | null {
  return TIME_PERIODS.find(p => p.value === v.trim()) ?? null;
}

/** True for an empty value, a listed part of the day, or an exact time. */
export function isIncidentTime(v: string | null | undefined): boolean {
  const s = (v ?? '').trim();
  return !s || periodOf(s) !== null || parseExactTime(s) !== null;
}

/** Minutes after midnight that the value starts at, or null for empty / unknown text. */
export function startMinutes(v: string): number | null {
  const p = periodOf(v);
  if (p) return p.startHour * 60;
  const t = parseExactTime(v);
  if (!t) return null;
  const h = Number(t.hour) % 12 + (t.meridiem === 'PM' ? 12 : 0);
  return h * 60 + Number(t.minute);
}

/** Today's date (YYYY-MM-DD) and the minutes after midnight, in Philippine time. */
export function nowInPh(now = Date.now()): { date: string; minutes: number } {
  const d = new Date(now + 8 * 3600_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/**
 * True when the incident is said to be today but at a time still to come.
 * Five minutes of grace, for a phone clock a little ahead.
 */
export function isFutureIncidentTime(date: string | null | undefined, time: string | null | undefined, now = Date.now()): boolean {
  if (!date || !time) return false;
  const ph = nowInPh(now);
  if (date !== ph.date) return false;
  const start = startMinutes(time);
  return start !== null && start > ph.minutes + 5;
}
