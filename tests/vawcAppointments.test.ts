/**
 * VAWC Appointments & Follow-ups - through the real routes and the real
 * database (in-process; no dev server needed).
 * Run with:  npm run test:vawcappointments
 *
 * The ten checks of the specification are marked TEST 1 to TEST 10. Temporary
 * rows are marked PROBE-VA and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { phDay } from '../lib/hearings';
import { decideAppointmentAccess } from '../lib/vawcAppointmentsServer';
import { GET as listGET, POST as createPOST } from '../app/api/vawc/appointments/route';
import { GET as casesGET } from '../app/api/vawc/appointments/cases/route';
import { GET as oneGET, PATCH as onePATCH } from '../app/api/vawc/appointments/[aid]/route';
import { GET as residentGET } from '../app/api/resident/appointments/route';
import { POST as residentPOST } from '../app/api/resident/appointments/[aid]/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { GET as hearingCasesGET } from '../app/api/hearings/cases/route';
import { GET as hearingsGET } from '../app/api/hearings/route';
import { POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { GET as analyticsGET } from '../app/api/analytics/[section]/route';
import { GET as staffNotificationsGET } from '../app/api/notifications/route';

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
const refuse = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
const VAWC_WORDS = /vawc|abuse|violence|domestic|victim|survivor|respondent|interview/i;

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.va.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
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
    const R1 = await mkRes('a', 'Ana');   // filed the VAWC case (self-report)
    const R2 = await mkRes('b', 'Bea');   // filed nothing here
    const R3 = await mkRes('c', 'Cora');  // filed a third-party VAWC report
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Fictional Reporter', caseType: 'Domestic Violence',
        barangay: 'Probe Street', description: 'fictional test narrative', status: 'Open', riskLevel: 'High', residentId: R1.id, assignedToId: V.id,
        reportingRelationship: 'SELF', contactPreference: 'no_phone', contactSafetyNote: 'Only weekday mornings', ...d } as never });
      caseIds.push(c.id); return c;
    };
    const KV = await mkCase({});                                                       // a VAWC case, assigned to V
    const KV3 = await mkCase({ residentId: R3.id, reportingRelationship: 'THIRD_PARTY', contactPreference: 'text_first' });
    const KVnoAcct = await mkCase({ residentId: null, contactPreference: null });      // a walk-in VAWC case: no account
    const KVfree = await mkCase({ assignedToId: null });                               // an unassigned VAWC case
    const KB = await mkCase({ caseType: 'Noise Complaint', assignedToId: B.id, contactPreference: null, reportingRelationship: null }); // a blotter case
    await prisma.caseParty.create({ data: { caseId: KV.id, role: 'REPORTED', fullName: 'Fictional Respondent', source: 'reporter' } });

    const PA = (aid: string) => ({ params: Promise.resolve({ aid }) });
    const create = (cookie: string, body: Body) => createPOST(req('/api/vawc/appointments', cookie, 'POST', body)).then(json);
    const patch = (aid: string, cookie: string, body: Body) => onePATCH(req(`/api/vawc/appointments/${aid}`, cookie, 'PATCH', body), PA(aid)).then(json);
    const one = (aid: string, cookie: string) => oneGET(req(`/api/vawc/appointments/${aid}`, cookie), PA(aid)).then(json);
    const list = (cookie: string, q = '') => listGET(req(`/api/vawc/appointments?${q}`, cookie)).then(json);
    const picker = (cookie: string, q = '') => casesGET(req(`/api/vawc/appointments/cases?${q}`, cookie)).then(json);
    const mine = (cookie: string) => residentGET(req('/api/resident/appointments', cookie)).then(json);
    const rpost = (aid: string, cookie: string, body: Body) => residentPOST(req(`/api/resident/appointments/${aid}`, cookie, 'POST', body), PA(aid)).then(json);
    const feed = async (cookie: string) => ((await json(await updatesGET(req('/api/resident/updates?limit=20', cookie)))).body.data ?? []) as Body[];
    const day = (offset: number) => phDay(new Date(Date.now() + offset * 86_400_000));
    const base = {
      type: 'VICTIM_INTERVIEW', date: day(2), time: '10:00', venue: 'VAWC Desk - private room', participants: ['REPORTER'],
      purpose: 'PROBE-PURPOSE initial private interview', internalNotes: 'PROBE-INTERNAL do not disclose', notifyVia: 'SAFECOMM_ACCOUNT',
      residentInstructions: 'Bring any papers you have.',
    };

    // ── TEST 1: Blotter Hearing Management lists blotter cases only ──
    console.log('\nTEST 1  Blotter Hearing Management: blotter cases only');
    const hc = await json(await hearingCasesGET(req('/api/hearings/cases?status=ANY&pageSize=100', C.cookie)));
    ok('the hearing case list has the blotter case and no VAWC case', hc.status === 200 && hc.body.data.rows.some((r: Body) => r.id === KB.id)
      && !hc.body.data.rows.some((r: Body) => caseIds.slice(0, 4).includes(r.id)), String(hc.status));
    const hl = await json(await hearingsGET(req('/api/hearings', C.cookie)));
    ok('the hearing records hold no VAWC case', hl.status === 200 && hl.body.data.rows.every((r: Body) => r.case.caseType !== 'Domestic Violence'));
    const early = await json(await caseHearingsPOST(req(`/api/cases/${KB.id}/hearings`, B.cookie, 'POST', { stage: 'MEDIATION', date: day(3), time: '09:00', venue: 'Barangay Hall' }), { params: Promise.resolve({ id: KB.id }) }));
    ok('a blotter case not yet reviewed as eligible gets no hearing', early.status >= 400 && early.status < 500, `${early.status} ${early.body.error}`);

    // ── TEST 2: VAWC Appointments lists VAWC cases only ──
    console.log('\nTEST 2  VAWC Appointments: VAWC cases only');
    const pk = await picker(V.cookie);
    ok('Create Appointment loads VAWC cases from the records, and no blotter case', pk.status === 200 && pk.body.data.rows.some((r: Body) => r.id === KV.id)
      && !pk.body.data.rows.some((r: Body) => r.id === KB.id) && pk.body.data.rows.every((r: Body) => r.caseType !== 'Noise Complaint'));
    ok('a case is shown by reference, category and status - no reporter name or narrative', !JSON.stringify(pk.body).includes('Fictional Reporter') && !JSON.stringify(pk.body).includes('fictional test narrative'));
    ok('searching by reference finds it', (await picker(V.cookie, `q=${encodeURIComponent(KV.caseNumber)}`)).body.data.rows[0]?.id === KV.id);
    const onBlotter = await create(V.cookie, { ...base, caseId: KB.id });
    ok('an appointment on a blotter case is refused, with the reason', onBlotter.status === 422 && /VAWC cases only/.test(onBlotter.body.error), `${onBlotter.status} ${onBlotter.body.error}`);
    ok('an appointment with no valid case is refused', (await create(V.cookie, { ...base, caseId: 'no-such-case' })).status === 404
      && (await create(V.cookie, { ...base, caseId: undefined })).status === 400);
    ok('the database itself refuses an appointment on a blotter case', await refuse(() => prisma.vawcAppointment.create({ data: { caseId: KB.id, reference: `${TAG}-x1`,
      type: 'VICTIM_INTERVIEW', scheduledAt: new Date(), venue: 'x', participants: ['REPORTER'], purpose: 'x', notifyVia: 'NONE', createdById: V.id, updatedById: V.id } })));

    // ── TEST 3 and 4: create, saved against the case id ──
    console.log('\nTEST 3  A VAWC officer creates an appointment  /  TEST 4  saved against the case id');
    const made = await create(V.cookie, { ...base, caseId: KV.id });
    ok('created (201)', made.status === 201, `${made.status} ${made.body.error}`);
    const aid = made.body.data?.id as string;
    const row = await prisma.vawcAppointment.findUnique({ where: { id: aid }, include: { events: true } });
    ok('saved against the case id, with a reference from the case number', row?.caseId === KV.id && row.reference === `APT-${KV.caseNumber}-1`);
    ok('every field kept: type, time, venue, officer, participants, purpose, notes, notice, status',
      row?.type === 'VICTIM_INTERVIEW' && phDay(row.scheduledAt) === day(2) && row.venue === base.venue && row.assignedOfficerId === V.id
      && row.participants.join() === 'REPORTER' && row.purpose === base.purpose && row.internalNotes === base.internalNotes && row.notifyVia === 'SAFECOMM_ACCOUNT' && row.status === 'SCHEDULED');
    ok('the history has it, with the official who did it', row?.events.some(e => e.kind === 'created' && e.actorId === V.id) === true
      && row?.events.some(e => e.kind === 'resident_notified') === true);
    ok('on a self-report, "the victim-survivor" is the reporter: saved once, as REPORTER', (await (async () => {
      const r = await create(V.cookie, { ...base, caseId: KV.id, participants: ['VICTIM_SURVIVOR', 'REPORTER'], date: day(5), notifyVia: 'NONE' });
      const a = await prisma.vawcAppointment.findUnique({ where: { id: r.body.data.id } });
      await prisma.vawcAppointment.delete({ where: { id: r.body.data.id } });
      return a?.participants.join() === 'REPORTER';
    })()));
    ok('a respondent participant is refused, with the reason (RA 9262 sec. 33)', (await (async () => {
      const r = await create(V.cookie, { ...base, caseId: KV.id, participants: ['REPORTER', 'RESPONDENT'] });
      return r.status === 400 && /never include the respondent/.test(r.body.error);
    })()));
    ok('mediation or a joint session is refused as a type', (await create(V.cookie, { ...base, caseId: KV.id, type: 'MEDIATION' })).status === 400
      && (await create(V.cookie, { ...base, caseId: KV.id, type: 'JOINT_SESSION' })).status === 400);
    ok('the database refuses a respondent participant too', await refuse(() => prisma.vawcAppointment.create({ data: { caseId: KV.id, reference: `${TAG}-x2`,
      type: 'VICTIM_INTERVIEW', scheduledAt: new Date(), venue: 'x', participants: ['RESPONDENT'], purpose: 'x', notifyVia: 'NONE', createdById: V.id, updatedById: V.id } })));
    ok('a date already gone is refused', (await create(V.cookie, { ...base, caseId: KV.id, date: day(-1) })).status === 400);
    const clash = await create(V.cookie, { ...base, caseId: KV3.id, participants: ['REPORTER'], notifyVia: 'NONE' });
    ok('the same officer at the same time: a conflict, nothing saved', clash.status === 409 && clash.body.code === 'schedule_conflict');

    // ── TEST 5: resident notification reaches the right account ──
    console.log('\nTEST 5  The resident notice reaches the right account');
    const f1 = await feed(R1.cookie);
    const notice = f1.find(u => u.title === 'Appointment update');
    ok('the reporter who filed the case gets an in-app notice', Boolean(notice) && /appointment with the barangay/.test(notice?.message ?? ''));
    ok('it opens My Appointments, not the case', notice?.href === '/resident/appointments' && notice?.caseId === null);
    ok('another resident gets nothing', !(await feed(R2.cookie)).some(u => u.title === 'Appointment update')
      && (await mine(R2.cookie)).body.data.all.length === 0);
    const m1 = await mine(R1.cookie);
    ok('My Appointments shows it, with the date, place and instructions', m1.status === 200 && m1.body.data.upcoming.length === 1
      && m1.body.data.upcoming[0].venue === base.venue && m1.body.data.upcoming[0].instructions.includes('Bring any papers you have.'));
    const quiet = await create(V.cookie, { ...base, caseId: KV.id, date: day(6), notifyVia: 'NONE' });
    ok('an appointment kept to the desk ("no notice") is not shown to the resident', quiet.status === 201
      && !(await mine(R1.cookie)).body.data.all.some((a: Body) => a.id === quiet.body.data.id));
    const third = await create(V.cookie, { ...base, caseId: KV3.id, date: day(4), participants: ['VICTIM_SURVIVOR', 'SERVICE_PROVIDER'], notifyVia: 'SAFECOMM_ACCOUNT' });
    ok('on a third-party report, an in-app notice needs the reporter among the participants', third.status === 400 && /only to the resident who filed/.test(third.body.error));
    const thirdOk = await create(V.cookie, { ...base, caseId: KV3.id, date: day(4), participants: ['REPORTER', 'VICTIM_SURVIVOR'], notifyVia: 'SAFECOMM_ACCOUNT' });
    ok('...and with them, only the reporter\'s own account is told', thirdOk.status === 201 && (await mine(R3.cookie)).body.data.all.length === 1
      && !(await mine(R1.cookie)).body.data.all.some((a: Body) => a.id === thirdOk.body.data.id));
    ok('the respondent has no account link and is told nothing: no notice row exists for anyone else',
      (await prisma.notification.count({ where: { caseId: KV.id, userId: { notIn: [V.id, V2.id, C.id] }, NOT: { userId: null } } })) === 0);

    // ── TEST 6: safe-contact preferences ──
    console.log('\nTEST 6  Safe-contact preferences');
    const ctx = await picker(V.cookie, `caseId=${KV.id}`);
    ok('scheduling shows the preference and what it asks: no calls or texts', ctx.status === 200 && ctx.body.data.case.contact.preference === 'no_phone'
      && ctx.body.data.case.contact.allowCall === false && /Do not call or text/.test(ctx.body.data.case.contact.label) && ctx.body.data.case.contact.note === 'Only weekday mornings');
    const noAcct = await create(V.cookie, { ...base, caseId: KVnoAcct.id, date: day(3) });
    ok('no account to notify: an in-app notice is refused, the officer contacts them instead', noAcct.status === 400 && /no account to notify/.test(noAcct.body.error)
      && (await create(V.cookie, { ...base, caseId: KVnoAcct.id, date: day(3), notifyVia: 'OFFICER_CONTACT' })).status === 201);
    const allFeed = JSON.stringify((await feed(R1.cookie)).filter(u => u.title === 'Appointment update'));
    ok('the notice is safe to be seen: no case number, category, purpose, officer or VAWC words', !allFeed.includes(KV.caseNumber) && !allFeed.includes('Domestic')
      && !allFeed.includes('PROBE-PURPOSE') && !allFeed.includes(V.name) && !VAWC_WORDS.test(allFeed.replace(/"href":"[^"]*"/g, '')), allFeed.slice(0, 300));
    ok('nothing is sent by text or email: no such channel exists', !(await import('fs')).readFileSync('lib/vawcAppointmentsServer.ts', 'utf8').match(/sendMail|sendEmail|sms/i));

    // ── TEST 7: residents never see officials' notes ──
    console.log('\nTEST 7  Residents cannot reach confidential records');
    await patch(aid, V.cookie, { action: 'update', internalNotes: 'PROBE-INTERNAL updated' });
    const r1json = JSON.stringify((await mine(R1.cookie)).body);
    ok('My Appointments carries no purpose, internal note, reference, case number, officer or participants', !r1json.includes('PROBE-PURPOSE') && !r1json.includes('PROBE-INTERNAL')
      && !r1json.includes('APT-') && !r1json.includes(KV.caseNumber) && !r1json.includes(V.name) && !r1json.includes('participants'));
    ok('a resident session cannot open the officials\' routes', (await one(aid, R1.cookie)).status === 401 && (await list(R1.cookie)).status === 401
      && (await patch(aid, R1.cookie, { action: 'cancel', reason: 'x x x' })).status === 401);
    ok('a resident cannot act on another resident\'s appointment', (await rpost(aid, R2.cookie, { action: 'acknowledge' })).status === 404);

    // ── TEST 8: blotter officers and others cannot reach VAWC appointments ──
    console.log('\nTEST 8  Restricted to the VAWC desk');
    ok('a blotter officer: the module is refused, the case and appointment do not exist', (await list(B.cookie)).status === 403
      && (await one(aid, B.cookie)).status === 404 && (await patch(aid, B.cookie, { action: 'cancel', reason: 'abc' })).status === 404
      && (await picker(B.cookie, `caseId=${KV.id}`)).status === 404 && (await create(B.cookie, { ...base, caseId: KV.id })).status === 404);
    ok('the system administrator likewise', (await list(SA.cookie)).status === 403 && (await one(aid, SA.cookie)).status === 404);
    const v2 = await one(aid, V2.cookie);
    ok('another VAWC officer, not assigned: refused', v2.status === 403 && v2.body.code === 'not_assigned' && (await list(V2.cookie)).body.data.rows.length === 0);
    const free = await picker(V2.cookie, `caseId=${KVfree.id}`);
    ok('an unassigned VAWC case: refused, and the officer is told they can take it - its contact details are not sent', free.status === 403 && free.body.canClaim === true
      && !JSON.stringify(free.body).includes('weekday')
      && (await create(V2.cookie, { ...base, caseId: KVfree.id })).status === 403);
    const cap = await one(aid, C.cookie);
    ok('the Punong Barangay views, but does not manage another officer\'s appointment', cap.status === 200 && cap.body.data.canEdit === false
      && (await patch(aid, C.cookie, { action: 'cancel', reason: 'abc' })).status === 403);
    const logs = await prisma.reporterAccessLog.findMany({ where: { fields: { has: 'vawc_appointments' }, actorId: { in: [B.id, SA.id, V2.id, V.id] } } });
    ok('every look and refusal is in the access log', logs.some(l => l.actorId === B.id && l.outcome === 'denied') && logs.some(l => l.actorId === V2.id && l.outcome === 'denied')
      && logs.some(l => l.actorId === V.id && l.outcome === 'permitted' && l.code === 'created:edit'));
    const bNotes = await json(await staffNotificationsGET(req('/api/notifications?limit=100', B.cookie)));
    ok('a blotter officer sees no notification about the VAWC appointments', !JSON.stringify(bNotes.body).includes(KV.caseNumber));
    ok('the access rule on its own', decideAppointmentAccess({ id: 'x', role: 'officer', active: true }, { caseType: 'Domestic Violence', assignedToId: 'x' }).hidden
      && decideAppointmentAccess({ id: 'x', role: 'vawc_officer', active: true }, { caseType: 'Domestic Violence', assignedToId: 'x' }).edit
      && !decideAppointmentAccess({ id: 'x', role: 'vawc_officer', active: false }, { caseType: 'Domestic Violence', assignedToId: 'x' }).view
      && decideAppointmentAccess({ id: 'x', role: 'vawc_officer', active: true }, { caseType: 'Noise Complaint', assignedToId: 'x' }).code === 'not_vawc');

    // ── TEST 9: calendar, new date, cancellation, history ──
    console.log('\nTEST 9  Calendar, new date, requests, cancellation, history');
    const cal = await list(V.cookie, `from=${day(0)}&to=${day(10)}`);
    ok('the calendar range holds the appointments on those days', cal.status === 200 && cal.body.data.rows.some((r: Body) => r.id === aid));
    ok('the upcoming list has it; the summary counts it', (await list(V.cookie, 'view=upcoming')).body.data.rows.some((r: Body) => r.id === aid) && cal.body.data.summary.upcoming >= 1);
    ok('the resident acknowledges it', (await rpost(aid, R1.cookie, { action: 'acknowledge' })).status === 200
      && Boolean((await prisma.vawcAppointment.findUnique({ where: { id: aid } }))?.residentAcknowledgedAt));
    const ask = await rpost(aid, R1.cookie, { action: 'reschedule', reason: 'Not safe to leave the house that day', preferredSchedule: 'A weekday morning' });
    ok('the resident asks for a new date: pending, the date does not move', ask.status === 201
      && phDay((await prisma.vawcAppointment.findUnique({ where: { id: aid } }))!.scheduledAt) === day(2));
    ok('one waiting request at a time', (await rpost(aid, R1.cookie, { action: 'reschedule', reason: 'Asking again for a date' })).status === 409);
    const resched = await patch(aid, V.cookie, { action: 'reschedule', date: day(7), time: '09:30', reason: 'Approved the resident request', requestId: ask.body.data.id });
    const moved = await prisma.vawcAppointment.findUnique({ where: { id: aid }, include: { requests: true } });
    ok('a new date set, approving the request', resched.status === 200 && moved?.status === 'RESCHEDULED' && moved.rescheduleCount === 1 && phDay(moved.scheduledAt) === day(7)
      && moved.requests[0].status === 'APPROVED' && moved.residentAcknowledgedAt === null, `${resched.status} ${resched.body.error}`);
    ok('the resident is told the new date, in safe words', (await feed(R1.cookie)).some(u => /has a new date/.test(u.message) && !u.message.includes('Approved the resident request')));
    ok('the rescheduled list has it', (await list(V.cookie, 'view=rescheduled')).body.data.rows.some((r: Body) => r.id === aid));
    const ask2 = await rpost(aid, R1.cookie, { action: 'reschedule', reason: 'Still not a safe day for me' });
    ok('a request can be declined, with a reply the resident reads', ask2.status === 201
      && (await patch(aid, V.cookie, { action: 'review_request', requestId: ask2.body.data.id, reviewNote: 'Please call the desk when safe' })).status === 200
      && (await mine(R1.cookie)).body.data.upcoming[0].requests.some((r: Body) => r.status === 'DECLINED' && r.reviewNote === 'Please call the desk when safe'));
    ok('details can be updated; the history names the fields, not the confidential text', (await patch(aid, V.cookie, { action: 'update', venue: 'Women and Children Desk', purpose: 'PROBE-PURPOSE revised' })).status === 200
      && (await (async () => { const e = await prisma.vawcAppointmentEvent.findFirst({ where: { appointmentId: aid, kind: 'updated' }, orderBy: { createdAt: 'desc' } });
        return JSON.stringify(e?.after).includes('purpose') && !JSON.stringify(e).includes('PROBE-PURPOSE revised'); })()));
    // The outcome: the day must have come - moved into the past directly, as if it had.
    await prisma.vawcAppointment.update({ where: { id: aid }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    ok('past its time and open: listed as past, flagged to record', (await list(V.cookie, 'view=past')).body.data.rows.some((r: Body) => r.id === aid && r.overdue));
    const rec = await patch(aid, V.cookie, { action: 'record', held: true, attendance: 'ATTENDED', outcomeNotes: 'PROBE-OUTCOME notes', followUpActions: 'PROBE-FOLLOWUP safety plan',
      referralStatus: 'IN_PROGRESS', nextDate: day(14), nextTime: '10:00' });
    const held = await prisma.vawcAppointment.findUnique({ where: { id: aid } });
    ok('outcome, attendance, follow-up, referral status and next date recorded', rec.status === 200 && held?.status === 'COMPLETED' && held.attendance === 'ATTENDED'
      && held.referralStatus === 'IN_PROGRESS' && phDay(held.nextAppointmentAt!) === day(14) && held.completedById === V.id, `${rec.status} ${rec.body.error}`);
    ok('the completed list has it; the resident sees none of the outcome', (await list(V.cookie, 'view=completed')).body.data.rows.some((r: Body) => r.id === aid)
      && !JSON.stringify((await mine(R1.cookie)).body).match(/PROBE-OUTCOME|PROBE-FOLLOWUP|IN_PROGRESS|ATTENDED/));
    ok('the outcome can be added to later', (await patch(aid, V.cookie, { action: 'amend_outcome', referralStatus: 'COMPLETED' })).status === 200);
    ok('a completed appointment cannot be cancelled or moved', (await patch(aid, V.cookie, { action: 'cancel', reason: 'abc' })).status === 409
      && (await patch(aid, V.cookie, { action: 'reschedule', date: day(9), time: '09:00', reason: 'abc' })).status === 409);
    const cancelMe = thirdOk.body.data.id as string;
    ok('cancelled, with the reason kept for officials', (await patch(cancelMe, V.cookie, { action: 'cancel', reason: 'PROBE-REASON client moved' })).status === 200
      && (await prisma.vawcAppointment.findUnique({ where: { id: cancelMe } }))?.status === 'CANCELLED'
      && (await list(V.cookie, 'view=cancelled')).body.data.rows.some((r: Body) => r.id === cancelMe));
    const f3 = JSON.stringify(await feed(R3.cookie));
    ok('the resident is told it was cancelled - not why', /was cancelled/.test(f3) && !f3.includes('PROBE-REASON'));
    const hist = (await one(aid, V.cookie)).body.data.appointment.events as Body[];
    ok('the history: every step is there, each with who did it', ['created', 'resident_notified', 'updated', 'resident_acknowledged', 'reschedule_requested', 'rescheduled', 'request_approved',
      'request_declined', 'completed', 'outcome_amended'].every(k => hist.some(e => e.kind === k))
      && hist.filter(e => e.actorType === 'official').every(e => e.by === V.name) && hist.filter(e => e.actorType === 'resident').every(e => e.by === 'The resident'));
    ok('the history cannot be rewritten', await refuse(() => prisma.vawcAppointmentEvent.updateMany({ where: { appointmentId: aid }, data: { note: 'changed' } })));
    ok('an appointment cannot be moved to another case', await refuse(() => prisma.vawcAppointment.update({ where: { id: aid }, data: { caseId: KV3.id } })));
    ok('the officers are told; the case timeline line stays on the desk', (await prisma.notification.count({ where: { caseId: KV.id, title: { startsWith: 'New date requested' } } })) >= 1
      && (await prisma.activity.count({ where: { caseId: KV.id, type: 'vawc_appointment' } })) >= 4);

    // ── TEST 10: no VAWC case enters KP mediation or conciliation ──
    console.log('\nTEST 10  No VAWC case enters Katarungang Pambarangay proceedings');
    const kp = await json(await caseHearingsPOST(req(`/api/cases/${KV.id}/hearings`, C.cookie, 'POST', { stage: 'MEDIATION', date: day(3), time: '09:00', venue: 'Barangay Hall' }), { params: Promise.resolve({ id: KV.id }) }));
    ok('the captain cannot schedule KP mediation on a VAWC case', kp.status === 422, `${kp.status} ${kp.body.error}`);
    ok('the VAWC desk is refused Hearing Management', (await json(await hearingsGET(req('/api/hearings', V.cookie)))).status === 403);
    ok('the database refuses a hearing row on a VAWC case', await refuse(() => prisma.caseHearing.create({ data: { caseId: KV.id, reference: `${TAG}-kp`, hearingNumber: 1,
      scheduledAt: new Date(), createdById: C.id, updatedById: C.id } })));
    ok('no hearing exists on any VAWC test case', (await prisma.caseHearing.count({ where: { caseId: { in: caseIds.slice(0, 4) } } })) === 0);

    // ── Analytics: separate, counts only ──
    console.log('\nAnalytics');
    const av = await json(await analyticsGET(req('/api/analytics/hearings?scope=vawc', V.cookie), { params: Promise.resolve({ section: 'hearings' }) }));
    const ap = av.body.data?.vawc?.appointments;
    ok('VAWC analytics count the appointments: scheduled, interviews completed, rescheduled, referral status', av.status === 200 && ap
      && ap.completedInterviews >= 1 && ap.rescheduled >= 1 && ap.referralCoordination.COMPLETED >= 1 && ap.scheduled >= 1, JSON.stringify(ap));
    ok('the VAWC scope has no KP hearing figures', av.body.data.applicable === false);
    ok('no note, purpose, name or case number in the analytics', !JSON.stringify(av.body).match(/PROBE-|Fictional/) && !JSON.stringify(av.body).includes(KV.caseNumber));
    const ab = await json(await analyticsGET(req('/api/analytics/hearings?scope=vawc', B.cookie), { params: Promise.resolve({ section: 'hearings' }) }));
    ok('a blotter officer\'s analytics have no VAWC track', ab.status === 200 && ab.body.data.vawc === null);
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
    && await prisma.user.count({ where: { email: { startsWith: 'probe.va.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
