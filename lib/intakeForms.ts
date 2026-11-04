/**
 * The official case forms, and which one a case uses.
 *
 *   VAWC_INTAKE    - the barangay VAWC intake form (lib/officialIntakeForm),
 *                    confidential, for VAWC cases.
 *   BLOTTER_REPORT - the Barangay Blotter Intake Form (lib/blotterIntakeForm),
 *                    for blotter cases. (The type keeps its stored name:
 *                    it replaced the earlier Blotter Report on the same rows.)
 *
 * A case's form follows its desk when the form is started, and is stored
 * with it: a draft reopens as the form it was begun on even if the case is
 * later moved to the other desk. Client-safe.
 */
import { INTAKE_SECTIONS, INTAKE_FORM_VERSION, appliesTo, isAnswered, type Item, type Responses, type Section } from './officialIntakeForm';
import { BLOTTER_INTAKE_SECTIONS, BLOTTER_INTAKE_VERSION } from './blotterIntakeForm';
import { VAWC_TYPES } from './vawcTypes';

export type FormType = 'VAWC_INTAKE' | 'BLOTTER_REPORT';

export interface FormDef {
  type: FormType;
  version: string;
  /** What the form is called on screen. */
  title: string;
  sections: Section[];
  items: Item[];
  byKey: Record<string, Item>;
  pdf: {
    title: string;
    /** The two boxes at the top of every page after the first: label and the item they show. */
    box: [string, string, string, string];
    instructions: string[];
    signatures: [{ key: string; caption: string }, { key: string; caption: string }];
    /**
     * Where the source document starts a new page: before which item, and the
     * bar a page repeats when it continues a section (lib/intakeDocument.ts).
     * A form without them flows as one sheet.
     */
    pageBreaks?: { before: string; bar?: string }[];
  };
}

const build = (d: Omit<FormDef, 'items' | 'byKey'>): FormDef => {
  const items = d.sections.flatMap(s => s.items);
  return { ...d, items, byKey: Object.fromEntries(items.map(i => [i.key, i])) };
};

export const FORMS: Record<FormType, FormDef> = {
  VAWC_INTAKE: build({
    type: 'VAWC_INTAKE', version: INTAKE_FORM_VERSION, title: 'Intake Form', sections: INTAKE_SECTIONS,
    pdf: {
      title: 'INTAKE FORM', box: ['1. Client Code', 'clientCode', '2. Incident No', 'incidentNo'],
      instructions: [
        'Authorized personnel must fill out this form. Do not leave any fields blank. Write N/A for items that are not applicable.',
        'Please check the option "Others" and use the space provided for answers that are not found in the selection.',
        'Unless otherwise specified, always mark only one response field for each question.',
        'Before beginning the interview, please be sure to remind your client that all information given will be kept confidential, and that they may choose to decline to answer any of the following questions.',
        'Please feel free to add as many questions to this form as needed in your context but do not remove any.',
        'For more information on how to fill out this form, please refer to the attached instructions in the user guide.',
      ],
      signatures: [
        { key: 'signatureClient', caption: '(Signature over printed name of the victim, parent, or guardian)' },
        { key: 'signatureOfficer', caption: '(Signature over printed name of the intake officer)' },
      ],
      // The five pages of intake form.pdf: A and B items 11-17.a; B 18-30; C 31; C 32-40; D 41-51.
      pageBreaks: [
        { before: 'civilStatus', bar: 'VICTIM-SURVIVOR INFORMATION' },
        { before: 'typeOfViolence' },
        { before: 'description', bar: 'DETAILS OF THE INCIDENT' },
        { before: 'perpName' },
      ],
    },
  }),
  BLOTTER_REPORT: build({
    type: 'BLOTTER_REPORT', version: BLOTTER_INTAKE_VERSION, title: 'Blotter Intake Form', sections: BLOTTER_INTAKE_SECTIONS,
    pdf: {
      title: 'BARANGAY BLOTTER INTAKE RECORD', box: ['Blotter Ref. No.', 'blotterReferenceNo', 'Date Received', 'recordedDate'],
      instructions: [
        'To be filled out by authorized barangay personnel. Write N/A for items that are not applicable, and Unknown where the complainant does not know.',
        'Record the complainant\'s account and complaint in their own words. It is their statement, not a finding on what happened.',
        'Keep the receiving officer\'s notes and actions (Section F) apart from the complainant\'s statement.',
        'If anyone is in immediate danger, follow the urgent-response workflow at once; this record can be completed afterwards.',
        'This record is not KP Form No. 7. A complaint for barangay conciliation is filed on KP Form No. 7, only once an official has confirmed the case is eligible.',
        'VAWC cases are not recorded on this form. Refer them to the barangay VAWC desk.',
      ],
      signatures: [
        { key: 'signatureComplainant', caption: '(Signature over printed name of the complainant)' },
        { key: 'signatureOfficer', caption: '(Signature over printed name of the receiving officer)' },
      ],
      // Three pages: A and B; C and D; E and F.
      pageBreaks: [{ before: 'respondentUnknown' }, { before: 'complaintNature' }],
    },
  }),
};

/** The stored form, or the VAWC intake for rows from before forms were typed. */
export const formForType = (t: string | null | undefined): FormDef => FORMS[t === 'BLOTTER_REPORT' ? 'BLOTTER_REPORT' : 'VAWC_INTAKE'];

/** The form a case starts with: its desk's. */
export const formTypeForCase = (caseType: string): FormType =>
  ((VAWC_TYPES as readonly string[]).includes(caseType) ? 'VAWC_INTAKE' : 'BLOTTER_REPORT');

/** Every item that must be answered (or marked N/A, Unknown or Declined) before this form can be completed. */
export function missingIn(def: FormDef, r: Responses): Item[] {
  return def.items.filter(i => appliesTo(i, r) === 'required' && !isAnswered(i, r[i.key]));
}

/**
 * Answers stored by an earlier version of a form, read in the current one's
 * shape - a copy; what is stored is never rewritten. The Blotter Report kept
 * the complainant's and respondent's names as one line: they become the
 * "Full name" part of the name.
 */
export function upgradeResponses(def: FormDef, r: Responses): Responses {
  let out: Responses | null = null;
  for (const item of def.items) {
    const a = r[item.key];
    if (item.type === 'name' && typeof a?.value === 'string' && item.parts?.some(p => p.key === 'full')) {
      out ??= { ...r };
      out[item.key] = { ...a, value: a.value.trim() ? { full: a.value.slice(0, 200) } : undefined };
      if (out[item.key].value === undefined) delete out[item.key].value;
    }
  }
  return out ?? r;
}
