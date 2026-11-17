/**
 * KP Forms (Katarungang Pambarangay) for Barangay Biñang 2nd, Bocaue,
 * Bulacan - the registry of forms and their fields, the state of one open
 * intake, defaults and validation. Pure: the buttons, the left-panel inputs,
 * the saved records and the tests read it; the documents themselves are
 * drawn from it by components/kpForms/documents.tsx.
 *
 * Adding a form = one entry in KP_FORMS (and its document renderer).
 */
import { cleanNames, dateParts, todayPh } from './format';

export const KP_FORM_IDS = ['KP7', 'KP8', 'KP9', 'KP16', 'KP18', 'KP19'] as const;
export type KpFormId = typeof KP_FORM_IDS[number];
export const isKpFormId = (v: unknown): v is KpFormId => (KP_FORM_IDS as readonly unknown[]).includes(v);

/** The Punong Barangay's name as printed - set once here (or NEXT_PUBLIC_PUNONG_BARANGAY), editable per document. */
export const DEFAULT_PUNONG_BARANGAY = (process.env.NEXT_PUBLIC_PUNONG_BARANGAY ?? '').trim() || 'YBOYH N. DEL ROSARIO, JR.';

// ── State ────────────────────────────────────────────────────────────────────

export interface KpShared {
  caseNo: string;
  paraSa: string;
  complainants: string[];
  respondents: string[];
  punongBarangay: string;
}

/** Each form's own values. `null` on a name means "follow the parties / the Punong Barangay"; any string (even '') is the official's own. */
export interface KpFormValues {
  KP7: { violationDetails: string; reliefSought: string; dateMade: string; dateFiled: string };
  KP8: { recipientType: 'respondent' | 'complainant'; recipientName: string | null; hearingDate: string; hearingTime: string; dateIssued: string; dateNotified: string };
  KP9: {
    appearanceDate: string; appearanceTime: string; dateIssued: string; signatoryRole: SignatoryRole; signatoryName: string | null;
    servedDate: string; serviceMethods: ServiceMethod[]; leftWithPerson3: string; leftWithPerson4: string; serverName: string;
    receivedBy: { name: string; date: string }[];
  };
  KP16: { settlementTerms: string; dateRecorded: string; punongBarangay: string | null; signatoryRole: SignatoryRole };
  KP18: NoticeForAbsence;
  KP19: NoticeForAbsence;
}
export interface NoticeForAbsence {
  recipientName: string | null; appearanceDate: string; appearanceTime: string; missedHearingDate: string; dateIssued: string;
  signatoryRole: SignatoryRole; signatoryName: string | null; dateNotified: string;
}
export type SignatoryRole = 'pb' | 'pangkat';
/** How the summons reached each respondent (KP 9 page 2): 1-4, or '' when not served that way. */
export type ServiceMethod = '' | '1' | '2' | '3' | '4';

export interface KpIntakeState {
  walkInReportId: string;
  shared: KpShared;
  forms: { [K in KpFormId]: KpFormValues[K] };
  activeForm: KpFormId;
}

export function emptyShared(): KpShared {
  return { caseNo: '', paraSa: '', complainants: [''], respondents: [''], punongBarangay: DEFAULT_PUNONG_BARANGAY };
}

export function emptyForms(today = todayPh()): KpIntakeState['forms'] {
  const absence = (): NoticeForAbsence => ({ recipientName: null, appearanceDate: '', appearanceTime: '', missedHearingDate: '', dateIssued: today,
    signatoryRole: 'pb', signatoryName: null, dateNotified: '' });
  return {
    KP7: { violationDetails: '', reliefSought: '', dateMade: today, dateFiled: today },
    KP8: { recipientType: 'respondent', recipientName: null, hearingDate: '', hearingTime: '', dateIssued: today, dateNotified: '' },
    KP9: { appearanceDate: '', appearanceTime: '', dateIssued: today, signatoryRole: 'pb', signatoryName: null, servedDate: '', serviceMethods: [],
      leftWithPerson3: '', leftWithPerson4: '', serverName: '', receivedBy: [] },
    KP16: { settlementTerms: '', dateRecorded: today, punongBarangay: null, signatoryRole: 'pb' },
    KP18: absence(),
    KP19: absence(),
  };
}

export function emptyIntake(walkInReportId: string, today = todayPh()): KpIntakeState {
  return { walkInReportId, shared: emptyShared(), forms: emptyForms(today), activeForm: 'KP7' };
}

/** The walk-in report, as the forms are prefilled from it. Anything it lacks stays blank. */
export interface KpPrefill { caseNumber: string; caseType: string; complainant: string | null; respondents: string[]; narrative: string }
export function prefilledIntake(walkInReportId: string, p: KpPrefill, today = todayPh()): KpIntakeState {
  const s = emptyIntake(walkInReportId, today);
  s.shared.caseNo = p.caseNumber;
  s.shared.paraSa = p.caseType;
  s.shared.complainants = p.complainant ? [p.complainant] : [''];
  s.shared.respondents = p.respondents.length ? [...p.respondents] : [''];
  s.forms.KP7.violationDetails = p.narrative;
  return s;
}

// ── What a name field shows when it follows the parties ─────────────────────

export const joinNames = (names: string[]) => cleanNames(names).join(', ');

export function effectiveRecipient(id: 'KP8' | 'KP18' | 'KP19', s: KpShared, f: KpIntakeState['forms']): string {
  if (id === 'KP8') {
    const v = f.KP8;
    if (v.recipientName !== null) return v.recipientName;
    return cleanNames(v.recipientType === 'respondent' ? s.respondents : s.complainants)[0] ?? '';
  }
  const v = f[id];
  if (v.recipientName !== null) return v.recipientName;
  return joinNames(id === 'KP18' ? s.complainants : s.respondents);
}
export const effectiveSignatory = (s: KpShared, own: string | null) => (own !== null ? own : s.punongBarangay);
export const effectiveKp16Name = (s: KpShared, own: string | null) => (own !== null ? own : (s.punongBarangay ? `IGG. ${s.punongBarangay}` : ''));

// ── The registry ─────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'textarea' | 'names' | 'date' | 'time' | 'choice' | 'service' | 'received';
export type FieldGroup = 'Case details' | 'Parties' | 'Body' | 'Dates' | 'Signatories' | 'Service (page 2)';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup;
  /** 'shared' fields are the case's (case number, Para sa, parties, Punong Barangay) and carry across forms. */
  scope: 'shared' | 'form';
  required?: boolean;
  options?: { value: string; label: string }[];
  maxLength?: number;
  rows?: number;
  hint?: string;
  /** The value follows the parties or the Punong Barangay until the official types their own. */
  auto?: boolean;
}

export interface KpFormSpec {
  id: KpFormId;
  /** The number on the button and in the file name: "7", "18". */
  number: string;
  /** Printed top-left of the page. */
  label: string;
  /** On the choice button. */
  buttonTitle: string;
  title: string;
  pages: number;
  font: 'serif' | 'sans';
  fields: FieldSpec[];
}

const caseNo = (required = true): FieldSpec => ({ key: 'caseNo', label: 'Usaping Barangay Blg.', type: 'text', group: 'Case details', scope: 'shared', required, maxLength: 40 });
const paraSa = (label = 'Para sa (nature of the case)', required = true): FieldSpec =>
  ({ key: 'paraSa', label, type: 'textarea', rows: 2, group: 'Case details', scope: 'shared', required, maxLength: 160 });
const complainants: FieldSpec = { key: 'complainants', label: 'Nagsusumbong (complainants)', type: 'names', group: 'Parties', scope: 'shared', required: true };
const respondents: FieldSpec = { key: 'respondents', label: 'Ipinagsusumbong (respondents)', type: 'names', group: 'Parties', scope: 'shared', required: true };
const pb = (required = true): FieldSpec => ({ key: 'punongBarangay', label: 'Punong Barangay', type: 'text', group: 'Signatories', scope: 'shared', required, maxLength: 80 });
const date = (key: string, label: string, required = false): FieldSpec => ({ key, label, type: 'date', group: 'Dates', scope: 'form', required });
const time = (key: string, label: string, required = false): FieldSpec => ({ key, label, type: 'time', group: 'Dates', scope: 'form', required, hint: 'umaga / hapon is crossed out for you' });
const role: FieldSpec = { key: 'signatoryRole', label: 'Signs as', type: 'choice', group: 'Signatories', scope: 'form',
  options: [{ value: 'pb', label: 'Punong Barangay' }, { value: 'pangkat', label: 'Tagapangulo ng Pangkat' }], hint: 'The other is crossed out on the form' };
const signatory: FieldSpec = { key: 'signatoryName', label: 'Name of the one who signs', type: 'text', group: 'Signatories', scope: 'form', required: true, auto: true, maxLength: 80 };
const absenceFields = (recipientLabel: string): FieldSpec[] => [
  caseNo(), paraSa(), complainants, respondents,
  { key: 'recipientName', label: recipientLabel, type: 'text', group: 'Parties', scope: 'form', required: true, auto: true, maxLength: 160 },
  date('appearanceDate', 'Humarap sa ika (appearance date)', true), time('appearanceTime', 'Ganap na (time)', true),
  date('missedHearingDate', 'Nakatakda noong (missed hearing)', true), date('dateIssued', 'Ngayong (issued)', true), date('dateNotified', 'Ipinabatid ngayong (notified)'),
  role, signatory,
];

export const KP_FORMS: KpFormSpec[] = [
  {
    id: 'KP7', number: '7', label: 'KP Form 7', buttonTitle: 'Sumbong (Complaint)', title: 'SUMBONG', pages: 1, font: 'serif',
    fields: [
      caseNo(), paraSa('Para (nature of the case)'), complainants, respondents,
      { key: 'violationDetails', label: 'Paglabag - how the rights were violated', type: 'textarea', rows: 5, group: 'Body', scope: 'form', required: true, maxLength: 4000 },
      { key: 'reliefSought', label: 'Hinihiling - the relief asked for', type: 'textarea', rows: 4, group: 'Body', scope: 'form', required: true, maxLength: 3000 },
      date('dateMade', 'Ginawa ngayong (made)', true), date('dateFiled', 'Inihain at tinanggap (filed and received)', true), pb(),
    ],
  },
  {
    id: 'KP8', number: '8', label: 'KP Form 8', buttonTitle: 'Patalastas ng Pagdinig (Notice of Hearing)', title: 'PATALASTAS NG PAGDINIG', pages: 1, font: 'serif',
    fields: [
      { key: 'recipientType', label: 'Para sa', type: 'choice', group: 'Parties', scope: 'form',
        options: [{ value: 'respondent', label: 'Ipinagsusumbong' }, { value: 'complainant', label: 'Nagsusumbong' }] },
      { key: 'recipientName', label: 'Name of the one notified', type: 'text', group: 'Parties', scope: 'form', required: true, auto: true, maxLength: 120 },
      date('hearingDate', 'Pagdinig sa ika (hearing date)', true), time('hearingTime', 'Ganap na (time)', true),
      date('dateIssued', 'Ngayong (issued)', true), date('dateNotified', 'Ipinabatid ngayong (notified)'), pb(),
    ],
  },
  {
    id: 'KP9', number: '9', label: 'KP Form 9', buttonTitle: 'Patawag (Summons) + Opisyal na Nagdala ng Patawag', title: 'PATAWAG', pages: 2, font: 'sans',
    fields: [
      caseNo(), paraSa(), complainants, respondents,
      date('appearanceDate', 'Humarap sa ika (appearance date)', true), time('appearanceTime', 'Sa ganap na ika (time)', true),
      date('dateIssued', 'Ngayong (issued)', true), role, signatory,
      { key: 'servedDate', label: 'Ipinatanggap noong (served on)', type: 'date', group: 'Service (page 2)', scope: 'form' },
      { key: 'serviceMethods', label: 'How each respondent was served', type: 'service', group: 'Service (page 2)', scope: 'form' },
      { key: 'serverName', label: 'Nagdala ng Patawag (served by)', type: 'text', group: 'Service (page 2)', scope: 'form', maxLength: 80 },
      { key: 'receivedBy', label: 'Tinanggap ng kinatawan (received by)', type: 'received', group: 'Service (page 2)', scope: 'form' },
    ],
  },
  {
    id: 'KP16', number: '16', label: 'KP Form 16', buttonTitle: 'Kasunduan (Amicable Settlement)', title: 'KASUNDUAN', pages: 1, font: 'serif',
    fields: [
      caseNo(), paraSa(), complainants, respondents,
      { key: 'settlementTerms', label: 'Napagkasunduan - the terms agreed', type: 'textarea', rows: 6, group: 'Body', scope: 'form', required: true, maxLength: 4000 },
      date('dateRecorded', 'Itinala ngayong (recorded)', true),
      { key: 'punongBarangay', label: 'Pagpapatunay - name', type: 'text', group: 'Signatories', scope: 'form', required: true, auto: true, maxLength: 90 },
      role,
    ],
  },
  {
    id: 'KP18', number: '18', label: 'KP Form No. 18', buttonTitle: 'Patalastas ng Pagdinig – hindi pagdalo ng nagsusumbong', title: 'PATALASTAS NG PAGDINIG', pages: 1, font: 'serif',
    fields: absenceFields('Nagsusumbong notified'),
  },
  {
    id: 'KP19', number: '19', label: 'KP Form 19', buttonTitle: 'Patalastas ng Pagdinig – hindi pagdalo ng ipinagsusumbong', title: 'PATALASTAS NG PAGDINIG', pages: 1, font: 'serif',
    fields: absenceFields('Ipinagsusumbong notified'),
  },
];
export const kpForm = (id: KpFormId) => KP_FORMS.find(f => f.id === id)!;

// ── Validation (warnings only: blank forms may be printed and filled by hand) ─

/** The required fields this form still lacks, by their labels. */
export function missingRequired(id: KpFormId, s: KpIntakeState): string[] {
  const out: string[] = [];
  const form = s.forms[id] as unknown as Record<string, unknown>;
  for (const f of kpForm(id).fields) {
    if (!f.required) continue;
    let v: unknown;
    if (f.scope === 'shared') v = (s.shared as unknown as Record<string, unknown>)[f.key];
    else if (f.key === 'recipientName' && (id === 'KP8' || id === 'KP18' || id === 'KP19')) v = effectiveRecipient(id, s.shared, s.forms);
    else if (f.key === 'signatoryName') v = effectiveSignatory(s.shared, form.signatoryName as string | null);
    else if (f.key === 'punongBarangay' && id === 'KP16') v = effectiveKp16Name(s.shared, s.forms.KP16.punongBarangay);
    else v = form[f.key];
    const empty = Array.isArray(v) ? cleanNames(v as string[]).length === 0 : !String(v ?? '').trim();
    if (empty) out.push(f.label);
  }
  return out;
}

/** "Inihain/Ipinabatid" before "Ginawa/Ngayong" - a warning, never a block. */
export function dateOrderWarnings(id: KpFormId, s: KpIntakeState): string[] {
  const before = (a: string, b: string) => Boolean(dateParts(a) && dateParts(b) && a < b);
  if (id === 'KP7' && before(s.forms.KP7.dateFiled, s.forms.KP7.dateMade)) return ['"Inihain at tinanggap" is before "Ginawa ngayong".'];
  if (id === 'KP8' && before(s.forms.KP8.dateNotified, s.forms.KP8.dateIssued)) return ['"Ipinabatid ngayong" is before "Ngayong".'];
  if ((id === 'KP18' || id === 'KP19') && before(s.forms[id].dateNotified, s.forms[id].dateIssued)) return ['"Ipinabatid ngayong" is before "Ngayong".'];
  return [];
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** What one saved record holds: the case's shared values and this form's own. */
export interface KpRecordData { shared: KpShared; form: unknown }
export function recordData(id: KpFormId, s: KpIntakeState): KpRecordData {
  return { shared: s.shared, form: s.forms[id] };
}

/** A saved record back into an open intake, defensively: unknown keys are dropped, missing ones take the defaults. */
export function applyRecord(s: KpIntakeState, id: KpFormId, data: unknown): KpIntakeState {
  const d = (data && typeof data === 'object' ? data : {}) as { shared?: Partial<KpShared>; form?: Record<string, unknown> };
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
  const names = (v: unknown, fb: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fb);
  const shared: KpShared = {
    caseNo: str(d.shared?.caseNo, s.shared.caseNo), paraSa: str(d.shared?.paraSa, s.shared.paraSa),
    complainants: names(d.shared?.complainants, s.shared.complainants), respondents: names(d.shared?.respondents, s.shared.respondents),
    punongBarangay: str(d.shared?.punongBarangay, s.shared.punongBarangay),
  };
  const base = emptyForms()[id] as unknown as Record<string, unknown>;
  const form: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) if (d.form && k in d.form) form[k] = d.form[k];
  return { ...s, shared, activeForm: id, forms: { ...s.forms, [id]: form } };
}
