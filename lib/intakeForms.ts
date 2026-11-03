/**
 * The official case forms, and which one a case uses.
 *
 *   VAWC_INTAKE    - the barangay VAWC intake form (lib/officialIntakeForm),
 *                    confidential, for VAWC cases.
 *   BLOTTER_REPORT - the Barangay Blotter Report (lib/blotterReportForm),
 *                    for blotter cases.
 *
 * A case's form follows its desk when the form is started, and is stored
 * with it: a draft reopens as the form it was begun on even if the case is
 * later moved to the other desk. Client-safe.
 */
import { INTAKE_SECTIONS, INTAKE_FORM_VERSION, appliesTo, isAnswered, type Item, type Responses, type Section } from './officialIntakeForm';
import { BLOTTER_REPORT_SECTIONS, BLOTTER_REPORT_VERSION } from './blotterReportForm';
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
    },
  }),
  BLOTTER_REPORT: build({
    type: 'BLOTTER_REPORT', version: BLOTTER_REPORT_VERSION, title: 'Blotter Report', sections: BLOTTER_REPORT_SECTIONS,
    pdf: {
      title: 'BARANGAY BLOTTER REPORT', box: ['Blotter Ref. No.', 'blotterReferenceNo', 'Incident Date', 'incidentDate'],
      instructions: [
        'To be filled out by authorized barangay personnel. Write N/A for items that are not applicable, and Unknown where the complainant does not know.',
        'Record what the complainant states as their account. It is not a finding on what happened.',
        'If anyone is in immediate danger, follow the urgent-response workflow at once; this report can be completed afterwards.',
        'VAWC cases are not recorded on this form. Refer them to the barangay VAWC desk.',
      ],
      signatures: [
        { key: 'signatureComplainant', caption: '(Signature over printed name of the complainant)' },
        { key: 'signatureOfficer', caption: '(Signature over printed name of the receiving officer)' },
      ],
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
