/**
 * VAWC Case Proceedings (BPOs and referrals) - through the
 * real routes and the real database, in-process. Needs migrations 012, 019
 * and 020 applied. Run with:  npm run test:vawcproceedings
 * (External court dates are Hearings: tests/vawcHearings.test.ts.)
 * Temporary rows are marked PROBE-VP and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { phDay } from '../lib/hearings';
import { bpoLastDay } from '../lib/vawcProceedings';
import { runVawcReminders } from '../lib/vawcProceedingsServer';
import { GET as listGET, POST as createPOST } from '../app/api/vawc/proceedings/route';
import { GET as oneGET, PATCH as onePATCH } from '../app/api/vawc/proceedings/[kind]/[rid]/route';
import { GET as residentApptGET } from '../app/api/resident/appointments/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { POST as caseHearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { GET as hearingCasesGET } from '../app/api/hearings/cases/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-VP';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const refuse = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
const SECRET = 'PROBE-VP ex parte assessment: fictional confidential reasoning';

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.vp.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mk('vawc', 'vawc_officer');
    const V2 = await mk('vawc2', 'vawc_officer');
    const B = await mk('blotter', 'officer');
    const C = await mk('captain', 'admin');
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Ana', lastName: 'Probe', age: 30, gender: 'Female',
      barangay: 'Ayukit', address: 'fictional address', emailVerified: true } });
    residents.push(r.id);
    const R = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Ana', role: 'resident' })}`;
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Fictional Reporter', caseType: 'Domestic Violence',
        barangay: 'Probe Street', description: 'fictional test narrative', status: 'Open', riskLevel: 'High', residentId: r.id, assignedToId: V.id,
        reportingRelationship: 'SELF', ...d } as never });
      caseIds.push(c.id); return c;
    };
    const KV = await mkCase({});
    const KB = await mkCase({ caseType: 'Noise Complaint', assignedToId: B.id });
    const today = phDay(new Date());
    const nowHm = new Date(Date.now() + 8 * 3_600_000 - 60 * 60_000).toISOString().slice(11, 16); // an hour ago, Philippine time
    const day = (o: number) => phDay(new Date(Date.now() + o * 86_400_000));
    const P = (kind: string, rid: string) => ({ params: Promise.resolve({ kind, rid }) });
    const create = (cookie: string, body: Body) => createPOST(req('/api/vawc/proceedings', cookie, 'POST', body)).then(json);
    const patch = (cookie: string, kind: string, rid: string, body: Body) => onePATCH(req(`/api/vawc/proceedings/${kind}/${rid}`, cookie, 'PATCH', body), P(kind, rid)).then(json);

    console.log('TEST 1-2  VAWC records only on VAWC cases; blotter cases stay in KP Hearing Management');
    const onBlotter = await create(B.cookie, { kind: 'bpo', caseId: KB.id, appliedDate: today, appliedTime: nowHm, applicantType: 'VICTIM_SURVIVOR' });
    ok('a BPO cannot be recorded on a blotter case', onBlotter.status === 422 || onBlotter.status === 404, `${onBlotter.status} ${onBlotter.body.error}`);
    ok('...nor by the VAWC officer either', (await create(V.cookie, { kind: 'referral', caseId: KB.id, agencyType: 'SWDO', agencyName: 'MSWDO', referredDate: today, purpose: 'fictional purpose' })).status === 422);
    ok('the database refuses a BPO row on a blotter case', await refuse(() => prisma.vawcBpo.create({ data: { caseId: KB.id, reference: `${TAG}-x`, appliedAt: new Date(),
      applicantType: 'VICTIM_SURVIVOR', receivedById: V.id, createdById: V.id, updatedById: V.id } })));
    const kpCases = await json(await hearingCasesGET(req('/api/hearings/cases', B.cookie)));
    ok('the blotter case is still listed in KP Hearing Management; the VAWC case is not', kpCases.status === 200
      && JSON.stringify(kpCases.body).includes(KB.caseNumber) && !JSON.stringify(kpCases.body).includes(KV.caseNumber), String(kpCases.status));

    console.log('\nTEST 4  BPO: application, ex parte decision and service, recorded separately');
    const app = await create(V.cookie, { kind: 'bpo', caseId: KV.id, appliedDate: today, appliedTime: nowHm, applicantType: 'VICTIM_SURVIVOR', applicationNotes: 'fictional application notes' });
    ok('the assigned VAWC officer records the application', app.status === 201 && /^BPO-/.test(app.body.data?.reference ?? ''), JSON.stringify(app.body));
    const bid = app.body.data.id as string;
    ok('another VAWC officer cannot', (await create(V2.cookie, { kind: 'bpo', caseId: KV.id, appliedDate: today, appliedTime: nowHm, applicantType: 'VICTIM_SURVIVOR' })).status === 403);
    ok('a blotter officer is told the case does not exist', (await create(B.cookie, { kind: 'bpo', caseId: KV.id, appliedDate: today, appliedTime: nowHm, applicantType: 'VICTIM_SURVIVOR' })).status === 404);
    ok('a resident session cannot', (await create(R, { kind: 'bpo', caseId: KV.id, appliedDate: today, appliedTime: nowHm, applicantType: 'VICTIM_SURVIVOR' })).status >= 400);
    ok('an application in the future is refused', (await create(V.cookie, { kind: 'bpo', caseId: KV.id, appliedDate: day(2), appliedTime: '09:00', applicantType: 'VICTIM_SURVIVOR' })).status === 400);
    // Officials are not sent a notice of their own action; anyone else handling the case would be, and the reminder run covers the due steps.
    ok('the officer who recorded it gets no notice of their own action', (await prisma.notification.count({ where: { caseId: KV.id, userId: V.id, title: { startsWith: 'BPO application' } } })) === 0);
    const due0 = (await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V.cookie)))).body.data.items as Body[];
    ok('the application is due for a decision today (sec. 14: the date of filing)', due0.some(i => i.recordId === bid && i.kind === 'BPO_DECIDE' && i.day === today));
    const serveEarly = await patch(V.cookie, 'bpo', bid, { action: 'serve', date: today, time: nowHm, serviceMethod: 'PERSONAL', servedByName: 'Kgd. Fictional' });
    ok('it cannot be served before it is decided', serveEarly.status === 409);
    const kag = await patch(V.cookie, 'bpo', bid, { action: 'decide', decision: 'ISSUED', date: today, time: nowHm, actingRole: 'KAGAWAD', actingOfficialName: 'Kgd. Fictional', exParteAssessment: SECRET });
    ok('a Kagawad decision without the attestation is refused (sec. 14)', kag.status === 400 && /unavailable/.test(kag.body.error ?? ''), JSON.stringify(kag.body));
    const dec = await patch(V.cookie, 'bpo', bid, { action: 'decide', decision: 'ISSUED', date: today, time: nowHm, actingRole: 'KAGAWAD', actingOfficialName: 'Kgd. Fictional',
      punongBarangayUnavailable: true, exParteAssessment: SECRET });
    const b1 = await prisma.vawcBpo.findUnique({ where: { id: bid } });
    ok('with it, issued: the decision, the date and who decided are saved', dec.status === 200 && b1?.status === 'ISSUED' && b1.decision === 'ISSUED' && b1.actingRole === 'KAGAWAD'
      && b1.punongBarangayUnavailable && Boolean(b1.decidedAt), JSON.stringify(dec.body));
    const due1 = (await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V.cookie)))).body.data.items as Body[];
    ok('once issued: serve it now, and its last effective day is on the due dates', due1.some(i => i.recordId === bid && i.kind === 'BPO_SERVE')
      && due1.some(i => i.recordId === bid && i.kind === 'BPO_ENDS' && i.day === bpoLastDay(b1!.decidedAt!)), due1.map(i => i.kind).join());
    ok('a second decision is refused: each step is recorded once', (await patch(V.cookie, 'bpo', bid, { action: 'decide', decision: 'DENIED', date: today, time: nowHm,
      actingRole: 'PUNONG_BARANGAY', actingOfficialName: 'PB Fictional', exParteAssessment: 'another reading' })).status === 409);
    const served = await patch(V.cookie, 'bpo', bid, { action: 'serve', date: today, time: nowHm, serviceMethod: 'PERSONAL', servedByName: 'Kgd. Fictional' });
    const b2 = await prisma.vawcBpo.findUnique({ where: { id: bid } });
    ok('the service is recorded separately', served.status === 200 && b2?.status === 'SERVED' && Boolean(b2.servedAt) && b2.servedByName === 'Kgd. Fictional');
    ok('application, decision and service stay in their own fields', b2?.applicationNotes === 'fictional application notes' && b2.exParteAssessment === SECRET && b2.serviceMethod === 'PERSONAL');
    const view = await json(await oneGET(req(`/api/vawc/proceedings/bpo/${bid}`, V.cookie), P('bpo', bid)));
    ok('its history: applied, issued, served - in order, by the officer', view.status === 200
      && view.body.data.history.map((h: Body) => h.kind).join() === 'bpo_applied,bpo_issued,bpo_served' && view.body.data.history.every((h: Body) => h.by === `${TAG} vawc`));
    const hist = await prisma.vawcProceedingEvent.findFirst({ where: { recordId: bid } });
    ok('the history cannot be rewritten (database)', await refuse(() => prisma.vawcProceedingEvent.update({ where: { id: hist!.id }, data: { note: 'x' } })));
    ok('the database refuses "served" without a service date', await refuse(() => prisma.vawcBpo.update({ where: { id: bid }, data: { servedAt: null } })));
    const list = await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V.cookie)));
    const lb = list.body.data?.bpos?.find((x: Body) => x.id === bid);
    ok('the list shows it in effect, with its last effective day (15 days from issuance)', lb?.inEffect === true && lb.lastDay === bpoLastDay(b1!.decidedAt!));

    console.log('\nTEST 6  Referrals and follow-ups');
    const rf = await create(V.cookie, { kind: 'referral', caseId: KV.id, agencyType: 'PNP_WCPD', agencyName: 'PNP WCPD Bocaue', referredDate: today, purpose: 'Fictional: assistance with a complaint', followUpDate: today });
    ok('a referral with a follow-up date is recorded', rf.status === 201, JSON.stringify(rf.body));
    const rid = rf.body.data.id as string;
    const items1 = (await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V.cookie)))).body.data.items as Body[];
    ok('due dates: the follow-up and the served BPO\'s last day, each with its own kind',
      ['REFERRAL_FOLLOW_UP', 'BPO_ENDS'].every(k => items1.some(i => i.kind === k)), items1.map(i => i.kind).join());
    ok('no court date among the proceedings: those are Hearings', !items1.some(i => /COURT/.test(String(i.kind))));
    ok('a follow-up before the referral is refused', (await patch(V.cookie, 'referral', rid, { action: 'update', followUpDate: day(-5) })).status === 400);
    const first = await runVawcReminders(new Date(), { onlyCaseIds: caseIds });
    const second = await runVawcReminders(new Date(), { onlyCaseIds: caseIds });
    ok('status updated to completed', (await patch(V.cookie, 'referral', rid, { action: 'update', status: 'COMPLETED', outcome: 'fictional outcome' })).status === 200);
    const items2 = (await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V.cookie)))).body.data.items as Body[];
    ok('...and its follow-up leaves the due dates', !items2.some(i => i.recordId === rid));

    console.log('\nTEST 7-8  Who is told, and what stays confidential');
    ok('reminders go out once (the referral follow-up is due today)', first.sent >= 1 && second.sent === 0, `${JSON.stringify(first)} ${JSON.stringify(second)}`);
    ok('they go to the officials - the officer handling it', (await prisma.notification.count({ where: { caseId: KV.id, userId: V.id, title: { startsWith: 'VAWC reminder' } } })) >= 1);
    const staffText = JSON.stringify(await prisma.notification.findMany({ where: { caseId: KV.id }, select: { title: true, message: true } }));
    ok('no staff notice carries a note or the ex parte assessment', !staffText.includes('PROBE-VP ex parte') && !staffText.includes('fictional note') && !staffText.includes('fictional application'));
    const resUpdates = await json(await updatesGET(req('/api/resident/updates?limit=50', R)));
    const resAppts = await json(await residentApptGET(req('/api/resident/appointments', R)));
    const resText = JSON.stringify(resUpdates.body) + JSON.stringify(resAppts.body);
    ok('the resident is told nothing about BPOs or referrals', resUpdates.status === 200 && !/BPO|protection order|court|referral|RTC|PNP|ex parte/i.test(resText), resText.slice(0, 300));
    ok('...and never sees the assessment', !resText.includes(SECRET));
    ok('another VAWC officer cannot open the case\'s records', (await json(await listGET(req(`/api/vawc/proceedings?caseId=${KV.id}`, V2.cookie)))).status === 403);
    ok('...nor finds them in their own list', !JSON.stringify((await json(await listGET(req('/api/vawc/proceedings', V2.cookie)))).body).includes(bid));
    ok('a blotter officer: the records do not exist', (await json(await oneGET(req(`/api/vawc/proceedings/bpo/${bid}`, B.cookie), P('bpo', bid)))).status === 404
      && (await json(await listGET(req('/api/vawc/proceedings', B.cookie)))).status === 403);
    const cap = await json(await listGET(req('/api/vawc/proceedings', C.cookie)));
    ok('the Punong Barangay sees them, and may not change what is not assigned to them', cap.status === 200 && cap.body.data.bpos.some((x: Body) => x.id === bid && x.canEdit === false)
      && (await patch(C.cookie, 'bpo', bid, { action: 'cancel', reason: 'fictional reason' })).status === 403);
    ok('every look and change is in the access log', (await prisma.reporterAccessLog.count({ where: { caseId: KV.id, fields: { has: 'vawc_appointments' } } })) >= 5);

    console.log('\nTEST 9  No VAWC case enters ordinary KP mediation');
    const kp = await json(await caseHearingsPOST(req(`/api/cases/${KV.id}/hearings`, C.cookie, 'POST', { stage: 'MEDIATION', date: day(3), time: '09:00', venue: 'Barangay Hall' }), { params: Promise.resolve({ id: KV.id }) }));
    ok('KP mediation on the VAWC case is refused', kp.status === 422, `${kp.status} ${kp.body.error}`);
    ok('the database refuses a hearing row on it', await refuse(() => prisma.caseHearing.create({ data: { caseId: KV.id, reference: `${TAG}-kp`, hearingNumber: 1,
      scheduledAt: new Date(), createdById: C.id, updatedById: C.id } })));
  } finally {
    await prisma.vawcProceedingEvent.deleteMany({ where: { caseId: { in: caseIds } } });
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
    && await prisma.vawcProceedingEvent.count({ where: { caseId: { in: caseIds } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
}

main().finally(() => prisma.$disconnect());
