/**
 * The Barangay Blotter Report and the VAWC intake as two separate official
 * forms, the safety assessment's added fields, resolution records, and the
 * confidentiality hold on a report filed on the VAWC form - through the real
 * routes and the real database, with Groq replaced by a fake.
 * Run with:  npm run test:blotterreport
 *
 * Temporary rows are marked PROBE-BR and removed at the end, with their
 * audit rows; today's app-wide AI usage row is put back as it was.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import { FORMS, formTypeForCase, missingIn } from '../lib/intakeForms';
import { resolutionRefusal } from '../lib/caseRecords';
import { GET as intakeGET, POST as intakePOST, PUT as intakePUT } from '../app/api/cases/[id]/official-intake/route';
import { GET as pdfGET } from '../app/api/cases/[id]/official-intake/pdf/route';
import { PUT as safetyPUT } from '../app/api/cases/[id]/safety/route';
import { GET as recordsGET } from '../app/api/cases/[id]/records/route';
import { POST as followUpPOST } from '../app/api/cases/[id]/follow-ups/route';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_TIMEOUT_MS = '2000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
// Groq is answered with "assessment unavailable": nothing leaves the machine.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  return new Response('{"error":"test"}', { status: 503 });
}) as typeof fetch;

const TAG = 'PROBE-BR';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function pdfText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
  return out;
}

async function main() {
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    console.log('\nThe two forms');
    ok('a blotter case gets the Blotter Report, a VAWC case the intake form',
      formTypeForCase('Noise Complaint') === 'BLOTTER_REPORT' && formTypeForCase('Domestic Violence') === 'VAWC_INTAKE' && formTypeForCase('VAWC - Other') === 'VAWC_INTAKE');
    const bl = FORMS.BLOTTER_REPORT;
    ok('the Blotter Report has sections A to E', bl.sections.map(s => s.key).join('') === 'ABCDE');
    ok('it asks what the spec lists', ['complainantName', 'complainantAge', 'complainantAddress', 'complainantContact', 'complainantOccupation',
      'complainantRelationship', 'preferredContact', 'respondentName', 'respondentRelationship', 'incidentDate', 'incidentTime', 'incidentLocation',
      'incidentCategory', 'narrative', 'attachments', 'actionTaken', 'receivingOfficer', 'recordedDate', 'recordedTime', 'initialObservations',
      'recommendedNextSteps', 'blotterReferenceNo', 'assignedOfficer', 'caseStatus', 'resolutionDetails'].every(k => bl.byKey[k]));
    ok('occupation is optional', missingIn(bl, {}).every(i => i.key !== 'complainantOccupation'));
    ok('the forms share no victim-survivor items', !bl.byKey.victimName && !bl.byKey.typeOfViolence && Boolean(FORMS.VAWC_INTAKE.byKey.victimName));
    ok('a VAWC case cannot be recorded as "settled"', resolutionRefusal('SETTLED', 'Domestic Violence') !== null && resolutionRefusal('SETTLED', 'Noise Complaint') === null);

    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.br.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'); const V = await mk('vawc', 'vawc_officer');
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Complainant', age: 41, gender: 'Male',
      barangay: 'Ayukit', address: '12 Sampaguita St', emailVerified: true } });
    residents.push(r.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe Complainant', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'Maingay ang videoke ng kapitbahay hanggang madaling araw.', status: 'Open', residentId: r.id,
        reportingRelationship: 'SELF', contactPreference: 'text_first', incidentDate: new Date('2026-10-30T00:00:00Z'), incidentTimeApprox: 'mga alas-dos',
        assignedToId: B.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const bc = await mkCase({});
    await prisma.caseParty.create({ data: { caseId: bc.id, role: 'REPORTED', fullName: 'Juan Respondent', relationship: 'Kapitbahay', source: 'reporter' } });
    const vc = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });

    console.log('\nThe Blotter Report on a blotter case');
    const start = (id: string, cookie: string) => intakePOST(req(`/api/cases/${id}/official-intake`, cookie, 'POST'), params(id)).then(json);
    const st = await start(bc.id, B.cookie);
    ok('the blotter officer starts it', st.status === 201 && st.body.data.intake.formType === 'BLOTTER_REPORT', `${st.status} ${st.body.data?.intake?.formType}`);
    const resp = st.body.data.intake.responses as Body;
    ok('the complainant is the reporter on the case, from their account', resp.complainantName?.value === 'Probe Complainant' && resp.complainantAge?.value === '41'
      && String(resp.complainantAddress?.value).includes('12 Sampaguita St'));
    ok('no contact number is copied in - it stays behind the logged reveal', !resp.complainantContact);
    ok('relationship and contact preference from the report', resp.complainantRelationship?.value === 'directly_involved' && resp.preferredContact?.value === 'text_first');
    ok('the person reported, from the case record', resp.respondentName?.value === 'Juan Respondent' && resp.respondentRelationship?.value === 'Kapitbahay');
    ok('incident date, time, place, category and the original narrative', resp.incidentDate?.value === '2026-10-30' && resp.incidentTime?.value === 'mga alas-dos'
      && String(resp.incidentLocation?.value).startsWith('Ortega Compound') && resp.incidentCategory?.value === 'Noise Complaint'
      && resp.narrative?.value === bc.description);
    ok('reference number, receiving officer and assigned officer', resp.blotterReferenceNo?.value === bc.caseNumber
      && resp.receivingOfficer?.value === `${TAG} blotter` && resp.assignedOfficer?.value === `${TAG} blotter`);
    ok('each prefilled answer says where it came from', st.body.data.intake.prefilled.complainantName === 'registered resident profile');
    const put = (id: string, cookie: string, body: Body) => intakePUT(req(`/api/cases/${id}/official-intake`, cookie, 'PUT', body), params(id)).then(json);
    const draft = await put(bc.id, B.cookie, { expectedVersion: 1, status: 'DRAFT', responses: { ...resp, complainantOccupation: { value: 'Tricycle driver' } } });
    ok('saved as a draft, to continue later', draft.status === 200 && draft.body.data.intake.version === 2);
    ok('a VAWC item is refused on the Blotter Report', (await put(bc.id, B.cookie, { expectedVersion: 2, status: 'DRAFT', responses: { victimName: { value: { first: 'X' } } } })).status === 400);
    const early = await put(bc.id, B.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: draft.body.data.intake.responses });
    ok('completing early lists what is missing', early.status === 422 && early.body.missing.some((m: Body) => m.key === 'actionTaken'));
    const full = { ...draft.body.data.intake.responses, complainantContact: { marker: 'declined' }, respondentName: { value: 'Juan Respondent' },
      attachments: { value: 'none' }, immediateDanger: { value: 'no' }, actionTaken: { value: 'Kinausap ang magkabilang panig.' },
      initialObservations: { value: 'Malakas ang sound system sa oras ng pagdating.' }, recommendedNextSteps: { value: 'Ipatawag para sa pagdinig.' } };
    const done = await put(bc.id, B.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: full });
    ok('completed', done.status === 200 && done.body.data.intake.status === 'COMPLETED', `${done.status} ${JSON.stringify(done.body.missing ?? done.body.error ?? '')}`);
    const pdf = await pdfGET(req(`/api/cases/${bc.id}/official-intake/pdf`, B.cookie), params(bc.id));
    const text = await pdfText(new Uint8Array(await pdf!.arrayBuffer()));
    ok('the PDF is a Barangay Blotter Report', text.includes('BARANGAY BLOTTER REPORT') && !text.includes('INTAKE FORM') && text.includes('Tricycle driver')
      && text.includes('Initial Action Taken'.toUpperCase()), text.slice(0, 120));
    ok('and its file is named for it', /BlotterReport-/.test(pdf!.headers.get('content-disposition') ?? ''));

    console.log('\nThe VAWC intake stays VAWC');
    const vs = await start(vc.id, V.cookie);
    ok('a VAWC case starts the VAWC intake form', vs.status === 201 && vs.body.data.intake.formType === 'VAWC_INTAKE');
    ok('the blotter officer cannot open it', (await json(await intakeGET(req(`/api/cases/${vc.id}/official-intake`, B.cookie), params(vc.id)))).status === 404);
    const legacy = await mkCase({});
    await prisma.officialIntake.create({ data: { caseId: legacy.id, residentId: r.id, status: 'DRAFT', version: 1, formVersion: 'old', responses: {}, startedById: B.id, updatedById: B.id } });
    const lg = await json(await intakeGET(req(`/api/cases/${legacy.id}/official-intake`, B.cookie), params(legacy.id)));
    ok('an intake begun before the forms were split reopens as the form it was begun on', lg.body.data.formType === 'VAWC_INTAKE' && lg.body.data.intake.formType === 'VAWC_INTAKE');

    console.log('\nUrgent on the Blotter Report');
    const uc = await mkCase({});
    const us = await start(uc.id, B.cookie);
    await put(uc.id, B.cookie, { expectedVersion: 1, status: 'DRAFT', responses: { ...us.body.data.intake.responses, immediateDanger: { value: 'yes' } } });
    ok('danger recorded on a draft raises urgent review at once', (await prisma.case.findUnique({ where: { id: uc.id } }))?.triageStatus === 'URGENT_REVIEW');

    console.log('\nSafety assessment - the added fields');
    const s1 = await json(await safetyPUT(req(`/api/cases/${vc.id}/safety`, V.cookie, 'PUT', {
      immediateConcern: 'no', dependentsAffected: 'yes', urgentAssistance: 'no', medicalNeeded: 'no', shelterNeeded: 'unknown', policeOrReferralNeeded: 'yes',
      safeContactConfirmed: 'yes', preferredAssistance: 'Counseling at the MSWDO', safetyPlan: 'Stay with her sister if he returns; keep IDs ready.',
      followUpRequirements: 'Call back in 3 days by text first', expectedVersion: 0 }), params(vc.id)));
    ok('saved', s1.status === 200, `${s1.status} ${s1.body.error ?? ''}`);
    const rec = (await json(await recordsGET(req(`/api/cases/${vc.id}/records`, V.cookie), params(vc.id)))).body.data;
    ok('safe contact, preferred assistance, safety plan and follow-up requirements are kept', rec.safety.safeContactConfirmed === 'yes'
      && rec.safety.preferredAssistance === 'Counseling at the MSWDO' && rec.safety.safetyPlan.startsWith('Stay with') && rec.safety.followUpRequirements.startsWith('Call back'));
    const s2 = await json(await safetyPUT(req(`/api/cases/${uc.id}/safety`, B.cookie, 'PUT', {
      immediateConcern: 'yes', dependentsAffected: 'unknown', urgentAssistance: 'yes', medicalNeeded: 'unknown', shelterNeeded: 'unknown', policeOrReferralNeeded: 'unknown',
      expectedVersion: 0 }), params(uc.id)));
    ok('an urgent assessment saves without the optional details', s2.status === 200);

    console.log('\nResolution');
    const close = (id: string, cookie: string, body: Body) => followUpPOST(req(`/api/cases/${id}/follow-ups`, cookie, 'POST', body), params(id)).then(json);
    ok('resolution details only with a closure', (await close(bc.id, B.cookie, { type: 'note', content: 'x', resolution: { type: 'SETTLED', summary: 'Nagkasundo sila.' } })).status === 400);
    const c1 = await close(bc.id, B.cookie, { type: 'status_change', content: 'Nagkasundo sa pagdinig.', statusTo: 'Resolved', resolution: { type: 'SETTLED', summary: 'Nagkasundo ang dalawang panig na hihinaan ang videoke pagsapit ng alas-diyes.' } });
    ok('a blotter case resolved by amicable settlement', c1.status === 201);
    const bcase = await prisma.case.findUnique({ where: { id: bc.id } });
    ok('the resolution is recorded on the case, with who and when', bcase?.status === 'Resolved' && bcase.resolutionType === 'SETTLED' && bcase.resolvedById === B.id && Boolean(bcase.resolvedAt));
    ok('a VAWC case cannot be closed as settled', (await close(vc.id, V.cookie, { type: 'status_change', content: 'x', statusTo: 'Closed', resolution: { type: 'SETTLED', summary: 'Nagkasundo sila.' } })).status === 422);
    ok('it can be closed with services completed', (await close(vc.id, V.cookie, { type: 'status_change', content: 'Natapos ang serbisyo.', statusTo: 'Closed', resolution: { type: 'SERVICES_PROVIDED', summary: 'Counseling completed; referral to WCPD done.' } })).status === 201);
    const recB = (await json(await recordsGET(req(`/api/cases/${bc.id}/records`, B.cookie), params(bc.id)))).body.data;
    ok('the case records show it', recB.report.resolution?.type === 'SETTLED' && recB.report.resolution?.by === `${TAG} blotter`);

    console.log('\nA report on the VAWC form that reads as a blotter matter');
    const NOISE = 'Gabi-gabi pong maingay ang videoke ng kapitbahay namin hanggang alas-dos ng madaling araw. Walang nasaktan at walang nagbanta.';
    const filed = await json(await filePOST(req('/api/resident/cases', resCookie, 'POST', { reportPath: 'VAWC', description: NOISE, intakeNarrative: NOISE,
      reportingRelationship: 'SELF', intakeAnswers: [], barangay: 'Ayukit' })));
    ok('filed, not rejected', filed.status === 201, `${filed.status} ${filed.body.error ?? ''}`);
    if (filed.body.data?.id) caseIds.push(filed.body.data.id);
    const held = await prisma.case.findUnique({ where: { id: filed.body.data.id }, include: { intake: true } });
    ok('held on the VAWC desk until a VAWC officer confirms it', held?.caseType === 'VAWC - Other' && held.requiresOfficerReview);
    ok('the AI\'s own category is kept for the officer', held?.intake?.suggestedCaseCategory === 'Noise Complaint');
    ok('the reason is recorded', (held?.intake?.reviewReasons as string[]).some(x => x.includes('Held on the VAWC desk')));
    ok('the blotter cannot read it meanwhile', (await caseGET(req(`/api/cases/${held!.id}`, B.cookie), params(held!.id)))?.status === 404);
    ok('the original report is kept as written', held?.description === NOISE);
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
    await prisma.aiUsage.deleteMany({ where: { OR: residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })) } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0
    && await prisma.officialIntake.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.br.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
