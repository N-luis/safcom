/**
 * Case Management - CSV export: who may export, the period chosen, and how a
 * CSV is written safely. Pure and client-safe; the query, the per-record
 * checks and the audit trail are in lib/caseExportServer.ts.
 *
 * Periods are calendar days of the INCIDENT date (Case.incidentDate, a date
 * with no time of day, as the reporter gave it - Philippine calendar days).
 * A case with no incident date recorded is never placed in a period.
 */
import { realDate } from './caseSearch';

/**
 * Who may export: the desks' officials and the Punong Barangay. Not residents
 * (they have no staff session at all) and not the system administrator - an IT
 * role, with no case work that needs the records outside SafeComm. Each desk
 * exports its own desk's cases; the captain, both (lib/caseExportServer).
 */
export const EXPORT_ROLES = ['officer', 'blotter_officer', 'vawc_officer', 'vawc', 'vawc_lead', 'admin'] as const;
export const canExportCases = (role: string | null | undefined) => (EXPORT_ROLES as readonly string[]).includes((role ?? '').trim());

export type ExportMode = 'date' | 'month' | 'range';
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The longest custom range one file may cover. */
export const MAX_RANGE_DAYS = 366;
/** The most cases one file may hold - a narrower period beyond that. */
export const MAX_EXPORT_ROWS = 5000;

export interface ExportPeriod {
  /** First and last incident day, inclusive ("YYYY-MM-DD"). */
  start: string;
  end: string;
  /** In words, for the audit trail and the screen. */
  label: string;
  filename: string;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoDay = (v: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? realDate(+m[1], +m[2], +m[3]) : null;
};

/** Read the period from the request. An error says what to fix. */
export function parseExportPeriod(q: { mode?: string | null; date?: string | null; month?: string | null; year?: string | null; start?: string | null; end?: string | null }): ExportPeriod | { error: string } {
  if (q.mode === 'date') {
    const d = isoDay(q.date);
    if (!d) return { error: 'Choose the date to export' };
    return { start: d, end: d, label: `incident date ${d}`, filename: `SafeComm_Cases_${d}.csv` };
  }
  if (q.mode === 'month') {
    const m = Number(q.month), y = Number(q.year);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { error: 'Choose the month' };
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: 'Choose the year' };
    const mm = String(m).padStart(2, '0');
    // The whole month: the 1st to its last day (28-31, leap years included).
    return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay(y, m)).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y}`, filename: `SafeComm_Cases_${MONTH_NAMES[m - 1]}_${y}.csv` };
  }
  if (q.mode === 'range') {
    const s = isoDay(q.start), e = isoDay(q.end);
    if (!s) return { error: 'Choose the start date' };
    if (!e) return { error: 'Choose the end date' };
    if (e < s) return { error: 'The end date is before the start date' };
    if (daysBetween(s, e) + 1 > MAX_RANGE_DAYS) return { error: 'Choose a range of one year or less' };
    return { start: s, end: e, label: `${s} to ${e}`, filename: `SafeComm_Cases_${s}_to_${e}.csv` };
  }
  return { error: 'Choose a date, a month, or a date range' };
}

// ── Writing the CSV ──────────────────────────────────────────────────────────

/**
 * One cell. Text that came from a person (a name, a type) and starts like a
 * spreadsheet formula (= + - @, a tab or a carriage return) is prefixed with
 * an apostrophe, so a spreadsheet shows it as text instead of running it
 * (CSV/formula injection). Then RFC 4180 quoting: a cell with a comma, a quote
 * or a line break is wrapped in quotes, its quotes doubled.
 */
export function csvCell(value: string | number | null | undefined, untrusted = true): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (untrusted && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The file: a UTF-8 byte-order mark (so spreadsheet apps read Filipino names
 * and "ñ" correctly), the header row, then one row per case, CRLF line ends.
 * `trusted` names the columns SafeComm itself writes (dates, references).
 */
export function toCsv(headers: string[], rows: (string | number | null)[][], trusted: number[] = []): string {
  const line = (cells: (string | number | null)[]) => cells.map((c, i) => csvCell(c, !trusted.includes(i))).join(',');
  return '﻿' + [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}
