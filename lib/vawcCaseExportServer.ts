import 'server-only';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { VAWC_TYPES } from './vawcTypes';
import { canSeeVawc } from './caseAccess';
import { VAWC_DESK_ROLES, type Actor } from './reporterAccess';
import { decideIntakeAccess } from './officialIntake';
import { toCsv } from './caseExport';
import { TRIAGE } from './triageLabels';
import { RELATIONSHIP_LABEL, type ReportingRelationship } from './interviewTypes';

/**
 * VAWC Case Monitoring - Export CSV: every VAWC case the official may reach,
 * from the whole case history, as one file. No period to choose and no page
 * limit: the cases are read from the database in batches until none are left.
 *
 * WHO: the VAWC desk and the Punong Barangay ('admin') - the roles that open
 * VAWC Case Monitoring. Never a blotter officer or the system administrator.
 * Every row is checked again before it is written.
 *
 * WHAT: case information only. The narrative, contact details, evidence and
 * attachments are never read: no image, file name, storage path, URL or file
 * content is selected, so none can reach the file. The people in a case (the
 * victim-survivor and the person reported) are written only for the official
 * the case is assigned to, or the captain - the case records' own rule
 * (lib/officialIntake decideIntakeAccess); anyone else sees "(restricted)".
 *
 * AUDIT: one access-log row per exported case, naming the official, the export
 * and how many cases went with it - as the blotter export does.
 */

export const VAWC_EXPORT_ROLES = [...VAWC_DESK_ROLES, 'admin'];
export const canExportVawcCases = (role: string | null | undefined) => VAWC_EXPORT_ROLES.includes((role ?? '').trim()) && canSeeVawc(role);

export const VAWC_EXPORT_HEADERS = [
  'Case Reference', 'Case Type', 'Incident Date', 'Incident Time (as reported)', 'Date Reported (PH time)', 'Status', 'Risk Level', 'Triage Status',
  'Assigned VAWC Officer', 'Reporter', 'Reporter Is', 'Victim-Survivor(s)', 'Victim-Survivor Record(s)', 'Person(s) Reported', 'Last Updated (PH time)',
];
/** Columns SafeComm writes itself (reference, dates, labels) - not person-typed text. */
const TRUSTED = [0, 2, 4, 6, 7, 10, 14];
export const RESTRICTED = '(restricted)';
/** How many cases are read per database round trip. */
export const BATCH = 500;
/** Audit rows per insert: small statements, which every Postgres (the local test engine included) takes. */
const LOG_CHUNK = 50;

const phTime = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
export const phToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export const vawcExportFilename = (now = new Date()) => `SafeComm_VAWC_All_Cases_${phToday(now)}.csv`;

const caseSelect = {
  id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, triageStatus: true, incidentDate: true, incidentTimeApprox: true,
  filedAt: true, updatedAt: true, residentName: true, reporterIdentityWithheld: true, reportingRelationship: true, assignedToId: true,
  assignedTo: { select: { name: true } },
  // The people, as lists on the case - never joined into extra rows.
  parties: { orderBy: { createdAt: 'asc' as const }, select: { role: true, fullName: true } },
  victimSurvivors: { where: { removedAt: null }, orderBy: { createdAt: 'asc' as const }, select: { clientCode: true, sexAtBirth: true, ageAtIncident: true, birthDate: true } },
} as const;

/** One batch: the next BATCH VAWC cases after the cursor, oldest first. */
const loadBatch = (cursor: string | null) => prisma.case.findMany({
  where: { caseType: { in: [...VAWC_TYPES] } }, orderBy: [{ filedAt: 'asc' }, { id: 'asc' }], take: BATCH,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  select: caseSelect,
});

export type VawcExportResult =
  | { ok: true; csv: string; count: number; exportId: string; restricted: number; filename: string }
  | { ok: false; status: number; error: string };

export async function buildVawcCaseExport(actor: Actor, now = new Date()): Promise<VawcExportResult> {
  if (!actor.active || !canExportVawcCases(actor.role)) return { ok: false, status: 404, error: 'Not found' };

  // Every VAWC case, oldest first, a batch at a time, by a cursor on the id - nothing is cut off at a page size.
  const rows: (string | null)[][] = [];
  const exported: { id: string; caseNumber: string }[] = [];
  const seen = new Set<string>();
  let restricted = 0;
  let cursor: string | null = null;
  for (;;) {
    const batch: Awaited<ReturnType<typeof loadBatch>> = await loadBatch(cursor);
    for (const c of batch) {
      if (seen.has(c.id)) continue; // one row per case, whatever happens between batches
      seen.add(c.id);
      // Checked again as if opened: a VAWC case only, for a role that may read it.
      if (!(VAWC_TYPES as readonly string[]).includes(c.caseType) || !canSeeVawc(actor.role)) continue;
      const mayViewPeople = decideIntakeAccess(actor, c).view;
      const self = (c.reportingRelationship ?? 'SELF') === 'SELF';
      const affected = c.parties.filter(p => p.role === 'AFFECTED').map(p => p.fullName?.trim()).filter((n): n is string => Boolean(n));
      const reported = c.parties.filter(p => p.role === 'REPORTED').map(p => p.fullName?.trim()).filter((n): n is string => Boolean(n));
      const victims = affected.length ? affected.join('; ') : self ? 'Same as reporter' : '';
      const records = c.victimSurvivors.map(v => [
        v.clientCode ? `Client code ${v.clientCode}` : null, v.sexAtBirth,
        v.ageAtIncident !== null ? `age ${v.ageAtIncident}` : v.birthDate ? `born ${v.birthDate.toISOString().slice(0, 10)}` : null,
      ].filter(Boolean).join(', ')).filter(Boolean).join('; ');
      const hide = (v: string) => (v ? (mayViewPeople ? v : RESTRICTED) : '');
      if (!mayViewPeople && (affected.length || reported.length || records)) restricted++;
      const rel = c.reportingRelationship as ReportingRelationship | null;
      rows.push([
        c.caseNumber,
        c.caseType,
        c.incidentDate ? c.incidentDate.toISOString().slice(0, 10) : '',
        c.incidentTimeApprox ?? '',
        phTime(c.filedAt),
        c.status,
        c.riskLevel ?? 'Undetermined',
        c.triageStatus ? TRIAGE[c.triageStatus]?.label ?? c.triageStatus : '',
        c.assignedTo?.name ?? 'Unassigned',
        // As Case Monitoring shows it: an anonymous report is "Anonymous reporter", never a name.
        c.reporterIdentityWithheld ? 'Anonymous reporter' : c.residentName,
        rel && rel in RELATIONSHIP_LABEL ? RELATIONSHIP_LABEL[rel].en : '',
        hide(victims),
        hide(records),
        hide(reported.join('; ')),
        phTime(c.updatedAt),
      ]);
      exported.push({ id: c.id, caseNumber: c.caseNumber });
    }
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  if (!rows.length) return { ok: false, status: 404, error: 'There are no VAWC cases to export yet.' };

  const exportId = randomUUID();
  const reason = `CSV export, all VAWC cases: ${rows.length} case${rows.length === 1 ? '' : 's'} (export ${exportId})`;
  for (let i = 0; i < exported.length; i += LOG_CHUNK) {
    await prisma.reporterAccessLog.createMany({ data: exported.slice(i, i + LOG_CHUNK).map(c => ({
      actorId: actor.id, actorRole: actor.role, caseId: c.id, caseNumber: c.caseNumber,
      fields: ['case_export'], outcome: 'permitted', code: 'vawc_case_export', reason,
    })) });
  }
  return { ok: true, csv: toCsv(VAWC_EXPORT_HEADERS, rows, TRUSTED), count: rows.length, exportId, restricted, filename: vawcExportFilename(now) };
}
