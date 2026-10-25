/**
 * The official intake, end to end through the real API routes and the real
 * database (in-process; no dev server needed).
 * Run with:  npm run test:officialintake
 *
 * Temporary residents, officials and cases are marked PROBE-OI and removed at
 * the end, with their audit rows. No real resident's data is read or logged.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { ALL_ITEMS, appliesTo, missingForCompletion, type Responses } from '../lib/officialIntakeForm';
import { GET as intakeGET, POST as intakePOST, PUT as intakePUT } from '../app/api/cases/[id]/official-intake/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-OI';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// Response bodies are read loosely here; the assertions say what each must hold.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  // A handler that returned nothing: counted as a failure, never as a pass.
  : { status: 0, body: {} as Body };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, cookie: string) => intakeGET(req(`/api/cases/${id}/official-intake`, cookie), params(id)).then(json);
const start = (id: string, cookie: string) => intakePOST(req(`/api/cases/${id}/official-intake`, cookie, 'POST'), params(id)).then(json);
const put = (id: string, cookie: string, body: unknown) => intakePUT(req(`/api/cases/${id}/official-intake`, cookie, 'PUT', body), params(id)).then(json);

/** Answers every required item - N/A where the form allows it - so an intake can be completed. */
function complete(base: Responses): Responses {
  const r: Responses = { ...base };
  for (let pass2 = 0; pass2 < 2; pass2++) {
    for (const i of ALL_ITEMS) {
      if (appliesTo(i, r) !== 'required' || r[i.key]?.value || r[i.key]?.marker) continue;
      r[i.key] = i.type === 'confirm' ? { value: 'yes' } : i.key === 'safeToSpeak' ? { value: 'yes' } : i.key === 'immediateDanger' ? { value: 'no' } : { marker: 'na' };
    }
  }
  return r;
}

async function main() {
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  const realFetch = globalThis.fetch;
  try {
    const mkRes = async (k: string, d: { phone?: string | null; email?: string | null }) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: `Probe${k}`, lastName: 'Intaketest',
        age: 31, gender: 'Female', barangay: 'Ayukit', address: `${k} Test Street`, contactNumber: d.phone ?? null, email: d.email ?? null, emailVerified: true } });
      residents.push(r.id); return r;
    };
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.oi.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const R1 = await mkRes('Self', { phone: '09170000777', email: 'probe.oi.self@safcom.local' });
    const R2 = await mkRes('Third', { phone: null, email: null });
    const R3 = await mkRes('Anon', { phone: '09170000888' });
    const V = await mkUser('vawc', 'vawc_officer');
    const V2 = await mkUser('vawc2', 'vawc_officer');
    const B = await mkUser('blotter', 'officer');
    const C = await mkUser('captain', 'admin');
    const residentCookie = `resident_token=${signResidentToken({ residentId: R1.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe', caseType: 'Domestic Violence',
        barangay: 'Ortega Compound', description: 'temporary test case narrative', status: 'Open', riskLevel: null, municipality: 'Bocaue', province: 'Bulacan', ...d } as never });
      caseIds.push(c.id); return c;
    };
    const self = await mkCase({ residentId: R1.id, residentName: 'ProbeSelf Intaketest', reportingRelationship: 'SELF', assignedToId: V.id });
    const third = await mkCase({ residentId: R2.id, residentName: 'ProbeThird Intaketest', reportingRelationship: 'THIRD_PARTY',
      affectedPersonNote: 'the woman next door', assignedToId: V.id });
    const anon = await mkCase({ residentId: R3.id, residentName: 'Anonymous reporter', reportingRelationship: 'ANONYMOUS',
      reporterIdentityWithheld: true, assignedToId: V.id });
    const noAccount = await mkCase({ residentId: null, residentName: 'Walk-in person', assignedToId: V.id });
    const blotter = await mkCase({ caseType: 'Noise Complaint', residentId: R1.id, reportingRelationship: 'SELF', assignedToId: B.id });

    console.log('A. the first section is the right reporter');
    const a = await get(self.id, V.cookie);
    ok('the assigned VAWC officer can open it', a.status === 200 && a.body.data.access.edit === true);
    ok('Section 1 shows the reporter the case points to', a.body.data.context.reporter?.name === 'ProbeSelf Intaketest'
      && a.body.data.context.reporter.residentNumber === R1.residentNumber && a.body.data.context.reporter.address === 'Self Test Street');
    ok('...and the case\'s own details', a.body.data.context.case.caseNumber === self.caseNumber && a.body.data.context.case.narrative === 'temporary test case narrative');
    ok('...the phone and e-mail are not in it (masked, revealed only through the logged endpoint)',
      !JSON.stringify(a.body).includes('09170000777') && !JSON.stringify(a.body).includes('probe.oi.self@'));
    ok('...missing values say "Not provided"', a.body.data.context.case.incidentDateTime === 'Not provided');

    console.log('\nB. starting links it to this case');
    const s1 = await start(self.id, V.cookie);
    ok('START INTAKE creates a draft for this case', s1.status === 201 && s1.body.data.intake.status === 'DRAFT' && s1.body.data.intake.version === 1);
    const row = await prisma.officialIntake.findUnique({ where: { caseId: self.id } });
    ok('...stored against the selected case and its reporter account', row?.caseId === self.id && row.residentId === R1.id && row.startedById === V.id);
    const pre = s1.body.data.intake.responses as Responses;
    ok('...prefilled from the records, each marked with its source', (pre.victimName?.value as Record<string, string>)?.first === 'ProbeSelf'
      && pre.incidentNo?.value === self.caseNumber && pre.reportingMode?.value === 'victim_survivor'
      && s1.body.data.intake.prefilled.victimName === 'registered resident profile');
    ok('...nothing filled in for the other cases', (await prisma.officialIntake.count({ where: { caseId: { in: [third.id, anon.id, blotter.id] } } })) === 0);

    console.log('\nC/D/J. saving, reopening, persistence');
    const draft = { ...pre, description: { value: 'Client states the incident happened at home.' }, safeToSpeak: { value: 'yes' } };
    const sv = await put(self.id, V.cookie, { expectedVersion: 1, status: 'DRAFT', responses: draft });
    ok('a draft saves and the version rises', sv.status === 200 && sv.body.data.intake.version === 2);
    const again = await start(self.id, V.cookie);
    ok('[D] starting again reopens the same draft - no duplicate', again.status === 200 && again.body.data.created === false
      && again.body.data.intake.id === row?.id && (await prisma.officialIntake.count({ where: { caseId: self.id } })) === 1);
    const reopened = await get(self.id, V.cookie);
    ok('[C][J] reopened from the database with the saved answers', reopened.body.data.intake.responses.description?.value === 'Client states the incident happened at home.'
      && reopened.body.data.intake.version === 2);

    console.log('\nL. duplicate and stale saves');
    const dup = await put(self.id, V.cookie, { expectedVersion: 2, status: 'DRAFT', responses: draft });
    ok('the same save twice -> recognised as no change, nothing new stored', dup.status === 200 && dup.body.data.unchanged === true
      && (await prisma.officialIntakeRevision.count({ where: { intakeId: row!.id } })) === 2);
    const stale = await put(self.id, V.cookie, { expectedVersion: 1, status: 'DRAFT', responses: { ...draft, clientCode: { value: 'X1' } } });
    ok('a save based on an old version -> 409, not overwritten', stale.status === 409 && stale.body.code === 'version_conflict');
    const [p1, p2] = await Promise.all([start(third.id, V.cookie), start(third.id, V.cookie)]);
    ok('two "Start" requests at once -> one intake', [p1.status, p2.status].every(s => s === 200 || s === 201)
      && (await prisma.officialIntake.count({ where: { caseId: third.id } })) === 1);

    console.log('\nvalidation and completion');
    ok('an unknown item is refused', (await put(self.id, V.cookie, { expectedVersion: 2, status: 'DRAFT', responses: { ...draft, hackField: { value: 'x' } } })).status === 400);
    ok('a value outside the options is refused', (await put(self.id, V.cookie, { expectedVersion: 2, status: 'DRAFT', responses: { ...draft, sexAtBirth: { value: 'robot' } } })).status === 400);
    const early = await put(self.id, V.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: draft });
    ok('completing with items unanswered -> 422 with the list', early.status === 422 && early.body.missing.length > 10);
    ok('items not applicable are not demanded (no informant items when the victim reported)',
      !missingForCompletion(complete(draft)).length && !early.body.missing.some((m: { key: string }) => m.key === 'informantName'));
    const full = complete(draft);
    const done = await put(self.id, V.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: full });
    ok('completing with every item answered or marked N/A -> COMPLETED', done.status === 200 && done.body.data.intake.status === 'COMPLETED');
    ok('a completed intake cannot be turned back into a draft', (await put(self.id, V.cookie, { expectedVersion: 3, status: 'DRAFT', responses: full })).status === 422);
    const upd = await put(self.id, V.cookie, { expectedVersion: 3, status: 'COMPLETED', responses: { ...full, clientCode: { value: 'CC-01' } } });
    ok('editing a completed intake -> a new version, still completed', upd.status === 200 && upd.body.data.intake.version === 4);
    const caseAfter = await prisma.case.findUnique({ where: { id: self.id } });
    ok('the original report is unchanged, and the case is not marked resolved', caseAfter?.description === 'temporary test case narrative' && caseAfter.status === 'Open');
    let immutable = false;
    try { await prisma.officialIntakeRevision.updateMany({ where: { intakeId: row!.id }, data: { status: 'X' } }); } catch { immutable = true; }
    ok('saved versions cannot be edited (database trigger)', immutable);

    console.log('\nI. the case timeline');
    const acts = await prisma.activity.findMany({ where: { type: 'intake', caseId: self.id }, orderBy: { createdAt: 'asc' } });
    ok('started, completed and updated each appear, by the official who did it', acts.length === 3 && acts.every(x => x.userId === V.id)
      && /started \(draft\)/.test(acts[0].message) && /completed/.test(acts[1].message) && /updated/.test(acts[2].message), acts.map(x => x.message).join(' | '));
    ok('...under this case only', (await prisma.activity.count({ where: { type: 'intake', entityId: row!.id, NOT: { caseId: self.id } } })) === 0);
    const detail = await json(await caseGET(req(`/api/cases/${self.id}`, V.cookie), params(self.id)));
    ok('the case page gets the intake state and the events - not the answers', detail.body.data.officialIntake?.status === 'COMPLETED'
      && detail.body.data.activities.some((x: { type: string }) => x.type === 'intake') && !JSON.stringify(detail.body).includes('Client states the incident'));

    console.log('\nE/F. anonymous, no account, someone else');
    const e = await get(anon.id, V.cookie);
    ok('[E] anonymous: no reporter, a warning, and no one else\'s details', e.body.data.context.reporter === null
      && e.body.data.context.warnings.some((w: string) => /anonymously/.test(w)) && !JSON.stringify(e.body).includes('ProbeAnon'));
    const eS = await start(anon.id, V.cookie);
    ok('[E] ...and starting fills in no identity', !eS.body.data.intake.responses.victimName && !eS.body.data.intake.responses.informantName
      && (await prisma.officialIntake.findUnique({ where: { caseId: anon.id } }))?.residentId === null);
    const na = await get(noAccount.id, V.cookie);
    ok('a case with no resident account says so, and shows no one', na.body.data.context.reporter === null
      && na.body.data.context.warnings.some((w: string) => /No resident account/.test(w)));
    const f = await get(third.id, V.cookie);
    ok('[F] someone else\'s incident: reporter, affected person and accused stay distinct', f.body.data.context.reporter?.name === 'ProbeThird Intaketest'
      && f.body.data.context.affectedPerson === 'the woman next door' && /Section D/.test(f.body.data.context.accusedPerson)
      && f.body.data.context.warnings.some((w: string) => /Do not treat the reporter as the victim/.test(w)));
    const fi = (await get(third.id, V.cookie)).body.data.intake.responses as Responses;
    ok('[F] ...the reporter is filled in as the informant, never as the victim-survivor', fi.informantName?.value === 'ProbeThird Intaketest'
      && !fi.victimName && !fi.reportingMode);
    ok('missing phone and e-mail are said, not invented', f.body.data.context.warnings.some((w: string) => /no phone number/.test(w))
      && f.body.data.context.warnings.some((w: string) => /no e-mail/.test(w)));

    console.log('\nG/H. who can see it');
    ok('[G] a resident session is refused', (await get(self.id, residentCookie)).status === 401);
    ok('[G] no session at all is refused', (await get(self.id, '')).status === 401);
    const v2 = await get(self.id, V2.cookie);
    ok('[G] a VAWC officer not assigned to the case is refused, with nothing confidential', v2.status === 403 && !v2.body.data
      && !JSON.stringify(v2.body).includes('ProbeSelf'));
    ok('[G] ...and cannot save to it directly', (await put(self.id, V2.cookie, { expectedVersion: 4, status: 'COMPLETED', responses: full })).status === 403);
    ok('[H] a blotter officer gets "not found" for a VAWC case', (await get(self.id, B.cookie)).status === 404);
    const cap = await get(self.id, C.cookie);
    ok('[H] the captain may view a VAWC intake but not fill it in', cap.status === 200 && cap.body.data.access.view && !cap.body.data.access.edit
      && (await put(self.id, C.cookie, { expectedVersion: 4, status: 'COMPLETED', responses: full })).status === 403);
    ok('[H] the captain may fill in a blotter case\'s intake', (await get(blotter.id, C.cookie)).body.data.access.edit === true);
    ok('[H] the assigned blotter officer may too', (await start(blotter.id, B.cookie)).status === 201);
    const logs = await prisma.reporterAccessLog.findMany({ where: { caseId: self.id, fields: { has: 'intake' } } });
    ok('every look is in the audit log, permitted and denied, with no answers in it', logs.some(l => l.outcome === 'permitted' && l.actorId === V.id)
      && logs.some(l => l.outcome === 'denied' && l.actorId === V2.id) && logs.some(l => l.actorId === C.id)
      && !JSON.stringify(logs).includes('Client states'));

    console.log('\nK. the AI down');
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('api.groq.com')) throw new Error('Groq unreachable');
      return realFetch(url, init);
    }) as typeof fetch;
    const k = await put(third.id, V.cookie, { expectedVersion: 1, status: 'DRAFT', responses: { ...fi, clientCode: { value: 'K-1' } } });
    ok('[K] with Groq unreachable the intake still saves and reopens', k.status === 200
      && (await get(third.id, V.cookie)).body.data.intake.responses.clientCode?.value === 'K-1');
    globalThis.fetch = realFetch;

    console.log('\nurgent, and a case reassigned mid-intake');
    const cur = (await get(third.id, V.cookie)).body.data.intake;
    const urg = await put(third.id, V.cookie, { expectedVersion: cur.version, status: 'DRAFT', responses: { ...cur.responses, immediateDanger: { value: 'yes' } } });
    const tc = await prisma.case.findUnique({ where: { id: third.id }, include: { notifications: true } });
    ok('danger disclosed -> the case is flagged for urgent review and the desks notified, without completing the form',
      urg.status === 200 && urg.body.data.flaggedUrgent === true && tc?.triageStatus === 'URGENT_REVIEW' && tc.notifications.length > 0);
    await prisma.case.update({ where: { id: third.id }, data: { assignedToId: V2.id } });
    const moved = await put(third.id, V.cookie, { expectedVersion: cur.version + 1, status: 'DRAFT', responses: { ...cur.responses, clientCode: { value: 'late' } } });
    ok('reassigned while the form was open -> the next save is refused', moved.status === 403);
    ok('...and the new officer can continue the same intake', (await get(third.id, V2.cookie)).body.data.intake?.id === cur.id);
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
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
    && await prisma.officialIntake.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
