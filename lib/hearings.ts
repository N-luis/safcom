/**
 * Hearing Management: Katarungang Pambarangay hearings 1 to 3 on a blotter
 * dispute - what each status, outcome and notice state means, who may have a
 * hearing at all, and what the complainant is allowed to read.
 *
 * Shared by the pages (browser) and the routes (server); no database access.
 *
 * Three rules hold everywhere:
 *   - a VAWC case under RA 9262 never gets an ordinary hearing - it stays in
 *     the VAWC desk's own workflow (intervention, referral, follow-up);
 *   - a hearing is scheduled by an official, one at a time, and only when the
 *     one before it calls for another - nothing is created in advance;
 *   - status (where the hearing stands), outcome (what came of it) and the
 *     case's own status are three different things.
 */
import { VAWC_TYPES } from './vawcTypes';

const isVawc = (caseType: string) => (VAWC_TYPES as readonly string[]).includes(caseType);

export const MAX_HEARINGS = 3;

export const HEARING_TITLES: Record<number, string> = {
  1: 'Initial Hearing',
  2: 'Follow-up Hearing',
  3: 'Further Proceeding',
};

// ── Status ───────────────────────────────────────────────────────────────────

export const HEARING_STATUSES = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  NOTICE_ISSUED: 'Notice issued',
  ACKNOWLEDGED: 'Acknowledged',
  RESCHEDULED: 'Rescheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;
export type HearingStatus = keyof typeof HEARING_STATUSES;

/** Not yet held or cancelled. A draft is open but known only to officials. */
export const OPEN_STATUSES: HearingStatus[] = ['DRAFT', 'SCHEDULED', 'NOTICE_ISSUED', 'ACKNOWLEDGED', 'RESCHEDULED'];
/** Set for a date the parties have been told about. */
export const LIVE_STATUSES: HearingStatus[] = ['SCHEDULED', 'NOTICE_ISSUED', 'ACKNOWLEDGED', 'RESCHEDULED'];

export const isOpen = (s: string) => (OPEN_STATUSES as string[]).includes(s);
export const isLive = (s: string) => (LIVE_STATUSES as string[]).includes(s);

// ── Attendance: the official record, kept apart from status ──────────────────

export const ATTENDANCE = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  EXCUSED: 'Excused',
  NOT_RECORDED: 'Not recorded',
} as const;
export type Attendance = keyof typeof ATTENDANCE;

// ── Outcome: what came of a held hearing ─────────────────────────────────────

export const HEARING_OUTCOMES = {
  SETTLED: { label: 'Settled - amicable settlement', ends: true, resident: 'Settled - the parties reached an amicable settlement.' },
  CONTINUED: { label: 'Continued - not yet settled', ends: false, resident: 'Not yet settled - the proceedings continue.' },
  NOT_SETTLED: { label: 'Not settled at this hearing', ends: false, resident: 'Not settled at this hearing.' },
  RESPONDENT_ABSENT: { label: 'Respondent did not appear', ends: false, resident: 'The other party did not appear.' },
  COMPLAINANT_ABSENT: { label: 'Complainant did not appear', ends: false, resident: 'The complainant did not appear.' },
  REFERRED: { label: 'Referred to another office or agency', ends: true, resident: 'The matter was referred to another office or agency.' },
  CERTIFICATE_TO_FILE: { label: 'Certification to file action issued', ends: true, resident: 'A certification to file action was issued.' },
  WITHDRAWN: { label: 'Complaint withdrawn', ends: true, resident: 'The complaint was withdrawn.' },
  OTHER_DISPOSITION: { label: 'Otherwise disposed of', ends: true, resident: 'The matter was disposed of by the barangay.' },
} as const;
export type HearingOutcome = keyof typeof HEARING_OUTCOMES;
export const HEARING_OUTCOME_KEYS = Object.keys(HEARING_OUTCOMES) as [HearingOutcome, ...HearingOutcome[]];
export const outcomeLabel = (o: string | null | undefined) => (o && o in HEARING_OUTCOMES ? HEARING_OUTCOMES[o as HearingOutcome].label : null);

// ── Notices ──────────────────────────────────────────────────────────────────

export const NOTICE_STATUSES = {
  GENERATED: 'Generated - not yet issued',
  ISSUED: 'Issued',
  DELIVERED: 'Delivered',
  UNDELIVERED: 'Not delivered',
  ACKNOWLEDGED: 'Acknowledged',
  SUPERSEDED: 'Replaced - date changed',
} as const;
export type NoticeStatus = keyof typeof NOTICE_STATUSES;
/** Given out and still for the current date. A generated notice has not been given to anyone. */
export const LIVE_NOTICE: NoticeStatus[] = ['ISSUED', 'DELIVERED', 'UNDELIVERED', 'ACKNOWLEDGED'];

export const NOTICE_RECIPIENTS = { COMPLAINANT: 'Complainant', RESPONDENT: 'Respondent' } as const;
export type NoticeRecipient = keyof typeof NOTICE_RECIPIENTS;

export const NOTICE_METHODS = {
  IN_PERSON: 'Handed over in person at the barangay hall',
  SERVED: "Served at the party's address by barangay personnel",
  SAFECOMM: 'Made available in SafeComm (complainant only)',
  OTHER: 'Other',
} as const;
export type NoticeMethod = keyof typeof NOTICE_METHODS;

export const hearingReference = (caseNumber: string, n: number, attempt = 1) =>
  `HRG-${caseNumber}-H${n}${attempt > 1 ? `-${attempt}` : ''}`;
export const noticeNumber = (caseNumber: string, n: number, recipient: NoticeRecipient, seq: number) =>
  `HN-${caseNumber}-H${n}-${recipient === 'COMPLAINANT' ? 'C' : 'R'}${seq}`;

/**
 * Where a live hearing stands once its notices are counted: issued when a
 * notice for the current date is out, acknowledged once every one that is
 * out has been acknowledged. Generating a notice alone changes nothing.
 */
export function statusFromNotices(h: { status: string; rescheduleCount: number }, notices: { status: string }[]): HearingStatus {
  if (!isLive(h.status)) return h.status as HearingStatus;
  const out = notices.filter(n => (LIVE_NOTICE as string[]).includes(n.status));
  if (!out.length) return h.rescheduleCount > 0 ? 'RESCHEDULED' : 'SCHEDULED';
  return out.every(n => n.status === 'ACKNOWLEDGED') ? 'ACKNOWLEDGED' : 'NOTICE_ISSUED';
}

// ── Dates: the barangay's day ────────────────────────────────────────────────

const PH_OFFSET_MS = 8 * 3_600_000;
/** YYYY-MM-DD in Philippine time. */
export const phDay = (d: Date | string) => new Date(new Date(d).getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
/** HH:MM in Philippine time. */
export const phTime = (d: Date | string) => new Date(new Date(d).getTime() + PH_OFFSET_MS).toISOString().slice(11, 16);
/** A Philippine date and time as one instant, or null when either is malformed. */
export function phInstant(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(d.getTime()) || phDay(d) !== date ? null : d;
}
export const formatHearingDate = (d: Date | string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
export const formatHearingTime = (d: Date | string) => new Date(d).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
export const formatHearingWhen = (d: Date | string) => `${formatHearingDate(d)}, ${formatHearingTime(d)}`;

/** A hearing is never set for a day that has already gone. */
export const isPastDay = (d: Date, now = new Date()) => phDay(d) < phDay(now);
/** A hearing can be recorded as held from its own day on. */
export const hasDayArrived = (d: Date | string, now = new Date()) => phDay(d) <= phDay(now);

// ── Eligibility for Katarungang Pambarangay proceedings ──────────────────────

/**
 * What the reviewing official confirms. Each must hold for the dispute to go
 * to barangay mediation or conciliation (Local Government Code, secs. 408 and
 * 412). SafeComm records the official's review; it does not decide the law.
 */
export const KP_CHECKLIST = [
  { key: 'not_vawc', label: 'The dispute does not involve violence against women or their children (RA 9262). Those cases stay with the VAWC desk.' },
  { key: 'individuals', label: 'The parties are individuals - not the government, a government office, or a corporation or other juridical entity.' },
  { key: 'not_official_duty', label: 'No party is a public officer or employee and the dispute does not relate to the performance of official functions.' },
  { key: 'offence_limit', label: 'Any offence involved is punishable by not more than one year of imprisonment or a fine of not more than PHP 5,000.' },
  { key: 'private_party', label: 'There is a private offended party (the complaint is not one with no private complainant).' },
  { key: 'residence', label: 'The parties actually reside in the same city or municipality (or in adjoining barangays and they agree to conciliation), and any real property involved is there too.' },
  { key: 'no_urgent_court', label: 'No urgent court action is needed - no one is under detention, and no habeas corpus, provisional remedy or prescription deadline makes conciliation impossible.' },
] as const;
export type KpCheckKey = (typeof KP_CHECKLIST)[number]['key'];
export const KP_KEYS = KP_CHECKLIST.map(c => c.key) as [KpCheckKey, ...KpCheckKey[]];

export const CLOSED_CASE_STATUSES = ['Resolved', 'Closed'];

export interface EligibilityInput {
  caseType: string;
  status: string;
  /** The latest officer decision on the category (confirmed, changed, or entered at a walk-in). */
  verifiedCategory: { caseType: string | null; at: Date | string } | null;
  /** The latest eligibility review. */
  review: { decision: string; caseType: string; at: Date | string; note?: string | null; by?: string | null } | null;
  reportPath?: string | null;
  /** The category the AI read from the report, when it differed. */
  aiSuggestedCategory?: string | null;
}

export interface Eligibility {
  eligible: boolean;
  /** Why not - shown in place of the Create Hearing button. */
  reasons: string[];
  /** Worth a second look even when eligible. */
  warnings: string[];
  categoryVerified: boolean;
  /** True when an official still has to review eligibility (or review it again). */
  needsReview: boolean;
  review: EligibilityInput['review'];
}

export const VAWC_HEARING_REFUSAL = 'VAWC cases under RA 9262 are not subject to barangay mediation or conciliation. Keep this case in the VAWC workflow - intervention, safety assistance, referral and follow-up.';

/**
 * May this case have an ordinary barangay hearing? Decided from the verified
 * category and an official's review, never from the form the resident chose.
 */
export function hearingEligibility(i: EligibilityInput): Eligibility {
  const base = { warnings: [] as string[], review: i.review };
  if (isVawc(i.caseType)) {
    return { ...base, eligible: false, reasons: [VAWC_HEARING_REFUSAL], categoryVerified: Boolean(i.verifiedCategory), needsReview: false };
  }
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (CLOSED_CASE_STATUSES.includes(i.status)) reasons.push(`This case is ${i.status.toLowerCase()}. A closed case has no further hearings.`);
  const categoryVerified = Boolean(i.verifiedCategory && i.verifiedCategory.caseType === i.caseType);
  if (!categoryVerified) {
    reasons.push('Confirm the case category first (Case Classification). Eligibility follows the verified category, not the one chosen when the report was filed.');
  }
  const reviewHolds = Boolean(i.review && i.review.caseType === i.caseType);
  const needsReview = !reviewHolds;
  if (!i.review) reasons.push('An official must review whether this dispute may go to Katarungang Pambarangay proceedings.');
  else if (!reviewHolds) reasons.push(`The eligibility review was made when the case was "${i.review.caseType}". Review it again for "${i.caseType}".`);
  else if (i.review.decision !== 'ELIGIBLE') {
    reasons.push(`Reviewed as not eligible for barangay conciliation${i.review.note ? `: ${i.review.note}` : '.'}`);
  }
  if (i.reportPath === 'VAWC') warnings.push('The reporter filed this on the VAWC form. Check again that RA 9262 does not apply before any hearing.');
  if (i.aiSuggestedCategory && isVawc(i.aiSuggestedCategory)) {
    warnings.push(`The AI read possible VAWC indicators ("${i.aiSuggestedCategory}"). The verified category is "${i.caseType}" - confirm that RA 9262 does not apply.`);
  }
  return { eligible: reasons.length === 0, reasons, warnings, categoryVerified, needsReview, review: i.review };
}

// ── Which hearing may come next ──────────────────────────────────────────────

type HearingLite = { hearingNumber: number; status: string; outcome?: string | null };

/**
 * Why this hearing cannot be created on this case, or null. One open hearing
 * at a time; each follows a held one; none after the proceedings ended; three
 * at most. A cancelled hearing may be replaced.
 */
export function hearingRefusal(caseType: string, existing: HearingLite[], hearingNumber: number): string | null {
  if (isVawc(caseType)) return VAWC_HEARING_REFUSAL;
  if (!Number.isInteger(hearingNumber) || hearingNumber < 1 || hearingNumber > MAX_HEARINGS) return `A case has hearings 1 to ${MAX_HEARINGS} only.`;
  const open = existing.find(h => isOpen(h.status));
  if (open) return `Hearing ${open.hearingNumber} is still open. Record it as held or cancel it first.`;
  const ended = existing.find(h => h.status === 'COMPLETED' && h.outcome && HEARING_OUTCOMES[h.outcome as HearingOutcome]?.ends);
  if (ended) return `The proceedings ended at hearing ${ended.hearingNumber} (${outcomeLabel(ended.outcome)?.toLowerCase()}). No further hearing is scheduled.`;
  if (existing.some(h => h.hearingNumber === hearingNumber && h.status === 'COMPLETED')) return `Hearing ${hearingNumber} has already been held.`;
  if (hearingNumber > 1 && !existing.some(h => h.hearingNumber === hearingNumber - 1 && h.status === 'COMPLETED')) {
    return `Hearing ${hearingNumber - 1} must be held first.`;
  }
  if (existing.some(h => h.hearingNumber > hearingNumber && h.status !== 'CANCELLED')) return `A later hearing is already on record.`;
  return null;
}

/** The hearing to schedule next: one after the last held, never past three. */
export function nextHearingNumber(existing: { hearingNumber: number; status: string }[]): number | null {
  const held = existing.filter(h => h.status === 'COMPLETED').map(h => h.hearingNumber);
  const next = held.length ? Math.max(...held) + 1 : 1;
  return next > MAX_HEARINGS ? null : next;
}

/** What each action may be done from. */
export const ALLOWED_FROM: Record<string, HearingStatus[]> = {
  update: ['DRAFT'],
  schedule: ['DRAFT'],
  details: LIVE_STATUSES,
  reschedule: LIVE_STATUSES,
  notice: LIVE_STATUSES,
  attendance: [...LIVE_STATUSES, 'COMPLETED'],
  proceedings: [...LIVE_STATUSES, 'COMPLETED'],
  complete: LIVE_STATUSES,
  cancel: OPEN_STATUSES,
  decline_request: LIVE_STATUSES,
};
export const allowedFrom = (action: string, status: string) => (ALLOWED_FROM[action] ?? []).includes(status as HearingStatus);

// ── The history ──────────────────────────────────────────────────────────────

export const HEARING_EVENT_LABELS: Record<string, string> = {
  created: 'Draft created',
  updated: 'Details updated',
  scheduled: 'Scheduled',
  rescheduled: 'New date set',
  notice_generated: 'Notice generated',
  notice_issued: 'Notice issued',
  notice_delivery: 'Notice delivery recorded',
  notice_acknowledged: 'Notice acknowledged',
  attendance: 'Attendance recorded',
  proceedings_note: 'Proceedings note',
  outcome: 'Outcome recorded',
  cancelled: 'Cancelled',
  resident_intent: 'Complainant replied about attending',
  reschedule_requested: 'Complainant asked for a new date',
  request_approved: 'Request for a new date approved',
  request_declined: 'Request for a new date declined',
  attachment_added: 'Attachment added',
  reminder: 'Reminder sent',
  attention: 'Officials alerted',
};

/**
 * The events a complainant is told about. Everything else - drafts, notes,
 * attendance, the respondent's notice - stays with the officials.
 */
export const RESIDENT_EVENT_KINDS = ['scheduled', 'rescheduled', 'notice_issued', 'cancelled', 'outcome', 'request_approved', 'request_declined', 'reminder'] as const;

/**
 * The message a complainant gets about one hearing event, from the event's own
 * snapshot - or null for an event that is not theirs to know. No official is
 * named, and no note, attendance or other party's detail is included.
 */
export function residentHearingMessage(e: { kind: string; after: unknown }): string | null {
  if (!(RESIDENT_EVENT_KINDS as readonly string[]).includes(e.kind)) return null;
  const a = (e.after ?? {}) as Record<string, unknown>;
  const n = typeof a.hearingNumber === 'number' ? a.hearingNumber : null;
  if (!n) return null;
  const when = typeof a.scheduledAt === 'string' ? formatHearingWhen(a.scheduledAt) : null;
  const venue = typeof a.venue === 'string' && a.venue ? ` at ${a.venue}` : '';
  switch (e.kind) {
    case 'scheduled': return when ? `Hearing ${n} is scheduled for ${when}${venue}. Open My Hearings for the details.` : null;
    case 'rescheduled': return when ? `Hearing ${n} has a new date: ${when}${venue}. Open My Hearings for the details.` : null;
    case 'notice_issued': return a.recipientRole === 'COMPLAINANT' ? `Your notice for Hearing ${n} has been issued. Open My Hearings to view, download or acknowledge it.` : null;
    // A draft the complainant was never told about is not theirs to hear cancelled.
    case 'cancelled': return a.wasDraft ? null : `Hearing ${n} was cancelled. The barangay will tell you if another date is set.`;
    case 'outcome': {
      const o = typeof a.outcome === 'string' && a.outcome in HEARING_OUTCOMES ? HEARING_OUTCOMES[a.outcome as HearingOutcome].resident : null;
      if (!o) return null;
      const summary = typeof a.outcomeSummary === 'string' && a.outcomeSummary ? `\n\n${a.outcomeSummary}` : '';
      return `Hearing ${n} was held. ${o}${summary}`;
    }
    case 'request_approved': return `Your request for a new date for Hearing ${n} was approved.${when ? ` The new date is ${when}${venue}.` : ''}`;
    case 'request_declined': {
      const note = typeof a.reviewNote === 'string' && a.reviewNote ? ` ${a.reviewNote}` : '';
      return `Your request for a new date for Hearing ${n} was not approved.${note}`;
    }
    case 'reminder': return when ? `Reminder: Hearing ${n} is on ${when}${venue}.` : null;
  }
  return null;
}

/** What the complainant is told to do before any hearing. */
export const RESIDENT_HEARING_INSTRUCTIONS = [
  'Bring a valid ID and any documents or photos related to your complaint.',
  'Arrive 15 minutes before the time on your notice and report to the barangay hall desk.',
  'If you cannot attend, request a new date here as early as you can - the date changes only when an official approves it.',
  'Not appearing without a valid reason can affect your complaint under the Katarungang Pambarangay rules.',
];

/** How a status reads to the complainant. A draft never reaches them. */
export const RESIDENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  NOTICE_ISSUED: 'Notice issued',
  ACKNOWLEDGED: 'Notice acknowledged',
  RESCHEDULED: 'New date set',
  COMPLETED: 'Held',
  CANCELLED: 'Cancelled',
};

export const RESCHEDULE_REQUESTS_PER_HEARING = 3;

// ── Scheduling checks ────────────────────────────────────────────────────────

/** How far ahead a hearing may be set. */
export const MAX_DAYS_AHEAD = 365;

/**
 * Why this date and time cannot hold a hearing, or null. A time already gone
 * (a few minutes' grace for the form), or one more than a year ahead, is
 * not a schedule.
 */
export function scheduleTimeRefusal(at: Date | null, now = new Date()): string | null {
  if (!at || Number.isNaN(at.getTime())) return 'Choose a valid hearing date and time.';
  if (at.getTime() < now.getTime() - 5 * 60_000) return 'That date and time have already passed. Choose a later time.';
  if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return `A hearing can be set up to ${MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

/** Two hearings conflict when they start closer together than one slot. */
export const overlaps = (a: Date | string, b: Date | string, slotMinutes: number) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) < slotMinutes * 60_000;

/** The same venue, however it was typed. */
export const sameVenue = (a: string | null | undefined, b: string | null | undefined) =>
  (a || 'Barangay Hall').trim().toLowerCase().replace(/\s+/g, ' ') === (b || 'Barangay Hall').trim().toLowerCase().replace(/\s+/g, ' ');

export interface ScheduleConflict {
  kind: 'official' | 'venue';
  message: string;
  /** The other hearing's reference - only when the official may view it. */
  reference: string | null;
  scheduledAt: string;
}

/** The calendar's status filter: "scheduled" covers every live state but a new date. */
export const CALENDAR_STATUS_GROUPS = {
  scheduled: { label: 'Scheduled', statuses: ['SCHEDULED', 'NOTICE_ISSUED', 'ACKNOWLEDGED'] },
  rescheduled: { label: 'Rescheduled', statuses: ['RESCHEDULED'] },
  completed: { label: 'Completed', statuses: ['COMPLETED'] },
  cancelled: { label: 'Cancelled', statuses: ['CANCELLED'] },
  draft: { label: 'Draft', statuses: ['DRAFT'] },
} as const;
export type CalendarStatusGroup = keyof typeof CALENDAR_STATUS_GROUPS;
