/**
 * The records a case carries beside its narrative: the two report forms, the
 * people in a report, the officer's safety assessment and referrals.
 *
 * Shared by the forms (browser) and the routes (server), so a value the form
 * offers is one the server accepts, and nothing else is. No database access
 * here.
 */
import { z } from 'zod';
import { BLOTTER_CATEGORIES, VAWC_CATEGORIES } from './classificationSchema';
import { VAWC_TYPES } from './vawcTypes';

const isVawcType = (caseType: string) => (VAWC_TYPES as readonly string[]).includes(caseType);

// ── The two report forms ─────────────────────────────────────────────────────

export const REPORT_PATHS = ['BLOTTER', 'VAWC'] as const;
export type ReportPath = (typeof REPORT_PATHS)[number];

export const REPORT_PATH_LABEL: Record<ReportPath, { title: string; hint: string }> = {
  BLOTTER: {
    title: 'Barangay Blotter Incident Report',
    hint: 'Disputes, threats, theft, noise, damage, and other incidents in the community.',
  },
  VAWC: {
    title: 'VAWC Incident Report (confidential)',
    hint: 'Violence or abuse against a woman or a child - including by a partner, ex-partner or family member.',
  },
};

/**
 * Categories a reporter may pick as a first reading. The pick is context: the
 * case is filed under what the report describes, and a pick that disagrees is
 * recorded for the officer. "Other" is left out - not knowing is no pick.
 */
export const INITIAL_CATEGORIES: Record<ReportPath, string[]> = {
  BLOTTER: BLOTTER_CATEGORIES.map(c => c.category).filter(c => c !== 'Other'),
  VAWC: VAWC_CATEGORIES.map(c => c.category).filter(c => c !== 'VAWC - Other'),
};

export const REPORTING_CHANNELS = {
  ONLINE: 'Online (SafeComm)',
  WALK_IN: 'Walk-in at the barangay hall',
  PHONE: 'Phone call',
  REFERRAL: 'Referred by another office',
  OTHER: 'Other',
} as const;
export type ReportingChannel = keyof typeof REPORTING_CHANNELS;

/** The number every case already has, called what each desk calls it. */
export function caseNumberLabel(caseType: string): string {
  return isVawcType(caseType) ? 'VAWC Reference No.' : 'Blotter Entry No.';
}

/** The desk a case type belongs to, as the forms name it. */
export function pathOfType(caseType: string): ReportPath {
  return isVawcType(caseType) ? 'VAWC' : 'BLOTTER';
}

// ── The people in a report ───────────────────────────────────────────────────

export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
export type YesNoUnknownAnswer = (typeof YES_NO_UNKNOWN)[number];
export const ANSWER_LABEL: Record<YesNoUnknownAnswer, string> = { yes: 'Yes', no: 'No', unknown: 'Not known' };

const text = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined);
const age = z.union([z.number(), z.string()]).optional()
  .transform(v => (v === undefined || v === '' ? undefined : Number(v)))
  .refine(v => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 120), 'Age must be a whole number from 0 to 120');

/** The person affected, as far as the reporter knows. Every field optional. */
export const affectedPartySchema = z.object({
  fullName: text(120),
  age,
  address: text(200),
  contactNumber: text(40),
  relationship: text(120),
  dependentsAffected: z.enum(YES_NO_UNKNOWN).optional(),
  details: text(500),
});

/** The person reported, as far as the reporter knows. Every field optional. */
export const reportedPartySchema = z.object({
  fullName: text(120),
  age,
  address: text(200),
  relationship: text(120),
  details: text(500),
});

export type AffectedParty = z.infer<typeof affectedPartySchema>;
export type ReportedParty = z.infer<typeof reportedPartySchema>;

/** True when the reporter said anything at all about this person. */
export function hasPartyDetails(p: Record<string, unknown> | undefined | null): boolean {
  return Boolean(p && Object.values(p).some(v => v !== undefined && v !== null && v !== ''));
}

/** When it happened, if known: a day not in the future, and not decades back. */
export const incidentDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
  .refine(d => {
    const t = Date.parse(`${d}T00:00:00+08:00`);
    return Number.isFinite(t) && t <= Date.now() && t >= Date.parse('1990-01-01T00:00:00+08:00');
  }, 'The date cannot be in the future')
  .optional();

// ── The officer's safety assessment ──────────────────────────────────────────

export const SAFETY_QUESTIONS = [
  { key: 'immediateConcern', label: 'Is there an immediate safety concern?' },
  { key: 'dependentsAffected', label: 'Are children or dependents potentially affected?' },
  { key: 'urgentAssistance', label: 'Is immediate assistance requested or required?' },
  { key: 'medicalNeeded', label: 'Is medical assistance needed?' },
  { key: 'shelterNeeded', label: 'Is safe accommodation needed?' },
  { key: 'policeOrReferralNeeded', label: 'Is police assistance or another referral needed?' },
] as const;
export type SafetyKey = (typeof SAFETY_QUESTIONS)[number]['key'];

const answer = z.enum(YES_NO_UNKNOWN);
export const safetyAssessmentSchema = z.object({
  immediateConcern: answer,
  dependentsAffected: answer,
  urgentAssistance: answer,
  medicalNeeded: answer,
  shelterNeeded: answer,
  policeOrReferralNeeded: answer,
  additionalConcerns: text(1000),
  initialAction: text(1000),
  assistanceProvided: text(1000),
  protectionActions: text(1000),
  /** Optional, unlike the six above: "not recorded" is allowed here. */
  safeContactConfirmed: answer.optional(),
  preferredAssistance: text(500),
  followUpRequirements: text(1000),
  safetyPlan: text(2000),
  followUpAt: z.string().datetime({ offset: true }).optional().or(z.literal('').transform(() => undefined)),
  /** The version the officer started from - a save over someone else's is refused. */
  expectedVersion: z.number().int().min(0),
});
export type SafetyAssessmentInput = z.infer<typeof safetyAssessmentSchema>;

/** Answers that start the urgent-response workflow on their own, whatever the risk level. */
export function safetyIsUrgent(a: Pick<SafetyAssessmentInput, 'immediateConcern' | 'urgentAssistance'>): boolean {
  return a.immediateConcern === 'yes' || a.urgentAssistance === 'yes';
}

// ── Referrals ────────────────────────────────────────────────────────────────

/**
 * Where a case may be referred. The Lupon - Katarungang Pambarangay mediation
 * and conciliation - is for blotter cases only: VAWC cases are not subject to
 * barangay conciliation, and the server refuses that referral on one.
 */
export const REFERRAL_AGENCIES = {
  PNP_WCPD: { label: 'PNP Women and Children Protection Desk', desks: ['VAWC', 'BLOTTER'] },
  PNP: { label: 'PNP police station', desks: ['BLOTTER', 'VAWC'] },
  SOCIAL_WELFARE: { label: 'Social welfare office (MSWDO / CSWDO / DSWD)', desks: ['VAWC', 'BLOTTER'] },
  HEALTH: { label: 'Health center or hospital', desks: ['VAWC', 'BLOTTER'] },
  LEGAL_AID: { label: 'Legal aid (PAO or other)', desks: ['VAWC', 'BLOTTER'] },
  SHELTER: { label: 'Shelter or safe accommodation', desks: ['VAWC'] },
  LUPON: { label: 'Lupon Tagapamayapa (Katarungang Pambarangay)', desks: ['BLOTTER'] },
  OTHER: { label: 'Other office', desks: ['VAWC', 'BLOTTER'] },
} as const satisfies Record<string, { label: string; desks: readonly ReportPath[] }>;
export type ReferralAgency = keyof typeof REFERRAL_AGENCIES;

export function referralAgenciesFor(path: ReportPath): ReferralAgency[] {
  return (Object.keys(REFERRAL_AGENCIES) as ReferralAgency[])
    .filter(k => (REFERRAL_AGENCIES[k].desks as readonly string[]).includes(path));
}

export const REFERRAL_STATUSES = {
  REFERRED: 'Referred',
  ACKNOWLEDGED: 'Received by the office',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
} as const;
export type ReferralStatus = keyof typeof REFERRAL_STATUSES;

export const referralSchema = z.object({
  agency: z.enum(Object.keys(REFERRAL_AGENCIES) as [ReferralAgency, ...ReferralAgency[]]),
  agencyOther: text(160),
  referredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker'),
  reason: text(500),
  status: z.enum(Object.keys(REFERRAL_STATUSES) as [ReferralStatus, ...ReferralStatus[]]).default('REFERRED'),
  notes: text(1000),
}).refine(r => r.agency !== 'OTHER' || Boolean(r.agencyOther), { message: 'Name the office', path: ['agencyOther'] });

export const referralUpdateSchema = z.object({
  status: z.enum(Object.keys(REFERRAL_STATUSES) as [ReferralStatus, ...ReferralStatus[]]),
  notes: text(1000),
});

/** Why a referral is refused for this case, or null. */
export function referralRefusal(agency: ReferralAgency, caseType: string): string | null {
  const path = pathOfType(caseType);
  if ((REFERRAL_AGENCIES[agency].desks as readonly string[]).includes(path)) return null;
  return agency === 'LUPON'
    ? 'VAWC cases are not referred to the Lupon for mediation or conciliation. Refer to the PNP Women and Children Protection Desk, social welfare or health services instead.'
    : 'That referral is not available for this case.';
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * How a case was resolved or closed. The two desks differ: a blotter dispute
 * can end in an amicable settlement at the barangay; a VAWC case cannot - it
 * is never mediated - so it has no such option, and the server refuses one.
 */
export const RESOLUTION_TYPES = {
  SETTLED: { label: 'Amicable settlement at the barangay', desks: ['BLOTTER'] },
  CERTIFICATE_TO_FILE: { label: 'Not settled - certification to file action issued', desks: ['BLOTTER'] },
  ACTION_COMPLETED: { label: 'Resolved by barangay action', desks: ['BLOTTER', 'VAWC'] },
  SERVICES_PROVIDED: { label: 'Assistance and interventions completed', desks: ['VAWC'] },
  REFERRED: { label: 'Referred to another office, which now handles it', desks: ['BLOTTER', 'VAWC'] },
  WITHDRAWN: { label: 'Withdrawn by the complainant / reporter', desks: ['BLOTTER', 'VAWC'] },
  OTHER: { label: 'Other - see the summary', desks: ['BLOTTER', 'VAWC'] },
} as const satisfies Record<string, { label: string; desks: readonly ReportPath[] }>;
export type ResolutionType = keyof typeof RESOLUTION_TYPES;

export function resolutionTypesFor(path: ReportPath): ResolutionType[] {
  return (Object.keys(RESOLUTION_TYPES) as ResolutionType[])
    .filter(k => (RESOLUTION_TYPES[k].desks as readonly string[]).includes(path));
}

export const resolutionSchema = z.object({
  type: z.enum(Object.keys(RESOLUTION_TYPES) as [ResolutionType, ...ResolutionType[]]),
  summary: z.string().trim().min(5, 'Say briefly how it was resolved').max(2000),
});

/** Why this resolution cannot be recorded on this case, or null. */
export function resolutionRefusal(type: ResolutionType, caseType: string): string | null {
  if ((RESOLUTION_TYPES[type].desks as readonly string[]).includes(pathOfType(caseType))) return null;
  return type === 'SETTLED' || type === 'CERTIFICATE_TO_FILE'
    ? 'VAWC cases are not settled through barangay mediation or conciliation. Choose another outcome.'
    : 'That outcome is not available for this case.';
}
