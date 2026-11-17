/**
 * The VAWC Appointments, merged into hearings: the data migration
 * (lib/appointmentMigration.ts) and the retired module - through the real
 * database and routes, in-process.
 * Run with:  npm run test:vawcappointments
 *
 *   - the status and type mapping is the explicit table, and anything without
 *     a clear mapping is reported, never inserted;
 *   - running the migration twice makes no duplicate;
 *   - a migrated appointment keeps its case, dates, creator, participants and
 *     requests, and its old notices open the hearing it became;
 *   - nothing is written to appointments any more (410), the records stay
 *     readable, and the old pages redirect to My Hearings & Notices (no tabs).
 *
 * Temporary rows are marked PROBE-VA and removed at the end. Fictional data only.
 */
import fs from 'fs';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { APPOINTMENT_STATUS_MAP, APPOINTMENT_TYPE_MAP, migrateAppointments, planFor, formatReport } from '../lib/appointmentMigration';
import { APPOINTMENT_STATUSES, APPOINTMENT_TYPES } from '../lib/vawcAppointments';
import { GET as apptListGET, POST as apptPOST } from '../app/api/vawc/appointments/route';
import { PATCH as apptPATCH } from '../app/api/vawc/appointments/[aid]/route';
import { GET as resApptGET } from '../app/api/resident/appointments/route';
import { POST as resApptPOST } from '../app/api/resident/appointments/[aid]/route';
import { GET as residentGET } from '../app/api/resident/hearings/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { GET as caseHearingsGET } from '../app/api/cases/[id]/hearings/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-VA';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── 1. The mapping table ──
    console.log('\n1. The mapping, as an explicit table');
    ok('status: scheduled, rescheduled, completed, cancelled map across; "did not take place" has no clear mapping',
      APPOINTMENT_STATUS_MAP.SCHEDULED === 'SCHEDULED' && APPOINTMENT_STATUS_MAP.RESCHEDULED === 'RESCHEDULED' && APPOINTMENT_STATUS_MAP.COMPLETED === 'COMPLETED'
      && APPOINTMENT_STATUS_MAP.CANCELLED === 'CANCELLED' && APPOINTMENT_STATUS_MAP.NOT_HELD === null);
    ok('every appointment status and type is in the table (none is guessed)', Object.keys(APPOINTMENT_STATUSES).every(k => k in APPOINTMENT_STATUS_MAP)
      && Object.keys(APPOINTMENT_TYPES).every(k => k in APPOINTMENT_TYPE_MAP));
    ok('a court date is not made into a barangay hearing', APPOINTMENT_TYPE_MAP.EXTERNAL_COURT_HEARING === null && APPOINTMENT_TYPE_MAP.VICTIM_INTERVIEW === 'VICTIM_INTERVIEW');
    ok('a case no longer VAWC is left as it is', 'skip' in planFor({ status: 'SCHEDULED', type: 'VICTIM_INTERVIEW' }, 'Noise Complaint'));

    // ── Fixtures ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.va.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mk('vawc', 'vawc_officer');
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-a-${process.pid}`, firstName: 'Ana', lastName: 'Fictional', age: 30, gender: 'Female',
      barangay: 'Ayukit', address: 'Fictional address', contactNumber: '09170000000', emailVerified: true } });
    residents.push(r.id);
    const R = { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Ana', role: 'resident' })}` };
    let n = 0;
    const mkCase = async () => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Ana Fictional', caseType: 'Domestic Violence',
        barangay: 'Ortega Compound', description: 'temporary test case', status: 'Open', riskLevel: 'Medium', residentId: R.id, assignedToId: V.id } as never });
      caseIds.push(c.id); return c;
    };
    const K1 = await mkCase();
    const K2 = await mkCase();
    const at = (days: number) => new Date(Date.now() + days * 86_400_000);
    const created = new Date(Date.now() - 3 * 86_400_000);
    let a = 0;
    const appt = (caseId: string, d: Record<string, unknown>) => prisma.vawcAppointment.create({ data: {
      caseId, reference: `${TAG}-APT-${process.pid}-${++a}`, type: 'VICTIM_INTERVIEW', scheduledAt: at(4), venue: 'Barangay Hall, Room 2', participants: ['REPORTER', 'SUPPORT_PERSON'],
      purpose: 'Fictional: private interview', internalNotes: 'Fictional internal note', notifyVia: 'SAFECOMM_ACCOUNT', assignedOfficerId: V.id, createdById: V.id, updatedById: V.id, createdAt: created, ...d,
    } as never });
    const A1 = await appt(K1.id, { residentAcknowledgedAt: new Date(Date.now() - 86_400_000) });   // scheduled, acknowledged, a pending request
    await prisma.vawcAppointmentRequest.create({ data: { appointmentId: A1.id, caseId: K1.id, residentId: R.id, reason: 'Fictional: I work that morning', status: 'PENDING', pendingKey: A1.id } });
    await prisma.vawcAppointmentEvent.create({ data: { appointmentId: A1.id, caseId: K1.id, kind: 'created', actorType: 'official', actorId: V.id,
      after: { type: 'VICTIM_INTERVIEW', scheduledAt: A1.scheduledAt.toISOString() }, createdAt: created } });
    const A2 = await appt(K1.id, { status: 'NOT_HELD', scheduledAt: at(-2), completedAt: at(-2), completedById: V.id });                       // no clear mapping
    const A3 = await appt(K2.id, { type: 'EXTERNAL_COURT_HEARING', courtMatter: 'TPO', courtSource: 'COURT_NOTICE', participants: ['REPORTER'] }); // a court's date
    const A4 = await appt(K1.id, { type: 'CASE_CONFERENCE', status: 'COMPLETED', scheduledAt: at(-5), attendance: 'ATTENDED', completedAt: at(-5), completedById: V.id,
      outcomeNotes: 'Fictional outcome notes', participants: ['VAWC_STAFF', 'SERVICE_PROVIDER'], notifyVia: 'NONE' });
    const A5 = await appt(K1.id, { type: 'INTAKE_FOLLOW_UP', scheduledAt: at(6) });                  // second open one on K1
    const ids = [A1.id, A2.id, A3.id, A4.id, A5.id];

    // ── 2. Migrate ──
    console.log('\n2. The migration');
    const dry = await migrateAppointments({ dryRun: true, only: ids });
    ok('a dry run writes nothing', dry.created === 2 && await prisma.caseHearing.count({ where: { migratedFromAppointmentId: { in: ids } } }) === 0);
    const r1 = await migrateAppointments({ only: ids });
    console.log(formatReport(r1).split('\n').map(l => `      ${l}`).join('\n'));
    const reason = (id: string) => r1.skipped.find(s => s.appointmentId === id)?.reason;
    ok('summary reconciles: read = created + skipped', r1.read === 5 && r1.created === 2 && r1.skipped.length === 3 && r1.read === r1.created + r1.skipped.length);
    ok('per status', r1.byStatus.SCHEDULED?.read === 3 && r1.byStatus.SCHEDULED.created === 1 && r1.byStatus.COMPLETED?.created === 1 && r1.byStatus.NOT_HELD?.skipped === 1);
    ok('unmatched rows are reported, not inserted', reason(A2.id) === 'unmapped_status' && reason(A3.id) === 'unmapped_type' && reason(A5.id) === 'case_has_open_hearing'
      && await prisma.caseHearing.count({ where: { migratedFromAppointmentId: { in: [A2.id, A3.id, A5.id] } } }) === 0);
    ok('no hearing without a linked case', r1.hearingsWithoutCase === 0);
    const h1 = await prisma.caseHearing.findUnique({ where: { migratedFromAppointmentId: A1.id }, include: { requests: true, events: true } });
    ok('the hearing keeps the case, type, date, venue, creator and when it was made', h1?.caseId === K1.id && h1.stage === 'VICTIM_INTERVIEW' && h1.status === 'SCHEDULED'
      && h1.scheduledAt.getTime() === A1.scheduledAt.getTime() && h1.venue === A1.venue && h1.createdById === V.id && h1.createdAt.getTime() === created.getTime()
      && h1.assignedOfficialId === V.id && h1.openKey === K1.id && /Fictional: private interview/.test(h1.notes ?? ''));
    const ev = h1?.events.find(e => e.kind === 'migrated_from_appointment');
    const evAfter = (ev?.after ?? {}) as Body;
    ok('its history keeps the participants, the acknowledgement and where it came from', Boolean(ev) && evAfter.participants?.join() === 'REPORTER,SUPPORT_PERSON'
      && typeof evAfter.residentAcknowledgedAt === 'string' && evAfter.appointmentId === A1.id && evAfter.appointmentEvents?.[0]?.kind === 'created');
    ok('the pending request for a new date carries over', h1?.requests.length === 1 && h1.requests[0].status === 'PENDING' && h1.requests[0].requesterRole === 'COMPLAINANT');
    const h4 = await prisma.caseHearing.findUnique({ where: { migratedFromAppointmentId: A4.id } });
    ok('a completed appointment is a held hearing (outcome: held, attendance kept)', h4?.status === 'COMPLETED' && h4.outcome === 'HELD' && h4.complainantAttendance === 'PRESENT'
      && h4.openKey === null && h4.stage === 'CASE_CONFERENCE');
    ok('the appointment itself is unchanged', (await prisma.vawcAppointment.findUnique({ where: { id: A1.id } }))?.status === 'SCHEDULED');
    const r2 = await migrateAppointments({ only: ids });
    ok('running it twice creates no duplicate', r2.created === 0 && r2.skipped.filter(s => s.reason === 'already_migrated').length === 2
      && await prisma.caseHearing.count({ where: { migratedFromAppointmentId: { in: ids } } }) === 2);

    // ── 3. The resident ──
    console.log('\n3. The resident: one page, old notices open the hearing');
    const mine = (await json(await residentGET(req('/api/resident/hearings', R.cookie)))).body.data;
    ok('the migrated hearing is on My Hearings & Notices as a VAWC hearing', (mine.history as Body[]).flatMap(g => g.hearings).some(h => h.id === h1?.id && h.caseType === 'VAWC'));
    const feed = ((await json(await updatesGET(req('/api/resident/updates?limit=20', R.cookie)))).body.data ?? []) as Body[];
    const old = feed.find(u => u.title === 'Appointment update');
    ok('an old appointment notice opens the matching hearing', old?.href === `/resident/hearings?hearing=${h1?.id}`, old?.href);
    // (Followed in the browser too; next/navigation does not load under the server-only test conditions.)
    const pageSrc = fs.readFileSync('app/resident/appointments/page.tsx', 'utf8');
    ok('the old /resident/appointments URL redirects to My Hearings & Notices', /redirect\('\/resident\/hearings'\)/.test(pageSrc) && !/tab=appointments/.test(pageSrc));
    const moduleSrc = fs.readFileSync('components/hearings/ResidentHearingsModule.tsx', 'utf8');
    ok('the page has no tab bar and no Appointments tab', !/<Tabs|<Tab\b|ResidentAppointments/.test(moduleSrc) && /tab=|\.delete\('tab'\)/.test(moduleSrc));

    // ── 4. Nothing is written to appointments any more ──
    console.log('\n4. Appointments are read-only');
    const pa = await json(await apptPOST(req('/api/vawc/appointments', V.cookie, 'POST', { caseId: K2.id })));
    ok('creating an appointment: 410, pointing to hearings', pa.status === 410 && pa.body.code === 'appointments_retired' && /hearings/.test(pa.body.use ?? ''));
    ok('changing one: 410', (await json(await apptPATCH(req(`/api/vawc/appointments/${A1.id}`, V.cookie, 'PATCH', { action: 'cancel', reason: 'x' })))).status === 410);
    ok('a resident acknowledging or asking: 410', (await json(await resApptPOST(req(`/api/resident/appointments/${A1.id}`, R.cookie, 'POST', { action: 'acknowledge' })))).status === 410);
    ok('the records still read (for one release)', (await json(await apptListGET(req('/api/vawc/appointments?view=all', V.cookie)))).status === 200
      && (await json(await resApptGET(req('/api/resident/appointments', R.cookie)))).status === 200);
    ok('the VAWC officer runs the migrated hearing on the hearing screens', (await json(await caseHearingsGET(req(`/api/cases/${K1.id}/hearings`, V.cookie), { params: Promise.resolve({ id: K1.id }) })))
      .body.data?.hearings.some((h: Body) => h.id === h1?.id));
  } finally {
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.vawcAppointment.count({ where: { reference: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.va.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
