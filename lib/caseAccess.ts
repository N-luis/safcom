/**
 * Who may read a VAWC case.
 *
 * A report of domestic violence, child abuse or rape is handled by the VAWC
 * desk, not the blotter. Keeping the two apart is the point of having two
 * modules, and it is a confidentiality rule rather than a UI preference: a
 * survivor who reports to the VAWC officer has not consented to every officer
 * in the barangay reading the narrative.
 *
 * Enforced in the database query rather than by hiding rows afterwards, so an
 * endpoint cannot leak them by forgetting to filter a response.
 */

import { VAWC_TYPES } from './vawcTypes';

/**
 * Roles the VAWC module is open to, matching the gate in proxy.ts. The captain
 * and the system administrator oversee both modules; a blotter officer does
 * not.
 */
const VAWC_ROLES = ['vawc_officer', 'vawc', 'vawc_lead', 'admin', 'system_admin'];

export function canSeeVawc(role: string | undefined | null): boolean {
  return VAWC_ROLES.includes((role ?? '').trim());
}

/**
 * A `where` fragment that hides VAWC cases from anyone not entitled to them.
 *
 * Spread into an existing filter. Returns nothing for a role that may see
 * them, so the query is unchanged for the VAWC desk and the captain.
 */
export function vawcFilter(role: string | undefined | null): Record<string, unknown> {
  return canSeeVawc(role) ? {} : { caseType: { notIn: [...VAWC_TYPES] } };
}

/** True when this particular case is one the role may not read. */
export function isVawcCaseHidden(role: string | undefined | null, caseType: string): boolean {
  return !canSeeVawc(role) && (VAWC_TYPES as readonly string[]).includes(caseType);
}

/**
 * An anonymous report as officials receive it: no link to the resident who
 * filed it. Applied to every staff response that carries case rows, so an
 * account id cannot be looked up in the resident directory.
 */
export function withholdReporter<T extends { reporterIdentityWithheld?: boolean | null; residentId?: string | null }>(c: T): T {
  return c.reporterIdentityWithheld ? { ...c, residentId: null } : c;
}
