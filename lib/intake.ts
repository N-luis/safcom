/**
 * Assisted intake: what a report already says, what it leaves out, and the
 * one question most worth asking next.
 *
 * WHAT THIS IS. A rule-based reading of the resident's own words, built on
 * the same grounded classifier the rest of SafeComm uses (lib/caseClassification
 * - including its negation guard). It is deterministic: the same narrative and
 * answers always produce the same questions and the same result, and every
 * fact it reports can be traced to a quote or to an answer the resident gave.
 * On its own it calls no language model. When the AI reader is configured
 * (lib/aiClassifier.ts), its reading arrives here as `input.ai`: facts named
 * in this file's own vocabulary, each with the resident's exact words, already
 * checked against the report. They are added to what the rules found - never
 * removing anything - and the same matrices then decide the category and the
 * level. The model never sets a level directly.
 *
 * THE FOUR THINGS IT KEEPS APART
 *   - completeness: how much is known. Never a risk level.
 *   - suggested category: what the words describe. Never the dropdown alone.
 *   - risk level: from stated facts and the documented hard rules only.
 *   - unknowns: kept as unknown. Missing is not "safe" and is not "dangerous".
 *
 * Everything here is preliminary. Officers review it; the resident's original
 * narrative and chosen category are kept unchanged beside it.
 */

import {
  classifyCase, enforceHardRules, mentions, type Classification, type TermGroup,
} from './caseClassification';
import { assessCase, priorityToRiskLevel, type CaseAssessment } from './caseAssessment';
import { detectLanguageSafe, type ReportLanguage } from './detectLanguage';
import {
  evaluateMatrix, queueLevelFor, MATRICES,
  type Facts, type Framework, type MatchedIndicator,
} from './riskMatrices';
import {
  matchCategories, needsReviewCategory, categoryByName, MATRIX_VERSION, type Signal, type CategoryMeta,
} from './classificationSchema';

export const INTAKE_ENGINE_VERSION = 'safecomm-intake-rules/2.0';

/** Questions are never repeated, so this is also the most that can be asked. */
export const MAX_QUESTIONS = 10;

/**
 * A narrative this long is treated as describing the circumstances, so the
 * "what happened before and how" question is not asked. Counted in words of
 * the resident's own text; documented here so the threshold can be argued
 * with rather than discovered.
 */
export const CONTEXT_MIN_WORDS = 20;

/** Share of the relevant supporting questions that must be known for SUFFICIENT. */
export const SUFFICIENT_SUPPORTING_SHARE = 0.6;

export type Completeness = 'INSUFFICIENT' | 'PARTIAL' | 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type SlotId =
  | 'safety' | 'act' | 'context' | 'injury' | 'injuryCare'
  | 'weapon' | 'children' | 'recurrence' | 'statements' | 'priorReport';

/** Asked in this order; a slot is only asked while it is relevant and unknown. */
export const SLOT_ORDER: SlotId[] = [
  'safety', 'act', 'context', 'injury', 'injuryCare', 'weapon', 'children', 'recurrence', 'statements', 'priorReport',
];

const ESSENTIAL: SlotId[] = ['safety', 'act', 'context'];

/**
 * An answer to one question. `value` is the plain meaning of the slot's
 * question - "yes" to the safety question means "yes, there is danger now".
 */
export interface IntakeAnswer {
  slot: SlotId;
  kind: 'option' | 'text' | 'skipped' | 'declined';
  value?: 'yes' | 'no' | 'unsure';
  /** Free text the resident typed, if any. Kept verbatim. */
  text?: string;
}

export type SlotStatus = 'known' | 'unknown' | 'unsure' | 'skipped' | 'declined';

export interface SlotState {
  id: SlotId;
  label: string;
  relevant: boolean;
  essential: boolean;
  /** What is known. 'unknown' whenever nothing the resident said settles it. */
  value: 'yes' | 'no' | 'unknown';
  status: SlotStatus;
  source: 'report' | 'answer' | null;
  /** The resident's own words, when the value came from them. */
  quote?: string;
}

export interface IntakeQuestion {
  slot: SlotId;
  text: string;
  options: { value: 'yes' | 'no' | 'unsure'; label: string }[];
  allowText: boolean;
  textPlaceholder: string;
}

export interface SupportingIndicator {
  label: string;
  quote: string;
  /** Always a report by the resident - nothing here has been verified. */
  source: 'report' | 'answer';
}

export interface IntakeResult {
  engineVersion: string;
  language: ReportLanguage;
  /** Shown once, before the first question. */
  intro: string;

  informationCompleteness: Completeness;
  completenessExplanation: string;
  slots: SlotState[];
  nextQuestion: IntakeQuestion | null;
  questionsAsked: number;

  immediateSafetyConcern: boolean;
  safetyReasons: string[];

  selectedCategory: string | null;
  /**
   * Always a category from the matrix. When nothing supports one, this is the
   * needs-review entry ("Other", or "VAWC - Other" when the report involves a
   * partner, family, a child or sexual conduct) and the status says so.
   */
  suggestedCaseCategory: string;
  classificationStatus: 'suggested' | 'needs_review';
  /**
   * How much of the category's definition the report itself supports.
   * Qualitative and NOT a calibrated probability: 'high' = two or more of the
   * category's facts are stated and the essentials are known; 'medium' = it
   * matched but on less; 'low' = needs review. Never shown as a percentage.
   */
  categoryConfidence: 'high' | 'medium' | 'low';
  categoryRationale: string[];
  /** Facts the report cannot settle, which an officer must confirm. */
  officerToConfirm: string[];
  matrixVersion: string;
  /** Things that do not agree with each other - both sides kept. */
  conflicts: string[];
  route: 'VAWC' | 'Blotter';

  /**
   * The level the rest of SafeComm queues by (Low/Medium/High/Critical). Set
   * from the matrix level when a criterion is met, or by a documented safety
   * rule (e.g. "I am not safe right now"); see matrixLevel for the matrix's
   * own five-level answer and label. NULL when neither applies: the risk is
   * undetermined. It used to fall back to a keyword reading, which filed a
   * short report as "Low" - an unknown risk is not a low one.
   */
  riskLevel: RiskLevel | null;
  /**
   * matrix_criteria - a criterion in the matrix is met by what was reported.
   * not_covered_by_matrix - enough is known, but the matrix has no criterion
   *   for it (e.g. economic abuse, a water outage); an officer decides.
   * insufficient_information - too little is known to apply the matrix.
   */
  riskBasis: 'matrix_criteria' | 'not_covered_by_matrix' | 'insufficient_information';

  /** Which matrix applied: the VAWC desk's or the blotter's. */
  framework: Framework;
  frameworkDocument: string;
  /** What the document says it is - an operational framework, not law. */
  frameworkStatus: string;
  /** 1-5 on that matrix, or null when no criterion is met. */
  matrixLevel: number | null;
  /** The level's label exactly as the document gives it. */
  matrixLabel: string | null;
  /** Each criterion met, in the document's words, with the resident's words for it. */
  matchedCriteria: MatchedIndicator[];
  /**
   * NEEDS_MORE_INFORMATION - no criterion met yet.
   * FOR_REVIEW - a level is supported, but the category is unclear or the
   *   report contradicts itself.
   * PRELIMINARY - a level is supported by a met criterion. Still for an
   *   officer to confirm; never a finding.
   */
  assessmentStatus: 'NEEDS_MORE_INFORMATION' | 'PRELIMINARY' | 'FOR_REVIEW';
  /** Other categories the report could also fit, best first. */
  alternativeCategories: string[];
  /** Unknowns that, once answered, could move the matrix level. */
  levelCaveats: string[];
  riskRationale: string[];
  rulesApplied: string[];
  supportingIndicators: SupportingIndicator[];

  missingInformation: string[];
  notAnswered: string[];
  recommendedNextSteps: string[];

  requiresOfficerReview: boolean;
  reviewReasons: string[];

  /** Whether the AI reader's checked facts were part of this reading. Set on the server. */
  aiAssist?: { used: boolean; model: string | null };
}

// ─── Wording ─────────────────────────────────────────────────────────────────

type Lang = 'tl' | 'en';

const LABEL: Record<SlotId, Record<Lang, string>> = {
  safety:      { tl: 'Kung may panganib ngayon', en: 'Whether anyone is in danger now' },
  act:         { tl: 'Kung ano ang ginawa', en: 'What was done' },
  context:     { tl: 'Paano at bakit ito nangyari, ayon sa nakita mo', en: 'How it happened and what came before' },
  injury:      { tl: 'Kung may nasaktan', en: 'Whether anyone was hurt' },
  injuryCare:  { tl: 'Kung kailangan ng medikal na tulong', en: 'Whether medical help is needed' },
  weapon:      { tl: 'Kung may armas', en: 'Whether a weapon was present or used' },
  children:    { tl: 'Kung may batang naroon', en: 'Whether children were present' },
  recurrence:  { tl: 'Kung nangyari na ito dati', en: 'Whether this has happened before' },
  statements:  { tl: 'Ang sinabi ng mga sangkot', en: 'What the people involved said' },
  priorReport: { tl: 'Kung naiulat na ito dati', en: 'Whether it was reported before' },
};

const QUESTION: Record<SlotId, Record<Lang, {
  text: string; yes?: string; no?: string; unsure?: string; placeholder: string; text_only?: boolean;
}>> = {
  safety: {
    tl: { text: 'Ligtas ka ba ngayon, o may panganib na maulit agad ang pananakit?',
      yes: 'Hindi ako ligtas ngayon', no: 'Ligtas ako ngayon', unsure: 'Hindi ako sigurado',
      placeholder: 'Halimbawa: nasa bahay pa siya, o nasa ibang lugar na ako' },
    en: { text: 'Are you safe right now, or is there a risk it could happen again soon?',
      yes: 'I am not safe right now', no: 'I am safe right now', unsure: 'I am not sure',
      placeholder: 'For example: they are still here, or I am somewhere else now' },
  },
  act: {
    tl: { text: 'Ano ang nangyari? Ilarawan sa sarili mong salita kung ano ang ginawa o ang nakita mo.',
      placeholder: 'Isulat lamang ang alam mo', text_only: true },
    en: { text: 'What happened? In your own words, describe what was done or what you saw.',
      placeholder: 'Write only what you know', text_only: true },
  },
  context: {
    tl: { text: 'Maaari mo bang ilarawan kung paano ito nangyari, at kung ano ang nangyari bago at pagkatapos nito?',
      placeholder: 'Halimbawa: kailan, saan, ano ang nangyari bago, at ano ang ginawa pagkatapos', text_only: true },
    en: { text: 'Could you describe how it happened, and what happened just before and after?',
      placeholder: 'For example: when, where, what led up to it, and what happened afterwards', text_only: true },
  },
  injury: {
    tl: { text: 'May nasaktan ba? Kung mayroon, saan at gaano kalala?',
      yes: 'Oo, may nasaktan', no: 'Walang nasaktan', unsure: 'Hindi ako sigurado',
      placeholder: 'Halimbawa: may pasa sa braso' },
    en: { text: 'Was anyone hurt? If so, where and how badly?',
      yes: 'Yes, someone was hurt', no: 'No one was hurt', unsure: 'I am not sure',
      placeholder: 'For example: a bruise on the arm' },
  },
  injuryCare: {
    tl: { text: 'Kailangan ba ngayon ng medikal na tulong ang nasaktan?',
      yes: 'Oo, kailangan ng tulong', no: 'Hindi na kailangan', unsure: 'Hindi ako sigurado',
      placeholder: '' },
    en: { text: 'Does the person who was hurt need medical help now?',
      yes: 'Yes, medical help is needed', no: 'No, not needed', unsure: 'I am not sure',
      placeholder: '' },
  },
  weapon: {
    tl: { text: 'May hawak o ginamit bang armas o anumang bagay na pananakit (hal. kutsilyo, baril)?',
      yes: 'Oo, mayroon', no: 'Wala', unsure: 'Hindi ako sigurado',
      placeholder: 'Kung mayroon, ano ito?' },
    en: { text: 'Was a weapon or any object used or held to hurt or threaten (e.g. a knife or gun)?',
      yes: 'Yes', no: 'No', unsure: 'I am not sure',
      placeholder: 'If yes, what was it?' },
  },
  children: {
    tl: { text: 'May mga bata ba sa bahay o nakasaksi nang mangyari ito?',
      yes: 'Oo, may mga bata', no: 'Walang bata', unsure: 'Hindi ako sigurado',
      placeholder: '' },
    en: { text: 'Were there children in the home or who saw it happen?',
      yes: 'Yes, there were children', no: 'No children', unsure: 'I am not sure',
      placeholder: '' },
  },
  recurrence: {
    tl: { text: 'Nangyari na ba ito dati?',
      yes: 'Oo, nangyari na dati', no: 'Ito ang unang beses', unsure: 'Hindi ako sigurado',
      placeholder: 'Kung oo, gaano kadalas?' },
    en: { text: 'Has this happened before?',
      yes: 'Yes, it has happened before', no: 'This is the first time', unsure: 'I am not sure',
      placeholder: 'If yes, how often?' },
  },
  // What was said or done, as the resident heard or saw it - never a guess at
  // why. Asking someone to explain another person's motive invites them to
  // speculate, and a speculation would then sit on the record as a fact.
  statements: {
    tl: { text: 'May sinabi ba ang taong sangkot bago, habang, o pagkatapos itong mangyari? Isulat lamang ang narinig o nakita mo.',
      placeholder: 'Halimbawa: ang eksaktong sinabi niya, kung naaalala mo', text_only: true },
    en: { text: 'Did the person involved say anything before, during or after it happened? Write only what you heard or saw.',
      placeholder: 'For example: what they said, as closely as you remember', text_only: true },
  },
  priorReport: {
    tl: { text: 'Naipagbigay-alam na ba ito sa barangay, pulis, o ibang awtoridad?',
      yes: 'Oo, naiulat na', no: 'Hindi pa', unsure: 'Hindi ako sigurado',
      placeholder: 'Kung oo, saan at kailan?' },
    en: { text: 'Has this been reported to the barangay, police or another authority before?',
      yes: 'Yes, it was reported', no: 'Not yet', unsure: 'I am not sure',
      placeholder: 'If yes, where and when?' },
  },
};

/**
 * Asked instead of the safety question above when nothing describes harm.
 * "May panganib na maulit ang pananakit?" put to someone reporting a noisy
 * videoke assumed a hurt that nobody had mentioned.
 */
/**
 * The safety question when the report is about someone else: the reporter is
 * not assumed to be the person harmed, and may only know part of it.
 */
const OTHERS_SAFETY: Record<Lang, { text: string; yes: string; no: string; unsure: string }> = {
  tl: { text: 'Sa pagkakaalam mo, may tao bang nasa panganib ngayon, o maaaring maulit agad ang pananakit?',
    yes: 'Oo, may maaaring nasa panganib ngayon', no: 'Wala, ligtas sila ngayon', unsure: 'Hindi ko alam' },
  en: { text: 'As far as you know, is anyone in danger right now, or could it happen again soon?',
    yes: 'Yes, someone may be in danger now', no: 'No, they are safe now', unsure: "I don't know" },
};

const NEUTRAL_SAFETY: Record<Lang, string> = {
  tl: 'Mayroon bang panganib sa iyo o sa iba ngayon dahil dito?',
  en: 'Is anyone in danger right now because of this?',
};

/** "Reported before" is not something the classifier reads, so it is read here. */
const PRIOR_REPORT_NO = /\b(?:hindi pa|wala pang|hindi ko pa|never|not yet|haven'?t|have not)\b[^.!?]{0,40}\b(?:naiulat|nai-?report|ni-?report|nireport|nagsumbong|isinumbong|reported)/i;
const PRIOR_REPORT_YES = /\b(?:naiulat na|nai-?report na|nireport ko na|ni-?report ko na|nagsumbong na|isinumbong na|nag-?report na|reported (?:it )?(?:before|already)|already reported)\b/i;

const INTRO: Record<Lang, string> = {
  tl: 'Naiintindihan ko. Para mas maunawaan ang nangyari at maitala nang tama ang iyong report, '
    + 'may ilang tanong ako. Sagutin lamang ang mga tanong na komportable at ligtas para sa iyo — '
    + 'maaari mong laktawan ang anumang tanong, at maaari kang mag-submit anumang oras.',
  en: 'Thank you for telling us. To understand what happened and record your report correctly, '
    + 'I have a few questions. Answer only what feels comfortable and safe — you can skip any '
    + 'question, and you can submit at any time.',
};

// ─── Category suggestion ────────────────────────────────────────────────────

/** How each fact reads when it is given as a reason. */
const SIGNAL_LABEL: Record<Signal, Record<Lang, string>> = {
  force: { tl: 'May inilarawang pisikal na pananakit', en: 'Physical force is described' },
  threat: { tl: 'May inilarawang banta', en: 'A threat is described' },
  injury: { tl: 'May nasaktan', en: 'Someone was hurt' },
  weapon: { tl: 'May armas', en: 'A weapon was present or used' },
  partner: { tl: 'Ang taong tinutukoy ay asawa o kapareha', en: 'The person named is a spouse or partner' },
  family: { tl: 'Ang taong tinutukoy ay kapamilya', en: 'The person named is a family member' },
  neighbors: { tl: 'Ang taong tinutukoy ay kapitbahay', en: 'The person named is a neighbour' },
  minor: { tl: 'May batang binanggit', en: 'A child is mentioned' },
  sexualViolence: { tl: 'May inilarawang sekswal na karahasan', en: 'Sexual violence is described' },
  harassment: { tl: 'May inilarawang hindi kanais-nais na sekswal na asal', en: 'Unwanted sexual conduct is described' },
  stalking: { tl: 'May inilarawang paulit-ulit na pagsunod o pagmamanman', en: 'Repeated following or watching is described' },
  trafficking: { tl: 'May inilarawang pagbebenta o sapilitang pagtatrabaho', en: 'Sale or forced work is described' },
  economicAbuse: { tl: 'May inilarawang pagkakait ng pera o sustento', en: 'Money or support being withheld is described' },
  emotionalAbuse: { tl: 'May inilarawang pang-iinsulto o pagkontrol', en: 'Insults, humiliation or control are described' },
  quarrel: { tl: 'May inilarawang pagtatalo', en: 'An argument is described' },
  harmDenied: { tl: 'Sinabi mong walang nasaktan', en: 'You said no one was hurt' },
  theft: { tl: 'May inilarawang ninakaw', en: 'Something taken is described' },
  vandalism: { tl: 'May inilarawang pinsala sa ari-arian', en: 'Property damage is described' },
  trespass: { tl: 'May pumasok nang walang pahintulot', en: 'Someone entered without permission' },
  cyber: { tl: 'Nangyari online o sa telepono', en: 'It happened online or by phone' },
  traffic: { tl: 'May inilarawang insidente sa kalsada', en: 'A road incident is described' },
  drugs: { tl: 'May binanggit na droga', en: 'Drugs are mentioned' },
  gambling: { tl: 'May binanggit na sugal', en: 'Gambling is mentioned' },
  noise: { tl: 'May inilarawang ingay', en: 'Noise is described' },
  nuisance: { tl: 'May inilarawang istorbo sa publiko', en: 'A public nuisance is described' },
  boundary: { tl: 'May inilarawang usapin sa hangganan o lupa', en: 'A boundary or land matter is described' },
  construction: { tl: 'May inilarawang pagtatayo', en: 'Construction is described' },
  animalBite: { tl: 'May inilarawang kagat ng hayop', en: 'An animal bite is described' },
  pets: { tl: 'May binanggit na hayop', en: 'An animal is mentioned' },
  utility: { tl: 'May problema sa tubig o kuryente', en: 'A water or power problem is described' },
  sanitation: { tl: 'May problema sa basura o kanal', en: 'A garbage or drainage problem is described' },
  infrastructure: { tl: 'May sira sa kalsada o pasilidad', en: 'Damaged roads or facilities are described' },
};

/** Text-only facts, read with the negation-aware matcher. */
const TEXT_SIGNALS: (Signal & TermGroup)[] = [
  'sexualViolence', 'harassment', 'stalking', 'trafficking', 'economicAbuse', 'emotionalAbuse', 'quarrel',
  'theft', 'vandalism', 'trespass', 'cyber', 'traffic', 'drugs', 'gambling', 'noise', 'nuisance', 'boundary',
  'construction', 'animalBite', 'pets', 'utility', 'sanitation', 'infrastructure',
];

// ─── Hard-rule explanations, in the order they are reported ──────────────────

const RULE_TEXT: Record<string, Record<Lang, string>> = {
  H1: { tl: 'May panganib ngayon ayon sa ulat (panuntunan H1: Critical).',
        en: 'Danger right now was reported (rule H1: Critical).' },
  H2: { tl: 'May batang naroon at may pananakit o banta (panuntunan H2: hindi bababa sa High).',
        en: 'A child was present alongside harm or a threat (rule H2: at least High).' },
  H3: { tl: 'Pananakit o banta mula sa asawa, kapareha, o kapamilya (panuntunan H3: hindi bababa sa High).',
        en: 'Force or a threat by a partner or family member (rule H3: at least High).' },
  H4: { tl: 'May armas kasabay ng banta o pananakit (panuntunan H4: hindi bababa sa High).',
        en: 'A weapon together with a threat or harm (rule H4: at least High).' },
  H5: { tl: 'May pinsalang nangangailangan ng gamutan (panuntunan H5).',
        en: 'An injury needing treatment (rule H5).' },
};

const ORDER: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
const higher = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

// ─── The analysis ────────────────────────────────────────────────────────────

/**
 * What the AI reader found, after checking. Every quote here appears in the
 * report text that was read; anything it could not back with the resident's
 * own words has already been dropped (lib/aiClassifier.ts).
 */
export interface AiIntakeHints {
  /** Signal names (classificationSchema) and matrix fact names (riskMatrices). */
  facts: { key: string; quote: string }[];
  /** Questions the report already answers. */
  slots: { slot: SlotId; value: 'yes' | 'no'; quote: string }[];
  /** A category from the classification matrix, or null when it was unsure. */
  category: string | null;
  categoryConfidence: 'high' | 'medium' | 'low';
  alternativeCategories: string[];
  /** Provider and model, for the record. */
  model: string;
}

/** Fact names that are about the people or the setting, not about what was done. */
const NOT_AN_ACT = new Set(['partner', 'family', 'neighbors', 'minor', 'harmDenied', 'publicPlace', 'repeated', 'imminent']);
const HARM_FACTS = new Set(['force', 'threat', 'weapon', 'injury', 'choking', 'severeBeating', 'explicitThreat', 'killThreat',
  'weaponShown', 'weaponUsed', 'shooting', 'stabbing', 'sexualViolence', 'hostage', 'confinement']);

export interface IntakeInput {
  narrative: string;
  answers?: IntakeAnswer[];
  selectedCategory?: string | null;
  /** Prior same-type cases by this reporter, from the database. */
  priorSameType?: number;
  areaRecentSameType?: number;
  gender?: string | null;
  /**
   * Apply this matrix rather than the one the suggested category points to -
   * used when an officer has moved the case to the other desk.
   */
  framework?: Framework;
  /** The AI reader's checked reading, when it ran. */
  ai?: AiIntakeHints | null;
  /**
   * Who the report is for (lib/interviewTypes.ts). Anything but SELF: the
   * reporter is not taken to be the person harmed, and is asked about others.
   */
  relationship?: 'SELF' | 'THIRD_PARTY' | 'ON_BEHALF' | 'ANONYMOUS' | null;
  /** The resident's typed answers to AI interview questions - read like their other words. */
  extraText?: string[];
}

export interface IntakeAnalysis {
  result: IntakeResult;
  /** The names of the facts the matrix was applied to (not their content). */
  facts: string[];
  /** The full assessment, for storing alongside - not sent to the resident. */
  assessment: CaseAssessment;
  classification: Classification;
}

const wordCount = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

export function analyzeIntake(input: IntakeInput): IntakeAnalysis {
  const narrative = (input.narrative ?? '').trim();
  const answers = dedupeAnswers(input.answers ?? []);
  const answerOf = (slot: SlotId) => answers.find(a => a.slot === slot);

  // Language from what the resident typed, as everywhere else.
  const detected = detectLanguageSafe(narrative);
  const lang: Lang = detected.language === 'english' ? 'en' : 'tl';

  // Only the resident's own words are read. Option buttons are turned into
  // slot values directly below, never into invented sentences.
  const typed = [...answers.map(a => a.text?.trim()), ...(input.extraText ?? []).map(t => t.trim().slice(0, 1000))]
    .filter((t): t is string => Boolean(t));
  const aboutOthers = input.relationship === 'THIRD_PARTY' || input.relationship === 'ON_BEHALF';
  const combined = [narrative, ...typed].join('\n');

  const classification = classifyCase({ report: combined, unclearWords: [], attachments: {} });
  const p = classification.parameters;
  const quoteFor = (param: string) =>
    classification.evidence_from_report.find(e => e.parameter === param)?.quote;

  const force = mentions(combined, 'physical');
  const threat = p.threats === 'verbal' || p.threats === 'explicit';
  const ai = input.ai ?? null;
  const aiFact = (k: string) => ai?.facts.find(f => f.key === k)?.quote;
  const aiAct = ai?.facts.find(f => !NOT_AN_ACT.has(f.key));
  const actKnown = Boolean(force) || threat
    || p.weapon === 'used'
    || (classification.case_category !== 'other_unclear')
    || Boolean(aiAct);

  // ── What the words already settle ──
  const fromReport: Partial<Record<SlotId, { value: 'yes' | 'no'; quote?: string }>> = {};
  if (p.immediate_danger === 'yes' || p.reporter_safety === 'unsafe') {
    fromReport.safety = { value: 'yes', quote: quoteFor('immediate_danger') ?? quoteFor('reporter_safety') };
  } else if (p.immediate_danger === 'no' || p.reporter_safety === 'safe') {
    fromReport.safety = { value: 'no', quote: quoteFor('immediate_danger') ?? quoteFor('reporter_safety') };
  }
  if (actKnown) fromReport.act = { value: 'yes', quote: force ?? undefined };
  if (wordCount(narrative) >= CONTEXT_MIN_WORDS) fromReport.context = { value: 'yes' };
  if (p.injury !== 'unknown') fromReport.injury = { value: p.injury === 'none' ? 'no' : 'yes', quote: quoteFor('injury') };
  if (p.injury === 'needs_treatment' || p.injury === 'serious') fromReport.injuryCare = { value: 'yes', quote: quoteFor('injury') };
  if (p.weapon !== 'unknown') fromReport.weapon = { value: p.weapon === 'none' ? 'no' : 'yes', quote: quoteFor('weapon') };
  if (p.vulnerable_person.includes('minor')) fromReport.children = { value: 'yes', quote: quoteFor('vulnerable_person') };
  else if (p.vulnerable_person.includes('none')) fromReport.children = { value: 'no', quote: quoteFor('vulnerable_person') };
  if (PRIOR_REPORT_NO.test(combined)) fromReport.priorReport = { value: 'no', quote: combined.match(PRIOR_REPORT_NO)![0] };
  else if (PRIOR_REPORT_YES.test(combined)) fromReport.priorReport = { value: 'yes', quote: combined.match(PRIOR_REPORT_YES)![0] };
  const said = combined.match(/\b(sinabi niya|sabi niya|sinabihan (?:niya )?ako|sumigaw siya|he said|she said|told me)\b[^.!?]{0,80}/i);
  if (said) fromReport.statements = { value: 'yes', quote: said[0] };
  if (p.frequency !== 'unknown') fromReport.recurrence = { value: p.frequency === 'repeated' ? 'yes' : 'no', quote: quoteFor('frequency') };
  // What the AI reader found the report already answers, for questions the
  // rules could not settle. The rules' reading is kept where both have one.
  if (aiAct && !fromReport.act) fromReport.act = { value: 'yes', quote: aiAct.quote };
  for (const a of ai?.slots ?? []) if (!fromReport[a.slot]) fromReport[a.slot] = { value: a.value, quote: a.quote };

  // ── Which questions matter for this report ──
  const household = p.relationship === 'intimate_partners' || p.relationship === 'family';
  const harmContext = Boolean(force) || threat || p.weapon !== 'unknown'
    || ['physical_harm', 'domestic_family', 'child_related', 'gender_based_harassment'].includes(classification.case_category)
    || Boolean(ai?.facts.some(f => HARM_FACTS.has(f.key)));

  const answeredYes = (slot: SlotId) => {
    const a = answerOf(slot);
    return a?.kind === 'option' ? a.value === 'yes' : fromReport[slot]?.value === 'yes';
  };

  const relevant: Record<SlotId, boolean> = {
    safety: true,
    act: true,
    // Only once there is an act to describe; asking "how did it happen"
    // before knowing what "it" is would be asking twice.
    context: actKnown || answerOf('act')?.kind === 'text',
    injury: harmContext || household,
    // Adapts to the answer before it: only asked once someone was hurt.
    injuryCare: answeredYes('injury'),
    weapon: harmContext,
    children: household || classification.case_category === 'child_related',
    // Where words between people matter - harm, a threat, a household - not
    // for an ordinary complaint about noise or a drain.
    statements: harmContext || household,
    recurrence: household || p.relationship === 'neighbors'
      || ['domestic_family', 'gender_based_harassment', 'neighbor_community_dispute', 'child_related']
        .includes(classification.case_category),
    priorReport: true,
  };

  // ── Each slot: the answer, if there is one, otherwise the report ──
  const conflicts: string[] = [];
  const slots: SlotState[] = SLOT_ORDER.map(id => {
    const a = answerOf(id);
    const r = fromReport[id];
    const base = { id, label: LABEL[id][lang], relevant: relevant[id], essential: ESSENTIAL.includes(id) };

    if (a?.kind === 'declined') return { ...base, value: r?.value ?? 'unknown', status: r ? 'known' : 'declined', source: r ? 'report' : null, quote: r?.quote };
    if (a?.kind === 'skipped') return { ...base, value: r?.value ?? 'unknown', status: r ? 'known' : 'skipped', source: r ? 'report' : null, quote: r?.quote };
    if (a?.kind === 'option' && (a.value === 'yes' || a.value === 'no')) {
      if (r && r.value !== a.value) {
        conflicts.push(lang === 'tl'
          ? `${LABEL[id].tl}: magkaiba ang nakasulat sa report at ang sagot. Parehong itinala.`
          : `${LABEL[id].en}: the written report and the answer disagree. Both are recorded.`);
      }
      return { ...base, value: a.value, status: 'known', source: 'answer', quote: a.text?.trim() || undefined };
    }
    if (a?.kind === 'option' && a.value === 'unsure') {
      return { ...base, value: r?.value ?? 'unknown', status: r ? 'known' : 'unsure', source: r ? 'report' : null, quote: r?.quote };
    }
    if (a?.kind === 'text' && a.text?.trim()) {
      // Free text for a descriptive question settles it; for a yes/no
      // question it settles it only if the classifier read it.
      if (id === 'act' || id === 'context' || id === 'statements') return { ...base, value: 'yes', status: 'known', source: 'answer', quote: a.text.trim() };
      if (r) return { ...base, value: r.value, status: 'known', source: 'answer', quote: r.quote ?? a.text.trim() };
      return { ...base, value: 'unknown', status: 'unsure', source: null, quote: a.text.trim() };
    }
    if (r) return { ...base, value: r.value, status: 'known', source: 'report', quote: r.quote };
    return { ...base, value: 'unknown', status: 'unknown', source: null };
  });
  const slot = (id: SlotId) => slots.find(s => s.id === id)!;

  // ── Completeness. Documented, and never a risk level. ──
  //   INSUFFICIENT  - a relevant essential (danger now, what was done, how it
  //                   happened) is not known.
  //   SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT - every relevant essential is
  //                   known and at least 60% of the relevant supporting
  //                   questions are known (rounded up).
  //   PARTIAL       - everything in between.
  //   Skipped, declined and "not sure" all count as not known; they only
  //   stop the question being asked again.
  const rel = slots.filter(s => s.relevant);
  const missingEssential = rel.filter(s => s.essential && s.status !== 'known');
  // "Reported before" is context for the officer, not a fact about risk, so
  // it is asked when other questions are but does not hold completeness back.
  const supporting = rel.filter(s => !s.essential && s.id !== 'priorReport');
  const knownSupporting = supporting.filter(s => s.status === 'known').length;
  const needed = Math.ceil(supporting.length * SUFFICIENT_SUPPORTING_SHARE);

  const completeness: Completeness = missingEssential.length
    ? 'INSUFFICIENT'
    : knownSupporting >= needed ? 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' : 'PARTIAL';

  const essentialGaps = missingEssential.map(s => s.label.toLowerCase());
  const completenessExplanation =
    completeness === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT'
      ? (lang === 'tl' ? 'Sapat na ang impormasyon para sa paunang pagtatasa.' : 'There is enough information for a preliminary assessment.')
      : completeness === 'INSUFFICIENT'
        ? (lang === 'tl' ? `Kailangan pang malaman: ${essentialGaps.join('; ')}.` : `Still needed: ${essentialGaps.join('; ')}.`)
        : (lang === 'tl' ? 'Malinaw na ang mahahalaga; makatutulong ang iba pang detalye.' : 'The essentials are clear; more detail would help.');

  // ── Immediate safety, checked before anything else is waited on ──
  const safetyReasons: string[] = [];
  if (slot('safety').value === 'yes') {
    safetyReasons.push(aboutOthers
      ? (lang === 'tl' ? 'Sinabi mong may maaaring nasa panganib ngayon.' : 'You said someone may be in danger right now.')
      : (lang === 'tl' ? 'Sinabi mong hindi ka ligtas ngayon.' : 'You said you are not safe right now.'));
  }
  if (slot('injuryCare').value === 'yes') {
    safetyReasons.push(lang === 'tl' ? 'May nasaktan na nangangailangan ng medikal na tulong.' : 'Someone who was hurt needs medical help.');
  }

  // ── The earlier grounded reading. Used for the queue only when the matrix
  // has no criterion to apply; never shown as the matrix's answer. ──
  const assessment = assessCase(combined, {
    priorSameType: input.priorSameType ?? 0,
    areaRecentSameType: input.areaRecentSameType ?? 0,
    gender: input.gender ?? null,
    language: detected.language,
  });
  const { level: textLevel, classification: ruled } = enforceHardRules(
    priorityToRiskLevel(assessment.priority),
    { report: combined, unclearWords: [], priorCases: input.priorSameType ?? 0, attachments: {} },
  );
  let legacyLevel: RiskLevel = textLevel;
  const rulesApplied = ruled.hard_rules_applied.filter(r => r !== 'H6' && r !== 'H7');

  // The same rules, applied to what the resident answered directly. These
  // mirror H1, H2, H4 and H5 exactly; no threshold here is new.
  const abuseNow = Boolean(force) || threat || slot('injury').value === 'yes';
  const applyAnswerRule = (cond: boolean, to: RiskLevel, rule: string) => {
    if (!cond) return;
    legacyLevel = higher(legacyLevel, to);
    if (!rulesApplied.includes(rule)) rulesApplied.push(rule);
  };
  applyAnswerRule(slot('safety').value === 'yes', 'Critical', 'H1');
  applyAnswerRule(slot('children').value === 'yes' && abuseNow, 'High', 'H2');
  applyAnswerRule(slot('weapon').value === 'yes' && abuseNow, 'High', 'H4');
  applyAnswerRule(slot('injuryCare').value === 'yes', 'High', 'H5');

  // ── Category: the matrix, applied to what was said ──
  const sig = new Map<Signal, string | undefined>();
  const addSig = (k: Signal, quote?: string | null) => { if (!sig.has(k)) sig.set(k, quote ?? undefined); };
  if (force) addSig('force', force);
  if (threat) addSig('threat', quoteFor('threats'));
  if (slot('injury').value === 'yes') addSig('injury', slot('injury').quote);
  if (slot('weapon').value === 'yes') addSig('weapon', slot('weapon').quote);
  if (p.relationship === 'intimate_partners') addSig('partner', quoteFor('relationship'));
  if (p.relationship === 'family') addSig('family', quoteFor('relationship'));
  if (p.relationship === 'neighbors') addSig('neighbors', quoteFor('relationship'));
  // A child the report itself mentions. Answering "yes, children were there"
  // means they were present, not that they were the ones harmed - that is
  // rule H2's business, not the category's.
  if (p.vulnerable_person.includes('minor')) addSig('minor', quoteFor('vulnerable_person'));
  for (const g of TEXT_SIGNALS) {
    const q = mentions(combined, g);
    if (q) addSig(g, q);
  }
  // The AI reader's facts join the rules' - added, never replacing one.
  for (const f of ai?.facts ?? []) if (SIGNAL_LABEL[f.key as Signal]) addSig(f.key as Signal, f.quote);
  if (slot('injury').value === 'no' && !force && !threat && slot('weapon').value !== 'yes'
    && ![...sig.keys()].some(k => HARM_FACTS.has(k))) addSig('harmDenied');

  const signals = new Set(sig.keys());
  const best = matchCategories(signals)[0] ?? null;

  // The AI reader's own category, as a second opinion. It is used only when
  // it names a real category in the matrix with some confidence. Where the
  // rules found nothing, it fills the gap; where the two disagree, the case
  // is sent for review with both named - neither is quietly dropped.
  const aiMeta: CategoryMeta | null = ai?.category && ai.categoryConfidence !== 'low'
    && !/^(vawc - )?other$/i.test(ai.category) ? categoryByName(ai.category) : null;
  const aiDisagrees = Boolean(best && aiMeta && aiMeta.category !== best.meta.category);
  const aiLeads = Boolean(aiMeta && (!best
    || (aiDisagrees && ai!.categoryConfidence === 'high' && best.matched.length < 2)));
  const chosen: CategoryMeta = aiLeads ? aiMeta! : best?.meta ?? needsReviewCategory(signals);
  const classificationStatus: IntakeResult['classificationStatus'] = best || aiLeads ? 'suggested' : 'needs_review';
  const categoryConfidence: IntakeResult['categoryConfidence'] =
    aiLeads ? 'medium'
      : !best ? 'low' : best.matched.length >= 2 && completeness !== 'INSUFFICIENT' && !aiDisagrees ? 'high' : 'medium';

  const aiCategoryNote = aiMeta
    ? [aiDisagrees
      ? (lang === 'tl'
        ? `Magkaiba ang basa: ang AI ay "${aiMeta.category}", ang mga panuntunan ay "${best!.meta.category}". Isang opisyal ang magpapasya.`
        : `The readings differ: the AI read "${aiMeta.category}", the rules "${best!.meta.category}". An officer decides.`)
      : (lang === 'tl' ? `Ganito rin ang basa ng AI (${ai!.model}).` : `The AI reading agrees (${ai!.model}).`)]
    : [];

  const categoryRationale = aiLeads && !best
    ? [
      ...ai!.facts.filter(f => !NOT_AN_ACT.has(f.key)).slice(0, 3).map(f => `${SIGNAL_LABEL[f.key as Signal]?.[lang] ?? f.key}: "${f.quote}"`),
      lang === 'tl' ? `Binasa ng AI (${ai!.model}); kumpirmahin ng opisyal.` : `Read by the AI (${ai!.model}); an officer confirms it.`,
    ]
    : best
    ? best.matched.map(k => {
      const q = sig.get(k);
      return q ? `${SIGNAL_LABEL[k][lang]}: "${q}"` : SIGNAL_LABEL[k][lang];
    })
    : [lang === 'tl'
      ? 'Walang kategoryang malinaw na sinusuportahan ng report; isang opisyal ang mag-uuri nito.'
      : 'The report does not clearly support any category; an officer will classify it.',
    ...(chosen.desk === 'VAWC'
      ? [lang === 'tl'
        ? 'Itinala sa VAWC desk habang sinusuri, dahil may binanggit na kapareha, kapamilya, bata, o sekswal na asal.'
        : 'Kept on the VAWC desk while it is reviewed, because it mentions a partner, family, a child or sexual conduct.']
      : [])];
  categoryRationale.push(...aiCategoryNote);

  const selected = input.selectedCategory?.trim() || null;
  if (selected && selected !== chosen.category && !/^other/i.test(selected) && best) {
    conflicts.push(lang === 'tl'
      ? `Pinili ang "${selected}", pero ang inilarawan ay mas tugma sa "${chosen.category}". Parehong itinala para sa opisyal.`
      : `"${selected}" was selected, but the description fits "${chosen.category}" better. Both are kept for the officer.`);
  }
  const route: IntakeResult['route'] = chosen.desk;
  const suggestion = { category: chosen.category };

  // ── Risk: the matrix for this desk, applied to what was reported ──
  const framework: Framework = input.framework ?? (chosen.desk === 'VAWC' ? 'VAWC' : 'BLOTTER');
  const facts: Facts = new Map();
  const put = (k: string, q?: string | null | true) => { if (!facts.has(k)) facts.set(k, q ?? true); };
  for (const [k, q] of sig) put(k, q);
  for (const g of ['choking', 'severeBeating', 'killThreat', 'hostage', 'confinement', 'pursuit', 'messages',
    'intimidation', 'coercive', 'landDispute', 'debt', 'tenant', 'slander', 'accidentalDamage',
    'attemptedKilling', 'death', 'casualties', 'curfew', 'ongoing', 'publicPlace', 'rude', 'bullying'] as TermGroup[]) {
    const q = mentions(combined, g);
    if (q) put(g, q);
  }
  // The AI reader's matrix facts, under the same names the matrices use.
  for (const f of ai?.facts ?? []) if (!SIGNAL_LABEL[f.key as Signal]) put(f.key, f.quote);
  const stab = mentions(combined, 'stabShoot') ?? aiFact('stabbing') ?? aiFact('shooting');
  if (stab && !facts.has('stabbing') && !facts.has('shooting')) put(/baril|shot|shoot/i.test(stab) ? 'shooting' : 'stabbing', stab);
  if (p.threats === 'explicit' || facts.has('killThreat')) put('explicitThreat', quoteFor('threats') ?? (facts.get('killThreat') as string));
  if (p.weapon === 'present' || p.weapon === 'used' || slot('weapon').value === 'yes') {
    put('weaponShown', quoteFor('weapon') ?? slot('weapon').quote);
  }
  if (p.weapon === 'used' || stab) put('weaponUsed', quoteFor('weapon') ?? stab);
  if (p.injury === 'serious') put('injurySerious', quoteFor('injury'));
  if (p.injury === 'needs_treatment' || slot('injuryCare').value === 'yes') {
    put('injuryTreatment', quoteFor('injury') ?? slot('injuryCare').quote);
  }
  const unconscious = /nawalan ng malay|unconscious/i.exec(combined);
  if (unconscious) put('unconscious', unconscious[0]);
  if (p.frequency === 'repeated' || slot('recurrence').value === 'yes') {
    put('repeated', quoteFor('frequency') ?? slot('recurrence').quote);
  }
  if (facts.has('repeated') || p.escalation === 'getting_worse') put('repeatedOrWorse', facts.get('repeated') ?? quoteFor('escalation'));
  if (sig.has('partner') || sig.has('family')) put('household', sig.get('partner') ?? sig.get('family'));
  if (p.immediate_danger === 'yes' || slot('safety').value === 'yes' || facts.has('ongoing')) {
    put('imminent', quoteFor('immediate_danger') ?? (facts.get('ongoing') as string | undefined) ?? slot('safety').quote);
  }
  if (facts.has('intimidation') && facts.has('repeated')) put('persistentIntimidation', facts.get('intimidation'));
  const harass = sig.get('harassment');
  if (harass && /hip|touch|grop|molest|hawak/i.test(harass)) put('seriousHarassment', harass);

  const matrix = evaluateMatrix(framework, facts);
  const matrixLevel = matrix.level;
  // Only evidence sets a level: a matrix criterion met by what was said, or a
  // safety rule triggered by it. Otherwise it is undetermined - never the
  // keyword reading's guess, and never inferred from the category.
  const riskLevel: RiskLevel | null = matrixLevel ? queueLevelFor(matrixLevel) : rulesApplied.length ? legacyLevel : null;
  const riskBasis: IntakeResult['riskBasis'] = matrixLevel
    ? 'matrix_criteria'
    : completeness === 'INSUFFICIENT' ? 'insufficient_information' : 'not_covered_by_matrix';
  // A report that could be filed under categories on both desks, or that
  // involves a partner or family member while landing on the blotter, is not
  // a confident classification and is not presented as one.
  const allMatches = matchCategories(signals);
  const alternativeCategories = [
    ...(aiLeads && best ? [best.meta.category] : []),
    ...allMatches.map(m => m.meta.category),
    ...(aiMeta && !aiLeads ? [aiMeta.category] : []),
    ...(ai?.alternativeCategories ?? []).filter(c => categoryByName(c)),
  ].filter((c, i, all) => c !== chosen.category && all.indexOf(c) === i).slice(0, 4);
  const crossesDesks = (allMatches.length > 1 && allMatches.some(m => m.meta.desk !== chosen.desk))
    || Boolean(aiMeta && aiMeta.desk !== chosen.desk);
  const householdOnBlotter = chosen.desk === 'Blotter' && (sig.has('partner') || sig.has('family'))
    && (sig.has('threat') || sig.has('force') || sig.has('injury'));
  const ambiguous = crossesDesks || householdOnBlotter || aiDisagrees;

  // Sufficiency comes before classification: a criterion matched on a report
  // whose essentials (danger now, what was done, how) are still unknown is a
  // lower bound, not a preliminary assessment. It keeps its level - the words
  // support it - but is marked as needing more information.
  const assessmentStatus: IntakeResult['assessmentStatus'] = !matrixLevel
    ? (riskBasis === 'not_covered_by_matrix' ? 'FOR_REVIEW' : 'NEEDS_MORE_INFORMATION')
    : completeness === 'INSUFFICIENT' ? 'NEEDS_MORE_INFORMATION'
      : classificationStatus === 'needs_review' || conflicts.length || ambiguous ? 'FOR_REVIEW' : 'PRELIMINARY';

  // Where the matched criterion depends on something not yet known, the
  // level is a lower bound and says so - unknown is not taken as "absent".
  const levelCaveats: string[] = [];
  if (matrix.matched.some(m => /without severe injury/.test(m.indicator)) && slot('injury').status !== 'known') {
    levelCaveats.push(lang === 'tl'
      ? 'Hindi pa alam kung malubha ang pinsala. Kung malubha, maaaring tumaas ang antas (“Serious physical assault”).'
      : 'Whether the injury is serious is not yet known. If it is, the level could rise (“Serious physical assault”).');
  }
  if (matrix.matched.some(m => /non-imminent threats/.test(m.indicator)) && slot('safety').status !== 'known') {
    levelCaveats.push(lang === 'tl'
      ? 'Hindi pa alam kung may panganib ngayon. Kung mayroon, maaaring tumaas ang antas.'
      : 'Whether there is danger now is not yet known. If there is, the level could rise.');
  }

  const docName = MATRICES[framework].documentName;
  const riskRationale = matrixLevel
    ? [
      (lang === 'tl' ? `Ayon sa ${docName}: ` : `Under the ${docName}: `)
        + `Level ${matrixLevel} — ${matrix.label}.`,
      ...matrix.matched.filter(m => m.level === matrixLevel).slice(0, 3).map(m =>
        `“${m.indicator}”` + (m.evidence[0] ? ` — ${lang === 'tl' ? 'iniulat bilang' : 'reported as'} “${m.evidence[0]}”` : '')),
      lang === 'tl'
        ? 'Ito ay paunang triage ayon sa isang operational na balangkas, hindi legal na pagpapasya.'
        : 'This is preliminary triage under an operational framework, not a legal determination.',
    ]
    : [
      riskBasis === 'insufficient_information'
        ? (lang === 'tl'
          ? 'Kulang pa ang impormasyon para sa pagtatasa. Hindi ito nangangahulugang ligtas o mapanganib ang sitwasyon.'
          : 'There is not enough information to assess yet. This does not mean the situation is safe, or that it is dangerous.')
        : (lang === 'tl'
          ? `Walang pamantayan sa ${docName} na tumutugma sa iniulat. Isang opisyal ang magpapasya ng antas.`
          : `No criterion in the ${docName} matches what was reported. An officer will decide the level.`),
      ...rulesApplied.map(r => RULE_TEXT[r]?.[lang]).filter((t): t is string => Boolean(t)),
    ];

  // ── Immediate danger: its own path, whatever the category or level ──
  if (facts.has('imminent') && (facts.has('force') || facts.has('threat') || facts.has('weaponShown'))
    && slot('safety').value !== 'yes') {
    safetyReasons.push(lang === 'tl' ? 'Inilarawan itong nangyayari ngayon.' : 'It is described as happening now.');
  }
  if (facts.has('killThreat') && facts.has('imminent')) {
    safetyReasons.push(lang === 'tl' ? 'May bantang pumatay na maaaring mangyari agad.' : 'A threat to kill that may be carried out now.');
  }
  if (matrixLevel === 5) {
    safetyReasons.push(lang === 'tl'
      ? `Inilarawan ang pangyayaring nagbabanta sa buhay (Level 5 ng ${docName}).`
      : `A life-threatening event is described (Level 5 of the ${docName}).`);
  }
  const immediateSafetyConcern = safetyReasons.length > 0;

  // ── Indicators, in the resident's own words ──
  const supportingIndicators: SupportingIndicator[] = slots
    .filter(s => s.relevant && s.status === 'known' && s.value === 'yes' && s.quote)
    .map(s => ({ label: s.label, quote: s.quote!, source: s.source === 'answer' ? 'answer' : 'report' }));
  if (force && !supportingIndicators.some(i => i.quote === force)) {
    supportingIndicators.unshift({ label: lang === 'tl' ? 'Pisikal na pananakit' : 'Physical force', quote: force, source: 'report' });
  }

  const notAnswered = slots
    .filter(s => s.relevant && (s.status === 'skipped' || s.status === 'declined' || s.status === 'unsure'))
    .map(s => s.label);
  const missingInformation = rel.filter(s => s.status !== 'known').map(s => s.label);

  // ── Next steps: the assessment's own, plus what this intake adds ──
  const recommendedNextSteps = [
    ...(immediateSafetyConcern
      ? [lang === 'tl'
        ? 'Kung may panganib ngayon, tumawag agad sa mga numerong pang-emergency sa ibaba. Huwag nang hintayin ang mga tanong.'
        : 'If there is danger now, call the emergency numbers below straight away. Do not wait to finish the questions.']
      : []),
    ...assessment.recommendations.filter(r => r.audience !== 'officer').map(r => r.text),
  ].filter((t, i, all) => all.indexOf(t) === i);

  // ── Review ──
  const reviewReasons: string[] = [];
  if (completeness !== 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT') reviewReasons.push('Information is incomplete');
  if (conflicts.length) reviewReasons.push('The report and the answers, or the selected category, disagree');
  if (classificationStatus === 'needs_review') reviewReasons.push('No category is supported by the description');
  if (route === 'VAWC') reviewReasons.push('Describes a VAWC concern; needs the VAWC desk');
  if (immediateSafetyConcern) reviewReasons.push('Immediate safety concern');
  if (!matrixLevel) reviewReasons.push(riskLevel ? 'No risk-matrix criterion met; the level comes from a safety rule' : 'No risk-matrix criterion met; the level is undetermined until an officer sets it');
  if (matrixLevel && completeness === 'INSUFFICIENT') reviewReasons.push('A criterion is met, but essential details are missing; the level may change');
  if (aiDisagrees) reviewReasons.push(`The AI reading (${aiMeta!.category}) and the rules (${best!.meta.category}) suggest different categories`);
  if (ambiguous) reviewReasons.push(`Could fit more than one category: ${[chosen.category, ...alternativeCategories].join(', ')}`);
  if (ruled.needs_human_review && ruled.needs_human_review_reason) reviewReasons.push(ruled.needs_human_review_reason);

  // ── The next question, if one is still worth asking ──
  const questionsAsked = answers.length;
  let nextQuestion: IntakeQuestion | null = null;
  if (completeness !== 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' && questionsAsked < MAX_QUESTIONS) {
    const target = slots.find(s => s.relevant && s.status === 'unknown' && !answerOf(s.id));
    if (target) {
      const q = target.id === 'safety' && aboutOthers ? { ...QUESTION.safety[lang], ...OTHERS_SAFETY[lang] } : QUESTION[target.id][lang];
      nextQuestion = {
        slot: target.id,
        text: target.id === 'safety' && !harmContext && !household && !aboutOthers ? NEUTRAL_SAFETY[lang] : q.text,
        options: q.text_only ? [] : [
          { value: 'yes', label: q.yes! },
          { value: 'no', label: q.no! },
          { value: 'unsure', label: q.unsure! },
        ],
        allowText: true,
        textPlaceholder: q.placeholder,
      };
    }
  }

  return {
    assessment,
    classification,
    facts: [...facts.keys()],
    result: {
      engineVersion: INTAKE_ENGINE_VERSION,
      language: detected.language,
      intro: INTRO[lang],
      informationCompleteness: completeness,
      completenessExplanation,
      slots,
      nextQuestion,
      questionsAsked,
      immediateSafetyConcern,
      safetyReasons,
      selectedCategory: selected,
      suggestedCaseCategory: suggestion.category,
      classificationStatus,
      categoryConfidence,
      categoryRationale,
      officerToConfirm: chosen.confirm,
      matrixVersion: MATRIX_VERSION,
      conflicts,
      route,
      riskLevel,
      riskBasis,
      riskRationale,
      framework,
      frameworkDocument: docName,
      frameworkStatus: MATRICES[framework].status,
      matrixLevel,
      matrixLabel: matrix.label,
      matchedCriteria: matrix.matched,
      assessmentStatus,
      alternativeCategories,
      levelCaveats,
      rulesApplied,
      supportingIndicators,
      missingInformation,
      notAnswered,
      recommendedNextSteps,
      requiresOfficerReview: reviewReasons.length > 0,
      reviewReasons,
    },
  };
}

export type TriageStatus = 'URGENT_REVIEW' | 'NEEDS_FOLLOW_UP' | 'FOR_REVIEW' | 'PRELIMINARY' | 'ASSESSMENT_UNAVAILABLE' | 'REVIEWED';

/**
 * Where a newly filed report stands, from what the server worked out - never
 * from anything the browser says. In this order:
 *   URGENT_REVIEW          the rules saw danger now, or the AI assessment asks
 *                          for urgent human review - always submittable
 *   ASSESSMENT_UNAVAILABLE the matrix text could not be consulted
 *   NEEDS_FOLLOW_UP        essential information is missing (the rules, or
 *                          the AI's sufficiency check): not fully classified
 *   FOR_REVIEW             enough is known, but category or level is unclear
 *   PRELIMINARY            enough is known and the level is supported
 */
export function triageStatusFor(r: Pick<IntakeResult, 'immediateSafetyConcern' | 'assessmentStatus' | 'informationCompleteness'>,
  ai?: { urgentHumanReview?: boolean; informationSufficient?: boolean | null; status?: string; unavailableReason?: string | null } | null,
  knowledgeBaseUnavailable = false): Exclude<TriageStatus, 'REVIEWED'> {
  if (r.immediateSafetyConcern || ai?.urgentHumanReview) return 'URGENT_REVIEW';
  if (knowledgeBaseUnavailable || (ai?.status === 'ASSESSMENT_UNAVAILABLE' && /knowledge base|not been imported|retriev/i.test(ai.unavailableReason ?? ''))) {
    return 'ASSESSMENT_UNAVAILABLE';
  }
  if (r.assessmentStatus === 'NEEDS_MORE_INFORMATION' || r.informationCompleteness === 'INSUFFICIENT' || ai?.informationSufficient === false) {
    return 'NEEDS_FOLLOW_UP';
  }
  if (r.assessmentStatus === 'FOR_REVIEW') return 'FOR_REVIEW';
  return 'PRELIMINARY';
}

/** The last answer to each question wins; a question is never counted twice. */
function dedupeAnswers(list: IntakeAnswer[]): IntakeAnswer[] {
  const out = new Map<SlotId, IntakeAnswer>();
  for (const a of list) {
    if (!a || !SLOT_ORDER.includes(a.slot)) continue;
    out.set(a.slot, {
      slot: a.slot,
      kind: a.kind,
      value: a.value,
      // Bounded, so an answer cannot be used to smuggle a novel past the limit.
      text: typeof a.text === 'string' ? a.text.slice(0, 1000) : undefined,
    });
  }
  return [...out.values()];
}
