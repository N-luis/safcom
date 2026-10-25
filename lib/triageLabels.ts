/**
 * How the triage status and an undetermined risk level read on screen.
 * Client-safe. The values themselves are set only by the server
 * (lib/intake.ts triageStatusFor, and the assessment review).
 */

export const TRIAGE: Record<string, { label: string; color: string; hint: string }> = {
  URGENT_REVIEW: { label: 'Urgent review', color: '#b91c1c', hint: 'Possible danger now - a person looks first.' },
  NEEDS_FOLLOW_UP: { label: 'Needs follow-up', color: '#c2410c', hint: 'Essential details are missing; not fully classified.' },
  FOR_REVIEW: { label: 'For review', color: '#a16207', hint: 'Enough is known, but the category or level is uncertain.' },
  PRELIMINARY: { label: 'Preliminary', color: '#0f766e', hint: 'Enough is known and the level is supported. An officer confirms it.' },
  ASSESSMENT_UNAVAILABLE: { label: 'Assessment unavailable', color: '#7c3aed', hint: 'The risk matrix could not be consulted.' },
  REVIEWED: { label: 'Reviewed', color: '#15803d', hint: 'An officer has confirmed or set the assessment.' },
};

export const TRIAGE_VALUES = Object.keys(TRIAGE);

/** A case filed before triage statuses existed. */
export const LEGACY_TRIAGE = { label: 'Legacy', color: '#64748b', hint: 'Filed before triage statuses; assessed the earlier way.' };

export const triageOf = (status: string | null | undefined) => (status && TRIAGE[status]) || LEGACY_TRIAGE;

/** A risk level for display: undetermined is said, never shown as blank or as Low. */
export const riskText = (level: string | null | undefined) => level || 'Undetermined';
