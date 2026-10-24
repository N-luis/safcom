import type { SlotId } from './intake';

/**
 * The shapes shared by the report form, the intake endpoint and the filing
 * endpoint for the AI interview. Client-safe: no prompts, no keys.
 */

/** Who the report is for. The reporter, the affected person and the accused are always separate roles. */
export const REPORTING_RELATIONSHIPS = ['SELF', 'THIRD_PARTY', 'ON_BEHALF', 'ANONYMOUS'] as const;
export type ReportingRelationship = typeof REPORTING_RELATIONSHIPS[number];

export const RELATIONSHIP_LABEL: Record<ReportingRelationship, { tl: string; en: string; hintTl: string; hintEn: string }> = {
  SELF: {
    tl: 'Tungkol sa akin', en: 'It involves me',
    hintTl: 'Ako ang naapektuhan ng pangyayari.', hintEn: 'I am reporting an incident involving myself.',
  },
  THIRD_PARTY: {
    tl: 'Tungkol sa ibang tao', en: 'It involves someone else',
    hintTl: 'Nag-uulat ako tungkol sa nangyari sa iba.', hintEn: 'I am reporting an incident involving someone else.',
  },
  ON_BEHALF: {
    tl: 'Para sa ibang tao', en: 'On behalf of someone',
    hintTl: 'Isinusumite ko ito para sa taong naapektuhan.', hintEn: 'I am submitting this report on behalf of another person.',
  },
  ANONYMOUS: {
    tl: 'Nang hindi nagpapakilala', en: 'Without identifying myself',
    hintTl: 'Hindi ipapakita sa mga opisyal ang aking pangalan at contact.', hintEn: 'Barangay officials will not see my name or contact details.',
  },
};

/** The limits on the interview, so it cannot run up the free quota. */
export const INTERVIEW_LIMITS = { maxRounds: 3, maxQuestionsPerRound: 3, maxQuestionsTotal: 8 };

export interface InterviewQuestion {
  /** r<round>q<n>, assigned on the server. */
  id: string;
  round: number;
  text: string;
  answerType: 'yes_no' | 'short_text';
  /** The rules' question this one covers, so its answer feeds the rules too. */
  slot: SlotId | null;
}

/** A question as it was asked, and what the resident did with it. */
export interface InterviewTurn extends InterviewQuestion {
  kind: 'option' | 'text' | 'skipped' | 'declined';
  value?: 'yes' | 'no' | 'unsure';
  /** The resident's own words, when they typed any. */
  answerText?: string;
}

export interface InterviewState {
  /** ok | cached | off | daily_limit | resident_limit | busy | rate_limited | error | not_requested | limit_reached */
  status: string;
  used: boolean;
  understanding: string | null;
  possibleCategories: string[];
  missingInformation: string[];
  questions: InterviewQuestion[];
  /** Whether danger-now still needs asking about. */
  immediateDangerToAssess: boolean;
  /** The words suggest violence may be happening now or about to - checked against the text. */
  possibleOngoingDanger: boolean;
  dangerQuote: string | null;
  sufficient: boolean;
  round: number;
  /** No more questions will be asked. */
  done: boolean;
}

/** What officials see as the reporter's name on an anonymous report. */
export const ANONYMOUS_NAME = 'Anonymous reporter';
