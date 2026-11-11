/**
 * The Service Referral Form ("Referral Form.pdf", IACVAWC) - its fields, as
 * the form names them, what may be entered, what issuing needs, and how a
 * referral moves from draft to acknowledgement. Pure and client-safe: shared
 * by the editor, the live preview, the PDF, the routes and the tests, so a
 * value the editor offers is one the server accepts, and nothing else is.
 *
 * SafeComm's digital implementation of the supplied reference form. It is not
 * presented as a certified government form.
 *
 * One referral = one receiving organization (a barangay, or a social welfare
 * and development office). Section C belongs to that organization: it is
 * never part of the editable form, and only the acknowledgement route
 * records it, after the referral is issued.
 */
import { z } from 'zod';

export const SERVICE_REFERRAL_FORM_VERSION = 'iacvawc-service-referral-2026-11';
export const SERVICE_REFERRAL_TITLE = 'SERVICE REFERRAL FORM';
export const SERVICE_REFERRAL_DIGITAL_NOTICE =
  'SafeComm digital implementation of the Service Referral Form supplied as reference. Not a certified government form.';

/** The form's instructions, word for word. */
export const SERVICE_REFERRAL_INSTRUCTIONS = [
  'This form must be filled out by the person providing services to the client.',
  'Remind your client that all information will be kept confidential.',
  'Kindly send a copy of this form to the receiving organization, accompanied with the intake form.',
] as const;

// ── Section B: where, and for what ───────────────────────────────────────────

export const DESTINATIONS = {
  BARANGAY: { label: 'Referred to Barangay', short: 'Barangay' },
  SWDO: { label: 'Referred to Social Welfare and Development Office', short: 'Social Welfare and Development Office' },
} as const;
export type Destination = keyof typeof DESTINATIONS;
export const DESTINATION_KEYS = Object.keys(DESTINATIONS) as Destination[];

/** The services on the form, in its order and with its words. */
export const SERVICES = {
  BPO: { destination: 'BARANGAY', label: 'Issuance/enforcement of Barangay Protection Order (BPO)' },
  BARANGAY_OTHER: { destination: 'BARANGAY', label: 'Others, specify', other: true },
  PSYCHOSOCIAL: { destination: 'SWDO', label: 'Psychosocial' },
  SHELTER: { destination: 'SWDO', label: 'Emergency/ Temporary shelter' },
  ECONOMIC: { destination: 'SWDO', label: 'Economic assistance' },
  RESIDENTIAL: { destination: 'SWDO', label: 'Residential facility' },
  SWDO_OTHER: { destination: 'SWDO', label: 'Others, specify', other: true },
} as const satisfies Record<string, { destination: Destination; label: string; other?: boolean }>;
export type ServiceKey = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];
export const servicesFor = (d: Destination): ServiceKey[] => SERVICE_KEYS.filter(k => SERVICES[k].destination === d);
const isOther = (k: ServiceKey) => 'other' in SERVICES[k];

export const CLIENT_SIGNATORY = {
  CLIENT: 'The client',
  GUARDIAN: 'Parent/guardian (client is a child below 18, or as defined by RA 7610)',
} as const;
export type ClientSignatory = keyof typeof CLIENT_SIGNATORY;

// ── The fields ───────────────────────────────────────────────────────────────

/** Every text field, with the form's label. Section A is numbered as on the form. */
export const FIELD_LABELS = {
  clientCode: '1. Client Code',
  incidentNo: '2. Incident No.',
  referringOrganization: '1. Referring Organization',
  actionTaken: '2. Action Taken',
  referredByLast: '3. Referred by - Last Name',
  referredByFirst: '3. Referred by - First Name',
  referredByMiddle: '3. Referred by - Middle Name',
  referredByExt: '3. Referred by - Extension',
  position: '4. Position / Job Title',
  contactNo: '5. Contact No.',
  email: '6. Email Address',
  addressNo: '7. Address - No.',
  addressStreet: '7. Address - Street Name',
  addressBarangay: '7. Address - Barangay',
  addressCity: '7. Address - City/Mun',
  serviceOther: 'Others, specify',
  receivingAgency: 'Agency/Organization',
  receivingAddress: 'Address',
  receivingContactPerson: 'Name of Contact Person',
  receivingContactNo: 'Contact No.',
  receivingEmail: 'Email Address',
} as const;
export type TextKey = keyof typeof FIELD_LABELS;
export const TEXT_KEYS = Object.keys(FIELD_LABELS) as TextKey[];

export type ServiceReferralForm = Record<TextKey, string> & {
  destination: Destination | '';
  services: ServiceKey[];
  /** Who will sign the client's line - the form allows a parent/guardian for a child. */
  clientSignatory: ClientSignatory | '';
};
export type FormKey = keyof ServiceReferralForm;

export const EMPTY_SERVICE_REFERRAL_FORM: ServiceReferralForm = {
  ...(Object.fromEntries(TEXT_KEYS.map(k => [k, ''])) as Record<TextKey, string>),
  destination: '', services: [], clientSignatory: '',
};

const LIMITS: Partial<Record<TextKey, number>> = {
  actionTaken: 600, referringOrganization: 200, receivingAgency: 200, receivingAddress: 300, serviceOther: 200,
};
const PHONE = /^[0-9+()\-\s./]{5,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_KEYS: TextKey[] = ['contactNo', 'receivingContactNo'];
const EMAIL_KEYS: TextKey[] = ['email', 'receivingEmail'];

const text = (k: TextKey) => {
  const max = LIMITS[k] ?? 160;
  let s = z.string().trim().max(max, `${FIELD_LABELS[k]}: keep this under ${max} characters`);
  if (PHONE_KEYS.includes(k)) s = s.refine(v => !v || PHONE.test(v), `${FIELD_LABELS[k]}: digits, spaces and + ( ) - only`) as unknown as typeof s;
  if (EMAIL_KEYS.includes(k)) s = s.refine(v => !v || EMAIL.test(v), `${FIELD_LABELS[k]}: enter a valid email address`) as unknown as typeof s;
  return s.optional().default('');
};

/**
 * What a draft may hold. Lenient - a draft is unfinished - but every value is
 * the right shape. Services that do not belong to the chosen destination are
 * dropped, and "Others, specify" text goes with its tick.
 */
export const serviceReferralFormSchema = z.object({
  ...(Object.fromEntries(TEXT_KEYS.map(k => [k, text(k)])) as { [K in TextKey]: ReturnType<typeof text> }),
  destination: z.enum(DESTINATION_KEYS as [Destination, ...Destination[]]).or(z.literal('')).optional().default(''),
  services: z.array(z.enum(SERVICE_KEYS as [ServiceKey, ...ServiceKey[]])).max(SERVICE_KEYS.length).optional().default([]),
  clientSignatory: z.enum(Object.keys(CLIENT_SIGNATORY) as [ClientSignatory, ...ClientSignatory[]]).or(z.literal('')).optional().default(''),
}).strict().transform(f => normalizeForm(f as ServiceReferralForm));

/** The form made consistent: services of the chosen destination only, each once, in the form's order. */
export function normalizeForm(f: ServiceReferralForm): ServiceReferralForm {
  const d = f.destination;
  const services = d ? SERVICE_KEYS.filter(k => f.services.includes(k) && SERVICES[k].destination === d) : [];
  const other = services.some(isOther);
  return { ...f, services, serviceOther: other ? f.serviceOther : '' };
}

/** The fields whose values differ - keys only, for the history. */
export function changedKeys(a: ServiceReferralForm, b: ServiceReferralForm): FormKey[] {
  return (Object.keys(EMPTY_SERVICE_REFERRAL_FORM) as FormKey[]).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** A stored form (possibly from an older version), read safely. */
export function readForm(raw: unknown): ServiceReferralForm {
  const parsed = serviceReferralFormSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // A stored value that no longer validates is kept where it can be, never invented.
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = { ...EMPTY_SERVICE_REFERRAL_FORM };
  for (const k of TEXT_KEYS) if (typeof o[k] === 'string') f[k] = (o[k] as string).slice(0, LIMITS[k] ?? 160);
  if (o.destination === 'BARANGAY' || o.destination === 'SWDO') f.destination = o.destination;
  if (Array.isArray(o.services)) f.services = o.services.filter((s): s is ServiceKey => SERVICE_KEYS.includes(s as ServiceKey));
  if (o.clientSignatory === 'CLIENT' || o.clientSignatory === 'GUARDIAN') f.clientSignatory = o.clientSignatory;
  return normalizeForm(f);
}

// ── Before issuing ───────────────────────────────────────────────────────────

export interface Problem { key: FormKey; label: string; message: string }

/**
 * What stands between this draft and issuing it. `required` blocks issuing;
 * `recommended` is shown, and the officer decides. Never filled in for them.
 */
export function issueProblems(f: ServiceReferralForm): { required: Problem[]; recommended: Problem[] } {
  const required: Problem[] = [];
  const recommended: Problem[] = [];
  const need = (key: FormKey, label: string, message = 'Required before issuing') => required.push({ key, label, message });
  const want = (key: FormKey, label: string, message = 'Not filled in') => recommended.push({ key, label, message });
  const blank = (k: TextKey) => !f[k].trim();
  if (blank('incidentNo')) need('incidentNo', FIELD_LABELS.incidentNo);
  if (blank('clientCode')) want('clientCode', FIELD_LABELS.clientCode, 'No client code - use the one on the intake form, if it has one');
  for (const k of ['referringOrganization', 'actionTaken', 'referredByLast', 'referredByFirst', 'position', 'contactNo'] as TextKey[]) {
    if (blank(k)) need(k, FIELD_LABELS[k]);
  }
  if (blank('email')) want('email', FIELD_LABELS.email);
  if (blank('addressBarangay') || blank('addressCity')) want('addressBarangay', '7. Address', 'Barangay and City/Mun not both filled in');
  if (!f.destination) need('destination', 'Section B - where the client is referred', 'Choose Barangay or Social Welfare and Development Office');
  else {
    if (!f.services.length) need('services', '8. Referral Service', 'Tick at least one service');
    if (f.services.some(isOther) && blank('serviceOther')) need('serviceOther', 'Others, specify', 'Say which other service');
    if (blank('receivingAgency')) need('receivingAgency', f.destination === 'BARANGAY' ? 'Barangay / Office' : FIELD_LABELS.receivingAgency, 'Name the receiving organization');
    if (blank('receivingAddress')) need('receivingAddress', FIELD_LABELS.receivingAddress, "The receiving organization's address");
    if (blank('receivingContactNo') && blank('receivingEmail')) {
      need('receivingContactNo', 'Receiving organization contact', 'A contact number or email address, to confirm the referral reached them');
    }
    if (blank('receivingContactPerson')) want('receivingContactPerson', FIELD_LABELS.receivingContactPerson);
  }
  if (!f.clientSignatory) want('clientSignatory', 'Signature of client', 'Say whether the client or a parent/guardian will sign');
  return { required, recommended };
}

// ── Issuing, acknowledging, cancelling ───────────────────────────────────────

export const REFERRAL_STATUS = { DRAFT: 'Draft', ISSUED: 'Issued', CANCELLED: 'Cancelled' } as const;
export type ReferralStatus = keyof typeof REFERRAL_STATUS;

/** Section C's state. Received is not the same as the service having been provided. */
export const ACK_STATUS = {
  AWAITING: 'Awaiting acknowledgement',
  ACKNOWLEDGED: 'Received / Acknowledged',
  RETURNED: 'Returned for follow-up',
} as const;
export type AckStatus = keyof typeof ACK_STATUS;

export const ISSUED_VIA = {
  HAND_DELIVERED: 'Hand-delivered (printed copy)',
  EMAIL: 'Sent by email',
  ESCORTED: 'Client escorted to the organization with the form',
  OTHER: 'Other',
} as const;
export type IssuedVia = keyof typeof ISSUED_VIA;

/** What an acknowledgement is recorded on - always something that actually happened. */
export const ACK_BASIS = {
  SIGNED_COPY: 'Signed copy of Section C returned by the receiving organization',
  WRITTEN: 'Written confirmation from the receiving organization (letter, email or message)',
  VERBAL: 'Verbal confirmation from the receiving organization (phone or in person)',
} as const;
export type AckBasis = keyof typeof ACK_BASIS;

export const issueSchema = z.object({
  expectedVersion: z.number().int().positive(),
  issuedVia: z.enum(Object.keys(ISSUED_VIA) as [IssuedVia, ...IssuedVia[]]),
  /** The officer has confirmed who the recipient is - never assumed. */
  recipientVerified: z.literal(true, { error: 'Confirm the receiving organization and its contact details first' }),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker');
const opt = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional().transform(v => v || null);

export const ackSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ACKNOWLEDGED'),
    basis: z.enum(Object.keys(ACK_BASIS) as [AckBasis, ...AckBasis[]]),
    receivedByName: z.string().trim().min(2, 'Enter the printed name of the person who received it').max(160),
    position: opt(160),
    clientCode: opt(80),
    dateReceived: ymd,
    remarks: opt(1000),
  }),
  z.object({
    status: z.literal('RETURNED'),
    basis: z.enum(Object.keys(ACK_BASIS) as [AckBasis, ...AckBasis[]]),
    receivedByName: opt(160),
    position: opt(160),
    clientCode: opt(80),
    dateReceived: ymd.optional(),
    remarks: z.string().trim().min(5, 'Say why it was returned and what follow-up is needed').max(1000),
  }),
]);
export type AckInput = z.infer<typeof ackSchema>;

/** Which acknowledgement may follow which. A recorded receipt is final. */
export function ackTransitionAllowed(from: AckStatus | null, to: 'ACKNOWLEDGED' | 'RETURNED'): boolean {
  if (from === 'AWAITING') return true;
  if (from === 'RETURNED') return to === 'ACKNOWLEDGED' || to === 'RETURNED';
  return false;
}

export const cancelSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the referral is cancelled').max(500),
});

/** A referral may be cancelled while it is a draft, or issued and not yet acknowledged. */
export function cancelAllowed(status: ReferralStatus, ack: AckStatus | null): boolean {
  return status === 'DRAFT' || (status === 'ISSUED' && ack !== 'ACKNOWLEDGED');
}

// ── Suggestions (the officer decides) ────────────────────────────────────────

export interface SafetyFacts {
  immediateConcern?: string | null;
  shelterNeeded?: string | null;
  policeOrReferralNeeded?: string | null;
}
export interface Suggestion { service: ServiceKey | null; text: string }

/**
 * Prompts from what the officer's own safety assessment records - never a
 * selection, never a decision. Rule-based and explained; nothing is sent to an
 * AI model.
 */
export function serviceSuggestions(s: SafetyFacts | null): Suggestion[] {
  if (!s) return [{ service: null, text: 'No safety assessment is recorded on this case yet, so there is nothing to suggest from. Choose the services from what you know.' }];
  const out: Suggestion[] = [];
  if (s.shelterNeeded === 'yes') out.push({ service: 'SHELTER', text: 'The safety assessment records that shelter is needed: consider Emergency/ Temporary shelter (Social Welfare and Development Office).' });
  if (s.immediateConcern === 'yes') out.push({ service: 'BPO', text: 'The safety assessment records an immediate safety concern: consider whether a Barangay Protection Order should be applied for. The Punong Barangay decides on a BPO.' });
  if (s.policeOrReferralNeeded === 'yes') out.push({ service: null, text: 'The safety assessment records that police assistance or another referral is needed. This form covers barangay and social welfare referrals only.' });
  if (!out.length) out.push({ service: null, text: 'Nothing in the safety assessment points to a particular service. Choose the services from what you know.' });
  return out;
}

// ── For lists and the document ───────────────────────────────────────────────

export const referredByName = (f: ServiceReferralForm) =>
  [f.referredByFirst, f.referredByMiddle, f.referredByLast, f.referredByExt].map(s => s.trim()).filter(Boolean).join(' ');

export const serviceLabel = (k: ServiceKey, f?: ServiceReferralForm) =>
  isOther(k) ? `Others: ${f?.serviceOther.trim() || 'not specified'}` : SERVICES[k].label;

/** mm/dd/yyyy, as the form writes dates. */
export const mmddyyyy = (s: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (s ?? '');
};

/** Section C as recorded - what the preview and the record copy of the PDF show. */
export interface SectionC {
  status: AckStatus | null;
  receivedByName: string | null;
  position: string | null;
  clientCode: string | null;
  dateReceived: string | null;
  remarks: string | null;
}
export const EMPTY_SECTION_C: SectionC = { status: null, receivedByName: null, position: null, clientCode: null, dateReceived: null, remarks: null };
