/**
 * KP Forms (Katarungang Pambarangay) - how dates, times and file names are
 * written on the printed forms. Pure, so the screen, the PDF and the tests
 * all read them the same way.
 */

export const FIL_MONTHS = [
  'Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo',
  'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre',
] as const;

export interface DateParts {
  /** No leading zero: "7". */
  day: string;
  /** In Filipino: "Nobyembre". */
  month: string;
  /** The two digits after the "20" the form already prints: "26". */
  yy: string;
  /** The whole year: "2026" (KP 16 prints it in full). */
  yyyy: string;
}

/** A date input's value ("YYYY-MM-DD") as the form writes it; null when empty or not a real date. */
export function dateParts(iso: string | null | undefined): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Rejects 2026-02-30 and the like: the calendar must agree.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { day: String(d), month: FIL_MONTHS[mo - 1], yy: String(y % 100).padStart(2, '0'), yyyy: String(y) };
}

/** "Nobyembre 10" - for "nakatakda noong ____, 20__". */
export function monthDay(iso: string | null | undefined): string {
  const p = dateParts(iso);
  return p ? `${p.month} ${p.day}` : '';
}

export interface TimeParts {
  /** 12-hour, no leading zero: "9:00", "12:30". */
  time: string;
  /** Whether "umaga" (before noon) or "hapon" applies. */
  period: 'umaga' | 'hapon';
}

/** A time input's value ("HH:MM", 24-hour) as the form writes it; null when empty. */
export function timeParts(hhmm: string | null | undefined): TimeParts | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  return { time: `${h % 12 === 0 ? 12 : h % 12}:${m[2]}`, period: h < 12 ? 'umaga' : 'hapon' };
}

/** Today in the Philippines, as a date input's value. */
export function todayPh(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** KP-Form-7_BLT-123456_2026-11-17.pdf - safe characters only. */
export function pdfFileName(formNumber: string, caseNo: string | null | undefined, now = new Date()): string {
  const safe = (caseNo ?? '').trim().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `KP-Form-${formNumber}_${safe || 'draft'}_${todayPh(now)}.pdf`;
}

/** Names as the forms list them: trimmed, empty ones dropped. */
export const cleanNames = (names: readonly string[] | null | undefined) => (names ?? []).map(n => n.trim()).filter(Boolean);
