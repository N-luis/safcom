/**
 * VAWC Appointments & Follow-ups - the VAWC desk's own scheduling, separate
 * from Hearing Management in its records, permissions, calendar and words.
 *
 * Under RA 9262 the barangay does not mediate or conciliate a VAWC case
 * (sec. 33), and the desk's work is to respond, assist and refer (secs. 30
 * and 32), keeping every record confidential (sec. 44). So an appointment
 * here is a private interview, a follow-up, referral coordination or an
 * administrative case conference - never a hearing, never a joint session
 * with the respondent, and never a compromise. There is no respondent among
 * the participants and no mediation type to choose.
 *
 * Pure rules and labels, shared by the routes, the screens and the tests.
 */
import { phDay } from './hearings';

export { phDay };

// ── What an appointment is ───────────────────────────────────────────────────

export const APPOINTMENT_TYPES = {
  VICTIM_INTERVIEW: { label: 'Victim-survivor interview', resident: 'Private interview' },
  INTAKE_FOLLOW_UP: { label: 'Intake follow-up', resident: 'Follow-up appointment' },
  SAFETY_FOLLOW_UP: { label: 'Safety and support follow-up', resident: 'Follow-up appointment' },
  REFERRAL_COORDINATION: { label: 'Referral coordination', resident: 'Appointment about services' },
  CASE_CONFERENCE: { label: 'Administrative case conference', resident: 'Appointment' },
} as const;
export type AppointmentType = keyof typeof APPOINTMENT_TYPES;
export const APPOINTMENT_TYPE_KEYS = Object.keys(APPOINTMENT_TYPES) as [AppointmentType, ...AppointmentType[]];
export const typeLabel = (t: string) => (t in APPOINTMENT_TYPES ? APPOINTMENT_TYPES[t as AppointmentType].label : 'Appointment');

/**
 * Who an appointment is for. The respondent is not on the list and cannot be
 * added: a victim-survivor is never asked to meet them (RA 9262 sec. 33).
 */
export const PARTICIPANTS = {
  REPORTER: 'The resident who filed the report',
  VICTIM_SURVIVOR: 'The victim-survivor',
  SUPPORT_PERSON: 'A support person or guardian they choose',
  SERVICE_PROVIDER: 'Service provider (social welfare, health, WCPD, legal)',
  VAWC_STAFF: 'VAWC desk officials',
} as const;
export type Participant = keyof typeof PARTICIPANTS;
export const PARTICIPANT_KEYS = Object.keys(PARTICIPANTS) as [Participant, ...Participant[]];

/** The reporter is the victim-survivor when they reported for themselves (as the intake reads it: unset means self). */
export const reporterIsVictim = (relationship: string | null | undefined) => (relationship ?? 'SELF') === 'SELF';

/** A participant's name on this case: a self-report's reporter is the victim-survivor. */
export function participantLabel(p: string, relationship: string | null | undefined): string {
  if (p === 'REPORTER' && reporterIsVictim(relationship)) return 'The victim-survivor (filed this report)';
  return p in PARTICIPANTS ? PARTICIPANTS[p as Participant] : p;
}

/** The participants that make sense on this case: on a self-report the victim-survivor is the reporter. */
export const participantChoices = (relationship: string | null | undefined): Participant[] =>
  PARTICIPANT_KEYS.filter(p => !(p === 'VICTIM_SURVIVOR' && reporterIsVictim(relationship)));

/** The participants as saved: one entry each, and on a self-report the victim-survivor is the reporter. */
export function normalizeParticipants(list: string[], relationship: string | null | undefined): Participant[] {
  const mapped = list.map(p => (p === 'VICTIM_SURVIVOR' && reporterIsVictim(relationship) ? 'REPORTER' : p));
  return PARTICIPANT_KEYS.filter(p => mapped.includes(p));
}

/** Who a new appointment of this type is for, until the official changes it. */
export function defaultParticipants(type: AppointmentType, relationship: string | null | undefined): Participant[] {
  const victim: Participant = reporterIsVictim(relationship) ? 'REPORTER' : 'VICTIM_SURVIVOR';
  if (type === 'CASE_CONFERENCE') return ['VAWC_STAFF', 'SERVICE_PROVIDER'];
  if (type === 'REFERRAL_COORDINATION') return [victim, 'SERVICE_PROVIDER'];
  return [victim];
}

/**
 * Asked for something this module never does: a respondent, mediation,
 * reconciliation, a settlement. Read from the raw request, so the answer
 * says why rather than "invalid value".
 */
export const NOT_IN_VAWC = 'VAWC appointments never include the respondent and are never mediation, conciliation or reconciliation (RA 9262 sec. 33). The respondent is not notified.';
export function forbiddenRequest(raw: unknown): string | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const list = Array.isArray(r.participants) ? r.participants.map(String) : [];
  if (list.some(p => /RESPONDENT|ACCUSED|PERPETRATOR/i.test(p))) return NOT_IN_VAWC;
  if (typeof r.type === 'string' && /MEDIAT|CONCILIAT|RECONCIL|SETTLE|COMPROMISE|HEARING|JOINT/i.test(r.type)) return NOT_IN_VAWC;
  return null;
}

// ── How the resident hears about it ──────────────────────────────────────────

export const NOTIFY_OPTIONS = {
  SAFECOMM_ACCOUNT: { label: 'In-app notice to their SafeComm account', short: 'In-app notice' },
  OFFICER_CONTACT: { label: 'The officer contacts them, as their safe-contact preference allows', short: 'Officer contacts them' },
  NONE: { label: 'No notice - officials only', short: 'No notice' },
} as const;
export type NotifyVia = keyof typeof NOTIFY_OPTIONS;
export const NOTIFY_KEYS = Object.keys(NOTIFY_OPTIONS) as [NotifyVia, ...NotifyVia[]];

/**
 * Why this notice choice cannot be used on this case, or null. An in-app
 * notice goes only to the account that filed the case, and only when that
 * resident is among the participants - never to anyone else.
 */
export function notifyRefusal(notifyVia: string, c: { hasAccount: boolean }, participants: string[]): string | null {
  if (notifyVia !== 'SAFECOMM_ACCOUNT') return null;
  if (!c.hasAccount) return 'The report was not filed from a SafeComm account, so there is no account to notify. Choose "The officer contacts them".';
  if (!participants.includes('REPORTER')) return 'An in-app notice goes only to the resident who filed the report. Add them as a participant, or choose another way.';
  return null;
}

/** Whether the resident's own account is told about this appointment. */
export const residentNotified = (a: { notifyVia: string; participants: string[] }) =>
  a.notifyVia === 'SAFECOMM_ACCOUNT' && a.participants.includes('REPORTER');

// ── Where it stands ──────────────────────────────────────────────────────────

export const APPOINTMENT_STATUSES = {
  SCHEDULED: 'Scheduled', RESCHEDULED: 'Rescheduled', COMPLETED: 'Completed', NOT_HELD: 'Did not take place', CANCELLED: 'Cancelled',
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUSES;
export const OPEN_APPOINTMENT: AppointmentStatus[] = ['SCHEDULED', 'RESCHEDULED'];
export const isOpenAppointment = (s: string) => (OPEN_APPOINTMENT as string[]).includes(s);

export const ATTENDANCE_OPTIONS = { ATTENDED: 'Attended', DID_NOT_ATTEND: 'Did not attend', NOT_APPLICABLE: 'Not applicable' } as const;
export type AppointmentAttendance = keyof typeof ATTENDANCE_OPTIONS;
export const ATTENDANCE_KEYS = Object.keys(ATTENDANCE_OPTIONS) as [AppointmentAttendance, ...AppointmentAttendance[]];

export const REFERRAL_STATUS_OPTIONS = {
  NOT_NEEDED: 'No referral needed', TO_BE_MADE: 'Referral to be made', IN_PROGRESS: 'Referral in progress',
  COMPLETED: 'Referral completed', DECLINED_BY_CLIENT: 'Declined by the client',
} as const;
export type AppointmentReferralStatus = keyof typeof REFERRAL_STATUS_OPTIONS;
export const REFERRAL_STATUS_KEYS = Object.keys(REFERRAL_STATUS_OPTIONS) as [AppointmentReferralStatus, ...AppointmentReferralStatus[]];

/** The calendar's lists. "Past" is every appointment whose date has gone, cancelled ones aside. */
export const APPOINTMENT_VIEWS = {
  upcoming: 'Upcoming', past: 'Past', rescheduled: 'Rescheduled', completed: 'Completed', cancelled: 'Cancelled',
} as const;
export type AppointmentView = keyof typeof APPOINTMENT_VIEWS;
export const APPOINTMENT_VIEW_KEYS = Object.keys(APPOINTMENT_VIEWS) as AppointmentView[];

export function inView(a: { status: string; scheduledAt: Date | string; rescheduleCount: number }, view: AppointmentView, now = new Date()): boolean {
  const at = new Date(a.scheduledAt).getTime();
  if (view === 'upcoming') return isOpenAppointment(a.status) && at >= now.getTime();
  if (view === 'past') return a.status !== 'CANCELLED' && at < now.getTime();
  if (view === 'rescheduled') return a.rescheduleCount > 0 && a.status !== 'CANCELLED';
  if (view === 'completed') return a.status === 'COMPLETED';
  return a.status === 'CANCELLED';
}

/** What an action may be taken from. */
export const APPOINTMENT_ALLOWED_FROM: Record<string, AppointmentStatus[]> = {
  update: ['SCHEDULED', 'RESCHEDULED'],
  reschedule: ['SCHEDULED', 'RESCHEDULED'],
  cancel: ['SCHEDULED', 'RESCHEDULED'],
  record: ['SCHEDULED', 'RESCHEDULED'],
  review_request: ['SCHEDULED', 'RESCHEDULED'],
  // An outcome already recorded may be added to (follow-up actions, referral status, next date).
  amend_outcome: ['COMPLETED', 'NOT_HELD'],
};
export const appointmentAllowed = (action: string, status: string) => (APPOINTMENT_ALLOWED_FROM[action] ?? []).includes(status as AppointmentStatus);

/** An appointment can be recorded as held from its own day on. */
export const appointmentDayArrived = (at: Date | string, now = new Date()) => phDay(at) <= phDay(now);

export const RESCHEDULE_REQUESTS_PER_APPOINTMENT = 3;

/** How far ahead an appointment may be set. */
export const APPOINTMENT_MAX_DAYS_AHEAD = 365;

/** Why this date and time cannot hold an appointment, or null (a few minutes' grace for the form). */
export function appointmentTimeRefusal(at: Date | null, now = new Date()): string | null {
  if (!at || Number.isNaN(at.getTime())) return 'Choose a valid date and time.';
  if (at.getTime() < now.getTime() - 5 * 60_000) return 'That date and time have already passed. Choose a later time.';
  if (at.getTime() > now.getTime() + APPOINTMENT_MAX_DAYS_AHEAD * 86_400_000) return `An appointment can be set up to ${APPOINTMENT_MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

// ── The history ──────────────────────────────────────────────────────────────

export const APPOINTMENT_EVENT_LABELS: Record<string, string> = {
  created: 'Appointment scheduled',
  updated: 'Details updated',
  rescheduled: 'New date set',
  cancelled: 'Cancelled',
  completed: 'Outcome recorded - held',
  not_held: 'Outcome recorded - did not take place',
  outcome_amended: 'Outcome record updated',
  resident_notified: 'In-app notice sent to the resident',
  resident_seen: 'Seen by the resident',
  resident_acknowledged: 'Acknowledged by the resident',
  reschedule_requested: 'New date requested by the resident',
  request_approved: 'Request for a new date approved',
  request_declined: 'Request for a new date declined',
};

/** The events a resident may be told about - and only when their account is notified. */
export const RESIDENT_APPOINTMENT_EVENTS = ['created', 'rescheduled', 'cancelled', 'request_approved', 'request_declined'] as const;

const when = (iso: unknown) => {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}`;
};

/**
 * What the resident's notification says about an event - or null. Written so
 * it is safe for anyone who sees the screen: an appointment "with the
 * barangay" and its date. Never the case type, the purpose, the officer, a
 * note, the case number, or the words VAWC, abuse or violence - those stay
 * behind My Appointments, behind the resident's own login.
 */
export function residentAppointmentMessage(e: { kind: string; after: unknown }): string | null {
  const a = (e.after && typeof e.after === 'object' ? e.after : {}) as Record<string, unknown>;
  const at = when(a.scheduledAt);
  switch (e.kind) {
    case 'created': return at ? `You have an appointment with the barangay on ${at}. Open My Appointments for the details.` : null;
    case 'rescheduled': return at ? `Your appointment with the barangay has a new date: ${at}. Open My Appointments for the details.` : null;
    case 'cancelled': return at ? `Your appointment with the barangay on ${at} was cancelled.` : 'Your appointment with the barangay was cancelled.';
    case 'request_approved': return 'Your request for a new appointment date was approved. Open My Appointments to see the new date.';
    case 'request_declined': return 'Your request for a new appointment date was answered. Open My Appointments to see the reply.';
    default: return null;
  }
}

/** What the resident is asked to do before any appointment, whatever its type. */
export const RESIDENT_APPOINTMENT_INSTRUCTIONS = [
  'Come at the time shown. You may bring a support person you trust.',
  'If it is not safe for you to come, ask for a new date here, or contact the barangay when it is safe.',
  'This appointment is confidential. The person reported is never told about it.',
];
