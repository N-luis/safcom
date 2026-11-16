/**
 * VAWC Case Proceedings - the BPO and referral records of a VAWC case, beside
 * its Hearings (lib/vawcAppointments.ts, where an external court date is kept).
 *
 * What SafeComm is here: a case-management and documentation record for the
 * barangay VAWC desk - not a court and not a decision-maker.
 *   - A Barangay Protection Order (RA 9262 sec. 14) is applied for, decided
 *     ex parte by the Punong Barangay (or a Kagawad when the Punong Barangay
 *     is unavailable) and served on the respondent. SafeComm records each of
 *     those three steps separately; it holds no hearing for it.
 *   - A TPO or PPO is a court's (secs. 15-16). SafeComm only records a court
 *     date that has been officially provided, who follows it up, and the
 *     outcome when known - as a Hearing of type EXTERNAL_COURT_HEARING. No
 *     official can create or conduct a court hearing here.
 *   - Referrals to the PNP, the social welfare office, health and legal
 *     services (sec. 30) are tracked with their status and follow-up date.
 * There is no mediation, conciliation or joint session anywhere (sec. 33),
 * and the respondent is never notified of anything.
 *
 * Pure rules and labels, shared by the routes, the screens and the tests.
 */
import { phDay } from './hearings';

export type ProceedingKind = 'bpo' | 'referral';
export const PROCEEDING_KINDS = ['bpo', 'referral'] as const;
export const KIND_LABEL: Record<ProceedingKind, string> = {
  bpo: 'Barangay Protection Order', referral: 'Referral',
};

const DAY = 86_400_000;
/** "YYYY-MM-DD" plus n days. */
export const addDaysTo = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// ── Barangay Protection Order (RA 9262 sec. 14) ──────────────────────────────

/** Who may apply (RA 9262 sec. 9). */
export const BPO_APPLICANTS = {
  VICTIM_SURVIVOR: 'The victim-survivor',
  PARENT_GUARDIAN: 'Parent or guardian',
  RELATIVE: 'Relative (ascendant, descendant or collateral within the 4th degree)',
  SOCIAL_WORKER: 'Social worker (DSWD or local social welfare office)',
  POLICE: 'Police officer (preferably of the Women and Children Protection Desk)',
  BARANGAY_OFFICIAL: 'Punong Barangay or Barangay Kagawad',
  PROFESSIONAL: 'Lawyer, counselor, therapist or health care provider',
  CONCERNED_CITIZENS: 'At least two concerned citizens of the city or municipality',
} as const;
export type BpoApplicant = keyof typeof BPO_APPLICANTS;
export const BPO_APPLICANT_KEYS = Object.keys(BPO_APPLICANTS) as [BpoApplicant, ...BpoApplicant[]];

/** Who decided it: the Punong Barangay, or a Kagawad when the Punong Barangay was unavailable. */
export const BPO_ACTING = { PUNONG_BARANGAY: 'Punong Barangay', KAGAWAD: 'Barangay Kagawad' } as const;
export type BpoActing = keyof typeof BPO_ACTING;
export const BPO_ACTING_KEYS = Object.keys(BPO_ACTING) as [BpoActing, ...BpoActing[]];

export const BPO_SERVICE_METHODS = {
  PERSONAL: 'Personal service on the respondent',
  REFUSED: 'Respondent refused to receive (tendered personally)',
  OTHER: 'Other (described in the notes)',
} as const;
export type BpoServiceMethod = keyof typeof BPO_SERVICE_METHODS;
export const BPO_SERVICE_KEYS = Object.keys(BPO_SERVICE_METHODS) as [BpoServiceMethod, ...BpoServiceMethod[]];

export const BPO_STATUSES = {
  APPLIED: 'Applied - awaiting decision', ISSUED: 'Issued - not yet served', SERVED: 'Issued and served',
  DENIED: 'Not issued', CANCELLED: 'Recorded in error',
} as const;
export type BpoStatus = keyof typeof BPO_STATUSES;

/** "BPOs shall be effective for fifteen (15) days" - RA 9262 sec. 14. */
export const BPO_EFFECTIVE_DAYS = 15;
/** Days before the last effective day that the desk is reminded. */
export const BPO_ENDING_NOTICE_DAYS = 3;
export const BPO_PERIOD_NOTE = 'RA 9262 sec. 14: a BPO is effective for 15 days. Counted here from the day it was issued, that day being day 1 - '
  + 'the earliest reading. Confirm the period with the issuing office; if protection must continue, a TPO or PPO is applied for in court.';

/** The last day a BPO is in effect (Philippine day), counted from its issuance. */
export const bpoLastDay = (issuedAt: Date | string) => addDaysTo(phDay(issuedAt), BPO_EFFECTIVE_DAYS - 1);

/** Whether a BPO issued then is still in effect today. */
export const bpoInEffect = (issuedAt: Date | string | null, now = new Date()) => Boolean(issuedAt) && phDay(now) <= bpoLastDay(issuedAt!);

/** What each step may be recorded from. Each step is recorded once; a mistake is corrected, with a reason, not overwritten. */
export const BPO_ALLOWED_FROM: Record<string, BpoStatus[]> = {
  decide: ['APPLIED'],
  serve: ['ISSUED'],
  correct: ['APPLIED', 'ISSUED', 'SERVED', 'DENIED'],
  cancel: ['APPLIED', 'ISSUED', 'SERVED', 'DENIED'],
};
export const bpoAllowed = (action: string, status: string) => (BPO_ALLOWED_FROM[action] ?? []).includes(status as BpoStatus);

/** Why this decision cannot be recorded as given, or null. */
export function bpoDecisionRefusal(d: { decision: string; acting: string; pbUnavailable: boolean; decidedAt: Date; appliedAt: Date }, now = new Date()): string | null {
  if (d.decidedAt.getTime() > now.getTime() + 5 * 60_000) return 'The decision date and time cannot be in the future.';
  if (d.decidedAt.getTime() < d.appliedAt.getTime()) return 'The decision cannot be before the application was filed.';
  if (d.acting === 'KAGAWAD' && !d.pbUnavailable) {
    return 'A BPO decided by a Barangay Kagawad needs the attestation that the Punong Barangay was unavailable (RA 9262 sec. 14).';
  }
  return null;
}

/** Why this service cannot be recorded as given, or null. */
export function bpoServiceRefusal(servedAt: Date, issuedAt: Date | null, now = new Date()): string | null {
  if (!issuedAt) return 'A BPO is served only after it is issued.';
  if (servedAt.getTime() > now.getTime() + 5 * 60_000) return 'The service date and time cannot be in the future.';
  if (servedAt.getTime() < issuedAt.getTime()) return 'Service cannot be before the BPO was issued.';
  return null;
}

// External court hearings are a type of VAWC Hearing (lib/vawcAppointments.ts
// EXTERNAL_COURT_HEARING), kept in VawcAppointment with the other dates.
export { NOT_A_COURT } from './vawcAppointments';

// ── Referrals ────────────────────────────────────────────────────────────────

export const REFERRAL_AGENCIES = {
  PNP_WCPD: 'PNP Women and Children Protection Desk',
  SWDO: 'City/Municipal Social Welfare and Development Office',
  HEALTH: 'Health services (health center, hospital, WCPU)',
  LEGAL: 'Legal assistance (PAO, IBP, prosecutor)',
  SHELTER: 'Shelter or temporary refuge',
  OTHER: 'Other service provider',
} as const;
export type ReferralAgency = keyof typeof REFERRAL_AGENCIES;
export const REFERRAL_AGENCY_KEYS = Object.keys(REFERRAL_AGENCIES) as [ReferralAgency, ...ReferralAgency[]];

export const VAWC_REFERRAL_STATUSES = {
  REFERRED: 'Referred', ACKNOWLEDGED: 'Acknowledged by the agency', IN_PROGRESS: 'Service in progress',
  COMPLETED: 'Completed', DECLINED_BY_CLIENT: 'Declined by the client', NO_RESPONSE: 'No response yet from the agency',
} as const;
export type VawcReferralStatus = keyof typeof VAWC_REFERRAL_STATUSES;
export const VAWC_REFERRAL_STATUS_KEYS = Object.keys(VAWC_REFERRAL_STATUSES) as [VawcReferralStatus, ...VawcReferralStatus[]];
export const referralOpen = (s: string) => !['COMPLETED', 'DECLINED_BY_CLIENT'].includes(s);

// ── Dates, deadlines and the calendar ────────────────────────────────────────

/** The calendar's kinds of entry - each with its own label, so an interview, a BPO step and a court date are never confused. */
export const ACTIVITY_KINDS = {
  BPO_DECIDE: { label: 'BPO - decide today', color: '#b91c1c' },
  BPO_SERVE: { label: 'BPO - serve on respondent', color: '#c2410c' },
  BPO_ENDS: { label: 'BPO - last effective day', color: '#a16207' },
  REFERRAL_FOLLOW_UP: { label: 'Referral follow-up', color: '#0f766e' },
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;

export interface ActivityItem {
  kind: ActivityKind; day: string; at: string | null; caseId: string; caseNumber: string; recordKind: ProceedingKind; recordId: string;
  reference: string; title: string; overdue: boolean;
}

type CaseRef = { id: string; caseNumber: string };
export interface BpoLike { id: string; reference: string; status: string; appliedAt: Date | string; decidedAt: Date | string | null; case: CaseRef }
export interface ReferralLike { id: string; reference: string; status: string; followUpAt: Date | string | null; agencyType: string; agencyName: string; case: CaseRef }

/**
 * The dated things the desk has to act on or attend, from the records: a BPO
 * to decide (the day it was filed), to serve (the day it was issued), and
 * its last effective day; each open referral's follow-up. (Court dates are
 * Hearings, on the calendar as such.)
 */
export function activityItems(d: { bpos: BpoLike[]; referrals: ReferralLike[] }, now = new Date()): ActivityItem[] {
  const today = phDay(now);
  const out: ActivityItem[] = [];
  const base = (c: CaseRef) => ({ caseId: c.id, caseNumber: c.caseNumber });
  for (const b of d.bpos) {
    if (b.status === 'APPLIED') {
      const day = phDay(b.appliedAt);
      out.push({ kind: 'BPO_DECIDE', day, at: null, ...base(b.case), recordKind: 'bpo', recordId: b.id, reference: b.reference,
        title: 'Act on the BPO application (sec. 14: on the date of filing)', overdue: day < today });
    }
    if (b.status === 'ISSUED' && b.decidedAt) {
      const day = phDay(b.decidedAt);
      out.push({ kind: 'BPO_SERVE', day, at: null, ...base(b.case), recordKind: 'bpo', recordId: b.id, reference: b.reference,
        title: 'Serve the BPO on the respondent (immediately after issuance)', overdue: day < today });
    }
    if ((b.status === 'ISSUED' || b.status === 'SERVED') && b.decidedAt) {
      out.push({ kind: 'BPO_ENDS', day: bpoLastDay(b.decidedAt), at: null, ...base(b.case), recordKind: 'bpo', recordId: b.id, reference: b.reference,
        title: 'Last effective day of the BPO', overdue: false });
    }
  }
  for (const r of d.referrals) {
    if (!r.followUpAt || !referralOpen(r.status)) continue;
    const day = phDay(r.followUpAt);
    out.push({ kind: 'REFERRAL_FOLLOW_UP', day, at: null, ...base(r.case), recordKind: 'referral', recordId: r.id, reference: r.reference,
      title: `Follow up the referral - ${r.agencyName}`, overdue: day < today });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? '').localeCompare(b.at ?? ''));
}

/**
 * Which items the desk is reminded of now, each once (by its key): anything
 * overdue or due today, and a BPO's last effective day within
 * BPO_ENDING_NOTICE_DAYS. (Hearings, court dates included, are reminded the
 * day before and on the day - lib/vawcProceedingsServer runVawcReminders.)
 */
export function remindersDue(items: ActivityItem[], now = new Date()): (ActivityItem & { key: string })[] {
  const today = phDay(now);
  const soon = addDaysTo(today, BPO_ENDING_NOTICE_DAYS);
  return items.filter(i => {
    if (i.kind === 'BPO_ENDS') return i.day >= today && i.day <= soon;
    return i.day <= today;
  }).map(i => ({ ...i, key: `${i.kind}:${i.recordId}:${i.day}` }));
}

// ── History ──────────────────────────────────────────────────────────────────

export const PROCEEDING_EVENT_LABELS: Record<string, string> = {
  bpo_applied: 'BPO application recorded',
  bpo_issued: 'BPO issued (ex parte)',
  bpo_denied: 'BPO not issued',
  bpo_served: 'BPO service recorded',
  referral_recorded: 'Referral recorded',
  referral_updated: 'Referral status updated',
  corrected: 'Record corrected',
  cancelled: 'Marked as recorded in error',
  reminder_sent: 'Reminder sent to the officials',
};

/** Words for a staff notification - the case number and the kind of step, never a note, a name or an assessment. */
export const reminderMessage = (i: ActivityItem) => `${ACTIVITY_KINDS[i.kind].label}: ${i.reference} on case ${i.caseNumber}, ${i.day}${i.overdue ? ' (overdue)' : ''}.`;
