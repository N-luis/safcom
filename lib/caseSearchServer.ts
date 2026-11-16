import 'server-only';
import type { Prisma } from '@/app/generated/prisma/client';
import { VAWC_TYPES } from './vawcTypes';
import { OVERSIGHT_ROLES } from './reporterAccess';
import type { ParsedSearch } from './caseSearch';

/**
 * The case search bar's query: one input matched, with OR, against
 *   - the case reference                    (partial, any case)
 *   - the case type / category              (partial, any case)
 *   - the reporter's name                   (Case.residentName as the list shows it; the linked
 *                                            account's name only when the reporter is not withheld)
 *   - the respondent / person reported      (CaseParty role REPORTED)
 *   - the victim-survivor                   (CaseParty role AFFECTED, VAWC cases, VAWC lists only)
 *   - the incident date                     (Case.incidentDate, when the input is a real date)
 * Names: every typed word must be found in the same name, in any order, so a
 * partial name ("Johndel") or a reordered one ("Orinoco Nico") still matches.
 * Relations are matched with EXISTS (`some`), so a case with several parties
 * is one result, never repeated.
 *
 * The caller's own access filter (desk, VAWC rule, a resident's own cases) is
 * ANDed with this - search only narrows what the caller may already list.
 */

export interface SearchScope {
  /** Match the reporter's name - not for a resident, who is the reporter. */
  reporterName: boolean;
  /**
   * When the people in a case (respondent, victim-survivor, the linked
   * account's name) may be matched: the same rule as opening the case's
   * records - `{}` always, a condition (the case is assigned to me), or
   * null never.
   */
  peopleVisible: Prisma.CaseWhereInput | null;
  /** Only party records the reporter supplied (a resident's own list). */
  reporterSuppliedOnly?: boolean;
  /** Match the victim-survivor's name on VAWC cases (the VAWC desk's lists). */
  victimSurvivor?: boolean;
  /** Also match the barangay / area (the officers' list always offered this). */
  barangay?: boolean;
  /** Also match the narrative (a resident searching their own reports). */
  description?: boolean;
}

const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });
/** Every word in the same field. */
const allWords = (field: string, tokens: string[]): Prisma.CaseWhereInput => ({ AND: tokens.map(t => ({ [field]: ci(t) })) });

/**
 * When an official may see who is in a case: the rule that gates the case's
 * records (lib/officialIntake decideIntakeAccess) - the officer it is assigned
 * to, or the oversight roles. Applied inside the search so an officer cannot
 * learn who is in a case they may not open by searching a name.
 */
export function peopleVisibleTo(actor: { id: string; role: string }): Prisma.CaseWhereInput {
  return OVERSIGHT_ROLES.includes(actor.role.trim()) ? {} : { assignedToId: actor.id };
}

export function caseSearchWhere(p: ParsedSearch, s: SearchScope): Prisma.CaseWhereInput {
  const words = p.tokens.length ? p.tokens : [p.text];
  // A category written with "and" for "&" ("Theft and Robbery") still matches its words.
  const typeWords = words.filter(w => !/^(and|at|&|-|\/)$/i.test(w));
  const or: Prisma.CaseWhereInput[] = [
    { caseNumber: ci(p.text) },
    { caseType: ci(p.text) },
    ...(typeWords.length > 1 ? [allWords('caseType', typeWords)] : []),
  ];
  if (s.reporterName) or.push(allWords('residentName', words));
  if (s.barangay) or.push({ barangay: ci(p.text) });
  if (s.description) or.push({ description: ci(p.text) });
  if (p.date) or.push({ incidentDate: new Date(`${p.date}T00:00:00Z`) });

  if (s.peopleVisible) {
    const party = (role: 'REPORTED' | 'AFFECTED'): Prisma.CasePartyWhereInput => ({
      role, ...(s.reporterSuppliedOnly ? { source: 'reporter' } : {}), AND: words.map(t => ({ fullName: ci(t) })),
    });
    const people: Prisma.CaseWhereInput[] = [{ parties: { some: party('REPORTED') } }];
    if (s.victimSurvivor) people.push({ caseType: { in: [...VAWC_TYPES] }, parties: { some: party('AFFECTED') } });
    // The reporter's own account name - never for a report whose reporter is withheld.
    if (s.reporterName) {
      people.push({ reporterIdentityWithheld: false, resident: { AND: words.map(t => ({ OR: [{ firstName: ci(t) }, { lastName: ci(t) }] })) } });
    }
    or.push(Object.keys(s.peopleVisible).length ? { AND: [s.peopleVisible, { OR: people }] } : { OR: people });
  }
  return { OR: or };
}
