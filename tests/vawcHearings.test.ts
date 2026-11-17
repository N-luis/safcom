/**
 * VAWC Hearings (the renamed VAWC Appointments; records in VawcAppointment) -
 * the specification's checks 1 to 20, through the real routes and the real
 * database, in-process (no dev server). Check 21 (desktop, tablet and mobile
 * layouts) is done in a browser.
 * Run with:  npm run test:vawchearings
 *
 * Needs migrations 019 and 020 applied. Temporary rows are marked PROBE-VH
 * and removed at the end. Fictional data only.
 */
import fs from 'fs';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { phDay } from '../lib/hearings';
import { GET as listGET, POST as createPOST } from '../app/api/vawc/appointments/route';
import { GET as casesGET } from '../app/api/vawc/appointments/cases/route';
import { GET as oneGET, PATCH as onePATCH } from '../app/api/vawc/appointments/[aid]/route';
import { GET as residentGET } from '../app/api/resident/appointments/route';
import { POST as residentPOST } from '../app/api/resident/appointments/[aid]/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { GET as hearingCasesGET } from '../app/api/hearings/cases/route';
import { GET as hearingsGET } from '../app/api/hearings/route';
import { POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-VH';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const refuse = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
const read = (f: string) => fs.readFileSync(f, 'utf8');
const navLabels = (src: string) => [...src.matchAll(/\{ id: '([^']+)', label: '([^']+)'[^}]*path: '([^']+)'/g)].map(m => ({ id: m[1], label: m[2], path: m[3] }));

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── 1-4  The sidebars and the pages each opens ──
    console.log('TEST 1-4  Sidebar: "Hearings" for both desks, same place, separate modules');
    const vNav = navLabels(read('app/vawc/layout.tsx'));
    const bNav = navLabels(read('app/blotter-officer/layout.tsx'));
    ok('1. VAWC officers see "Hearings", not "Appointments"', vNav.some(n => n.label === 'Hearings') && !vNav.some(n => /appointment/i.test(n.label)), vNav.map(n => n.label).join());
    const after = (nav: typeof vNav) => nav[nav.findIndex(n => n.label === 'Case Classification') + 1]?.label;
    ok('2. the same place as the Blotter item: right after Case Classification, same icon', after(vNav) === 'Hearings' && after(bNav) === 'Hearings'
      && /id: 'hearings', label: 'Hearings', icon: Gavel/.test(read('app/vawc/layout.tsx')) && /id: 'hearings', label: 'Hearings', icon: Gavel/.test(read('app/blotter-officer/layout.tsx')),
      `${after(vNav)} / ${after(bNav)}`);
    ok('3. the Blotter item still opens its KP Hearing Management, unchanged', bNav.find(n => n.label === 'Hearings')?.path === '/blotter-officer/hearings'
      && /HearingManagement/.test(read('app/blotter-officer/hearings/page.tsx')));
    ok('4. the VAWC item opens /vawc/hearings (the VAWC module); old /vawc/appointments links redirect there', vNav.find(n => n.label === 'Hearings')?.path === '/vawc/hearings'
      && /VawcAppointments/.test(read('app/vawc/hearings/page.tsx')) && /redirect\(/.test(read('app/vawc/appointments/page.tsx')));

    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.vh.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mk('vawc', 'vawc_officer');
    const V2 = await mk('vawc2', 'vawc_officer');
    const B = await mk('blotter', 'officer');
    const C = await mk('captain', 'admin');
    const SA = await mk('sysadmin', 'system_admin');
    const mkRes = async (k: string, first: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: first, lastName: 'Probe', age: 30, gender: 'Female',
        barangay: 'Ayukit', address: `${k} fictional address`, emailVerified: true } });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const R1 = await mkRes('a', 'Ana');   // filed the VAWC case
    const R2 = await mkRes('b', 'Bea');   // unrelated resident
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Fictional Reporter', caseType: 'Domestic Violence',
        barangay: 'Probe Street', description: 'fictional test narrative', status: 'Open', riskLevel: 'High', residentId: R1.id, assignedToId: V.id,
        reportingRelationship: 'SELF', contactPreference: 'no_phone', ...d } as never });
      caseIds.push(c.id); return c;
    };
    const KV = await mkCase({});                                                                   // assigned to V, filed by R1
    // A VAWC case with every optional detail empty, never scheduled: it must still be listed.
    const KVbare = await mkCase({ caseType: 'Economic Abuse', riskLevel: null, residentId: null, contactPreference: null, reportingRelationship: null });
    const KVfree = await mkCase({ caseType: 'Stalking', assignedToId: null });                      // unassigned: V may take it
    const KVother = await mkCase({ assignedToId: V2.id });                                         // another officer's
    const KB = await mkCase({ caseType: 'Noise Complaint', assignedToId: B.id, contactPreference: null, reportingRelationship: null }); // blotter

    const PA = (aid: string) => ({ params: Promise.resolve({ aid }) });
    const create = (cookie: string, body: Body) => createPOST(req('/api/vawc/appointments', cookie, 'POST', body)).then(json);
    const patch = (aid: string, cookie: string, body: Body) => onePATCH(req(`/api/vawc/appointments/${aid}`, cookie, 'PATCH', body), PA(aid)).then(json);
    const one = (aid: string, cookie: string) => oneGET(req(`/api/vawc/appointments/${aid}`, cookie), PA(aid)).then(json);
    const list = (cookie: string, q = '') => listGET(req(`/api/vawc/appointments?${q}`, cookie)).then(json);
    const picker = (cookie: string, q = '') => casesGET(req(`/api/vawc/appointments/cases?${q}`, cookie)).then(json);
    const feed = async (cookie: string) => ((await json(await updatesGET(req('/api/resident/updates?limit=30', cookie)))).body.data ?? []) as Body[];
    const day = (o: number) => phDay(new Date(Date.now() + o * 86_400_000));

    console.log('\nTEST 5-8  The cases');
    const pk = await picker(V.cookie);
    const ids = (pk.body.data?.rows ?? []).map((r: Body) => r.id) as string[];
    ok('5. the VAWC officer sees actual VAWC cases: their own and the unassigned ones', pk.status === 200 && ids.includes(KV.id) && ids.includes(KVfree.id), JSON.stringify(pk.body).slice(0, 200));
    ok('   ...not another officer\'s case', !ids.includes(KVother.id));
    ok('   ...with reference, type, date, status and assigned officer', (() => { const r = pk.body.data.rows.find((x: Body) => x.id === KV.id);
      return r?.caseNumber === KV.caseNumber && r.caseType === 'Domestic Violence' && Boolean(r.filedAt) && r.status === 'Open' && r.assignedTo?.id === V.id && r.canSchedule === true; })());
    ok('   the Punong Barangay sees every VAWC case', ((await picker(C.cookie)).body.data.rows as Body[]).some(r => r.id === KVother.id));
    ok('6. no blotter case in the list, nor when searched for by its reference', !ids.includes(KB.id)
      && !((await picker(V.cookie, `q=${encodeURIComponent(KB.caseNumber)}`)).body.data.rows as Body[]).length);
    ok('7. a case with no hearing and every optional field empty is listed', ids.includes(KVbare.id));
    const ctx = await picker(V.cookie, `caseId=${KVbare.id}`);
    ok('   ...and selecting it loads (this call failed before: the table was missing)', ctx.status === 200 && ctx.body.data.appointments === 0 && ctx.body.data.canEdit === true, `${ctx.status} ${ctx.body.error ?? ''}`);
    const ctx1 = await picker(V.cookie, `caseId=${KV.id}`);
    const c1 = ctx1.body.data?.case;
    ok('8. selecting a case loads its own details: reference, type, officer, account, safe-contact preference', ctx1.status === 200 && c1.id === KV.id && c1.caseNumber === KV.caseNumber
      && c1.caseType === 'Domestic Violence' && c1.assignedTo?.id === V.id && c1.hasAccount === true && c1.contact.preference === 'no_phone' && !('description' in c1) && !('residentName' in c1));
    ok('   the blotter case cannot be selected (refused with the reason)', (await picker(V.cookie, `caseId=${KB.id}`)).status === 422);

    console.log('\nTEST 9-13  Create, save, list, calendar, refresh');
    const base = { caseId: KV.id, type: 'VICTIM_INTERVIEW', date: day(3), time: '10:00', venue: 'VAWC Desk - private room', participants: ['REPORTER'],
      purpose: 'PROBE-PURPOSE initial private interview', internalNotes: 'PROBE-INTERNAL do not disclose', notifyVia: 'SAFECOMM_ACCOUNT', residentInstructions: 'Bring any papers you have.' };
    const key = `${TAG}-key-${process.pid}-a`;
    const [c1a, c1b] = await Promise.all([create(V.cookie, { ...base, submissionKey: key }), create(V.cookie, { ...base, submissionKey: key })]);
    const aid = (c1a.body.data?.id ?? c1b.body.data?.id) as string;
    ok('9. Create Hearing succeeds', [c1a.status, c1b.status].includes(201), `${c1a.status} ${c1a.body.error ?? ''} / ${c1b.status} ${c1b.body.error ?? ''}`);
    ok('   a double submit of the same form saves one record', c1a.body.data?.id === c1b.body.data?.id && (await prisma.vawcAppointment.count({ where: { caseId: KV.id } })) === 1,
      `${c1a.status}/${c1b.status}`);
    const again = await create(V.cookie, { ...base, submissionKey: key });
    ok('   ...and a retry later returns that record, nothing new', again.status === 200 && again.body.data.duplicate === true && again.body.data.id === aid);
    const row = await prisma.vawcAppointment.findUnique({ where: { id: aid } });
    ok('10. saved against the VAWC case id, the officer, type, date, venue, purpose, status and timestamps', row?.caseId === KV.id && row.assignedOfficerId === V.id
      && row.createdById === V.id && row.type === 'VICTIM_INTERVIEW' && phDay(row.scheduledAt) === day(3) && row.venue === base.venue && row.purpose === base.purpose
      && row.status === 'SCHEDULED' && Boolean(row.createdAt) && Boolean(row.updatedAt) && row.participants.join() === 'REPORTER');

    // The court date: a Hearing type, with the court's details, tracked only.
    ok('   a court date without its matter or official source is refused', (await create(V.cookie, { ...base, type: 'EXTERNAL_COURT_HEARING', venue: 'RTC Branch 1', time: '08:30' })).status === 400);
    ok('   court details on another type are refused', (await create(V.cookie, { ...base, courtMatter: 'TPO', courtSource: 'COURT_NOTICE', time: '13:00' })).status === 400);
    ok('   SafeComm cannot be asked to conduct it', (await create(V.cookie, { ...base, action: 'conduct_hearing', type: 'EXTERNAL_COURT_HEARING', courtMatter: 'TPO', courtSource: 'COURT_NOTICE' })).status === 400);
    const ct = await create(V.cookie, { ...base, type: 'EXTERNAL_COURT_HEARING', date: day(5), time: '08:30', venue: 'RTC Branch 12 (Family Court) - fictional',
      courtMatter: 'TPO', courtSource: 'COURT_NOTICE', courtReference: 'FC-PROBE-0001', purpose: 'PROBE accompany the client to the TPO hearing', submissionKey: `${TAG}-key-${process.pid}-c` });
    const cid = ct.body.data?.id as string;
    const crow = cid ? await prisma.vawcAppointment.findUnique({ where: { id: cid } }) : null;
    ok('   an external court hearing is saved as a Hearing with its court details', ct.status === 201 && crow?.type === 'EXTERNAL_COURT_HEARING' && crow.courtMatter === 'TPO'
      && crow.courtSource === 'COURT_NOTICE' && crow.courtReference === 'FC-PROBE-0001', `${ct.status} ${ct.body.error ?? ''}`);
    ok('   the database refuses court details on another type', await refuse(() => prisma.vawcAppointment.update({ where: { id: aid }, data: { courtMatter: 'TPO' } })));
    ok('   the database refuses a court type without its source', await refuse(() => prisma.vawcAppointment.update({ where: { id: cid }, data: { courtSource: null } })));
    for (const t of ['INTAKE_FOLLOW_UP', 'SAFETY_FOLLOW_UP', 'REFERRAL_COORDINATION', 'CASE_CONFERENCE']) {
      const r = await create(V.cookie, { ...base, caseId: KVbare.id, type: t, date: day(6), time: ['09:00', '10:30', '13:00', '14:30'][['INTAKE_FOLLOW_UP', 'SAFETY_FOLLOW_UP', 'REFERRAL_COORDINATION', 'CASE_CONFERENCE'].indexOf(t)],
        participants: t === 'CASE_CONFERENCE' ? ['VAWC_STAFF'] : ['REPORTER'], notifyVia: 'OFFICER_CONTACT', residentInstructions: undefined });
      ok(`   type ${t} is saved on the case that had no hearing`, r.status === 201, `${r.status} ${r.body.error ?? ''}`);
    }

    const l = await list(V.cookie, 'view=upcoming');
    const lr = (l.body.data?.rows ?? []).find((r: Body) => r.id === aid);
    ok('11. it is in the Hearings list with the case reference, type, date, officer and status', l.status === 200 && lr?.case.caseNumber === KV.caseNumber
      && lr.typeLabel === 'Victim-survivor interview' && phDay(lr.scheduledAt) === day(3) && lr.officer?.id === V.id && lr.status === 'SCHEDULED');
    const cal = await list(V.cookie, `from=${day(-3)}&to=${day(38)}`);
    const calIds = (cal.body.data?.rows ?? []).map((r: Body) => r.id) as string[];
    ok('12. it is in the calendar\'s range, from the same records, once each', cal.status === 200 && calIds.includes(aid) && calIds.includes(cid) && new Set(calIds).size === calIds.length);
    const fresh = `safcom_token=${signToken({ userId: V.id, email: V.email, role: 'vawc_officer' })}`;
    ok('13. still there after a refresh and a new sign-in', ((await list(fresh, 'view=all')).body.data.rows as Body[]).some(r => r.id === aid));

    console.log('\nTEST 14-16  Reschedule, cancel, complete, follow-up');
    const rs = await patch(aid, V.cookie, { action: 'reschedule', date: day(4), time: '14:00', reason: 'Fictional: the client asked for the afternoon' });
    const moved = await prisma.vawcAppointment.findUnique({ where: { id: aid } });
    ok('14. rescheduling works: new date, status, count and history', rs.status === 200 && moved?.status === 'RESCHEDULED' && moved.rescheduleCount === 1 && phDay(moved.scheduledAt) === day(4)
      && (await prisma.vawcAppointmentEvent.count({ where: { appointmentId: aid, kind: 'rescheduled' } })) === 1, `${rs.status} ${rs.body.error ?? ''}`);
    const toCancel = (await create(V.cookie, { ...base, date: day(8), time: '11:00', notifyVia: 'NONE', participants: ['VAWC_STAFF'], residentInstructions: undefined })).body.data.id as string;
    const cn = await patch(toCancel, V.cookie, { action: 'cancel', reason: 'Fictional: no longer needed' });
    const cancelled = await prisma.vawcAppointment.findUnique({ where: { id: toCancel } });
    ok('15. cancellation works, kept with its reason', cn.status === 200 && cancelled?.status === 'CANCELLED' && Boolean(cancelled.cancelledAt) && cancelled.statusReason === 'Fictional: no longer needed');
    ok('    a cancelled hearing cannot be moved', (await patch(toCancel, V.cookie, { action: 'reschedule', date: day(9), time: '09:00', reason: 'x x x' })).status === 409);
    ok('    the outcome cannot be recorded before the day', (await patch(aid, V.cookie, { action: 'record', held: true, attendance: 'ATTENDED' })).status === 409);
    await prisma.vawcAppointment.update({ where: { id: aid }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });  // its day has come (fictional)
    const done = await patch(aid, V.cookie, { action: 'record', held: true, attendance: 'ATTENDED', outcomeNotes: 'PROBE-OUTCOME fictional', followUpActions: 'Fictional: safety plan review',
      referralStatus: 'TO_BE_MADE', nextDate: day(10), nextTime: '09:00' });
    const held = await prisma.vawcAppointment.findUnique({ where: { id: aid } });
    ok('16. marked completed with attendance, outcome, follow-up actions and the next date', done.status === 200 && held?.status === 'COMPLETED' && held.attendance === 'ATTENDED'
      && held.outcomeNotes === 'PROBE-OUTCOME fictional' && held.followUpActions === 'Fictional: safety plan review' && phDay(held.nextAppointmentAt!) === day(10));
    ok('    the outcome can be added to afterwards', (await patch(aid, V.cookie, { action: 'amend_outcome', referralStatus: 'IN_PROGRESS' })).status === 200
      && (await prisma.vawcAppointment.findUnique({ where: { id: aid } }))?.referralStatus === 'IN_PROGRESS');
    const fu = await create(V.cookie, { ...base, type: 'SAFETY_FOLLOW_UP', date: day(10), time: '09:00', submissionKey: `${TAG}-key-${process.pid}-f` });
    ok('    a follow-up hearing is added on the same case', fu.status === 201 && (await prisma.vawcAppointment.findUnique({ where: { id: fu.body.data.id } }))?.caseId === KV.id);
    const hist = await one(aid, V.cookie);
    ok('    the history keeps each step, with who did it', hist.status === 200 && ['created', 'resident_notified', 'rescheduled', 'completed', 'outcome_amended']
      .every(k => (hist.body.data.appointment.events as Body[]).some(e => e.kind === k)), (hist.body.data?.appointment?.events ?? []).map((e: Body) => e.kind).join());
    ok('    the history cannot be rewritten (database)', await refuse(() => prisma.vawcAppointmentEvent.updateMany({ where: { appointmentId: aid }, data: { note: 'x' } })));

    console.log('\nTEST 17  The resident');
    const f1 = await feed(R1.cookie);
    const notes = f1.filter(u => u.title === 'Appointment update').map(u => String(u.message));
    ok('17. the resident who filed the case gets in-app notices with the date', notes.some(m => /appointment with the barangay on/.test(m)) && notes.some(m => /new date/.test(m)), notes.join(' | '));
    ok('    the court date notice is plain: a date, no court, no case', notes.some(m => /scheduled date on .* has been noted for you/.test(m)) && !notes.some(m => /court|RTC|TPO|VAWC|abuse|violence|PROBE|SC-|interview/i.test(m)));
    const mine = await json(await residentGET(req('/api/resident/appointments', R1.cookie)));
    const mineText = JSON.stringify(mine.body);
    ok('    My Appointments shows the date and instructions, never the purpose, notes, outcome or reference', mine.status === 200 && mine.body.data.upcoming.length >= 1
      && !/PROBE-PURPOSE|PROBE-INTERNAL|PROBE-OUTCOME|APT-|FC-PROBE/.test(mineText) && mineText.includes('Bring any papers you have.'));
    ok('    a court date tells them the barangay does not hold it', mineText.includes('The barangay does not hold this hearing'));
    ok('    a hearing kept to the officials (no notice) never reaches the account', !(mine.body.data.all as Body[]).some(a => a.id === toCancel));
    const upcomingCourt = (mine.body.data.upcoming as Body[]).find(a => a.title === 'Court date');
    const ack = await json(await residentPOST(req(`/api/resident/appointments/${cid}`, R1.cookie, 'POST', { action: 'acknowledge' }), PA(cid)));
    ok('    the resident acknowledges', Boolean(upcomingCourt) && ack.status === 200 && Boolean((await prisma.vawcAppointment.findUnique({ where: { id: cid } }))?.residentAcknowledgedAt));
    const ask = await json(await residentPOST(req(`/api/resident/appointments/${fu.body.data.id}`, R1.cookie, 'POST', { action: 'reschedule', reason: 'Fictional: I work that morning', preferredSchedule: 'Afternoons' }), PA(fu.body.data.id)));
    ok('    ...and asks for a new date', ask.status === 201);
    const toV = await prisma.notification.findMany({ where: { caseId: KV.id, userId: V.id }, select: { title: true, message: true } });
    ok('    the assigned official is told of both answers', toV.some(x => /acknowledged by the resident/.test(x.title)) && toV.some(x => /New date requested/.test(x.title)), toV.map(x => x.title).join(' | '));
    ok('    the staff notices carry no purpose, note or outcome', !/PROBE-PURPOSE|PROBE-INTERNAL|PROBE-OUTCOME|Fictional: I work/.test(JSON.stringify(toV)));
    ok('    an unrelated resident is told nothing and sees nothing', !(await feed(R2.cookie)).some(u => u.title === 'Appointment update')
      && ((await json(await residentGET(req('/api/resident/appointments', R2.cookie)))).body.data.all as Body[]).length === 0);
    ok('    nor can they act on someone else\'s hearing', (await json(await residentPOST(req(`/api/resident/appointments/${cid}`, R2.cookie, 'POST', { action: 'acknowledge' }), PA(cid)))).status === 404);
    ok('    the respondent is never a participant (route and database)', (await create(V.cookie, { ...base, participants: ['REPORTER', 'RESPONDENT'] })).status === 400
      && await refuse(() => prisma.vawcAppointment.update({ where: { id: aid }, data: { participants: ['REPORTER', 'RESPONDENT'] } })));

    console.log('\nTEST 18  Who may reach the records');
    ok('18. a blotter officer: the list is refused, the hearing does not exist', (await list(B.cookie)).status === 403 && (await one(aid, B.cookie)).status === 404
      && (await picker(B.cookie)).status === 403);
    ok('    the system administrator: the same', (await list(SA.cookie)).status === 403 && (await one(aid, SA.cookie)).status === 404);
    ok('    another VAWC officer cannot open or change this case\'s hearings', (await one(aid, V2.cookie)).status === 403
      && (await patch(cid, V2.cookie, { action: 'cancel', reason: 'x x x' })).status === 403
      && !((await list(V2.cookie, 'view=all')).body.data.rows as Body[]).some(r => r.caseId === KV.id || r.case?.id === KV.id));
    ok('    the Punong Barangay may view, not change, what is not assigned to them', (await one(aid, C.cookie)).status === 200 && (await patch(cid, C.cookie, { action: 'cancel', reason: 'x x x' })).status === 403);
    ok('    a resident session cannot use the officials\' routes', (await list(R1.cookie)).status === 401 && (await create(R1.cookie, base)).status === 401);
    ok('    internal notes reach only the officials\' detail view', (await one(aid, V.cookie)).body.data.appointment.internalNotes === 'PROBE-INTERNAL do not disclose'
      && !JSON.stringify((await list(V.cookie, 'view=all')).body).includes('PROBE-INTERNAL'));
    ok('    every look and change is in the access log', (await prisma.reporterAccessLog.count({ where: { caseId: KV.id, fields: { has: 'vawc_appointments' } } })) >= 10);
    ok('    the public API roles cannot read the tables (RLS on, nothing granted)', (await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM information_schema.role_table_grants WHERE table_schema = 'public'
      AND table_name IN ('VawcAppointment','VawcAppointmentEvent','VawcAppointmentRequest') AND grantee IN ('anon','authenticated')`)[0].n === BigInt(0)
      && (await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_class WHERE relname IN ('VawcAppointment','VawcAppointmentEvent','VawcAppointmentRequest') AND relrowsecurity`)[0].n === BigInt(3));

    console.log('\nTEST 19  VAWC and Blotter hearings stay apart');
    const kp = await json(await caseHearingsPOST(req(`/api/cases/${KV.id}/hearings`, C.cookie, 'POST', { stage: 'MEDIATION', date: day(3), time: '09:00', venue: 'Barangay Hall' }), { params: Promise.resolve({ id: KV.id }) }));
    ok('19. KP mediation on the VAWC case is refused', kp.status === 422, `${kp.status} ${kp.body.error}`);
    ok('    the database refuses a KP hearing row on it, and a VAWC hearing on the blotter case', await refuse(() => prisma.caseHearing.create({ data: { caseId: KV.id, reference: `${TAG}-kp`, hearingNumber: 1,
      scheduledAt: new Date(), createdById: C.id, updatedById: C.id } })) && await refuse(() => prisma.vawcAppointment.create({ data: { caseId: KB.id, reference: `${TAG}-x`,
      type: 'VICTIM_INTERVIEW', scheduledAt: new Date(), venue: 'x', participants: ['REPORTER'], purpose: 'x', notifyVia: 'NONE', createdById: V.id, updatedById: V.id } })));
    const bh = await json(await hearingCasesGET(req('/api/hearings/cases', B.cookie)));
    ok('    the Blotter Hearings list has the blotter case and no VAWC case', bh.status === 200 && JSON.stringify(bh.body).includes(KB.caseNumber) && !JSON.stringify(bh.body).includes(KV.caseNumber));
    ok('    the VAWC desk is refused the Blotter Hearings module', (await json(await hearingsGET(req('/api/hearings', V.cookie)))).status === 403);
    ok('    a VAWC hearing on the blotter case is refused by the route', (await create(V.cookie, { ...base, caseId: KB.id })).status === 422);

    console.log('\nTEST 20  Records made before the rename still load');
    // The live database had no VAWC appointment rows before 019 was applied; this is a row in the
    // 019 shape (no court columns, no submission key), written the way the old module wrote it.
    const legacy = await prisma.vawcAppointment.create({ data: { caseId: KV.id, reference: `APT-${KV.caseNumber}-legacy`, type: 'INTAKE_FOLLOW_UP',
      scheduledAt: new Date(Date.now() + 12 * 86_400_000), venue: 'VAWC Desk', participants: ['REPORTER'], purpose: 'PROBE legacy row', notifyVia: 'OFFICER_CONTACT',
      createdById: V.id, updatedById: V.id } });
    ok('20. an appointment saved before the rename loads in Hearings (list and details) on its original case', ((await list(V.cookie, 'view=all')).body.data.rows as Body[])
      .some(r => r.id === legacy.id && r.case.id === KV.id) && (await one(legacy.id, V.cookie)).body.data?.appointment?.caseId === KV.id);
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
    && await prisma.vawcAppointment.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.vawcAppointmentEvent.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.vh.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
