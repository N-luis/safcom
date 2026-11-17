/**
 * The Resident Directory on the Blotter and VAWC officials' dashboards: the
 * registered resident accounts, by name, and - one at a time, logged - a
 * resident's profile and contact details.
 *
 * What it never carries: a password, a sign-in id, a username, a token, the
 * resident's internal notes or risk flag, or anything about their cases. A
 * resident's reports stay behind each case's own access rules (a Blotter
 * official cannot learn from here that a resident has a VAWC case).
 *
 * Safe contact is per report (Case.contactPreference). A resident is called
 * only as the strictest preference across all of their reports allows - and
 * the reason is given in words that do not say which report or what kind.
 */
import { BLOTTER_ROLES, VAWC_DESK_ROLES, CONTACT_PREFERENCES, type ContactPreference } from './reporterAccess';

/** Blotter officials, the VAWC desk, and the Punong Barangay who oversees both. */
export const DIRECTORY_ROLES = [...BLOTTER_ROLES, ...VAWC_DESK_ROLES, 'admin'];
export const canUseDirectory = (role: string | null | undefined) => DIRECTORY_ROLES.includes((role ?? '').trim());

/** Registration states that are a resident on record. A rejected registration is not. */
export const DIRECTORY_STATUSES = ['Active', 'Pending'];

export const DIRECTORY_PAGE_SIZE = 8;

/** "ana probe" -> each word must be in the first or last name. */
export function nameWhere(q: string | null | undefined) {
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4).map(w => w.slice(0, 40));
  return words.map(w => ({ OR: [
    { firstName: { contains: w, mode: 'insensitive' as const } },
    { lastName: { contains: w, mode: 'insensitive' as const } },
  ] }));
}

/** Strictest first. */
const ORDER: ContactPreference[] = ['no_phone', 'text_first', 'call_ok'];

/** The strictest preference across a resident's reports, or null when none was given. */
export function strictestPreference(prefs: (string | null | undefined)[]): ContactPreference | null {
  const known = prefs.filter((p): p is ContactPreference => (CONTACT_PREFERENCES as readonly string[]).includes(p ?? ''));
  return ORDER.find(p => known.includes(p)) ?? null;
}

export interface ContactAdvice { callAllowed: boolean; label: string; guidance: string }

/** What the official is told about calling - never which report the wish came from. */
export function contactAdvice(pref: ContactPreference | null, hasPhone: boolean): ContactAdvice {
  if (!hasPhone) return { callAllowed: false, label: 'No phone number on file', guidance: 'Reach the resident through SafeComm messages or in person.' };
  if (pref === 'no_phone') {
    return { callAllowed: false, label: 'Do not call or text',
      guidance: 'The resident said phone contact is not safe for them. Use SafeComm messages or arrange contact in person.' };
  }
  if (pref === 'text_first') {
    return { callAllowed: true, label: 'Text first before calling',
      guidance: 'Send a short, neutral text first (no case details) and call only once they reply that it is safe to talk.' };
  }
  if (pref === 'call_ok') return { callAllowed: true, label: 'Calls are fine', guidance: 'The resident said they can be called.' };
  return { callAllowed: true, label: 'No preference given', guidance: 'Confirm they can talk safely before discussing anything private.' };
}
