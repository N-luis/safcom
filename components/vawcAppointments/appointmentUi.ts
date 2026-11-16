/**
 * What the VAWC appointment screens share: the shapes the routes return and
 * the colours each status reads in. Fetching and the conflict list are the
 * hearing screens' own helpers (components/hearings/hearingUi.ts).
 */
import type { AppointmentStatus, Participant } from '@/lib/vawcAppointments';

export { getJson, send, todayPh, conflictsOf, chipSx, NAVY } from '@/components/hearings/hearingUi';

/** The VAWC desk's accent, as in its sidebar. */
export const VIOLET = '#7c3aed';

export const APPT_STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED: '#0369a1', RESCHEDULED: '#b45309', COMPLETED: '#15803d', NOT_HELD: '#b91c1c', CANCELLED: '#94a3b8',
};

export interface AppointmentRow {
  id: string; reference: string; type: string; typeLabel: string; scheduledAt: string; venue: string; status: AppointmentStatus;
  case: { id: string; caseNumber: string; caseType: string; status: string };
  officer: { id: string; name: string } | null; participants: Participant[]; notifyVia: string; rescheduleCount: number;
  acknowledged: boolean; pendingRequests: number; overdue: boolean; canEdit: boolean;
}
export interface AppointmentList {
  rows: AppointmentRow[]; canCreate: boolean;
  summary: { upcoming: number; overdue: number; pendingRequests: number; rescheduled: number; completed: number; cancelled: number };
  filters: { officers: { id: string; name: string }[] };
}

export interface AppointmentCaseContext {
  id: string; caseNumber: string; caseType: string; status: string; riskLevel: string | null; filedAt: string;
  assignedTo: { id: string; name: string } | null; hasAccount: boolean; reportingRelationship: string | null; reporterIsVictim: boolean;
  participantChoices: Participant[];
  contact: { preference: string | null; label: string; guidance: string; allowCall: boolean; allowText: boolean; note: string | null };
}
export interface Officer { id: string; name: string; role: string }

export interface AppointmentDetail {
  appointment: {
    id: string; caseId: string; reference: string; type: string; scheduledAt: string; venue: string; assignedOfficer: { id: string; name: string } | null;
    participants: Participant[]; purpose: string; internalNotes: string | null; notifyVia: string; residentInstructions: string | null;
    status: AppointmentStatus; statusReason: string | null; rescheduleCount: number; attendance: string | null; outcomeNotes: string | null;
    followUpActions: string | null; referralStatus: string | null; nextAppointmentAt: string | null; residentSeenAt: string | null; residentAcknowledgedAt: string | null;
    createdAt: string; createdBy: string | null; completedAt: string | null; completedBy: string | null; cancelledAt: string | null; cancelledBy: string | null; open: boolean;
    events: { id: string; kind: string; actorType: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null; createdAt: string; by: string | null }[];
    requests: { id: string; reason: string; preferredSchedule: string | null; status: 'PENDING' | 'APPROVED' | 'DECLINED'; createdAt: string; reviewedAt: string | null; reviewNote: string | null; reviewedBy: string | null }[];
  };
  case: AppointmentCaseContext; officers: Officer[]; canEdit: boolean; accessMessage: string | null;
}
