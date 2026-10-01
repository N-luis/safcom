import { analyseReport, type GbvAnalysis } from './gbvAnalysis';
import { EMERGENCY_CONTACTS, EMERGENCY_PRIORITY_THRESHOLD } from './safecommConfig';

/**
 * Multi-factor case triage.
 *
 * A single Low/Medium/High label hides the thing an officer actually needs:
 * *why*. A report can be serious but over, or minor but happening right now,
 * and one word cannot carry that. Six independent dimensions are scored from
 * what the report says, and the overall priority is a weighted combination of
 * them.
 *
 * What is deliberately NOT an input:
 *   - the case type. "Theft" does not make a case urgent; what happened does.
 *   - gender, or anything inferred about the person. Voluntarily given gender
 *     is used for wording only, never for scoring.
 *
 * This assists triage. It does not decide guilt, does not name anyone a victim
 * or an offender, gives no legal or medical opinion, and does not replace the
 * officer's review.
 */

export const IMMEDIATE_THREAT = ['None Identified', 'Possible', 'Present', 'Critical'] as const;
export const INCIDENT_SEVERITY = ['Minor', 'Moderate', 'Serious', 'Critical'] as const;
export const RECURRENCE = ['No Indication', 'Possible Recurrence', 'Repeated Incident', 'Ongoing Pattern'] as const;
export const VULNERABILITY = ['Standard', 'Increased', 'Significant', 'Critical'] as const;
export const ESCALATION_POTENTIAL = ['Low Concern', 'Monitor', 'Elevated', 'Urgent'] as const;
export const URGENCY = ['Routine', 'Attention Needed', 'Priority', 'Immediate Response'] as const;
export const CASE_PRIORITY = ['Routine', 'Priority Attention', 'Urgent Attention', 'Immediate Response'] as const;

export type ImmediateThreat = (typeof IMMEDIATE_THREAT)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITY)[number];
export type Recurrence = (typeof RECURRENCE)[number];
export type Vulnerability = (typeof VULNERABILITY)[number];
export type EscalationPotential = (typeof ESCALATION_POTENTIAL)[number];
export type Urgency = (typeof URGENCY)[number];
export type CasePriority = (typeof CASE_PRIORITY)[number];

export interface AssessmentFactors {
  immediateThreat: ImmediateThreat;
  incidentSeverity: IncidentSeverity;
  recurrence: Recurrence;
  vulnerability: Vulnerability;
  escalationPotential: EscalationPotential;
  urgency: Urgency;
}

export interface CaseRecommendation {
  audience: 'emergency' | 'resident' | 'officer';
  text: string;
}

export interface CaseAssessment {
  priority: CasePriority;
  factors: AssessmentFactors;
  /** Short, plain description of the situation as the report described it. */
  summary: string;
  /** Why this priority, in terms of the factors above. No internal detail. */
  reason: string;
  recommendations: CaseRecommendation[];
  safetyReminders: string[];
  /** Shown only when the configured threshold is reached. */
  emergencyContacts: { label: string; number: string }[];
  showEmergencyNotice: boolean;
  /** What the report left out that would change the reading. */
  missingInformation: string[];
  /** The underlying reading of the text, for officers who want the detail. */
  analysis: GbvAnalysis;
  assessedAt: string;
}

export interface AssessmentContext {
  /** Prior cases of the SAME type by this reporter - recurrence, not activity. */
  priorSameType?: number;
  /** Recent cases of this type in the same street, for escalation context. */
  areaRecentSameType?: number;
  /**
   * Voluntarily provided. Used for wording only; it never reaches the scoring.
   * Nothing infers it.
   */
  gender?: string | null;
}

const rank = <T extends readonly string[]>(scale: T, v: T[number]) => scale.indexOf(v);

// ─── Dimension scoring ───────────────────────────────────────────────────────

function scoreImmediateThreat(a: GbvAnalysis): ImmediateThreat {
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);
  const dangerNow = has('immediate-threat');
  const armed = has('weapon');
  const lethal = has('death-threat') || has('strangulation') || has('severe-violence');

  if (dangerNow && (armed || lethal)) return 'Critical';
  if (dangerNow) return 'Present';
  if (armed && lethal) return 'Present';
  if (armed || lethal || has('threats') || has('grave-threat') || has('threat-family')) return 'Possible';
  return 'None Identified';
}

function scoreSeverity(a: GbvAnalysis): IncidentSeverity {
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);
  if (has('severe-violence') || has('strangulation') || has('severe-injury')) return 'Critical';
  if (a.detectedFactors.some(d => d.tier === 'severe')) return 'Serious';
  if (has('physical-strike') && has('injury')) return 'Serious';
  if (a.detectedFactors.some(d => d.tier === 'moderate')) return 'Moderate';
  return 'Minor';
}

function scoreRecurrence(a: GbvAnalysis, ctx: AssessmentContext): Recurrence {
  const priors = Math.max(0, ctx.priorSameType ?? 0);
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);

  if (a.frequency === 'Ongoing' || a.frequency === 'Frequent' || priors >= 3) return 'Ongoing Pattern';
  if (a.frequency === 'Repeated' || priors >= 2 || has('previous-incident')) return 'Repeated Incident';
  if (priors === 1 || a.escalation === 'Present' || a.frequency === 'Occasional') return 'Possible Recurrence';
  return 'No Indication';
}

/**
 * Circumstances that make it harder for the person to get out of the situation.
 * Nothing here is inferred about who they are - it is all read from the report.
 */
function scoreVulnerability(a: GbvAnalysis): Vulnerability {
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);
  const dependent = has('vulnerable-person');
  const trapped = has('prevented-help') || has('restriction') || has('coercion');
  const isolated = has('knows-location') || has('stalking') || has('control');
  const severe = a.detectedFactors.some(d => d.tier === 'severe');

  if (dependent && severe) return 'Critical';
  if (dependent || trapped) return 'Significant';
  if (isolated || has('retaliation')) return 'Increased';
  return 'Standard';
}

function scoreEscalation(a: GbvAnalysis, ctx: AssessmentContext): EscalationPotential {
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);
  const worsening = a.escalation === 'Present';
  const severe = a.detectedFactors.some(d => d.tier === 'severe');
  const repeated = a.frequency === 'Repeated' || a.frequency === 'Frequent' || a.frequency === 'Ongoing';
  const area = Math.max(0, ctx.areaRecentSameType ?? 0);

  if (worsening && severe) return 'Urgent';
  if (worsening || (repeated && severe) || has('retaliation')) return 'Elevated';
  if (repeated || has('threats') || area >= 3) return 'Monitor';
  return 'Low Concern';
}

function scoreUrgency(threat: ImmediateThreat, severity: IncidentSeverity, esc: EscalationPotential): Urgency {
  if (threat === 'Critical') return 'Immediate Response';
  if (threat === 'Present' || severity === 'Critical' || esc === 'Urgent') return 'Priority';
  if (severity === 'Serious' || esc === 'Elevated') return 'Priority';
  if (severity === 'Moderate' || esc === 'Monitor' || threat === 'Possible') return 'Attention Needed';
  return 'Routine';
}

/**
 * The overall priority weighs the dimensions rather than taking the worst one,
 * so a single alarming word cannot carry a case on its own and a quiet report
 * with several converging factors is not missed.
 */
function scorePriority(f: AssessmentFactors): CasePriority {
  const weighted =
    rank(IMMEDIATE_THREAT, f.immediateThreat) * 3
    + rank(INCIDENT_SEVERITY, f.incidentSeverity) * 3
    + rank(ESCALATION_POTENTIAL, f.escalationPotential) * 2
    + rank(RECURRENCE, f.recurrence) * 2
    + rank(VULNERABILITY, f.vulnerability)
    + rank(URGENCY, f.urgency) * 2;

  if (f.immediateThreat === 'Critical' || f.urgency === 'Immediate Response' || weighted >= 28) {
    return 'Immediate Response';
  }
  // Urgency Priority is reached by a present threat, serious or critical harm,
  // or elevated escalation - any of which outranks the weighted total, which
  // can stay low when a single dimension carries the case on its own.
  if (f.incidentSeverity === 'Critical' || f.urgency === 'Priority' || weighted >= 16) {
    return 'Urgent Attention';
  }
  if (weighted >= 4) return 'Priority Attention';
  return 'Routine';
}

// ─── Wording ─────────────────────────────────────────────────────────────────

function buildSummary(a: GbvAnalysis, f: AssessmentFactors): string {
  const acts = a.detectedFactors.filter(d => d.tier === 'severe' || d.tier === 'moderate');
  const named = (acts.length ? acts : a.detectedFactors.filter(d => d.tier === 'low'))
    .map(d => d.label.toLowerCase());

  if (!named.length) {
    return 'The report does not contain wording that matches a known risk indicator. '
      + 'An officer will read it in full before deciding how it is handled.';
  }
  const list = named.length === 1
    ? named[0]
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;

  const recurrence = f.recurrence === 'No Indication'
    ? ''
    : f.recurrence === 'Ongoing Pattern'
      ? ' The report describes this as an ongoing pattern rather than a single incident.'
      : f.recurrence === 'Repeated Incident'
        ? ' The report describes this happening more than once.'
        : ' There are signs this could happen again.';

  const now = f.immediateThreat === 'Critical' || f.immediateThreat === 'Present'
    ? ' It also indicates a threat at the time of writing.'
    : '';

  return `Based on what was written, the report describes ${list}.${recurrence}${now}`;
}

function buildReason(f: AssessmentFactors, priority: CasePriority): string {
  const notable: string[] = [];
  if (f.immediateThreat !== 'None Identified') notable.push(`immediate threat assessed as ${f.immediateThreat}`);
  if (f.incidentSeverity !== 'Minor') notable.push(`incident severity assessed as ${f.incidentSeverity}`);
  if (f.recurrence !== 'No Indication') notable.push(`recurrence assessed as ${f.recurrence}`);
  if (f.vulnerability !== 'Standard') notable.push(`vulnerability assessed as ${f.vulnerability}`);
  if (f.escalationPotential !== 'Low Concern') notable.push(`escalation potential assessed as ${f.escalationPotential}`);

  if (!notable.length) {
    return `No factor rose above its baseline, so the case was assigned ${priority}. `
      + 'An authorized officer still reviews it.';
  }
  return `These factors contributed to the case being assigned ${priority}: ${notable.join('; ')}. `
    + 'The assessment reads only what the report itself says, and an authorized officer makes the final decision.';
}

function buildRecommendations(a: GbvAnalysis, f: AssessmentFactors, showEmergency: boolean): CaseRecommendation[] {
  const has = (id: string) => a.detectedFactors.some(d => d.id === id);
  const out: CaseRecommendation[] = [];
  const urgentNow = f.immediateThreat === 'Present' || f.immediateThreat === 'Critical';

  if (urgentNow) {
    out.push({
      audience: 'emergency',
      text: 'If you are in danger right now, contact the emergency numbers below before anything else. Do not wait for this case to be reviewed.',
    });
  } else if (showEmergency) {
    out.push({
      audience: 'emergency',
      text: 'If the situation becomes dangerous, contact the emergency numbers below rather than waiting for case processing.',
    });
  }

  // Evidence first: it is the single most useful thing a resident can do, and
  // it is as true of a minor case as a serious one.
  out.push({
    audience: 'resident',
    text: 'Keep anything that records what happened - messages, screenshots, photographs, receipts, medical or barangay documents.',
  });

  if (f.incidentSeverity !== 'Minor' || urgentNow) {
    out.push({
      audience: 'resident',
      text: 'Avoid confronting the person involved directly if that could make the situation worse.',
    });
  }
  if (urgentNow) {
    out.push({ audience: 'resident', text: 'Move somewhere safer if you can do so safely, and tell someone you trust where you are.' });
  }
  if (has('severe-injury') || has('injury')) {
    out.push({ audience: 'resident', text: 'Have any injury seen to, and keep the record of that visit.' });
  }
  if (has('knows-location') || has('stalking')) {
    out.push({ audience: 'resident', text: 'The report mentions being followed or the person knowing where you stay. Consider staying somewhere they do not for now.' });
  }
  if (has('prevented-help') || has('restriction')) {
    out.push({ audience: 'resident', text: 'Keep a charged phone within reach, and let a neighbour know they may need to call for help.' });
  }
  if (has('control')) {
    out.push({ audience: 'resident', text: 'Write down which documents or money are being withheld so the officer has it on record.' });
  }

  if (f.recurrence === 'Repeated Incident' || f.recurrence === 'Ongoing Pattern') {
    out.push({ audience: 'resident', text: 'Write down the earlier incidents with dates if you can remember them, and add them to this case.' });
    out.push({ audience: 'officer', text: `Repeated incidents identified - recurrence assessed as ${f.recurrence}.` });
  }
  if (f.escalationPotential === 'Elevated' || f.escalationPotential === 'Urgent') {
    out.push({ audience: 'officer', text: `Escalation potential assessed as ${f.escalationPotential} - coordinate with the reporter promptly.` });
  }
  if (has('retaliation')) {
    out.push({ audience: 'officer', text: 'A threat of reprisal for reporting is described - handle the reporter’s details accordingly.' });
  }
  if (has('vulnerable-person')) {
    out.push({ audience: 'officer', text: 'A minor or dependent person is described - consider a VAWC or child-protection referral.' });
  }

  out.push({
    audience: 'resident',
    text: urgentNow
      ? 'Keep your case number for reference.'
      : 'Keep your case number and follow the case under My Cases. Add anything further if an officer asks.',
  });
  out.push({
    audience: 'officer',
    text: `Case priority assessed as ${f.urgency === 'Immediate Response' ? 'Immediate Response' : f.urgency}. This has not been reviewed by anyone yet.`,
  });

  return out.slice(0, 10);
}

function buildSafetyReminders(f: AssessmentFactors, urgentNow: boolean): string[] {
  const reminders = [
    'This assessment is produced from the words in your report. It assists triage only and does not replace a review by an authorized officer.',
    'It does not decide who is at fault, and it is not legal or medical advice.',
  ];
  if (urgentNow) {
    reminders.unshift('Your safety comes before this case. If you are in danger, get help first.');
  } else if (f.recurrence !== 'No Indication') {
    reminders.push('If the situation happens again or changes, update the case so the officer sees the pattern.');
  }
  return reminders;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function assessCase(description: string, ctx: AssessmentContext = {}): CaseAssessment {
  const analysis = analyseReport(description);

  const immediateThreat = scoreImmediateThreat(analysis);
  const incidentSeverity = scoreSeverity(analysis);
  const recurrence = scoreRecurrence(analysis, ctx);
  const vulnerability = scoreVulnerability(analysis);
  const escalationPotential = scoreEscalation(analysis, ctx);
  const urgency = scoreUrgency(immediateThreat, incidentSeverity, escalationPotential);

  const factors: AssessmentFactors = {
    immediateThreat, incidentSeverity, recurrence, vulnerability, escalationPotential, urgency,
  };
  const priority = scorePriority(factors);

  const showEmergencyNotice =
    rank(CASE_PRIORITY, priority) >= rank(CASE_PRIORITY, EMERGENCY_PRIORITY_THRESHOLD as CasePriority);
  const urgentNow = immediateThreat === 'Present' || immediateThreat === 'Critical';

  return {
    priority,
    factors,
    summary: buildSummary(analysis, factors),
    reason: buildReason(factors, priority),
    recommendations: buildRecommendations(analysis, factors, showEmergencyNotice),
    safetyReminders: buildSafetyReminders(factors, urgentNow),
    emergencyContacts: showEmergencyNotice ? EMERGENCY_CONTACTS : [],
    showEmergencyNotice,
    missingInformation: analysis.missingInformation,
    analysis,
    assessedAt: new Date().toISOString(),
  };
}

/** The Low/Medium/High the rest of the app still stores on the case row. */
export function priorityToRiskLevel(priority: CasePriority): 'Low' | 'Medium' | 'High' {
  if (priority === 'Immediate Response' || priority === 'Urgent Attention') return 'High';
  if (priority === 'Priority Attention') return 'Medium';
  return 'Low';
}
