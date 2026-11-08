/**
 * Annex B - Referral Form: the fields, as the form names them, what may be
 * entered, and what a new referral starts with. Pure - shared by the dialog,
 * the routes, the PDF and the tests.
 *
 * Everything is optional, as on the paper form: a blank prints as a line to
 * fill in by hand. Nothing is guessed - the client's sex and age are only
 * what the case records; an official changes anything before saving.
 */
import { z } from 'zod';

export const CLIENT_SEX = ['Female', 'Male', 'Intersex'] as const;

/** The form's own labels, in its order. */
export const REFERRAL_FORM_LABELS = {
  toAddress: 'Address', toContactPerson: 'Contact Person',
  clientName: 'Name of Client', clientAge: 'Age', clientSex: 'Sex', clientAddress: 'Address',
  guardianName: 'Name of Family/Guardian', guardianContact: 'Contact No.', guardianAddress: 'Address',
  servicesRequested: 'Specific Service/s Requested',
  feedbackTo: 'Feedback requested and send to Referring Party/Agency', feedbackAddress: 'Address',
  feedbackCellPhone: 'Cell Phone No.', feedbackLandline: 'Landline No.', feedbackEmail: 'Email address', feedbackFax: 'Fax No.',
  feedbackContact: 'Contact Person', referredByName: 'Referred by - printed name', referredByDesignation: 'Designation',
} as const;
export type ReferralFormKey = keyof typeof REFERRAL_FORM_LABELS;

const opt = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional().transform(v => v || null);
/** A phone, landline or fax number: digits and the usual separators only. */
const phone = z.string().trim().max(40).optional().transform(v => v || null)
  .refine(v => v === null || /^[0-9+()\-\s./]{5,40}$/.test(v), 'A phone or fax number may use digits, spaces, + ( ) - only');

export const referralFormSchema = z.object({
  toAddress: opt(300),
  toContactPerson: opt(160),
  clientName: opt(160),
  clientAge: z.union([z.number(), z.string()]).optional().nullable()
    .transform(v => (v === undefined || v === null || v === '' ? null : Number(v)))
    .refine(v => v === null || (Number.isInteger(v) && v >= 0 && v <= 120), 'Age must be a whole number from 0 to 120'),
  clientSex: z.enum(CLIENT_SEX).optional().nullable().or(z.literal('')).transform(v => v || null),
  clientAddress: opt(300),
  guardianName: opt(160),
  guardianContact: phone,
  guardianAddress: opt(300),
  servicesRequested: opt(1000),
  feedbackTo: opt(200),
  feedbackAddress: opt(300),
  feedbackCellPhone: phone,
  feedbackLandline: phone,
  feedbackEmail: z.string().trim().max(160).optional().transform(v => v || null)
    .refine(v => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  feedbackFax: phone,
  feedbackContact: opt(160),
  referredByName: opt(160),
  referredByDesignation: opt(160),
});
export type ReferralForm = z.infer<typeof referralFormSchema>;
export type ReferralFormInput = z.input<typeof referralFormSchema>;

export const EMPTY_REFERRAL_FORM: Record<ReferralFormKey, string> = Object.fromEntries(
  (Object.keys(REFERRAL_FORM_LABELS) as ReferralFormKey[]).map(k => [k, ''])) as Record<ReferralFormKey, string>;

/** The form's values as stored on a referral row (for the dialog and the PDF). */
export function formOf(r: Partial<Record<ReferralFormKey, string | number | null>>): Record<ReferralFormKey, string> {
  return Object.fromEntries((Object.keys(REFERRAL_FORM_LABELS) as ReferralFormKey[])
    .map(k => [k, r[k] === null || r[k] === undefined ? '' : String(r[k])])) as Record<ReferralFormKey, string>;
}
