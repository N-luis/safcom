import 'server-only';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { VAWC_TYPES } from './vawcTypes';
import { isVawcCaseHidden } from './caseAccess';
import { BLOTTER_ROLES, VAWC_DESK_ROLES, type Actor } from './reporterAccess';
import { decideIntakeAccess } from './officialIntake';
import { canExportCases, toCsv, MAX_EXPORT_ROWS, type ExportPeriod } from './caseExport';

/**
 * The cases an official may export - the same rule as listing them, and each
 * desk its own: a blotter official the blotter cases, the VAWC desk the VAWC
 * cases, the Punong Barangay both. Applied in the query AND re-checked on
 * every row before it is written.
 */
export function exportScope(role: string): Record<string, unknown> | null {
  const r = role.trim();
  if (!canExportCases(r)) return null;
  if (BLOTTER_ROLES.includes(r)) return { caseType: { notIn: [...VAWC_TYPES] } };
  if (VAWC_DESK_ROLES.includes(r)) return { caseType: { in: [...VAWC_TYPES] } };
  return {}; // the captain (admin): both desks
}
const ownDesk = (role: string, caseType: string) => {
  const vawc = (VAWC_TYPES as readonly string[]).includes(caseType);
  const r = role.trim();
  if (BLOTTER_ROLES.includes(r)) return !vawc;
  if (VAWC_DESK_ROLES.includes(r)) return vawc;
  return true;
};

export const EXPORT_HEADERS = [
  'Case Reference', 'Incident Date', 'Case Type', 'Reporting Desk', 'Status',
  'Reporter', 'Respondent(s)', 'Assigned Officer', 'Date Reported (PH time)', 'Last Updated (PH time)',
];
/** Columns SafeComm writes itself (reference, dates, desk) - not person-typed text. */
const TRUSTED_COLUMNS = [0, 1, 3, 8, 9];
/** Written where a value exists but this official may not see it - never confused with "none recorded". */
export const RESTRICTED = '(restricted)';

const phTime = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

export type ExportResult =
  | { ok: true; csv: string; count: number; exportId: string; respondentsRestricted: number }
  | { ok: false; status: number; error: string; undated?: number };

/**
 * Build the export: the cases whose incident date falls in the period (whole
 * days, inclusive), one row per case, then the audit trail - one access-log
 * row per exported case naming the official, the period and the total.
 */
export async function buildCaseExport(actor: Actor, period: ExportPeriod): Promise<ExportResult> {
  const scope = actor.active ? exportScope(actor.role) : null;
  if (!scope) return { ok: false, status: 403, error: 'Your role cannot export case records.' };

  // A date column: the period's first and last days, both included, compared as calendar dates.
  const where = { ...scope, incidentDate: { gte: new Date(`${period.start}T00:00:00Z`), lte: new Date(`${period.end}T00:00:00Z`) } };
  const total = await prisma.case.count({ where });
  if (total === 0) {
    // Said, so an empty result is not mistaken for a quiet period: cases with no incident date cannot be placed in one.
    const undated = await prisma.case.count({ where: { ...scope, incidentDate: null } });
    return { ok: false, status: 404, error: 'No cases found for the selected period', undated };
  }
  if (total > MAX_EXPORT_ROWS) return { ok: false, status: 413, error: `That period has ${total} cases - more than ${MAX_EXPORT_ROWS} in one file. Choose a shorter period.` };

  // One row per case: the people are read as a list on the case, never joined into extra rows.
  const cases = await prisma.case.findMany({
    where, orderBy: [{ incidentDate: 'asc' }, { filedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, caseNumber: true, incidentDate: true, caseType: true, status: true, residentName: true, assignedToId: true,
      filedAt: true, updatedAt: true,
      assignedTo: { select: { name: true } },
      parties: { where: { role: 'REPORTED' }, orderBy: { createdAt: 'asc' }, select: { fullName: true } },
    },
  });

  let respondentsRestricted = 0;
  const rows: (string | null)[][] = [];
  const exported: typeof cases = [];
  for (const c of cases) {
    // Every record checked again, as if it were opened: a row this official may not see is not written.
    if (isVawcCaseHidden(actor.role, c.caseType) || !ownDesk(actor.role, c.caseType)) continue;
    const names = c.parties.map(p => p.fullName?.trim()).filter((n): n is string => Boolean(n));
    // The people in a case: for the official it is assigned to, or the captain - the case records' own rule.
    const mayViewPeople = decideIntakeAccess(actor, c).view;
    if (names.length && !mayViewPeople) respondentsRestricted++;
    rows.push([
      c.caseNumber,
      c.incidentDate!.toISOString().slice(0, 10),
      c.caseType,
      (VAWC_TYPES as readonly string[]).includes(c.caseType) ? 'VAWC' : 'Blotter',
      c.status,
      // As every case list shows it: an anonymous report says "Anonymous reporter", never a name.
      c.residentName,
      names.length ? (mayViewPeople ? names.join('; ') : RESTRICTED) : '',
      c.assignedTo?.name ?? 'Unassigned',
      phTime(c.filedAt),
      phTime(c.updatedAt),
    ]);
    exported.push(c);
  }
  if (!rows.length) return { ok: false, status: 404, error: 'No cases found for the selected period', undated: 0 };

  const exportId = randomUUID();
  // The audit trail: on every exported case, who took it out of SafeComm, when, for which period, and how many went with it.
  await prisma.reporterAccessLog.createMany({ data: exported.map(c => ({
    actorId: actor.id, actorRole: actor.role, caseId: c.id, caseNumber: c.caseNumber,
    fields: ['case_export'], outcome: 'permitted', code: 'case_export',
    reason: `CSV export, ${period.label}: ${rows.length} case${rows.length === 1 ? '' : 's'} (export ${exportId})`,
  })) });
  return { ok: true, csv: toCsv(EXPORT_HEADERS, rows, TRUSTED_COLUMNS), count: rows.length, exportId, respondentsRestricted };
}
