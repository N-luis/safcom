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
 * Roles that may open a VAWC case - its narrative, its people, its photos.
 *
 * The VAWC desk, and the Punong Barangay ('admin'), who issues Barangay
 * Protection Orders under RA 9262 and so has to be able to read the case.
 * Not the system administrator: that is an IT role, and keeping the system
 * running is no reason to read a survivor's account. A blotter officer does
 * not either.
 */
const VAWC_ROLES = ['vawc_officer', 'vawc', 'vawc_lead', 'admin'];

export function canSeeVawc(role: string | undefined | null): boolean {
  return VAWC_ROLES.includes((role ?? '').trim());
}

/**
 * Roles that may see VAWC numbers - counts, trends, totals by area - without
 * any case behind them. The system administrator monitors the system as a
 * whole, so the caseload is visible to them in aggregate; an endpoint that
 * returns rows uses canSeeVawc instead.
 */
export function canSeeVawcStatistics(role: string | undefined | null): boolean {
  return canSeeVawc(role) || (role ?? '').trim() === 'system_admin';
}

/** vawcFilter, for an endpoint that returns counts only. */
export function vawcStatisticsFilter(role: string | undefined | null): Record<string, unknown> {
  return canSeeVawcStatistics(role) ? {} : { caseType: { notIn: [...VAWC_TYPES] } };
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

/**
 * The notifications a staff user may see: their own and everyone's, and never
 * one about a case their role may not read. The list, its unread count, and
 * marking or deleting one by id all use this, so an id from someone else's
 * list cannot be acted on.
 */
export function notificationsVisibleTo(user: { userId: string; role?: string | null }): Record<string, unknown> {
  const mine = { OR: [{ userId: user.userId }, { userId: null }] };
  const caseVisible = canSeeVawc(user.role)
    ? {}
    : { OR: [{ caseId: null }, { case: { caseType: { notIn: [...VAWC_TYPES] } } }] };
  return { AND: [mine, caseVisible] };
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
