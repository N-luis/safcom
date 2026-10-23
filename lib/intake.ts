/**
 * Assisted intake: what a report already says, what it leaves out, and the
 * one question most worth asking next.
 *
 * WHAT THIS IS. A rule-based reading of the resident's own words, built on
 * the same grounded classifier the rest of SafeComm uses (lib/caseClassification
 * - including its negation guard). It is deterministic: the same narrative and
 * answers always produce the same questions and the same result, and every
 * fact it reports can be traced to a quote or to an answer the resident gave.
 * It does not call an external language model, so no narrative leaves the
 * server. A model could later phrase the questions; it must never decide them,
 * and it must never set the risk level - see the rules below.
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
  classifyCase, enforceHardRules, mentions, type Classification,
} from './caseClassification';
import { assessCase, priorityToRiskLevel, type CaseAssessment } from './caseAssessment';
import { detectLanguageSafe, type ReportLanguage } from './detectLanguage';
import { VAWC_TYPES } from './vawcTypes';

export const INTAKE_ENGINE_VERSION = 'safecomm-intake-rules/1.0';

/** Questions are never repeated, so this is also the most that can be asked. */
export const MAX_QUESTIONS = 9;

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
  | 'weapon' | 'children' | 'recurrence' | 'priorReport';

/** Asked in this order; a slot is only asked while it is relevant and unknown. */
export const SLOT_ORDER: SlotId[] = [
  'safety', 'act', 'context', 'injury', 'injuryCare', 'weapon', 'children', 'recurrence', 'priorReport',
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
  suggestedCaseCategory: string | null;
  categoryConfidence: 'high' | 'medium' | 'low';
  categoryRationale: string[];
  /** Things that do not agree with each other - both sides kept. */
  conflicts: string[];
  route: 'VAWC' | 'Blotter' | 'Undetermined';

  riskLevel: RiskLevel;
  /** Whether the level rests on stated facts or there was too little to go on. */
  riskBasis: 'documented_indicators' | 'insufficient_information';
  riskRationale: string[];
  rulesApplied: string[];
  supportingIndicators: SupportingIndicator[];

  missingInformation: string[];
  notAnswered: string[];
  recommendedNextSteps: string[];

  requiresOfficerReview: boolean;
  reviewReasons: string[];
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
    tl: { text: 'Maaari mo bang ilarawan kung paano ito nangyari at kung ano ang nangyari bago nito?',
      placeholder: 'Halimbawa: kailan, saan, at ano ang sinabi o ginawa bago ito', text_only: true },
    en: { text: 'Could you describe how it happened and what happened just before?',
      placeholder: 'For example: when, where, and what was said or done before', text_only: true },
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

const VAWC_SET = new Set<string>(VAWC_TYPES);

const WHY: Record<string, Record<Lang, (q?: string) => string>> = {
  sexual:     { tl: q => `May inilarawang sekswal na karahasan: "${q}"`, en: q => `Describes sexual violence: "${q}"` },
  partner:    { tl: () => 'Ang taong tinutukoy ay asawa o kapareha', en: () => 'The person named is a partner or spouse' },
  family:     { tl: () => 'Ang taong tinutukoy ay kapamilya', en: () => 'The person named is a family member' },
  force:      { tl: q => `May inilarawang pisikal na pananakit: "${q}"`, en: q => `Physical force is described: "${q}"` },
  threat:     { tl: () => 'May inilarawang banta', en: () => 'A threat is described' },
  injury:     { tl: () => 'May inilarawang pinsala', en: () => 'An injury is described' },
  child:      { tl: () => 'May inilarawang pananakit sa bata', en: () => 'Harm to a child is described' },
  stalking:   { tl: q => `May inilarawang paulit-ulit na pagsunod o pagmamanman: "${q}"`, en: q => `Repeated following or watching is described: "${q}"` },
  harassment: { tl: q => `May inilarawang hindi kanais-nais na sekswal na asal: "${q}"`, en: q => `Unwanted sexual conduct is described: "${q}"` },
  dispute:    { tl: () => 'Away sa loob ng tahanan, walang inilarawang pananakit', en: () => 'A household conflict is described with no abuse stated' },
  threatOrInjury: { tl: () => 'May inilarawang banta o pinsala', en: () => 'A threat or injury is described' },
  vandalism:  { tl: q => `May inilarawang pinsala sa ari-arian: "${q}"`, en: q => `Property damage is described: "${q}"` },
  theft:      { tl: q => `May inilarawang ninakaw: "${q}"`, en: q => `Something taken is described: "${q}"` },
  traffic:    { tl: q => `May inilarawang insidente sa kalsada: "${q}"`, en: q => `A road incident is described: "${q}"` },
  noise:      { tl: q => `May inilarawang ingay: "${q}"`, en: q => `Noise is described: "${q}"` },
  neighbour:  { tl: () => 'May inilarawang away sa kapitbahay o komunidad', en: () => 'A neighbour or community dispute is described' },
};

function suggestCategory(c: Classification, text: string, lang: Lang): {
  category: string | null; why: string[];
} {
  const w = (key: string, q?: string) => WHY[key][lang](q);
  const p = c.parameters;
  const force = mentions(text, 'physical');
  const threat = p.threats === 'verbal' || p.threats === 'explicit';
  const injured = p.injury !== 'none' && p.injury !== 'unknown';
  const abuse = Boolean(force) || threat || injured;
  const partner = p.relationship === 'intimate_partners';
  const family = p.relationship === 'family';

  const sexual = mentions(text, 'sexualViolence');
  if (sexual) return { category: 'Sexual Violence', why: [w('sexual', sexual)] };
  const stalking = mentions(text, 'stalking');

  if ((partner || family) && abuse) {
    return {
      category: 'Domestic Violence',
      why: [
        w(partner ? 'partner' : 'family'),
        force ? w('force', force) : threat ? w('threat') : w('injury'),
      ],
    };
  }
  if (c.case_category === 'child_related' || (p.vulnerable_person.includes('minor') && abuse)) {
    return { category: 'Child Abuse', why: [w('child')] };
  }
  if (stalking) return { category: 'Stalking', why: [w('stalking', stalking)] };
  const harass = mentions(text, 'harassment');
  if (harass) return { category: 'Sexual Harassment', why: [w('harassment', harass)] };
  if (partner || family) {
    return { category: 'Domestic Dispute', why: [w('dispute')] };
  }
  if (abuse) return { category: 'Assault', why: [force ? w('force', force) : w('threatOrInjury')] };

  const vand = mentions(text, 'vandalism');
  if (vand) return { category: 'Vandalism', why: [w('vandalism', vand)] };
  const theft = mentions(text, 'theft');
  if (theft) return { category: 'Theft & Robbery', why: [w('theft', theft)] };
  const traffic = mentions(text, 'traffic');
  if (traffic) return { category: 'Traffic Violation', why: [w('traffic', traffic)] };
  const noise = mentions(text, 'noise');
  if (noise) return { category: 'Noise Complaint', why: [w('noise', noise)] };
  if (c.case_category === 'neighbor_community_dispute') {
    return { category: 'Public Nuisance', why: [w('neighbour')] };
  }
  // Nothing in the words supports a category. Saying so is the answer.
  return { category: null, why: [] };
}

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

export interface IntakeInput {
  narrative: string;
  answers?: IntakeAnswer[];
  selectedCategory?: string | null;
  /** Prior same-type cases by this reporter, from the database. */
  priorSameType?: number;
  areaRecentSameType?: number;
  gender?: string | null;
}

export interface IntakeAnalysis {
  result: IntakeResult;
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
  const typed = answers.map(a => a.text?.trim()).filter((t): t is string => Boolean(t));
  const combined = [narrative, ...typed].join('\n');

  const classification = classifyCase({ report: combined, unclearWords: [], attachments: {} });
  const p = classification.parameters;
  const quoteFor = (param: string) =>
    classification.evidence_from_report.find(e => e.parameter === param)?.quote;

  const force = mentions(combined, 'physical');
  const threat = p.threats === 'verbal' || p.threats === 'explicit';
  const actKnown = Boolean(force) || threat
    || p.weapon === 'used'
    || (classification.case_category !== 'other_unclear');

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
  if (p.frequency !== 'unknown') fromReport.recurrence = { value: p.frequency === 'repeated' ? 'yes' : 'no', quote: quoteFor('frequency') };

  // ── Which questions matter for this report ──
  const household = p.relationship === 'intimate_partners' || p.relationship === 'family';
  const harmContext = Boolean(force) || threat || p.weapon !== 'unknown'
    || ['physical_harm', 'domestic_family', 'child_related', 'gender_based_harassment'].includes(classification.case_category);

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
      if (id === 'act' || id === 'context') return { ...base, value: 'yes', status: 'known', source: 'answer', quote: a.text.trim() };
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
  const supporting = rel.filter(s => !s.essential);
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
    safetyReasons.push(lang === 'tl' ? 'Sinabi mong hindi ka ligtas ngayon.' : 'You said you are not safe right now.');
  }
  if (slot('injuryCare').value === 'yes') {
    safetyReasons.push(lang === 'tl' ? 'May nasaktan na nangangailangan ng medikal na tulong.' : 'Someone who was hurt needs medical help.');
  }
  const immediateSafetyConcern = safetyReasons.length > 0;

  // ── Risk: stated facts and the documented hard rules, nothing else ──
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
  let riskLevel: RiskLevel = textLevel;
  const rulesApplied = ruled.hard_rules_applied.filter(r => r !== 'H6' && r !== 'H7');

  // The same rules, applied to what the resident answered directly. These
  // mirror H1, H2, H4 and H5 exactly; no threshold here is new.
  const abuseNow = Boolean(force) || threat || slot('injury').value === 'yes';
  const applyAnswerRule = (cond: boolean, to: RiskLevel, rule: string) => {
    if (!cond) return;
    riskLevel = higher(riskLevel, to);
    if (!rulesApplied.includes(rule)) rulesApplied.push(rule);
  };
  applyAnswerRule(slot('safety').value === 'yes', 'Critical', 'H1');
  applyAnswerRule(slot('children').value === 'yes' && abuseNow, 'High', 'H2');
  applyAnswerRule(slot('weapon').value === 'yes' && abuseNow, 'High', 'H4');
  applyAnswerRule(slot('injuryCare').value === 'yes', 'High', 'H5');

  const indicatorCount = rulesApplied.length + classification.evidence_from_report.length;
  const riskBasis: IntakeResult['riskBasis'] =
    completeness === 'INSUFFICIENT' && rulesApplied.length === 0
      ? 'insufficient_information' : 'documented_indicators';

  const riskRationale = [
    ...rulesApplied.map(r => RULE_TEXT[r]?.[lang]).filter((t): t is string => Boolean(t)),
    ...(riskBasis === 'insufficient_information'
      ? [lang === 'tl'
        ? 'Kulang pa ang impormasyon para sa pagtatasa. Hindi ito nangangahulugang ligtas o mapanganib ang sitwasyon.'
        : 'There is not enough information to assess yet. This does not mean the situation is safe, or that it is dangerous.']
      : []),
    ...(indicatorCount === 0 ? [] : [assessment.reason]),
  ];

  // ── Category, from the words ──
  const suggestion = suggestCategory(classification, combined, lang);
  const selected = input.selectedCategory?.trim() || null;
  const categoryConfidence: IntakeResult['categoryConfidence'] =
    !suggestion.category ? 'low'
      : completeness === 'INSUFFICIENT' ? (classification.category_confidence === 'high' ? 'medium' : 'low')
        : classification.category_confidence;
  if (selected && suggestion.category && selected !== suggestion.category && !/^other/i.test(selected)) {
    conflicts.push(lang === 'tl'
      ? `Pinili ang "${selected}", pero ang inilarawan ay mas tugma sa "${suggestion.category}". Parehong itinala para sa opisyal.`
      : `"${selected}" was selected, but the description fits "${suggestion.category}" better. Both are kept for the officer.`);
  }
  const effective = suggestion.category ?? (selected && !/^other/i.test(selected) ? selected : null);
  const route: IntakeResult['route'] = !effective ? 'Undetermined' : VAWC_SET.has(effective) ? 'VAWC' : 'Blotter';

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
  if (!suggestion.category) reviewReasons.push('No category is supported by the description');
  if (route === 'VAWC') reviewReasons.push('Describes a VAWC concern; needs the VAWC desk');
  if (immediateSafetyConcern) reviewReasons.push('Immediate safety concern');
  if (ruled.needs_human_review && ruled.needs_human_review_reason) reviewReasons.push(ruled.needs_human_review_reason);

  // ── The next question, if one is still worth asking ──
  const questionsAsked = answers.length;
  let nextQuestion: IntakeQuestion | null = null;
  if (completeness !== 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' && questionsAsked < MAX_QUESTIONS) {
    const target = slots.find(s => s.relevant && s.status === 'unknown' && !answerOf(s.id));
    if (target) {
      const q = QUESTION[target.id][lang];
      nextQuestion = {
        slot: target.id,
        text: target.id === 'safety' && !harmContext && !household ? NEUTRAL_SAFETY[lang] : q.text,
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
      categoryConfidence,
      categoryRationale: suggestion.why,
      conflicts,
      route,
      riskLevel,
      riskBasis,
      riskRationale,
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
