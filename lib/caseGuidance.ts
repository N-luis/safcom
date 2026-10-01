/**
 * What SafeComm tells a resident to do while their case waits to be reviewed.
 *
 * The copy lives here rather than in the component so a barangay can edit what
 * is said to a frightened person without touching layout code, and so the
 * whole of what the system says can be read in one place.
 *
 * Two limits are built into the shape. Nothing here may claim an officer or
 * the police are on their way - the report has been flagged and will be
 * reviewed, and that is all that has happened. And nothing here decides fault.
 */

import type { Progress } from './followUps';
import { EMERGENCY_CONTACTS } from './safecommConfig';

/** The levels this guidance is written for. */
export const GUIDANCE_RISKS = ['High', 'Medium', 'Low'] as const;
export type GuidanceRisk = (typeof GUIDANCE_RISKS)[number];

/**
 * Only English is written so far. The Filipino reassurance line sits inside
 * the English copy, as the barangay asked; a second locale added here switches
 * the whole block rather than one sentence.
 */
export const GUIDANCE_LOCALES = ['en'] as const;
export type GuidanceLocale = (typeof GUIDANCE_LOCALES)[number];

export interface GuidanceStep {
  title: string;
  detail: string;
}

export interface GuidanceAction {
  label: string;
  /** A phone number dials; a progress value files a follow-up saying so. */
  kind: 'call' | 'followUp';
  tel?: string;
  progress?: Progress;
}

export interface CheckIn {
  label: string;
  progress: Progress;
}

export interface GuidanceCopy {
  /** Pill beside the heading, and the colours the whole block is keyed to. */
  priorityLabel: string;
  riskPill: { bg: string; text: string };
  calm: {
    headline: string;
    body: string;
    /** Shown under the English, in italics. */
    filipino: string;
  };
  steps: [GuidanceStep, GuidanceStep, GuidanceStep];
  planB: {
    title: string;
    bullets: string[];
    bg: string;
    border: string;
    tagBg: string;
    tagText: string;
    /** The filled button. The outlined barangay-hall button is added to it. */
    action: GuidanceAction;
  };
  checkIns: [CheckIn, CheckIn, CheckIn];
}

const GUIDANCE: Record<GuidanceLocale, Record<GuidanceRisk, GuidanceCopy>> = {
  en: {
    High: {
      priorityLabel: 'High priority',
      riskPill: { bg: '#FDECEC', text: '#B42318' },
      calm: {
        headline: 'You did the right thing by reporting.',
        body:
          'Take one slow breath in for 4 seconds and out for 6. Your report is flagged as high '
          + 'priority so a barangay officer sees it first. Your safety comes before everything, '
          + "so please don't step in to stop the fight yourself.",
        filipino:
          'Tama lang na nag-report ka. Huminga ka muna nang malalim at huwag mo munang lapitan '
          + 'ang away.',
      },
      steps: [
        {
          title: 'Keep your distance',
          detail:
            "Move indoors or behind a locked door if you can. With a knife involved, don't try "
            + 'to break it up.',
        },
        {
          title: 'Call 911 if anyone is hurt or in danger right now',
          detail: "A weapon is involved, so don't wait for the barangay to arrive.",
        },
        {
          title: "Note what you see, only if it's safe",
          detail:
            "How many people, what they're wearing, which way they go. Add it as a follow-up "
            + 'for the officer.',
        },
      ],
      planB: {
        title: 'If it gets worse or no one arrives',
        bullets: [
          'Call 911 or the nearest police station.',
          "Go to a well-lit public place or a trusted neighbor's home.",
          'Ask a barangay tanod near the sari-sari store to stay with you.',
        ],
        bg: '#FFF7ED',
        border: '#F3D3AA',
        tagBg: '#FDE4C4',
        tagText: '#8A4300',
        action: { label: 'Call 911', kind: 'call', tel: '911' },
      },
      checkIns: [
        { label: "I'm safe now", progress: 'improving' },
        { label: 'Still happening', progress: 'still_happening' },
        { label: 'I need help now', progress: 'worsening' },
      ],
    },

    Medium: {
      priorityLabel: 'Medium priority',
      riskPill: { bg: '#FFF1CC', text: '#7A4E00' },
      calm: {
        headline: 'Thanks for speaking up. Lost sleep is exhausting.',
        body:
          "It's fair to feel frustrated. This isn't an emergency, and your report is now with "
          + 'the barangay for review. A few small steps can help you rest while you wait.',
        filipino: 'Naiintindihan namin ang pagod mo. Aasikasuhin ito ng barangay.',
      },
      steps: [
        {
          title: 'Write down dates and times',
          detail:
            'Note when the noise starts and stops each night. It helps the officer see the pattern.',
        },
        {
          title: 'Avoid confronting the neighbor',
          detail: 'Arguments can escalate. Barangay mediation is a calmer way to settle this.',
        },
        {
          title: 'Take the edge off tonight',
          detail:
            'Earplugs, a fan or white noise can help you sleep a little while this is being handled.',
        },
      ],
      planB: {
        title: 'If it continues tonight or gets heated',
        bullets: [
          'Add a follow-up with the time and how loud it is.',
          'Ask the barangay for a mediation meeting with your neighbor.',
          'If you ever feel threatened, call 911 right away.',
        ],
        bg: '#FFFBEB',
        border: '#EFDDA0',
        tagBg: '#FBEBB0',
        tagText: '#6E4600',
        action: { label: 'Request mediation', kind: 'followUp', progress: 'still_happening' },
      },
      checkIns: [
        { label: "It's quiet now", progress: 'improving' },
        { label: 'Still noisy', progress: 'still_happening' },
        { label: 'I feel unsafe', progress: 'worsening' },
      ],
    },

    Low: {
      priorityLabel: 'Low priority',
      riskPill: { bg: '#E2F4EA', text: '#17603E' },
      calm: {
        headline: 'No need to worry, this is low risk.',
        body:
          'Thank you for helping keep the street in good shape. Nobody is in danger, and the '
          + "barangay will schedule a check. You don't need to do anything else right now.",
        filipino: 'Salamat sa pag-report. Hindi ito emergency; susuriin ito ng barangay.',
      },
      steps: [
        {
          title: 'Use a well-lit path at night',
          detail:
            "Until it's fixed, walk the brighter side of the street, ideally with someone.",
        },
        {
          title: "Add a photo if it's safe",
          detail: 'A clear photo of the pole and a nearby landmark can speed up the repair.',
        },
        {
          title: 'Check back here',
          detail: 'Any update from the barangay will appear in the timeline below.',
        },
      ],
      planB: {
        title: 'If it becomes a safety problem',
        bullets: [
          'Stay clear of exposed wires and never touch them.',
          'Add a follow-up and mark it urgent.',
          'Call the barangay hall so someone can put up a warning.',
        ],
        bg: '#F3F6FA',
        border: '#D5DEE9',
        tagBg: '#DCE5F0',
        tagText: '#2B3F5C',
        action: { label: 'Add urgent follow-up', kind: 'followUp', progress: 'worsening' },
      },
      checkIns: [
        { label: "It's fixed", progress: 'resolved' },
        { label: 'Still broken', progress: 'still_happening' },
        { label: "It's now dangerous", progress: 'worsening' },
      ],
    },
  },
};

/**
 * Per-case-type wording, layered over the risk block.
 *
 * Empty for now. The steps above speak in the example each level was written
 * from - a knife, a videoke, a lamp post - so theft, vandalism and harassment
 * each want their own, and this is where they go without the levels having to
 * be rewritten.
 */
const BY_CASE_TYPE: Partial<Record<string, Partial<Record<GuidanceRisk, Partial<GuidanceCopy>>>>> = {};

/**
 * Critical is not a level this copy was written for, and a case that reaches it
 * must not fall through to nothing. It is read as High: the most protective
 * block of the three, and the only one that tells someone to call for help.
 */
function toGuidanceRisk(riskLevel: string): GuidanceRisk {
  const v = (riskLevel ?? '').trim().toLowerCase();
  if (v === 'critical' || v === 'high') return 'High';
  if (v === 'medium') return 'Medium';
  return 'Low';
}

/** The guidance for a case, by its level and type. */
export function guidanceFor(
  riskLevel: string,
  caseType = '',
  locale: GuidanceLocale = 'en',
): { risk: GuidanceRisk; copy: GuidanceCopy } {
  const risk = toGuidanceRisk(riskLevel);
  const base = GUIDANCE[locale][risk];
  const override = BY_CASE_TYPE[caseType.trim().toLowerCase()]?.[risk];
  return { risk, copy: override ? { ...base, ...override } : base };
}

/**
 * The barangay hall number from settings.
 *
 * Returns null when nothing is configured, so the button can say what it is
 * for without printing a number nobody can ring.
 */
export function barangayHotline(): string | null {
  const hall = EMERGENCY_CONTACTS.find(c => /station|hall|barangay/i.test(c.label))
    ?? EMERGENCY_CONTACTS[0];
  return hall?.number?.trim() || null;
}
