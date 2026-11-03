/**
 * The Barangay Blotter Report - the official record a blotter officer keeps
 * for a blotter case: complainant, person reported, incident, the initial
 * action taken and the case documentation.
 *
 * Built on the same engine as the VAWC intake form (lib/officialIntakeForm):
 * drafts, versions, completion, N/A / Unknown / Declined markers, the PDF and
 * the access log all work the same way. It is never used for a VAWC case.
 *
 * Client-safe: no data, no keys.
 */
import { o, type Section, type Responses } from './officialIntakeForm';
import { BLOTTER_CATEGORIES } from './classificationSchema';

export const BLOTTER_REPORT_VERSION = 'blotter-report/2026-11';

const otherRelationship = (r: Responses) => r.complainantRelationship?.value === 'other';

export const BLOTTER_REPORT_SECTIONS: Section[] = [
  {
    key: 'A',
    title: 'A. Complainant Information',
    note: 'The complainant is the person making the report. They may or may not be the person affected.',
    items: [
      { key: 'complainantName', label: 'Full Name', type: 'text' },
      { key: 'complainantAge', label: 'Age', type: 'number' },
      { key: 'complainantAddress', label: 'Address', type: 'text' },
      { key: 'complainantContact', label: 'Contact Number', type: 'text',
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
      { key: 'preferredContact', label: 'Preferred contact method', type: 'single', options: [
        o('call_ok', 'Call or text'), o('text_first', 'Text first before calling'),
        o('in_person', 'In person at the barangay hall only'), o('no_phone', 'Do not call or text'),
      ] },
    ],
  },
  {
    key: 'B',
    title: 'B. Person Reported Information',
    note: 'Record only what the complainant knows. Mark "Unknown" rather than guessing.',
    items: [
      { key: 'respondentName', label: 'Full Name', type: 'text' },
      { key: 'respondentAge', label: 'Age (optional)', type: 'number', applies: () => 'optional' },
      { key: 'respondentAddress', label: 'Address (optional)', type: 'text', applies: () => 'optional' },
      { key: 'respondentRelationship', label: 'Relationship to the complainant', type: 'text' },
      { key: 'respondentOther', label: 'Other relevant information (optional)', type: 'textarea', applies: () => 'optional' },
    ],
  },
  {
    key: 'C',
    title: 'C. Incident Information',
    items: [
      { key: 'incidentDate', label: 'Incident Date', type: 'date' },
      { key: 'incidentTime', label: 'Incident Time', type: 'text', hint: 'The time as the complainant gives it - "around 9 PM" is fine.' },
      { key: 'incidentLocation', label: 'Incident Location', type: 'text', hint: 'Street, landmark or place.' },
      { key: 'incidentCategory', label: 'Incident Category', type: 'single',
        hint: 'As documented in this report. The case\'s own category is confirmed in the category review on the case page.',
        options: [...BLOTTER_CATEGORIES.filter(c => c.category !== 'Other').map(c => o(c.category, c.category)), o('Other', 'Other, specify', 'required')] },
      { key: 'narrative', label: 'Incident Narrative', type: 'textarea',
        hint: 'The complainant\'s account, in their words as much as possible. The original report filed is kept unchanged on the case.' },
      { key: 'attachments', label: 'Supporting Attachments', type: 'single', options: [
        o('on_file', 'Photos or documents are attached to the case'),
        o('paper', 'Received on paper, kept at the barangay hall'),
        o('none', 'None'),
      ] },
    ],
  },
  {
    key: 'D',
    title: 'D. Initial Action Taken',
    items: [
      { key: 'immediateDanger', label: 'Is anyone in immediate danger?', type: 'single',
        hint: 'If yes, follow the urgent-response workflow now - you do not need to finish this report first. Saving flags the case for urgent review.',
        options: [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Not known')] },
      { key: 'actionTaken', label: 'Action taken by barangay personnel', type: 'textarea' },
      { key: 'receivingOfficer', label: 'Receiving officer', type: 'text' },
      { key: 'recordedDate', label: 'Date recorded', type: 'date' },
      { key: 'recordedTime', label: 'Time recorded', type: 'time' },
      { key: 'initialObservations', label: 'Initial observations', type: 'textarea',
        hint: 'What the officer saw or noted. Keep it apart from what the complainant alleged.' },
      { key: 'recommendedNextSteps', label: 'Recommended next steps', type: 'textarea' },
    ],
  },
  {
    key: 'E',
    title: 'E. Case Documentation',
    note: 'Follow-up records, investigation updates and referrals are kept in the case timeline and Case records; hearings in the Hearings panel. Resolution details are recorded when the case is resolved or closed.',
    items: [
      { key: 'blotterReferenceNo', label: 'Blotter Reference Number', type: 'text' },
      { key: 'assignedOfficer', label: 'Assigned Blotter Officer', type: 'text' },
      { key: 'caseStatus', label: 'Case status when this report was recorded', type: 'text' },
      { key: 'resolutionDetails', label: 'Resolution details (optional)', type: 'textarea', applies: () => 'optional' },
      { key: 'signatureComplainant', label: 'Signature over printed name of the complainant - signed on the paper copy', type: 'confirm', applies: () => 'optional' },
      { key: 'signatureOfficer', label: 'Signature over printed name of the receiving officer - signed on the paper copy', type: 'confirm', applies: () => 'optional' },
    ],
  },
];
