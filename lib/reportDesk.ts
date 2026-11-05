import { categoryByName } from './classificationSchema';
import type { IntakeResult } from './intake';

/**
 * Which desk a resident's report goes to - recommended by SafeComm, never
 * chosen by the resident and never a legal finding.
 *
 * The reading itself is the existing one: the grounded rules
 * (lib/intake.ts) and the Groq reader (lib/aiClassifier.ts), each with the
 * classification matrix behind it, and the knowledge base's BLOTTER and VAWC
 * source text (lib/reportDeskServer.ts). This file only turns that reading
 * into a recommendation, in code - so the safety rule below holds whatever a
 * model says:
 *
 *   Any sign the report may concern violence against a woman or her child
 *   files it on the VAWC desk for confidential review. A report is never put
 *   in the ordinary blotter queue on an uncertain reading, and never refused.
 *
 * Classification and risk stay apart: nothing here reads or sets a risk level.
 */

export const DESK_DECISIONS = ['BLOTTER', 'VAWC', 'NEEDS_CLARIFICATION', 'HUMAN_REVIEW'] as const;
export type DeskDecision = (typeof DESK_DECISIONS)[number];
export type FilingDesk = 'BLOTTER' | 'VAWC';
export const DESK_VERSION = 'safecomm-report-desk/1';

export const DESK_DECISION_LABEL: Record<DeskDecision, string> = {
  BLOTTER: 'Blotter desk', VAWC: 'VAWC desk (confidential)', NEEDS_CLARIFICATION: 'Needs clarification', HUMAN_REVIEW: 'Needs an official to decide the desk',
};

/** A knowledge-base chunk the recommendation was read against - only ones actually retrieved. */
export interface DeskSource {
  framework: 'BLOTTER' | 'VAWC';
  sectionTitle: string;
  pageNumber: number | null;
  riskLevel: number | null;
  riskLabel: string | null;
  strength: 'strong' | 'weak';
}

export interface DeskInput {
  result: Pick<IntakeResult, 'route' | 'classificationStatus' | 'categoryConfidence' | 'informationCompleteness' | 'conflicts'
    | 'alternativeCategories' | 'suggestedCaseCategory' | 'missingInformation' | 'categoryRationale' | 'supportingIndicators' | 'language'>;
  /** The Groq reader: whether it was asked, whether its facts were used, and what it read. */
  ai: {
    requested: boolean; used: boolean; status: string | null; model: string | null;
    category: string | null; categoryConfidence: 'high' | 'medium' | 'low' | null; alternativeCategories: string[];
  };
  sources: DeskSource[];
  /** The facts the rules read in the report (lib/intake.ts IntakeAnalysis.facts) - names only. */
  facts: string[];
  /** Whether the knowledge base could be searched at all. */
  knowledgeBaseAvailable: boolean;
  /** An older page still sent the confidential VAWC form choice - only ever a reason for more confidentiality. */
  reporterChoseVawc?: boolean;
  now?: Date;
}

export interface DeskRecommendation {
  version: string;
  decision: DeskDecision;
  /** Where the case is filed while that decision stands - VAWC whenever VAWC is possible. */
  desk: FilingDesk;
  /** The category it is filed under: the reading's, or "VAWC - Other" when it is held for confidential review. */
  filedCategory: string;
  confidentialReview: boolean;
  possibleVawc: boolean;
  explanation: string[];
  /** What in the report the reading rests on - each with the resident's own words. */
  indicators: { label: string; quote: string }[];
  missingInformation: string[];
  clarificationNeeded: boolean;
  /** Neutral, skippable questions for the resident when more is needed. */
  questions: string[];
  sources: DeskSource[];
  /** The Groq reader could not run: the recommendation waits for it (lib/reportDeskServer.ts retry). */
  awaitingAi: boolean;
  ai: { used: boolean; status: string | null; model: string | null; category: string | null };
  classifiedAt: string;
}

const deskOf = (category: string | null | undefined): FilingDesk | null => {
  const meta = category ? categoryByName(category) : null;
  return meta ? (meta.desk === 'VAWC' ? 'VAWC' : 'BLOTTER') : null;
};
const isOther = (category: string | null | undefined) => !category || /^(vawc - )?other$/i.test(category.trim());

/**
 * Facts in the report that may point to violence against a woman or her
 * child, whatever category won: a partner, sexual violence or stalking on
 * their own; family or a child together with harm, threats or harassment.
 * A land dispute between siblings, or children making noise, is neither.
 */
const VAWC_ALONE = ['partner', 'sexualViolence', 'stalking', 'trafficking', 'economicAbuse', 'emotionalAbuse'];
const VAWC_WITH_HARM = ['family', 'minor'];
const HARM = ['force', 'threat', 'injury', 'weapon', 'harassment', 'choking', 'severeBeating', 'explicitThreat', 'killThreat',
  'weaponShown', 'weaponUsed', 'stabbing', 'confinement', 'intimidation', 'coercive'];
export function vawcFactSigns(facts: string[]): string | null {
  const has = (k: string) => facts.includes(k);
  if (has('partner')) return 'the report mentions a partner or spouse';
  const alone = VAWC_ALONE.find(has);
  if (alone) return 'the report describes a kind of harm the VAWC desk handles';
  if (VAWC_WITH_HARM.some(has) && HARM.some(has)) return 'the report mentions family or a child together with harm or threats';
  return null;
}

/** The AI statuses that mean the reader did not run - not "it read and found nothing". */
const AI_DOWN = new Set(['off', 'daily_limit', 'resident_limit', 'busy', 'rate_limited', 'error']);

const QUESTIONS = {
  en: {
    more: 'Can you tell us more about what happened, in your own words?',
    when: 'When did it happen? An estimate is fine.',
    relationship: 'What is your relationship to the person involved, if you feel safe sharing?',
    conflict: 'Some details seem to differ. Could you say again what happened, as best you remember?',
    else: 'Is there anything else the responding official should know?',
  },
  tl: {
    more: 'Maaari mo bang ikuwento pa kung ano ang nangyari, sa sarili mong salita?',
    when: 'Kailan ito nangyari? Puwede ang tantiya.',
    relationship: 'Ano ang kaugnayan mo sa taong sangkot, kung ligtas para sa iyong sabihin?',
    conflict: 'Tila may magkaibang detalye. Maaari mo bang ulitin kung ano ang nangyari, ayon sa naaalala mo?',
    else: 'May iba pa bang dapat malaman ng opisyal na tutugon?',
  },
};

/**
 * The recommendation. In order:
 *   1. the AI could not run       -> HUMAN_REVIEW, waiting for it (never a guess)
 *   2. the report contradicts itself, or says too little to place
 *                                  -> NEEDS_CLARIFICATION
 *   3. the AI and the rules point to different desks
 *                                  -> HUMAN_REVIEW
 *   4. a Blotter reading with any VAWC indicator
 *                                  -> HUMAN_REVIEW, held on the VAWC desk
 *   5. otherwise                   -> the desk both readings agree on
 * Whatever the decision, a possible VAWC concern files it on the VAWC desk.
 */
export function recommendDesk(i: DeskInput): DeskRecommendation {
  const r = i.result;
  const lang = r.language === 'english' ? 'en' : 'tl';
  const q = QUESTIONS[lang];
  const rulesDesk: FilingDesk = r.route === 'VAWC' ? 'VAWC' : 'BLOTTER';
  const aiDown = i.ai.requested && !i.ai.used && (i.ai.status === null || AI_DOWN.has(i.ai.status));
  const aiDesk = i.ai.used && i.ai.categoryConfidence !== 'low' && !isOther(i.ai.category) ? deskOf(i.ai.category) : null;

  // Any reading that places it on the VAWC desk, as the first answer or an alternative.
  const vawcSigns = [
    rulesDesk === 'VAWC' ? 'the rules read it as a VAWC matter' : null,
    r.alternativeCategories.some(c => deskOf(c) === 'VAWC') ? 'a VAWC category is among the possible readings' : null,
    i.ai.used && deskOf(i.ai.category) === 'VAWC' ? 'the AI reader read a VAWC category' : null,
    i.ai.used && i.ai.alternativeCategories.some(c => deskOf(c) === 'VAWC') ? 'the AI reader named a VAWC category as possible' : null,
    vawcFactSigns(i.facts),
    i.reporterChoseVawc ? 'the reporter filed it on the confidential VAWC form' : null,
  ].filter((x): x is string => Boolean(x));
  const possibleVawc = vawcSigns.length > 0;
  const desk: FilingDesk = possibleVawc ? 'VAWC' : 'BLOTTER';
  const category = r.suggestedCaseCategory;
  const filedCategory = desk === 'VAWC' && deskOf(category) !== 'VAWC' ? 'VAWC - Other' : category;

  const explanation: string[] = [];
  const questions: string[] = [];
  let decision: DeskDecision;
  // Too little to place it: no category the report supports. How complete the
  // report is for the risk assessment is a different question (the risk side's),
  // and does not decide the desk.
  const insufficient = r.classificationStatus === 'needs_review' || r.categoryConfidence === 'low';

  if (aiDown) {
    decision = 'HUMAN_REVIEW';
    explanation.push('The AI reader could not run, so SafeComm has not classified this report. It is saved and waits for the AI or an official - the desk below is only where it is kept meanwhile.');
  } else if (r.conflicts.length) {
    decision = 'NEEDS_CLARIFICATION';
    explanation.push('Parts of the report do not agree with each other, so the desk is not decided from it yet.');
    questions.push(q.conflict);
  } else if (insufficient) {
    decision = 'NEEDS_CLARIFICATION';
    explanation.push('The report does not yet say enough to tell which desk should handle it.');
  } else if (aiDesk && aiDesk !== rulesDesk) {
    decision = 'HUMAN_REVIEW';
    explanation.push(`The AI reader and the rules point to different desks (AI: ${aiDesk === 'VAWC' ? 'VAWC' : 'Blotter'}, rules: ${rulesDesk === 'VAWC' ? 'VAWC' : 'Blotter'}). An official decides.`);
  } else if (possibleVawc && rulesDesk === 'BLOTTER') {
    decision = 'HUMAN_REVIEW';
    explanation.push('It reads mainly as a Blotter matter, but a VAWC concern cannot be ruled out. A VAWC officer reviews it first.');
  } else {
    decision = rulesDesk;
    explanation.push(rulesDesk === 'VAWC'
      ? `It describes a possible VAWC concern (${category}). Recommended for the VAWC desk.`
      : `It describes a community matter for the barangay blotter (${category}).`);
  }
  if (possibleVawc) explanation.push(`Kept confidential on the VAWC desk because ${vawcSigns.join('; ')}.`);
  if (!i.knowledgeBaseAvailable) explanation.push('The knowledge base could not be reached, so no source text is cited for this recommendation.');
  explanation.push('This is a recommendation for the barangay, not a legal finding.');

  const clarificationNeeded = decision === 'NEEDS_CLARIFICATION';
  if (clarificationNeeded) {
    if (!questions.length) questions.push(q.more);
    if (r.missingInformation.some(m => /when|kailan|timing/i.test(m))) questions.push(q.when);
    if (possibleVawc || r.alternativeCategories.length) questions.push(q.relationship);
    if (!questions.includes(q.more)) questions.unshift(q.more);
    questions.push(q.else);
  }

  return {
    version: DESK_VERSION,
    decision, desk, filedCategory,
    confidentialReview: desk === 'VAWC',
    possibleVawc,
    explanation,
    indicators: r.supportingIndicators.filter(s => s.quote).slice(0, 8).map(s => ({ label: s.label, quote: s.quote })),
    missingInformation: r.missingInformation.slice(0, 8),
    clarificationNeeded,
    questions: [...new Set(questions)].slice(0, 5),
    sources: i.sources,
    awaitingAi: aiDown,
    ai: { used: i.ai.used, status: i.ai.status, model: i.ai.model, category: i.ai.used ? i.ai.category : null },
    classifiedAt: (i.now ?? new Date()).toISOString(),
  };
}
