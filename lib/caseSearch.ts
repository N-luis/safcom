/**
 * The case search bar - one input, read the same way by every case list.
 *
 * What was typed is tidied (spaces collapsed, case ignored) and, when it is
 * a date in a supported format, also read as an incident date. Nothing is
 * guessed: an input that is not a real calendar date is searched as text
 * only, and a date whose day and month could be swapped (05/06/2026) is
 * read in the interface's month/day/year order and SAID so, never silently.
 *
 * Pure and client-safe; the query itself is lib/caseSearchServer.ts.
 */

export const SEARCH_MAX = 100;

export interface ParsedSearch {
  /** The input, trimmed, spaces collapsed, a leading "#" dropped. */
  text: string;
  /** Words for name matching (every word must be found), at most 8. */
  tokens: string[];
  /** An incident date the input names, "YYYY-MM-DD" - or null. */
  date: string | null;
  /** How the date was read, in words, e.g. "November 14, 2026". */
  dateLabel: string | null;
  /** Said to the user when the reading needs it (a swappable day and month). */
  dateNote: string | null;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  // Filipino month names, as residents and officials write them.
  enero: 1, pebrero: 2, marso: 3, abril: 4, mayo: 5, hunyo: 6, hulyo: 7, agosto: 8, setyembre: 9, oktubre: 10, nobyembre: 11, disyembre: 12,
};
const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
/** A calendar date that exists ("2026-02-30" does not), as "YYYY-MM-DD". */
function realDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}
export const dateLabelOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_NAME[m - 1]} ${d}, ${y}`;
};

/**
 * The incident date an input names, or null when it is not one. Supported:
 *   2026-11-14 · November 14, 2026 · Nov 14 2026 · Nov. 14, 2026 · 14 November 2026 ·
 *   Nobyembre 14, 2026 · 11/14/2026 (month/day/year, as this interface shows dates).
 * A day/month/year date is accepted only when it cannot be anything else (14/11/2026).
 */
export function parseSearchDate(input: string): { date: string; note: string | null } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { const d = realDate(+m[1], +m[2], +m[3]); return d ? { date: d, note: null } : null; }

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) { const d = realDate(y, b, a); return d ? { date: d, note: `Read as day/month/year: ${dateLabelOf(d)}.` } : null; }
    const d = realDate(y, a, b);
    if (!d) return null;
    // Both could be a month: say which reading is searched, and how to ask for the other.
    const other = a !== b && b <= 12 ? realDate(y, b, a) : null;
    return { date: d, note: other ? `Read as month/day/year: ${dateLabelOf(d)}. For ${dateLabelOf(other)}, type "${dateLabelOf(other)}".` : null };
  }

  // Month names: "november 14, 2026", "nov. 14 2026", "14 november 2026", "14 nov, 2026".
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1]]) { const d = realDate(+m[3], MONTHS[m[1]], +m[2]); return d ? { date: d, note: null } : null; }
  m = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)\.?,? (\d{4})$/.exec(s);
  if (m && MONTHS[m[2]]) { const d = realDate(+m[3], MONTHS[m[2]], +m[1]); return d ? { date: d, note: null } : null; }
  return null;
}

/** Read what was typed. Null when there is nothing to search. */
export function parseCaseSearch(raw: string | null | undefined): ParsedSearch | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().replace(/^#\s*/, '').slice(0, SEARCH_MAX);
  if (!text) return null;
  const tokens = text.split(/[\s,;]+/).map(t => t.replace(/^[.'"()]+|[.'"()]+$/g, '')).filter(Boolean).slice(0, 8);
  const d = parseSearchDate(text);
  return { text, tokens, date: d?.date ?? null, dateLabel: d ? dateLabelOf(d.date) : null, dateNote: d?.note ?? null };
}

/** What the list says about a search that included a date - shown under the search bar. */
export function searchSummary(p: ParsedSearch | null): { incidentDate: string | null; note: string | null } | null {
  if (!p?.date) return null;
  return { incidentDate: p.date, note: `Including cases whose incident date is ${p.dateLabel}.${p.dateNote ? ` ${p.dateNote}` : ''}` };
}
