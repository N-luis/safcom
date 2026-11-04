/**
 * The Barangay Blotter Intake Form - the blotter officer's record of a
 * blotter complaint, sections A to F: administrative information, the
 * complainant, the respondent, the incident, the complaint and the relief the
 * complainant asks for, and the initial action taken.
 *
 * It replaces the earlier Blotter Report (sections A-E). Every item that form
 * had keeps its key here, so a record begun on it reopens with its answers;
 * the two names it kept as one line are read as the "Full name" part
 * (upgradeResponses in lib/intakeForms.ts). Nothing stored is rewritten.
 *
 * Built on the same engine as the VAWC intake form (lib/officialIntakeForm):
 * drafts, versions, completion, N/A / Unknown / Declined markers, the live
 * preview, the PDF and the access log work the same way. Never used for a
 * VAWC case. The complainant's statement (D, E) and the officer's own notes
 * (F) are kept apart.
 *
 * Client-safe: no data, no keys.
 */
import { o, NAME_PARTS, type Section, type Responses } from './officialIntakeForm';
import { BLOTTER_CATEGORIES } from './classificationSchema';

export const BLOTTER_INTAKE_VERSION = 'blotter-intake/2026-11';

/** A person's name as the form asks it: the parts, and the name as written. */
export const PERSON_NAME_PARTS = [...NAME_PARTS, { key: 'full', label: 'Full name (as written)' }];

const otherRelationship = (r: Responses) => r.complainantRelationship?.value === 'other';
/** Section C asks less once the respondent is recorded as unknown. */
const respondentKnown = (r: Responses) => r.respondentUnknown?.value !== 'yes';
const whenKnown = (r: Responses) => (respondentKnown(r) ? 'required' : 'optional');

export const BLOTTER_INTAKE_SECTIONS: Section[] = [
  {
    key: 'A',
    title: 'A. Administrative Information',
    items: [
      { key: 'blotterReferenceNo', label: 'Blotter Reference Number', type: 'text',
        hint: 'The case number SafeComm gave this report. It is not generated again here.' },
      { key: 'recordedDate', label: 'Date received', type: 'date' },
      { key: 'recordedTime', label: 'Time received', type: 'time' },
      { key: 'receivingOfficer', label: 'Receiving officer', type: 'text' },
      { key: 'barangay', label: 'Barangay', type: 'text' },
      { key: 'assignedOfficer', label: 'Assigned officer', type: 'text' },
      { key: 'caseStatus', label: 'Initial case status', type: 'text',
        hint: 'As recorded on the case. The case status itself is changed from the case page, with a follow-up entry.' },
    ],
  },
  {
    key: 'B',
    title: 'B. Complainant Information',
    note: 'The complainant is the person making the complaint. They may or may not be the person affected.',
    items: [
      { key: 'complainantName', label: 'Name', type: 'name', parts: PERSON_NAME_PARTS },
      { key: 'complainantAge', label: 'Age (optional)', type: 'number', applies: () => 'optional' },
      { key: 'complainantAddress', label: 'Address', type: 'text' },
      { key: 'complainantContact', label: 'Contact number', type: 'text',
        hint: 'A number the complainant confirms they can be reached on. Registered numbers are shown in the Reporter Information panel.' },
      { key: 'complainantOccupation', label: 'Occupation (optional)', type: 'text', applies: () => 'optional' },
      { key: 'complainantRelationship', label: 'Relationship to the incident', type: 'single', options: [
        o('directly_involved', 'Directly involved - the complainant was affected'),
        o('for_another', 'Reporting on behalf of, or about, another person'),
        o('witness', 'Witness'),
        o('responder', 'Barangay personnel or responder'),
        o('other', 'Other, specify', 'required'),
      ] },
      { key: 'complainantRelationshipNote', label: 'If someone else was affected, who are they to the complainant?', type: 'text',
        applies: r => (r.complainantRelationship?.value === 'for_another' || otherRelationship(r) ? 'optional' : 'hidden') },
      { key: 'preferredContact', label: 'Preferred safe contact method, when applicable', type: 'single', options: [
        o('call_ok', 'Call or text'), o('text_first', 'Text first before calling'),
        o('in_person', 'In person at the barangay hall only'), o('no_phone', 'Do not call or text'),
      ] },
      { key: 'additionalComplainants', label: 'Other complainants, if any (optional)', type: 'textarea', applies: () => 'optional',
        hint: 'One per line: name, address and contact number.' },
    ],
  },
  {
    key: 'C',
    title: 'C. Respondent Information',
    note: 'Record only what the complainant knows. If the respondent is not known, say so rather than guessing.',
    items: [
      { key: 'respondentUnknown', label: 'The respondent is unknown, or the information is unavailable', type: 'confirm', applies: () => 'optional' },
      { key: 'respondentName', label: 'Name', type: 'name', parts: PERSON_NAME_PARTS, applies: whenKnown },
      { key: 'respondentAge', label: 'Age (optional)', type: 'number', applies: () => 'optional' },
      { key: 'respondentAddress', label: 'Address, if known', type: 'text', applies: () => 'optional' },
      { key: 'respondentContact', label: 'Contact number, if available', type: 'text', applies: () => 'optional' },
      { key: 'respondentRelationship', label: 'Relationship to the complainant', type: 'text', applies: whenKnown },
      { key: 'respondentOther', label: 'Other relevant information (optional)', type: 'textarea', applies: () => 'optional' },
      { key: 'additionalRespondents', label: 'Other respondents, if any (optional)', type: 'textarea', applies: () => 'optional',
        hint: 'One per line: name, address and relationship to the complainant, as far as known.' },
    ],
  },
  {
    key: 'D',
    title: 'D. Incident Information',
    items: [
      { key: 'incidentDate', label: 'Incident date', type: 'date' },
      { key: 'incidentTime', label: 'Incident time', type: 'text', hint: 'The time as the complainant gives it - "around 9 PM" is fine.' },
      { key: 'incidentLocation', label: 'Incident location', type: 'text', hint: 'Street, landmark or place.' },
      { key: 'incidentCategory', label: 'Incident category', type: 'single',
        hint: 'As documented in this record. The case\'s own category is confirmed in the category review on the case page.',
        options: [...BLOTTER_CATEGORIES.filter(c => c.category !== 'Other').map(c => o(c.category, c.category)), o('Other', 'Other, specify', 'required')] },
      { key: 'narrative', label: 'Detailed incident narrative', type: 'textarea',
        hint: 'The complainant\'s account, in their words as much as possible. Do not rewrite or summarise it. The original report filed is kept unchanged on the case.' },
      { key: 'personsInvolved', label: 'Persons involved', type: 'textarea', applies: () => 'optional',
        hint: 'Anyone else involved, as the complainant names them.' },
      { key: 'witnesses', label: 'Witnesses, if applicable', type: 'textarea', applies: () => 'optional' },
      { key: 'attachments', label: 'Supporting documents or attachments', type: 'single', options: [
        o('on_file', 'Photos or documents are attached to the case'),
        o('paper', 'Received on paper, kept at the barangay hall'),
        o('none', 'None'),
      ] },
    ],
  },
  {
    key: 'E',
    title: 'E. Complaint and Requested Relief',
    note: 'In the complainant\'s own words. Do not add legal claims or decide the relief for them. If the case goes to Katarungang Pambarangay proceedings, these are what KP Form No. 7 carries.',
    items: [
      { key: 'complaintNature', label: 'Nature or subject of the complaint', type: 'text', hint: 'Short, as the complainant puts it - for example "unpaid debt" or "noise at night".' },
      { key: 'complaintStatement', label: 'Detailed complaint statement', type: 'textarea',
        hint: 'How the complainant says their rights or interests were violated, in their words.' },
      { key: 'requestedRelief', label: 'Requested relief or assistance', type: 'textarea', hint: 'What the complainant asks for, as they state it.' },
      { key: 'additionalInfo', label: 'Additional relevant information (optional)', type: 'textarea', applies: () => 'optional' },
    ],
  },
  {
    key: 'F',
    title: 'F. Initial Action and Documentation',
    note: 'The barangay\'s own record - kept apart from the complainant\'s statement above. Follow-ups, referrals and hearings are also kept on the case page.',
    items: [
      { key: 'immediateDanger', label: 'Is anyone in immediate danger?', type: 'single',
        hint: 'If yes, follow the urgent-response workflow now - you do not need to finish this form first. Saving flags the case for urgent review.',
        options: [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Not known')] },
      { key: 'actionTaken', label: 'Initial action taken', type: 'textarea' },
      { key: 'initialObservations', label: 'Receiving officer\'s notes', type: 'textarea',
        hint: 'What the officer saw or noted. Not the complainant\'s account.' },
      { key: 'referralInfo', label: 'Referral information (optional)', type: 'textarea', applies: () => 'optional',
        hint: 'Where the complainant was referred, if anywhere (PNP, MSWDO, health centre...).' },
      { key: 'recommendedNextSteps', label: 'Follow-up information', type: 'textarea', hint: 'The next steps agreed or planned.' },
      { key: 'dateFiled', label: 'Date filed', type: 'date', applies: () => 'optional' },
      { key: 'acknowledgment', label: 'Acknowledgment', type: 'single', applies: () => 'optional', options: [
        o('given', 'Acknowledgment given to the complainant'),
        o('not_yet', 'Not yet given'),
        o('declined', 'The complainant did not want one'),
      ] },
      { key: 'resolutionDetails', label: 'Resolution details (optional)', type: 'textarea', applies: () => 'optional' },
      { key: 'signatureComplainant', label: 'Signature over printed name of the complainant - signed on the paper copy', type: 'confirm', applies: () => 'optional' },
      { key: 'signatureOfficer', label: 'Signature over printed name of the receiving officer - signed on the paper copy', type: 'confirm', applies: () => 'optional' },
    ],
  },
];

/** A name answer as one line: the full name as written, or the parts in order. */
export function nameText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '';
  const n = v as Record<string, string>;
  if (n.full?.trim()) return n.full.trim();
  return [n.first, n.middle, n.last, n.extension].map(x => x?.trim()).filter(Boolean).join(' ');
}
