/**
 * Analytics: how each figure is counted.
 *
 * Every figure is read from what the system already records - the case's
 * workflow status, the triage status, the risk matrix and Groq results saved
 * at filing and on each re-run, the officer's own decisions. Nothing here
 * scores a case: a case with no recorded level is shown as not assessed,
 * never given one.
 *
 * Shared by the dashboard (browser) and the routes (server); no database access.
 */
import { VAWC_TYPES } from './vawcTypes';

export type AnalyticsScope = 'all' | 'blotter' | 'vawc';

const isVawc = (caseType: string) => (VAWC_TYPES as readonly string[]).includes(caseType);
export const deskOf = (caseType: string): 'VAWC' | 'BLOTTER' => (isVawc(caseType) ? 'VAWC' : 'BLOTTER');

// ── Case overview: the workflow statuses, grouped ────────────────────────────

/** Each status in exactly one group, so the groups add up to the total. */
export const STATUS_GROUPS = {
  pending: { label: 'Pending', hint: 'Filed, no action recorded yet', statuses: ['Open'] },
  underReview: { label: 'Under Review', hint: 'Being investigated or awaiting a resolution', statuses: ['Under Investigation', 'Pending Resolution'] },
  ongoing: { label: 'Ongoing', hint: 'Action or intervention in progress', statuses: ['In Progress', 'Intervention in Progress'] },
  resolved: { label: 'Resolved', hint: 'Resolved or closed', statuses: ['Resolved', 'Closed'] },
} as const;
export type StatusGroup = keyof typeof STATUS_GROUPS;
export const CLOSED_STATUSES = ['Resolved', 'Closed'];

export function groupOfStatus(status: string): StatusGroup | null {
  for (const [k, g] of Object.entries(STATUS_GROUPS)) if ((g.statuses as readonly string[]).includes(status)) return k as StatusGroup;
  return null;
}

// ── Dates: the barangay's day, not the server's ──────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A date range from YYYY-MM-DD strings, read as Philippine days: `from` at
 * its first moment, `to` through its last. Either may be absent; a malformed
 * one is ignored rather than guessed at.
 */
export function parseRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null } {
  const f = from && DAY.test(from) ? new Date(`${from}T00:00:00+08:00`) : null;
  const t = to && DAY.test(to) ? new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86_400_000 - 1) : null;
  if (f && t && f > t) return { from: t, to: f };
  return { from: f && Number.isFinite(f.getTime()) ? f : null, to: t && Number.isFinite(t.getTime()) ? t : null };
}

// ── The AI's results, as recorded ────────────────────────────────────────────

export interface AiSnapshot {
  source: 'filing' | 'rerun';
  at: string;
  framework: string | null;
  level: number | null;
  label: string | null;
  status: string | null;
  recommendation: string | null;
  urgent: boolean;
  /** False when the Groq reading did not run or failed - the rules' reading stands alone. */
  aiUsed: boolean;
}

type AiAssessmentJson = { status?: string; recommendedNextAction?: string | null; urgentHumanReview?: boolean } | null | undefined;

/**
 * The latest recorded assessment of a case: the newest re-run, else the one
 * made at filing. The level is the risk matrix's own (Level 1-5 with its
 * label); the recommendation is Groq's, and only when Groq gave one.
 */
export function latestAi(
  intake: { createdAt: Date | string; framework: string | null; matrixLevel: number | null; matrixLabel: string | null; assessmentStatus: string | null; aiReading: unknown } | null,
  rerun: { createdAt: Date | string; framework: string | null; matrixLevel: number | null; matrixLabel: string | null; rationale: unknown } | null,
): AiSnapshot | null {
  if (rerun) {
    const r = (rerun.rationale ?? {}) as { status?: string; ai?: { used?: boolean; assessment?: AiAssessmentJson } | null };
    const a = r.ai?.assessment;
    return {
      source: 'rerun', at: new Date(rerun.createdAt).toISOString(), framework: rerun.framework,
      level: rerun.matrixLevel, label: rerun.matrixLabel, status: r.status ?? null,
      recommendation: a?.status === 'COMPLETED' ? a.recommendedNextAction ?? null : null,
      urgent: Boolean(a?.urgentHumanReview), aiUsed: Boolean(r.ai?.used),
    };
  }
  if (intake) {
    const ai = (intake.aiReading ?? null) as { used?: boolean; assessment?: AiAssessmentJson } | null;
    const a = ai?.assessment;
    return {
      source: 'filing', at: new Date(intake.createdAt).toISOString(), framework: intake.framework,
      level: intake.matrixLevel, label: intake.matrixLabel, status: intake.assessmentStatus,
      recommendation: a?.status === 'COMPLETED' ? a.recommendedNextAction ?? null : null,
      urgent: Boolean(a?.urgentHumanReview), aiUsed: Boolean(ai?.used),
    };
  }
  return null;
}

// ── Emergency and high priority ──────────────────────────────────────────────

export interface PriorityInput {
  status: string;
  riskLevel: string | null;
  triageStatus: string | null;
  intake: { immediateSafetyConcern: boolean; urgentReview: boolean | null } | null;
  safety: { immediateConcern: string; urgentAssistance: string } | null;
  ai: AiSnapshot | null;
}

/**
 * Why a case carries the emergency flag - any one is enough. It does not
 * depend on the AI having run: a resident's own "in danger now", an officer's
 * safety assessment and the urgent-review triage stand on their own.
 */
export function emergencyReasons(c: PriorityInput): string[] {
  const why: string[] = [];
  if (c.triageStatus === 'URGENT_REVIEW') why.push('Flagged for urgent review');
  if (c.intake?.immediateSafetyConcern || c.intake?.urgentReview) why.push('Immediate safety concern in the report');
  if (c.safety?.immediateConcern === 'yes') why.push('Officer recorded an immediate safety concern');
  if (c.safety?.urgentAssistance === 'yes') why.push('Officer recorded that urgent assistance is needed');
  if (c.ai?.urgent) why.push('AI recommended urgent human review');
  return why;
}

/** Open, and either flagged as an emergency or at a high level - the queue's or the matrix's. */
export function isHighPriority(c: PriorityInput): boolean {
  if (CLOSED_STATUSES.includes(c.status)) return false;
  return emergencyReasons(c).length > 0
    || c.riskLevel === 'High' || c.riskLevel === 'Critical'
    || (c.ai?.level ?? 0) >= 4;
}

/** Emergencies first, then the higher matrix level, then the case waiting longest. */
export function priorityOrder<T extends PriorityInput & { filedAt: Date | string }>(a: T, b: T): number {
  const e = Number(emergencyReasons(b).length > 0) - Number(emergencyReasons(a).length > 0);
  if (e) return e;
  const rank = (x: T) => Math.max(x.ai?.level ?? 0, ({ Critical: 4, High: 3, Medium: 2, Low: 1 } as Record<string, number>)[x.riskLevel ?? ''] ?? 0);
  const l = rank(b) - rank(a);
  if (l) return l;
  return new Date(a.filedAt).getTime() - new Date(b.filedAt).getTime();
}

// ── Correct reporting ────────────────────────────────────────────────────────

/**
 * Completeness is about how much the report says, not whether it is true: a
 * complete report is one with enough detail for a preliminary assessment.
 */
export function completenessOf(value: string | null | undefined): 'complete' | 'incomplete' | 'unassessed' {
  if (value === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT') return 'complete';
  if (value === 'PARTIAL' || value === 'INSUFFICIENT') return 'incomplete';
  return 'unassessed';
}

/**
 * The officer's last word on a case's category: confirmed as filed, moved to
 * the other desk (misrouted), or changed within the same desk.
 */
export function categoryVerdict(rows: { kind: string; caseType: string | null; previousCaseType: string | null }[]):
  'confirmed' | 'misrouted' | 'recategorized' | null {
  const last = rows.find(r => r.kind === 'category_confirm' || r.kind === 'category_change');
  if (!last) return null;
  if (last.kind === 'category_confirm') return 'confirmed';
  if (last.caseType && last.previousCaseType && deskOf(last.caseType) !== deskOf(last.previousCaseType)) return 'misrouted';
  return 'recategorized';
}

// ── Hearings ─────────────────────────────────────────────────────────────────

// The hearing rules live with Hearing Management; kept importable from here.
export {
  HEARING_STATUSES, HEARING_OUTCOMES, KP_STAGES, KP_STAGE_KEYS, hearingRefusal, nextStep,
  type HearingStatus, type HearingOutcome, type KpStage,
} from './hearings';

// ── Acknowledgement letters ──────────────────────────────────────────────────

export const ISSUE_METHODS = {
  IN_PERSON: 'Handed to the reporter in person',
  PRINTED_PICKUP: 'Printed for pick-up at the barangay hall',
  DIGITAL: 'Shared digitally with the reporter',
  OTHER: 'Other',
} as const;
export type IssueMethod = keyof typeof ISSUE_METHODS;

export const letterNumberFor = (caseNumber: string) => `ACK-${caseNumber}`;
