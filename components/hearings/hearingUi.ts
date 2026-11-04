/**
 * What the hearing screens share: the shapes the routes return, fetching,
 * and the colours each status reads in.
 */
import type { HearingStatus, Attendance, NoticeStatus, KpStage, PangkatChosenBy } from '@/lib/hearings';
import type { Eligibility, ScheduleConflict } from '@/lib/hearings';

export const NAVY = '#0c1e46';

export interface HearingNotice {
  id: string; noticeNumber: string; formNo: number | null; formName: string; recipientRole: 'COMPLAINANT' | 'RESPONDENT' | 'PANGKAT_MEMBER'; recipientName: string;
  scheduledAt: string; venue: string | null; channel: 'SAFECOMM_ACCOUNT' | 'OFFICER' | null; seenAt: string | null; pangkatMemberId: string | null;
  status: NoticeStatus; issueMethod: string | null; generatedAt: string; generatedBy: string | null; issuedAt: string | null; issuedBy: string | null;
  deliveryRecordedAt: string | null; deliveryRecordedBy: string | null; deliveryNote: string | null;
  acknowledgedAt: string | null; acknowledgedVia: string | null; supersededAt: string | null;
}
export interface HearingEvent { id: string; kind: string; actorType: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null; createdAt: string; by: string | null }
export interface HearingRequest { id: string; requesterRole: 'COMPLAINANT' | 'RESPONDENT'; reason: string; preferredSchedule: string | null; status: 'PENDING' | 'APPROVED' | 'DECLINED'; createdAt: string; reviewedAt: string | null; reviewNote: string | null; reviewedBy: string | null }
export interface Hearing {
  id: string; caseId: string; reference: string; hearingNumber: number; stage: KpStage; session: number; title: string; scheduledAt: string; venue: string | null; status: HearingStatus;
  outcome: string | null; agreements: string | null; outcomeSummary: string | null; nextAction: string | null; nextHearingAt: string | null;
  residentInstructions: string | null; statusReason: string | null; notes: string | null; rescheduleCount: number;
  residentIntent: 'WILL_ATTEND' | 'CANNOT_ATTEND' | null; residentIntentAt: string | null;
  complainantAttendance: Attendance; respondentAttendance: Attendance;
  assignedOfficialId: string | null; assignedOfficial: { id: string; name: string } | null;
  complainant: { partyId: string | null; name: string; hasAccount: boolean }; respondent: { partyId: string | null; name: string; hasAccount: boolean };
  notices: HearingNotice[]; events: HearingEvent[]; requests: HearingRequest[];
  attachments: { id: string; filename: string; mimeType: string; size: number; createdAt: string }[];
  createdAt: string; updatedAt: string; createdBy: string | null; completedAt: string | null; completedBy: string | null; cancelledAt: string | null; cancelledBy: string | null;
}
export interface PartyOption {
  id: string | null; name: string; label: string;
  /** The SafeComm account the party is linked to (the reporter's own, for the reporter). */
  account: { residentNumber: string | null; name: string | null; linkedAt: string | null; reporter?: boolean } | null;
}
export interface NextStep { stage: KpStage; session: number; label: string; title: string; forms: { formNo: number; recipientRole: 'COMPLAINANT' | 'RESPONDENT'; name: string }[] }
export interface PangkatMember {
  id: string; name: string; chosenBy: PangkatChosenBy; userId: string | null; createdAt: string; addedBy: string | null;
  removedAt: string | null; removedBy: string | null; removedReason: string | null;
}
export interface Pangkat {
  id: string; constitutedAt: string | null; constitutionHearingId: string | null; chairmanMemberId: string | null; secretaryMemberId: string | null;
  members: PangkatMember[];
}
export interface CaseHearingsData {
  case: { id: string; caseNumber: string; caseType: string; status: string; hasReporterAccount?: boolean };
  hearings: Hearing[]; next: NextStep | null; pangkat: Pangkat | null; canEdit: boolean; accessMessage?: string | null; blocked: string | null; vawc?: boolean;
  eligibility: Eligibility; parties: { complainants: PartyOption[]; respondents: PartyOption[] }; officials: { id: string; name: string; role: string }[];
}

export const STATUS_COLOR: Record<HearingStatus, string> = {
  DRAFT: '#64748b', SCHEDULED: '#0369a1', NOTICE_ISSUED: '#4f46e5', ACKNOWLEDGED: '#0f766e',
  RESCHEDULED: '#b45309', COMPLETED: '#15803d', CANCELLED: '#94a3b8',
};
export const NOTICE_COLOR: Record<string, string> = {
  GENERATED: '#64748b', ISSUED: '#4f46e5', DELIVERED: '#0369a1', UNDELIVERED: '#b91c1c', ACKNOWLEDGED: '#15803d', SUPERSEDED: '#94a3b8',
};
export const ATTENDANCE_COLOR: Record<string, string> = { PRESENT: '#15803d', ABSENT: '#b91c1c', EXCUSED: '#b45309', NOT_RECORDED: '#94a3b8' };

export const chipSx = (color: string) => ({ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: `${color}14`, color, border: `1px solid ${color}33` });

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Could not load this'), { status: res.status });
  return body.data as T;
}

export async function send<T = unknown>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  // A schedule conflict carries the clashing hearings, for the warning and "go ahead" choice.
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Could not save'), { status: res.status, conflicts: (json.conflicts ?? null) as ScheduleConflict[] | null });
  return json.data as T;
}

/** Today in Philippine time, for a date input's minimum. */
export const todayPh = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/** The conflicts a failed save came back with, if that is why it failed. */
export const conflictsOf = (e: unknown): ScheduleConflict[] | null =>
  e instanceof Error && Array.isArray((e as Error & { conflicts?: unknown }).conflicts) ? (e as Error & { conflicts: ScheduleConflict[] }).conflicts : null;
