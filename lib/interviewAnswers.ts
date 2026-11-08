/**
 * Record Interview - which report fields an interview answer may fill, and
 * how each is answered. Nothing here is invented: every field, its section,
 * its item number, its kind of answer and its options are read from the
 * official forms the report templates are built on -
 *   VAWC:    the Intake Form (lib/officialIntakeForm.ts, items 1-51);
 *   Blotter: the Barangay Blotter Intake Form (lib/blotterIntakeForm.ts, A-F).
 * A template field with no item on its form is not offered.
 *
 * The answer is kept as one line of text (the report's draft shows text),
 * written the same way every time so the server can check it:
 *   date "2026-11-05" · time "9:30 PM" · age "37" or "about 37" ·
 *   a choice: the option's label, "Label: what was specified" when the form asks to specify ·
 *   several choices: joined with "; " · yes/no: "No" or "Yes - <what was specified>".
 * Client-safe and pure - used by the dialog and by the server.
 */
import { INTAKE_SECTIONS, type Option, type Item, type Section } from './officialIntakeForm';
import { BLOTTER_INTAKE_SECTIONS } from './blotterIntakeForm';
import { TEMPLATES, REQUEST_QUESTIONS, type TemplateName } from './reportTemplates';
import { parseExactTime } from './incidentTime';

export type AnswerInput =
  | { kind: 'text'; multiline: boolean; hint?: string }
  | { kind: 'date' }
  | { kind: 'time' }
  | { kind: 'age' }
  | { kind: 'single'; options: Option[] }
  | { kind: 'multi'; groups: { title: string; options: Option[] }[] }
  | { kind: 'yesno'; yesLabel: string };

export interface InterviewField {
  key: string;
  /** The form's own wording. */
  label: string;
  /** The form's section, e.g. "D. Alleged Perpetrator Information". */
  section: string;
  /** The form's item number, when it has one. */
  no?: string;
  /** A neutral question to start from - the official may reword it. */
  question: string;
  input: AnswerInput;
  /** Where the field and its options come from, shown under the answer. */
  basis: string;
}

const FORM_NAME: Record<TemplateName, string> = { VAWC: 'VAWC Intake Form', BLOTTER: 'Barangay Blotter Intake Form' };
const FORM_SECTIONS: Record<TemplateName, Section[]> = { VAWC: INTAKE_SECTIONS, BLOTTER: BLOTTER_INTAKE_SECTIONS };

/** "Other public spaces, specify" -> "Other public spaces"; a bare "Specify" stays "Other". */
export const optionText = (o: Option) => o.label.replace(/,?\s*specify\b.*$/i, '').trim() || 'Other';

function inputOf(item: Item): AnswerInput | null {
  switch (item.type) {
    case 'date': return { kind: 'date' };
    case 'time': return { kind: 'time' };
    case 'number': return { kind: 'age' };
    case 'single': return item.options?.length ? { kind: 'single', options: item.options } : null;
    case 'multi': return item.groups?.length ? { kind: 'multi', groups: item.groups } : item.options?.length ? { kind: 'multi', groups: [{ title: '', options: item.options }] } : null;
    case 'yesNoSpecify': return { kind: 'yesno', yesLabel: item.yesLabel ?? 'Yes, please specify' };
    case 'textarea': return { kind: 'text', multiline: true, hint: item.hint };
    case 'text': case 'name': case 'address': case 'location': case 'place': return { kind: 'text', multiline: false, hint: item.hint };
    default: return null;
  }
}

const cache = new Map<TemplateName, InterviewField[]>();
/** The fields an interview answer may fill, in the form's order, grouped by its sections. */
export function interviewFields(t: TemplateName): InterviewField[] {
  const hit = cache.get(t);
  if (hit) return hit;
  const wanted = new Set(TEMPLATES[t].fields.filter(f => f.from.includes('ai')).map(f => f.key));
  const out: InterviewField[] = [];
  for (const s of FORM_SECTIONS[t]) {
    if (s.proposed) continue;
    for (const item of s.items) {
      if (!wanted.has(item.key)) continue;
      const input = inputOf(item);
      if (!input) continue;
      out.push({ key: item.key, label: item.label.replace(/\s*\((optional)\)\s*$/i, ''), section: s.title, no: item.no, input,
        question: REQUEST_QUESTIONS[item.key] ?? `${item.label}?`,
        basis: `${FORM_NAME[t]}, ${item.no ? `item ${item.no}, ` : ''}${s.title}` });
    }
  }
  cache.set(t, out);
  return out;
}
export const interviewFieldOf = (t: TemplateName, key: string) => interviewFields(t).find(f => f.key === key) ?? null;

// ── Reading and writing an answer ──────────────────────────────────────────

/** One choice of a single/multi answer: the option, and what was specified. */
export interface Picked { option: Option; specify: string }

function readChoice(options: Option[], part: string): Picked | null {
  for (const o of options) {
    const t = optionText(o);
    if (part === t) return { option: o, specify: '' };
    if (o.specify && part.startsWith(`${t}: `)) return { option: o, specify: part.slice(t.length + 2) };
    if (o.specify && part === `${t}:`) return { option: o, specify: '' };
  }
  return null;
}
export const writeChoice = (p: Picked) => (p.option.specify ? `${optionText(p.option)}: ${p.specify.replace(/;/g, ',')}` : optionText(p.option));

export const allOptions = (i: AnswerInput): Option[] => (i.kind === 'single' ? i.options : i.kind === 'multi' ? i.groups.flatMap(g => g.options) : []);

/** The parts of a stored answer, for the dialog. */
export function readSingle(i: AnswerInput, v: string): Picked | null { return v ? readChoice(allOptions(i), v) : null; }
export function readMulti(i: AnswerInput, v: string): Picked[] {
  return v ? v.split('; ').map(p => readChoice(allOptions(i), p)).filter((x): x is Picked => x !== null) : [];
}
export function readYesNo(v: string): { yes: boolean | null; specify: string } {
  if (v === 'No') return { yes: false, specify: '' };
  if (v.startsWith('Yes')) return { yes: true, specify: v.replace(/^Yes\s*-?\s?/, '') };
  return { yes: null, specify: '' };
}
export function readAge(v: string): { about: boolean; n: string } {
  const m = /^(about )?(\d*)$/.exec(v);
  return m ? { about: Boolean(m[1]), n: m[2] } : { about: false, n: '' };
}

/**
 * Why an answer to a field cannot be saved, or null when it can. An empty
 * answer is always allowed - it fills nothing. `today` is the date in the
 * Philippines, "YYYY-MM-DD".
 */
export function checkAnswer(f: InterviewField, raw: string, today: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const i = f.input;
  switch (i.kind) {
    case 'text': return v.length > 2000 ? 'Keep the answer under 2000 characters' : null;
    case 'date':
      // A calendar date that exists - "2026-02-30" does not roll over into March.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Choose the date';
      { const d = new Date(`${v}T00:00:00Z`); if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'Choose the date'; }
      return v > today ? 'The date cannot be in the future' : null;
    case 'time': return parseExactTime(v) ? null : 'Choose the time';
    case 'age': {
      const { n } = readAge(v);
      return n && Number(n) <= 120 ? null : 'Enter the age as a number from 0 to 120';
    }
    case 'single': {
      const p = readChoice(i.options, v);
      if (!p) return 'Choose one of the form\'s options';
      return p.option.specify === 'required' && !p.specify.trim() ? `Specify "${optionText(p.option)}"` : null;
    }
    case 'multi': {
      const parts = v.split('; ');
      const picked = parts.map(p => readChoice(allOptions(i), p));
      if (picked.some(p => !p)) return 'Choose from the form\'s options';
      const missing = picked.find(p => p!.option.specify === 'required' && !p!.specify.trim());
      if (missing) return `Specify "${optionText(missing.option)}"`;
      return new Set(picked.map(p => p!.option.value)).size === picked.length ? null : 'An option is chosen twice';
    }
    case 'yesno': {
      const y = readYesNo(v);
      if (y.yes === null) return 'Choose Yes or No';
      return y.yes && !y.specify.trim() ? i.yesLabel.replace(/^Yes,\s*/i, '').replace(/^please /i, '').replace(/^./, c => c.toUpperCase()) : null;
    }
  }
}
