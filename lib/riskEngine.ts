import { analyseReport, type GbvAnalysis } from './gbvAnalysis';
export interface FactorScore {
  factor: string;
  weight: number;
  score: number;
  contribution: number;
  detail: string;
}

export interface RiskResult {
  score: number;
  level: 'High' | 'Medium' | 'Low';
  factors: FactorScore[];
  riskFactors: string[];
  justification: string;
  recommendation: string;
  confidence: number;
  highRiskZone: boolean;
  /**
   * The contextual reading of the report itself: which behaviours were found,
   * how often, whether it is escalating, and whether anyone is in danger now.
   * This is what drives the level; the numeric score above stays informational.
   */
  assessment: GbvAnalysis;
}

export interface ScoringInput {
  caseType: string;
  barangay: string;
  description: string;
  filedAt: Date | string;
  residentId: string | null;
  status: string;
  barangayCaseCount: number;
  residentPriorCases: number;
  // Explicit context — provided by resident report form; derived from keywords when absent
  /**
   * Prior cases of the SAME case type for this reporter. Recurrence means the
   * same incident happening again; counting every report the person has ever
   * filed would mark an active reporter's unrelated noise complaint as High.
   */
  residentPriorSameType?: number;
  minorsInvolved?: boolean;
  physicalHarm?: boolean;
  recurring?: boolean;
  highRiskAreaCaseCount?: number; // High-Risk cases in same barangay + same type (last 30 days)
}

// ── Type severity lookup ─────────────────────────────────────────────────────
const TYPE_SEVERITY: [string, number][] = [
  ['homicide', 98], ['rape', 97], ['assault', 95], ['battery', 92],
  ['drug', 90], ['robbery', 82], ['theft', 72], ['domestic', 70],
  ['cyber', 65], ['fraud', 60], ['trespassing', 45], ['nuisance', 32],
  ['vandalism', 28], ['noise', 20],
];

function getTypeSeverity(caseType: string): { score: number; label: string } {
  const lower = caseType.toLowerCase();
  for (const [kw, score] of TYPE_SEVERITY) {
    if (lower.includes(kw)) {
      const label = score >= 85 ? 'critical severity' : score >= 65 ? 'high severity' : score >= 45 ? 'moderate severity' : 'low severity';
      return { score, label };
    }
  }
  return { score: 50, label: 'moderate severity' };
}

// ── Description severity lookup ───────────────────────────────────────────────
const DESCRIPTION_SEVERITY: { score: number; label: string; keywords: string[] }[] = [
  {
    score: 96,
    label: 'life-threatening / weapon involved',
    keywords: [
      'gun', 'baril', 'binaril', 'shot him', 'shot her', 'shoot',
      'knife', 'kutsilyo', 'patalim', 'sinaksak', 'stab', 'stabbed',
      'pumatay', 'patayin', 'papatayin', 'killed', 'kill her', 'kill him',
      'namatay', 'died', 'dead body', 'unconscious', 'walang malay', 'hindi humihinga',
      'malubhang sugat', 'profusely bleeding', 'tumutulo ang dugo', 'dumudugo',
    ],
  },
  {
    score: 80,
    label: 'serious injury / sexual assault / direct threat',
    keywords: [
      'rape', 'ginahasa', 'ginalaw', 'hinalay', 'sexually abused', 'pinagsamantalahan', 'molested',
      'binugbog', 'beaten', 'sinapok', 'sinuntok', 'sinampal', 'pinalo',
      'nasugatan', 'injured', 'wounded', 'sugat',
      'banta ng kamatayan', 'threatened to kill', 'death threat', 'may hawak na sandata', 'armed with',
      'sunog', 'arson', 'sinunog', 'fire',
    ],
  },
  {
    score: 55,
    label: 'physical altercation / forceful taking / harassment',
    keywords: [
      'snatch', 'snatched', 'nasnatch', 'hinablot', 'inagaw', 'agawan',
      'hinampas', 'sinaktan', 'hit me', 'hit her', 'hit him', 'sinipa', 'tinulak', 'pushed',
      'forced entry', 'pinasok', 'break-in', 'broke in', 'ninakawan habang', 'held at',
      'harassed', 'nanghaharass', 'sinusundan', 'stalking', 'sexual harassment',
    ],
  },
  {
    score: 30,
    label: 'verbal dispute / minor incident',
    keywords: [
      'verbal argument', 'nagtalo', 'away', 'sigawan', 'shouting', 'inis',
      'noise complaint', 'maingay', 'nawalan', 'lost item', 'nawala',
      'nakipag-away', 'nag-away',
    ],
  },
];

function getDescriptionSeverity(desc: string): { score: number; label: string; matched: string | null } {
  const lower = desc.toLowerCase();
  for (const tier of DESCRIPTION_SEVERITY) {
    const hit = tier.keywords.find(kw => lower.includes(kw));
    if (hit) return { score: tier.score, label: tier.label, matched: hit };
  }
  return { score: 35, label: 'no high-risk language detected', matched: null };
}

// Detect minor/child keywords in free-text description
function detectMinorsInDescription(desc: string): boolean {
  const lower = desc.toLowerCase();
  return ['minor', 'child', 'bata', 'anak', 'underage', 'juvenile', 'teen', 'teenager', 'baby', 'infant', 'toddler'].some(kw => lower.includes(kw));
}



// Detect active/pending legal case keywords
function detectLegalCaseInDescription(desc: string): boolean {
  const lower = desc.toLowerCase();
  return ['restraining order', 'protection order', 'pending case', 'legal case', 'court order', 'warrant', 'filed a case', 'may kaso'].some(kw => lower.includes(kw));
}

// ── Main scoring function ─────────────────────────────────────────────────────
export function computeRisk(input: ScoringInput): RiskResult {
  const factors: FactorScore[] = [];
  const filedDate = new Date(input.filedAt);

  // Factor 1: Case type severity (25%)
  const { score: typeSev, label: typeLabel } = getTypeSeverity(input.caseType);
  factors.push({
    factor: 'Case Type Severity',
    weight: 25,
    score: typeSev,
    contribution: Math.round(typeSev * 0.25),
    detail: `"${input.caseType}" classified as ${typeLabel} (${typeSev}/100)`,
  });

  // Factor 2: Incident description analysis (20%)
  const { score: descSev, label: descLabel, matched: descMatch } = getDescriptionSeverity(input.description ?? '');
  factors.push({
    factor: 'Incident Description',
    weight: 20,
    score: descSev,
    contribution: Math.round(descSev * 0.20),
    detail: descMatch
      ? `Mentions "${descMatch}" — ${descLabel}`
      : `Shows ${descLabel}`,
  });

  // Factor 3: Prior case history (20%)
  const priorN = Math.max(0, input.residentPriorCases);
  const repeatScore = priorN === 0 ? 5 : priorN === 1 ? 45 : priorN === 2 ? 68 : Math.min(95, 68 + (priorN - 2) * 9);
  factors.push({
    factor: 'Prior Case History',
    weight: 20,
    score: repeatScore,
    contribution: Math.round(repeatScore * 0.20),
    detail: priorN === 0
      ? 'No prior records on file'
      : `${priorN} prior case${priorN > 1 ? 's' : ''} linked to this resident`,
  });

  // Factor 4: Area incident frequency (15%)
  const cnt = Math.max(0, input.barangayCaseCount);
  const hotScore = cnt >= 15 ? 95 : cnt >= 10 ? 80 : cnt >= 6 ? 62 : cnt >= 3 ? 38 : 12;
  factors.push({
    factor: 'Area Incident Frequency',
    weight: 15,
    score: hotScore,
    contribution: Math.round(hotScore * 0.15),
    detail: `${cnt} case${cnt !== 1 ? 's' : ''} in ${input.barangay} (last 30 days)`,
  });

  // Factor 5: Response urgency (12%)
  const daysOpen = (Date.now() - filedDate.getTime()) / 86_400_000;
  let ageScore = 30;
  let ageDetail = `${Math.round(daysOpen)}d open — within SLA`;
  if (input.status === 'Resolved' || input.status === 'Closed') {
    ageScore = 5; ageDetail = `Case ${input.status.toLowerCase()} — no urgency`;
  } else if (daysOpen > 45) {
    ageScore = 95; ageDetail = `${Math.round(daysOpen)}d open — severely overdue`;
  } else if (daysOpen > 30) {
    ageScore = 80; ageDetail = `${Math.round(daysOpen)}d open — overdue`;
  } else if (daysOpen > 14) {
    ageScore = 55; ageDetail = `${Math.round(daysOpen)}d open — approaching SLA limit`;
  } else if (input.status === 'In Progress') {
    ageScore = 20; ageDetail = `Actively being processed`;
  }
  factors.push({
    factor: 'Response Urgency',
    weight: 12,
    score: ageScore,
    contribution: Math.round(ageScore * 0.12),
    detail: ageDetail,
  });

  // Factor 6: Incident time-of-day (8%)
  const hour = filedDate.getHours();
  const isNight = hour >= 22 || hour < 4;
  const isLateEvening = hour >= 20 || hour < 6;
  const timeScore = isNight ? 90 : isLateEvening ? 52 : 12;
  factors.push({
    factor: 'Incident Time',
    weight: 8,
    score: timeScore,
    contribution: Math.round(timeScore * 0.08),
    detail: `Filed at ${String(hour).padStart(2, '0')}:00 — ${isNight ? 'high-risk hours (10pm–4am)' : isLateEvening ? 'late-evening window' : 'daytime hours'}`,
  });

  // Composite score (informational — not used for level assignment)
  const score = Math.min(100, factors.reduce((s, f) => s + f.contribution, 0));

  // ── Rule-based classification (framework) ────────────────────────────────────
  // Derive implicit values from description/history when not explicitly provided
  // Each falls back to reading the report when the caller does not assert it.
  // The resident form no longer asks; the officer walk-in form may still pass
  // what the complainant stated at the desk.
  // Reading harm and recurrence out of the text is the contextual analysis's
  // job now: it grades them, so a single push lands Medium while strangulation
  // or a weapon lands High. A flat text match here would push both to High.
  const hasPhysicalHarm = input.physicalHarm ?? false;
  const hasMinors       = input.minorsInvolved ?? detectMinorsInDescription(input.description ?? '');
  const sameTypeN = Math.max(0, input.residentPriorSameType ?? 0);
  const isRecurring     = input.recurring ?? (sameTypeN >= 2);
  const hasLegalCase    = detectLegalCaseInDescription(input.description ?? '');
  const hrAreaCount     = Math.max(0, input.highRiskAreaCaseCount ?? 0);
  const isHighRiskZone  = hrAreaCount >= 3;

  // The report's own content, read in context rather than by single keyword.
  const gbv = analyseReport(input.description ?? '');

  // Evaluate High-Risk triggers
  const highTriggers: string[] = [];
  if (gbv.level === 'High') {
    // Name the behaviours found rather than a generic phrase, so an officer can
    // see what the classification rests on.
    highTriggers.push(...gbv.detectedFactors
      .filter(f => f.tier === 'severe' || f.tier === 'moderate')
      .map(f => f.label));
  }
  if (hasPhysicalHarm)   highTriggers.push('Physical harm reported by the complainant');
  if (hasMinors)         highTriggers.push('Minors or highly vulnerable individuals involved');
  if (isRecurring)       highTriggers.push(`Recurring incident — ${sameTypeN} prior ${input.caseType} cases on record`);
  if (hasLegalCase)      highTriggers.push('Active or pending legal case referenced');
  // descSev is not a trigger on its own: one severe-sounding word is exactly
  // the single-keyword classification the contextual reading above replaces.
  if (isHighRiskZone)    highTriggers.push(`High-Risk Zone: ${hrAreaCount} similar High-Risk cases already filed in ${input.barangay}`);

  // Evaluate Medium-Risk indicators
  const mediumIndicators: string[] = [];
  if (priorN === 1)      mediumIndicators.push('Limited prior case history');
  if (descSev >= 45 && descSev < 80) mediumIndicators.push('Verbal or emotional abuse indicators in description');
  if (cnt >= 2)          mediumIndicators.push(`${cnt} cases reported in area recently`);
  if (gbv.level === 'Medium') {
    mediumIndicators.push(...gbv.detectedFactors.map(f => f.label));
  }

  const isHigh   = highTriggers.length > 0;
  // Deliberately NOT keyed off the case type or its severity: a category such
  // as "Theft" or "VAWC" says nothing about how dangerous this report is. The
  // level comes from what the report describes, plus history and area density.
  const isMedium = !isHigh && (gbv.level === 'Medium' || priorN >= 1 || cnt >= 2);
  const level: 'High' | 'Medium' | 'Low' = isHigh ? 'High' : isMedium ? 'Medium' : 'Low';

  const riskFactors = isHigh
    ? highTriggers
    : isMedium
    ? mediumIndicators.length > 0
      ? mediumIndicators
      : ['Moderate severity with limited aggravating factors']
    : ['Isolated incident — no physical harm, prior history, vulnerable individuals, or recurrence detected'];

  // Prefer the reading of the report; fall back to the contextual triggers when
  // the level was raised by history or area density rather than the text.
  const justification = gbv.detectedFactors.length
    ? gbv.reason
    : isHigh
      ? `Classified as High Risk — ${highTriggers[0].toLowerCase()}.`
      : isMedium
        ? 'Classified as Medium Risk — prior case history or recent incidents in the area.'
        : 'Classified as Low Risk — no risk indicators identified in the report.';

  // Confidence: converging factors → higher confidence
  const factorLevels = factors.map(f => (f.score >= 70 ? 2 : f.score >= 40 ? 1 : 0));
  const spread = Math.max(...factorLevels) - Math.min(...factorLevels);
  const confidence = spread <= 1 ? 92 : spread === 2 ? 78 : 64;

  const recommendations: Record<'High' | 'Medium' | 'Low', string> = {
    High: 'Prioritize immediately — assign officer, notify supervisor, and activate intervention protocol',
    Medium: 'Schedule follow-up and case review within 72 hours',
    Low: 'Standard processing — routine monitoring applies',
  };

  return {
    score,
    level,
    factors,
    riskFactors,
    justification,
    recommendation: recommendations[level],
    confidence,
    highRiskZone: isHighRiskZone,
    // The level the engine returns can be raised above the text-only reading by
    // history or area density, so report the final one rather than gbv.level.
    // The level can be raised above the text-only reading by history or area
    // density; the recommended review has to move with it, or the card would
    // show "High" next to "Routine Review".
    assessment: {
      ...gbv,
      level,
      recommendedReview:
        level === 'High' ? 'Urgent Human Review'
          : level === 'Medium' && gbv.recommendedReview === 'Routine Review' ? 'Priority Review'
            : gbv.recommendedReview,
    },
  };
}
