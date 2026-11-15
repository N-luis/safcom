/**
 * AI-Assisted Report Standardization: the two templates a resident's report
 * is organized into, built from the existing intake forms - the same item
 * keys and labels as the Blotter report (lib/blotterIntakeForm.ts) and the
 * VAWC intake form (lib/officialIntakeForm.ts), grouped the way the desks
 * read a report. Pure - shared by the server, the pages and the tests.
 *
 * Each field says where its value may come from:
 *   records  - what the case already holds (the resident's form answers, the
 *              case's own dates and numbers, officials' records);
 *   ai       - SafeComm AI may fill it from the resident's words, only with a
 *              quote that is found in them (lib/reportStandardizer.ts);
 *   official - only an official may supply it.
 * A field with nothing behind it is NEEDS_CONFIRMATION - never guessed.
 */
import { ITEM_BY_KEY } from './officialIntakeForm';
import { BLOTTER_INTAKE_SECTIONS } from './blotterIntakeForm';
import { isVawcType } from './reportingStats';

export type TemplateName = 'BLOTTER' | 'VAWC';
export const templateFor = (caseType: string): TemplateName => (isVawcType(caseType) ? 'VAWC' : 'BLOTTER');

/** Where a value came from - shown beside every field. */
export const FIELD_STATUSES = {
  RESIDENT_CONFIRMED: { label: 'Stated by the resident', resident: 'You stated this' },
  ORIGINAL: { label: 'From the original report', resident: 'From your report' },
  NEW: { label: 'Newly supplied', resident: 'You added this' },
  AI_ORGANIZED: { label: 'Organized by SafeComm AI', resident: 'Organized by SafeComm AI' },
  UNVERIFIED: { label: 'Stated with uncertainty - unverified', resident: 'You were not sure' },
  RECORDED: { label: 'From the case record', resident: 'From the case record' },
  OFFICIAL: { label: 'Recorded by an official', resident: 'Recorded by the barangay' },
  NEEDS_CONFIRMATION: { label: 'Needs confirmation', resident: 'Not given yet' },
} as const;
export type FieldStatus = keyof typeof FIELD_STATUSES;

export type AiKind = 'text' | 'date' | 'time' | 'age' | 'name' | 'choice' | 'yesno';

export interface TemplateField {
  key: string;
  label: string;
  section: string;
  from: Array<'records' | 'ai' | 'official'>;
  ai?: { kind: AiKind; options?: string[]; hint: string };
  /** The question a resident may be asked when this is missing - neutral, and always skippable. */
  ask?: { question: string; kind: 'text' | 'date' | 'time' };
}

const BLOTTER_LABEL: Record<string, string> = Object.fromEntries(BLOTTER_INTAKE_SECTIONS.flatMap(s => s.items.map(i => [i.key, i.label])));
const bl = (key: string) => BLOTTER_LABEL[key] ?? key;
const vl = (key: string) => ITEM_BY_KEY[key]?.label ?? key;

const ASK = {
  date: { question: 'When did the incident happen?', kind: 'date' as const },
  time: { question: 'About what time did it happen?', kind: 'time' as const },
  place: { question: 'Where did the incident happen?', kind: 'text' as const },
};

const PLACE_OPTIONS = ['Conjugal Home', "Victim's Home", "Perpetrator's Home", 'Malls/Hotels', 'School', 'Workplace', 'Public Utility Vehicle (PUV)', 'Evacuation area', 'Other public spaces'];

export const TEMPLATES: Record<TemplateName, { title: string; sections: string[]; fields: TemplateField[] }> = {
  BLOTTER: {
    title: 'Blotter Intake Report',
    sections: ['Administrative information', 'Complainant information', 'Respondent information', 'Incident date, time and location',
      'Incident description', 'Complaint or requested action', 'Initial action and supporting documentation'],
    fields: [
      { key: 'blotterReferenceNo', label: bl('blotterReferenceNo'), section: 'Administrative information', from: ['records'] },
      { key: 'recordedDate', label: bl('recordedDate'), section: 'Administrative information', from: ['records'] },
      { key: 'recordedTime', label: bl('recordedTime'), section: 'Administrative information', from: ['records'] },
      { key: 'assignedOfficer', label: bl('assignedOfficer'), section: 'Administrative information', from: ['records'] },
      { key: 'complainantName', label: bl('complainantName'), section: 'Complainant information', from: ['records'] },
      { key: 'complainantRelationship', label: bl('complainantRelationship'), section: 'Complainant information', from: ['records'] },
      { key: 'complainantRelationshipNote', label: bl('complainantRelationshipNote'), section: 'Complainant information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'who the affected person is to the complainant, only if the report says so' } },
      { key: 'respondentName', label: bl('respondentName'), section: 'Respondent information', from: ['records', 'ai'],
        ai: { kind: 'name', hint: 'the name of the person complained about, exactly as written; empty if no name is given' } },
      { key: 'respondentAge', label: bl('respondentAge'), section: 'Respondent information', from: ['records', 'ai'],
        ai: { kind: 'age', hint: 'their age only if a number is stated' } },
      { key: 'respondentAddress', label: bl('respondentAddress'), section: 'Respondent information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'where the person complained about lives, only if stated' } },
      { key: 'respondentRelationship', label: bl('respondentRelationship'), section: 'Respondent information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'what they are to the complainant (neighbour, relative...), only if stated' } },
      { key: 'incidentDate', label: bl('incidentDate'), section: 'Incident date, time and location', from: ['records', 'ai'],
        ai: { kind: 'date', hint: 'YYYY-MM-DD only when an explicit calendar date is written; never work one out from "yesterday" or "last night"' }, ask: ASK.date },
      { key: 'incidentTime', label: bl('incidentTime'), section: 'Incident date, time and location', from: ['records', 'ai'],
        ai: { kind: 'time', hint: 'the time as stated, e.g. "around 9 PM", "madaling-araw"' }, ask: ASK.time },
      { key: 'incidentLocation', label: bl('incidentLocation'), section: 'Incident date, time and location', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'the place, street or landmark as stated' }, ask: ASK.place },
      { key: 'incidentCategory', label: bl('incidentCategory'), section: 'Incident description', from: ['official'] },
      { key: 'narrative', label: bl('narrative'), section: 'Incident description', from: ['records'] },
      { key: 'personsInvolved', label: bl('personsInvolved'), section: 'Incident description', from: ['ai'],
        ai: { kind: 'text', hint: 'the people involved and their part, as described - roles only when stated' } },
      { key: 'witnesses', label: bl('witnesses'), section: 'Incident description', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'who saw or heard it, only if stated' } },
      { key: 'complaintNature', label: bl('complaintNature'), section: 'Complaint or requested action', from: ['ai'],
        ai: { kind: 'text', hint: 'a few words naming what the complaint is about, in the reporter\'s terms (e.g. "noise at night")' } },
      { key: 'requestedRelief', label: bl('requestedRelief'), section: 'Complaint or requested action', from: ['ai'],
        ai: { kind: 'text', hint: 'what the reporter asks the barangay to do, only if stated' },
        ask: { question: 'What would you like the barangay to do about it?', kind: 'text' } },
      { key: 'immediateDanger', label: bl('immediateDanger'), section: 'Initial action and supporting documentation', from: ['records', 'official'] },
      { key: 'actionTaken', label: bl('actionTaken'), section: 'Initial action and supporting documentation', from: ['official'] },
      { key: 'attachments', label: bl('attachments'), section: 'Initial action and supporting documentation', from: ['records'] },
    ],
  },
  VAWC: {
    title: 'VAWC Intake Report (confidential)',
    sections: ['Confidential administrative information', 'Reporting person information', 'Victim-survivor information', 'Incident information',
      'Alleged perpetrator information', 'Initial safety assessment', 'Intervention and referral information'],
    fields: [
      { key: 'incidentNo', label: vl('incidentNo'), section: 'Confidential administrative information', from: ['records'] },
      { key: 'dateReported', label: 'Date reported', section: 'Confidential administrative information', from: ['records'] },
      { key: 'reportingMode', label: vl('reportingMode'), section: 'Confidential administrative information', from: ['records'] },
      { key: 'informantName', label: vl('informantName'), section: 'Reporting person information', from: ['records'] },
      { key: 'informantRelationship', label: vl('informantRelationship'), section: 'Reporting person information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'what the reporting person is to the victim-survivor, only if stated' } },
      { key: 'victimName', label: `${vl('victimName')} (victim-survivor)`, section: 'Victim-survivor information', from: ['records', 'ai'],
        ai: { kind: 'name', hint: 'the victim-survivor\'s name exactly as written; empty if not given' } },
      // Sex is recorded by an official, never read from a name or the narrative.
      { key: 'sexAtBirth', label: vl('sexAtBirth'), section: 'Victim-survivor information', from: ['records', 'official'] },
      { key: 'age', label: vl('age'), section: 'Victim-survivor information', from: ['records', 'ai'],
        ai: { kind: 'age', hint: 'the victim-survivor\'s age only if a number is stated' } },
      { key: 'description', label: vl('description'), section: 'Incident information', from: ['records'] },
      { key: 'incidentDate', label: vl('incidentDate'), section: 'Incident information', from: ['records', 'ai'],
        ai: { kind: 'date', hint: 'YYYY-MM-DD only when an explicit calendar date is written; never work one out from "yesterday" or "last night"' }, ask: ASK.date },
      { key: 'incidentTime', label: vl('incidentTime'), section: 'Incident information', from: ['records', 'ai'],
        ai: { kind: 'time', hint: 'the time as stated' }, ask: ASK.time },
      { key: 'incidentLocation', label: vl('incidentLocation'), section: 'Incident information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'the place as stated' }, ask: ASK.place },
      { key: 'typeOfPlace', label: vl('typeOfPlace'), section: 'Incident information', from: ['ai'],
        ai: { kind: 'choice', options: PLACE_OPTIONS, hint: 'one of the listed places, only if the report clearly says where' } },
      { key: 'electronicMeans', label: vl('electronicMeans'), section: 'Incident information', from: ['ai'],
        ai: { kind: 'yesno', hint: '"Yes - <medium>" only if the report says it happened through a phone, chat or social media; otherwise leave it out' } },
      // The form of violence is an official's call (the intake form), never the AI's.
      { key: 'typeOfViolence', label: vl('typeOfViolence'), section: 'Incident information', from: ['official'] },
      { key: 'perpName', label: `${vl('perpName')} (alleged perpetrator)`, section: 'Alleged perpetrator information', from: ['records', 'ai'],
        ai: { kind: 'name', hint: 'the alleged perpetrator\'s name exactly as written; empty if not given' } },
      { key: 'perpAge', label: vl('perpAge'), section: 'Alleged perpetrator information', from: ['records', 'ai'],
        ai: { kind: 'age', hint: 'their age only if a number is stated' } },
      { key: 'perpRelationship', label: vl('perpRelationship'), section: 'Alleged perpetrator information', from: ['records', 'ai'],
        ai: { kind: 'text', hint: 'what they are to the victim-survivor (husband, ex-partner...), only if stated' } },
      { key: 'immediateDanger', label: 'Immediate danger disclosed', section: 'Initial safety assessment', from: ['records', 'official'] },
      { key: 'safetyAssessment', label: 'Initial safety assessment', section: 'Initial safety assessment', from: ['official'] },
      { key: 'referrals', label: 'Referrals', section: 'Intervention and referral information', from: ['official'] },
      { key: 'interventions', label: 'Interventions recorded', section: 'Intervention and referral information', from: ['official'] },
    ],
  },
};

/**
 * Suggested wording for an official's clarification request, by field -
 * sent only when the official chooses to. Never asked automatically: the
 * resident's own follow-up questions (`ask`) stay to the date, time and place.
 * About the person responsible, only "if it is safe to share".
 */
export const REQUEST_QUESTIONS: Record<string, string> = {
  complainantRelationshipNote: 'Who is the person affected to you?',
  respondentName: 'Do you know the name of the person you are reporting?',
  respondentAge: 'Do you know about how old the person you reported is?',
  respondentAddress: 'Do you know where the person you reported lives?',
  respondentRelationship: 'What is the person you reported to you - for example a neighbour or a relative?',
  personsInvolved: 'Who else was involved, and what did each person do?',
  witnesses: 'Did anyone else see or hear what happened?',
  requestedRelief: 'What would you like the barangay to do about it?',
  informantRelationship: 'What is the person affected to you?',
  victimName: 'What name should the barangay use for the person affected?',
  age: 'About how old is the person affected?',
  typeOfPlace: 'What kind of place did it happen in - for example a home, a workplace or a public place?',
  electronicMeans: 'Did any of it happen through a phone, chat or social media?',
  perpName: 'If it is safe to share, what is the name of the person responsible?',
  perpAge: 'If it is safe to share, about how old is the person responsible?',
  perpRelationship: 'If it is safe to share, what is the person responsible to the person affected?',
  incidentDate: 'When did the incident happen?',
  incidentTime: 'About what time did it happen?',
  incidentLocation: 'Where did the incident happen?',
};

export const fieldsOf = (t: TemplateName) => TEMPLATES[t].fields;
export const fieldOf = (t: TemplateName, key: string) => TEMPLATES[t].fields.find(f => f.key === key) ?? null;
export const aiFields = (t: TemplateName) => TEMPLATES[t].fields.filter(f => f.ai);

/**
 * Questions that are not a template field - offered once, always optional.
 * "Can you clarify what occurred?" only when the report is short; the others
 * once each. Answers are added to the report as the resident's own words.
 */
export const EXTRA_QUESTIONS = {
  q_clarify: 'Can you clarify what occurred?',
  q_afterward: 'What happened afterward?',
  q_important: 'Is there any important information you would like the responding official to know?',
} as const;
export type ExtraQuestion = keyof typeof EXTRA_QUESTIONS;

export interface DraftField {
  value: string | null;
  status: FieldStatus;
  /** "v1" (the original), "v3" (a later version), "records", "official". */
  source: string | null;
  /** The resident's words behind an AI-filled value. */
  quote?: string | null;
  note?: string | null;
  /** The narrative: what later versions added, kept apart from the original. */
  additions?: { version: number; source: string; text: string }[];
  /** Another recorded detail says something different (e.g. the report's own words) - kept, not overwritten. */
  conflictWith?: string | null;
  /** An official's edit or confirmation: who (user id and name) and when (ISO). */
  by?: string | null;
  byName?: string | null;
  at?: string | null;
  /** A confirmation: where the confirmed value came from. */
  confirmedFrom?: FieldStatus | null;
  /** The form's own answer for a question with no value: N/A, Unknown, Declined to answer. */
  marker?: 'na' | 'unknown' | 'declined' | null;
}
export type DraftFields = Record<string, DraftField>;

export const countNeedsConfirmation = (f: DraftFields) => Object.values(f).filter(x => x.status === 'NEEDS_CONFIRMATION').length;

/** The form's answers for a question that has no value (lib/officialIntakeForm MARKER_LABEL) - never invented values. */
export const FIELD_MARKERS = { unknown: 'Unknown', declined: 'Declined to answer', na: 'N/A' } as const;

const BLOTTER_ITEMS: Record<string, { applies?: unknown }> = Object.fromEntries(BLOTTER_INTAKE_SECTIONS.flatMap(s => s.items.map(i => [i.key, i])));
/**
 * The template fields the official form always requires - items with no
 * condition on them (lib/officialIntakeForm, lib/blotterIntakeForm). A required
 * field is answered with a value or one of the form's markers before approval.
 */
export function requiredKeys(t: TemplateName): string[] {
  const items: Record<string, { applies?: unknown }> = t === 'VAWC' ? ITEM_BY_KEY : BLOTTER_ITEMS;
  return TEMPLATES[t].fields.filter(f => items[f.key] && !items[f.key].applies).map(f => f.key);
}

export type AttentionReason = 'missing' | 'unclear' | 'conflict' | 'verify' | 'response';
export interface Attention { key: string; label: string; section: string; reason: AttentionReason; required: boolean; field: DraftField }
/**
 * What an official still has to look at in a draft: missing, unclear,
 * conflicting, organized by SafeComm AI and not yet confirmed, or answered by
 * the resident in response to a clarification request (`responseVersions`:
 * the report versions that are such responses) - an official decides whether
 * the draft keeps it. The case's records and officials' own entries are not
 * listed. The original narrative never is.
 */
export function needsAttention(t: TemplateName, fields: DraftFields, responseVersions: ReadonlySet<number> = new Set()): Attention[] {
  const req = new Set(requiredKeys(t));
  const out: Attention[] = [];
  for (const f of TEMPLATES[t].fields) {
    if (f.key === 'narrative' || f.key === 'description') continue;
    const v = fields[f.key] ?? { value: null, status: 'NEEDS_CONFIRMATION' as FieldStatus, source: null };
    if (v.status === 'OFFICIAL') continue;
    const reason: AttentionReason | null = v.status === 'NEEDS_CONFIRMATION' ? 'missing'
      : v.conflictWith ? 'conflict'
      : v.status === 'UNVERIFIED' ? 'unclear'
      : v.status === 'AI_ORGANIZED' || ((v.status === 'ORIGINAL' || v.status === 'NEW') && v.note !== 'From a recorded interview') ? 'verify'
      : v.status === 'RESIDENT_CONFIRMED' && /^v\d+$/.test(v.source ?? '') && responseVersions.has(Number(v.source!.slice(1))) ? 'response'
      : null;
    if (reason) out.push({ key: f.key, label: f.label, section: f.section, reason, required: req.has(f.key), field: v });
  }
  return out;
}
