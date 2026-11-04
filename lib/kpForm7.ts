/**
 * KP Form No. 7 - the Complainant's Form of the Katarungang Pambarangay
 * (Katarungang Pambarangay Handbook, Annexes): the complaint filed with the
 * Lupong Tagapamayapa, drawn from a blotter intake's own answers.
 *
 * It is a separate document from the Blotter Intake Record, and SafeComm
 * produces it only for a case an official has found eligible for
 * Katarungang Pambarangay proceedings (lib/hearings.ts hearingEligibility) -
 * never for a VAWC case. The complaint and the relief are the complainant's
 * own words from Section E; nothing is added, and the "received and filed"
 * lines are left for the Punong Barangay or Lupon Chairman.
 *
 * Client-safe: used by the live preview and by the PDF.
 */
import type { Responses } from './officialIntakeForm';
import { nameText } from './blotterIntakeForm';

export interface KpForm7Content {
  province: string;
  municipality: string;
  barangay: string;
  caseNo: string;
  /** "For: ..." - the nature of the complaint. */
  nature: string;
  complainants: string[];
  respondents: string[];
  complaint: string;
  relief: string;
  /** "Made this ... day of ..." - the date filed, when recorded. */
  madeOn: string | null;
}

const text = (r: Responses, k: string) => (typeof r[k]?.value === 'string' ? (r[k].value as string).trim() : '');
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);
const known = (s: string | null | undefined) => (s && s !== 'Not provided' ? s : '');

export function kpForm7Content(r: Responses, c: { caseNumber: string; barangay: string; municipality?: string | null; province?: string | null }): KpForm7Content {
  const complainant = nameText(r.complainantName?.value);
  const respondent = r.respondentUnknown?.value === 'yes' ? '' : nameText(r.respondentName?.value);
  return {
    province: known(c.province), municipality: known(c.municipality), barangay: c.barangay,
    caseNo: text(r, 'blotterReferenceNo') || c.caseNumber,
    nature: text(r, 'complaintNature'),
    complainants: [complainant, ...lines(text(r, 'additionalComplainants'))].filter(Boolean),
    respondents: [respondent, ...lines(text(r, 'additionalRespondents'))].filter(Boolean),
    complaint: text(r, 'complaintStatement'),
    relief: text(r, 'requestedRelief'),
    madeOn: /^\d{4}-\d{2}-\d{2}$/.test(text(r, 'dateFiled')) ? text(r, 'dateFiled') : null,
  };
}

/** What the complaint cannot be filed without - said, never filled in. */
export function kpForm7Missing(k: KpForm7Content): string[] {
  const out: string[] = [];
  if (!k.complainants.length) out.push('the complainant\'s name (Section B)');
  if (!k.respondents.length) out.push('a respondent\'s name (Section C) - a complaint is filed against a named respondent');
  if (!k.nature) out.push('the nature of the complaint (Section E)');
  if (!k.complaint) out.push('the complaint statement (Section E)');
  if (!k.relief) out.push('the relief requested (Section E)');
  return out;
}

const ORDINAL = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** "4th day of November, 2026" from YYYY-MM-DD. */
export function dayOf(date: string): { day: string; monthYear: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return { day: ORDINAL(d.getUTCDate()), monthYear: `${d.toLocaleDateString('en-PH', { month: 'long', timeZone: 'UTC' })}, ${d.getUTCFullYear()}` };
}

export const KP_FORM7_NOTICE = 'Prepared in SafeComm from the blotter intake record, following KP Form No. 7 (Complainant\'s Form) of the Katarungang Pambarangay Handbook. It takes effect only when signed by the complainant and received and filed by the Punong Barangay or Lupon Chairman. It carries no seal.';
