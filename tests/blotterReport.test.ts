/**
 * The Barangay Blotter Intake Form (sections A-F, which replaced the Blotter
 * Report) and the VAWC intake as two separate official forms, KP Form No. 7,
 * old Blotter Report drafts reopening, the safety assessment's added fields, resolution records, and the
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
import { GET as kp7GET } from '../app/api/cases/[id]/official-intake/kp-form-7/route';
import { KP_KEYS } from '../lib/hearings';
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
    ok('a blotter case gets the Blotter Intake Form, a VAWC case the intake form',
      formTypeForCase('Noise Complaint') === 'BLOTTER_REPORT' && formTypeForCase('Domestic Violence') === 'VAWC_INTAKE' && formTypeForCase('VAWC - Other') === 'VAWC_INTAKE');
    const bl = FORMS.BLOTTER_REPORT;
    ok('one blotter form: the Blotter Intake Form, sections A to F', bl.title === 'Blotter Intake Form' && bl.sections.map(s => s.key).join('') === 'ABCDEF'
      && bl.pdf.title === 'BARANGAY BLOTTER INTAKE RECORD');
    ok('A: reference, date and time received, receiving officer, barangay, assigned officer, initial status',
      ['blotterReferenceNo', 'recordedDate', 'recordedTime', 'receivingOfficer', 'barangay', 'assignedOfficer', 'caseStatus'].every(k => bl.sections[0].items.some(i => i.key === k)));
    ok('B: the complainant\'s name in parts and in full, address, contact, relationship, safe contact method',
      bl.byKey.complainantName.type === 'name' && ['last', 'first', 'middle', 'extension', 'full'].every(k => bl.byKey.complainantName.parts!.some(p => p.key === k))
      && ['complainantAddress', 'complainantContact', 'complainantRelationship', 'preferredContact', 'additionalComplainants'].every(k => bl.sections[1].items.some(i => i.key === k)));
    ok('C: the respondent, with "unknown"', ['respondentUnknown', 'respondentName', 'respondentAddress', 'respondentContact', 'respondentRelationship', 'additionalRespondents']
      .every(k => bl.sections[2].items.some(i => i.key === k)));
    ok('D: the incident, persons involved, witnesses, attachments', ['incidentDate', 'incidentTime', 'incidentLocation', 'incidentCategory', 'narrative', 'personsInvolved', 'witnesses', 'attachments']
      .every(k => bl.sections[3].items.some(i => i.key === k)));
    ok('E: the complaint and the relief requested', ['complaintNature', 'complaintStatement', 'requestedRelief', 'additionalInfo'].every(k => bl.sections[4].items.some(i => i.key === k)));
    ok('F: initial action, the officer\'s own notes, referral, follow-up, date filed, acknowledgment', ['actionTaken', 'initialObservations', 'referralInfo', 'recommendedNextSteps', 'dateFiled', 'acknowledgment']
      .every(k => bl.sections[5].items.some(i => i.key === k)));
    ok('an unknown respondent need not be named', missingIn(bl, { respondentUnknown: { value: 'yes' } }).every(i => i.key !== 'respondentName')
      && missingIn(bl, {}).some(i => i.key === 'respondentName'));
    ok('occupation is optional', missingIn(bl, {}).every(i => i.key !== 'complainantOccupation'));
    ok('the forms share no victim-survivor items', !bl.byKey.victimName && !bl.byKey.typeOfViolence && Boolean(FORMS.VAWC_INTAKE.byKey.victimName));
    ok('a VAWC case cannot be recorded as "settled"', resolutionRefusal('SETTLED', 'Domestic Violence') !== null && resolutionRefusal('SETTLED', 'Noise Complaint') === null);

    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.br.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'); const V = await mk('vawc', 'vawc_officer'); const S = await mk('sysadmin', 'system_admin');
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Complainant', age: 41, gender: 'Male',
      barangay: 'Ayukit', address: '12 Sampaguita St', emailVerified: true } });
    residents.push(r.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe Complainant', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'Maingay ang videoke ng kapitbahay hanggang madaling araw.', status: 'Open', residentId: r.id,
        reportingRelationship: 'SELF', contactPreference: 'text_first', incidentDate: new Date('2026-10-30T00:00:00Z'), incidentTimeApprox: 'mga alas-dos',
        assignedToId: B.id, municipality: 'Bocaue', province: 'Bulacan', filedAt: new Date('2026-11-02T01:30:00Z'), ...d } as never });
      caseIds.push(c.id); return c;
    };
    const bc = await mkCase({});
    await prisma.caseParty.create({ data: { caseId: bc.id, role: 'REPORTED', fullName: 'Juan Respondent', relationship: 'Kapitbahay', source: 'reporter' } });
    const vc = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id });

    console.log('\nThe Blotter Intake Form on a blotter case');
    const start = (id: string, cookie: string) => intakePOST(req(`/api/cases/${id}/official-intake`, cookie, 'POST'), params(id)).then(json);
    const st = await start(bc.id, B.cookie);
    ok('the blotter officer starts it on the existing case', st.status === 201 && st.body.data.intake.formType === 'BLOTTER_REPORT', `${st.status} ${st.body.data?.intake?.formType}`);
    const resp = st.body.data.intake.responses as Body;
    ok('the complainant is the reporter on the case, name in parts, from their account', resp.complainantName?.value?.first === 'Probe' && resp.complainantName?.value?.last === 'Complainant'
      && resp.complainantAge?.value === '41' && String(resp.complainantAddress?.value).includes('12 Sampaguita St'));
    ok('no contact number is copied in - it stays behind the logged reveal', !resp.complainantContact);
    ok('relationship and contact preference from the report', resp.complainantRelationship?.value === 'directly_involved' && resp.preferredContact?.value === 'text_first');
    ok('the respondent, from the case record (never by name matching)', resp.respondentName?.value?.full === 'Juan Respondent' && resp.respondentRelationship?.value === 'Kapitbahay');
    ok('incident date, time, place, category and the original narrative, unchanged', resp.incidentDate?.value === '2026-10-30' && resp.incidentTime?.value === 'mga alas-dos'
      && String(resp.incidentLocation?.value).startsWith('Ortega Compound') && resp.incidentCategory?.value === 'Noise Complaint'
      && resp.narrative?.value === bc.description);
    ok('A: the case number as the reference, received when the case was filed, receiving and assigned officer, status, barangay',
      resp.blotterReferenceNo?.value === bc.caseNumber && resp.recordedDate?.value === '2026-11-02' && resp.recordedTime?.value === '09:30'
      && resp.receivingOfficer?.value === `${TAG} blotter` && resp.assignedOfficer?.value === `${TAG} blotter` && resp.caseStatus?.value === 'Open' && Boolean(resp.barangay?.value));
    ok('the complaint and relief are left for the complainant - nothing is written for them', !resp.complaintStatement && !resp.requestedRelief && !resp.complaintNature);
    ok('each prefilled answer says where it came from', st.body.data.intake.prefilled.complainantName === 'registered resident profile');
    ok('a second start returns the same intake, never a second', (await start(bc.id, B.cookie)).body.data.created === false
      && await prisma.officialIntake.count({ where: { caseId: bc.id } }) === 1);
    const put = (id: string, cookie: string, body: Body) => intakePUT(req(`/api/cases/${id}/official-intake`, cookie, 'PUT', body), params(id)).then(json);
    const draft = await put(bc.id, B.cookie, { expectedVersion: 1, status: 'DRAFT', autosave: true, responses: { ...resp, complainantOccupation: { value: 'Tricycle driver' } } });
    ok('saved as a draft (autosave), to continue later', draft.status === 200 && draft.body.data.intake.version === 2);
    ok('saving a draft creates no case', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 2);
    ok('a VAWC item is refused on the Blotter Intake Form', (await put(bc.id, B.cookie, { expectedVersion: 2, status: 'DRAFT', responses: { victimName: { value: { first: 'X' } } } })).status === 400);
    const early = await put(bc.id, B.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: draft.body.data.intake.responses });
    ok('completing early lists what is missing', early.status === 422 && ['actionTaken', 'complaintStatement', 'requestedRelief'].every(k => early.body.missing.some((m: Body) => m.key === k)));

    console.log('\nKP Form No. 7');
    const kp7 = (id: string, cookie: string) => kp7GET(req(`/api/cases/${id}/official-intake/kp-form-7`, cookie), params(id));
    const notYet = await json(await kp7(bc.id, B.cookie));
    ok('not for a case nobody has found eligible', notYet.status === 422 && /eligible/i.test(notYet.body.error ?? ''));
    ok('the form says so before anyone asks', (await json(await intakeGET(req(`/api/cases/${bc.id}/official-intake`, B.cookie), params(bc.id)))).body.data.kp?.eligible === false);
    await prisma.assessmentHistory.create({ data: { caseId: bc.id, kind: 'category_confirm', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
    await prisma.caseKpReview.create({ data: { caseId: bc.id, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: Object.fromEntries(KP_KEYS.map(k => [k, true])), reviewedById: B.id } });
    ok('once eligible, the form shows it available', (await json(await intakeGET(req(`/api/cases/${bc.id}/official-intake`, B.cookie), params(bc.id)))).body.data.kp?.eligible === true);
    const incomplete = await json(await kp7(bc.id, B.cookie));
    ok('without the complaint and relief it is refused, and says what is missing', incomplete.status === 422 && incomplete.body.missing?.some((m: string) => /complaint statement/.test(m)));
    const full = { ...draft.body.data.intake.responses, complainantContact: { marker: 'declined' },
      respondentName: { value: 'Juan Respondent' },  // the old one-line shape: read as the full name
      attachments: { value: 'none' }, immediateDanger: { value: 'no' }, actionTaken: { value: 'Kinausap ang magkabilang panig.' },
      initialObservations: { value: 'Malakas ang sound system sa oras ng pagdating.' }, recommendedNextSteps: { value: 'Ipatawag para sa pagdinig.' },
      complaintNature: { value: 'Ingay sa gabi (videoke)' }, complaintStatement: { value: 'Gabi-gabi pong maingay ang videoke ng respondent hanggang alas-dos ng madaling araw kaya hindi kami makatulog.' },
      requestedRelief: { value: 'Na hinaan ang videoke pagsapit ng alas-diyes ng gabi.' }, dateFiled: { value: '2026-11-04' } };
    const done = await put(bc.id, B.cookie, { expectedVersion: 2, status: 'COMPLETED', responses: full });
    ok('completed', done.status === 200 && done.body.data.intake.status === 'COMPLETED', `${done.status} ${JSON.stringify(done.body.missing ?? done.body.error ?? '')}`);
    ok('saved in the new form\'s version', (await prisma.officialIntake.findUnique({ where: { caseId: bc.id } }))?.formVersion === bl.version);
    const kres = await kp7(bc.id, B.cookie);
    ok('KP Form No. 7 is produced', kres!.status === 200 && /KP-Form-7-/.test(kres!.headers.get('content-disposition') ?? ''), String(kres!.status));
    const kt = (await pdfText(new Uint8Array(await kres!.arrayBuffer()))).replace(/\s+/g, ' ');
    ok('laid out as the handbook\'s form: Lupon heading, parties, case no., For', kt.includes('OFFICE OF THE LUPONG TAGAPAMAYAPA') && kt.includes('Probe Complainant') && kt.includes('Juan Respondent')
      && kt.includes(`Barangay Case No. ${bc.caseNumber}`) && kt.includes('For: Ingay sa gabi') && kt.includes('Province of Bulacan'));
    ok('the complaint and relief in the complainant\'s words', kt.includes('I/WE hereby complain against above named respondent/s') && kt.includes('hindi kami makatulog')
      && kt.includes('THEREFORE, I/WE pray that the following relief/s') && kt.includes('hinaan ang videoke'));
    ok('made on the date filed; received and filed left for the Punong Barangay', kt.includes('Made this 4th day of November, 2026') && kt.includes('Received and filed this ____') && kt.includes('Punong Barangay/Lupon Chairman'));
    ok('it says it is prepared in SafeComm, not an approved government copy', kt.includes('Prepared in SafeComm') && kt.includes('carries no seal'));
    ok('generating it is recorded on the case', await prisma.activity.count({ where: { caseId: bc.id, message: { startsWith: 'KP Form No. 7' } } }) === 1);
    ok('a VAWC case never gets one', (await json(await kp7(vc.id, V.cookie))).status === 422 || (await json(await kp7(vc.id, V.cookie))).status === 404);
    ok('and to the blotter desk a VAWC case is not found', (await json(await kp7(vc.id, B.cookie))).status === 404);

    const pdf = await pdfGET(req(`/api/cases/${bc.id}/official-intake/pdf`, B.cookie), params(bc.id));
    const text = await pdfText(new Uint8Array(await pdf!.arrayBuffer()));
    const flat = text.replace(/\s+/g, ' ');
    ok('the intake record PDF is the Barangay Blotter Intake Record, sections A to F', flat.includes('BARANGAY BLOTTER INTAKE RECORD') && !flat.includes('INTAKE FORM ')
      && ['A. ADMINISTRATIVE INFORMATION', 'B. COMPLAINANT INFORMATION', 'C. RESPONDENT INFORMATION', 'D. INCIDENT INFORMATION', 'E. COMPLAINT AND REQUESTED RELIEF', 'F. INITIAL ACTION AND DOCUMENTATION'].every(t => flat.includes(t))
      && flat.includes('Tricycle driver') && flat.includes('Juan Respondent'), flat.slice(0, 160));
    ok('three pages: A-B, C-D, E-F', text.split('\n').filter(Boolean).length === 3 && text.split('\n')[1].includes('C. RESPONDENT') && text.split('\n')[2].includes('E. COMPLAINT'));
    ok('it is not a KP form, and says it is a SafeComm copy', flat.includes('This record is not KP Form No. 7') && flat.includes('not an official government-issued form'));
    ok('and its file is named for it', /BlotterIntake-/.test(pdf!.headers.get('content-disposition') ?? ''), pdf!.headers.get('content-disposition') ?? '');

    console.log('\nWho may record it');
    const sa = await json(await intakeGET(req(`/api/cases/${bc.id}/official-intake`, S.cookie), params(bc.id)));
    ok('a system administrator may read a blotter intake but not record on it', sa.status === 200 && sa.body.data.access.edit === false
      && (await put(bc.id, S.cookie, { expectedVersion: 3, status: 'COMPLETED', responses: full })).status === 403);
    ok('a resident session cannot reach it', (await json(await intakeGET(req(`/api/cases/${bc.id}/official-intake`, resCookie), params(bc.id)))).status === 401);

    console.log('\nA draft begun on the old Blotter Report');
    const oc = await mkCase({});
    const oldResponses = { complainantName: { value: 'Pedro Lumang Ayos' }, respondentName: { value: 'Old Respondent' }, narrative: { value: 'Old narrative, kept.' },
      complainantOccupation: { value: 'Mangingisda' } };
    const oi = await prisma.officialIntake.create({ data: { caseId: oc.id, residentId: r.id, status: 'DRAFT', version: 1, formVersion: 'blotter-report/2026-11', formType: 'BLOTTER_REPORT',
      responses: oldResponses, startedById: B.id, updatedById: B.id } });
    await prisma.officialIntakeRevision.create({ data: { intakeId: oi.id, version: 1, status: 'DRAFT', responses: oldResponses, changedKeys: Object.keys(oldResponses), changedById: B.id } });
    const og = await json(await intakeGET(req(`/api/cases/${oc.id}/official-intake`, B.cookie), params(oc.id)));
    ok('reopens in the new form with every answer, the one-line names as the full name', og.status === 200 && og.body.data.intake.responses.complainantName?.value?.full === 'Pedro Lumang Ayos'
      && og.body.data.intake.responses.respondentName?.value?.full === 'Old Respondent' && og.body.data.intake.responses.narrative?.value === 'Old narrative, kept.'
      && og.body.data.intake.responses.complainantOccupation?.value === 'Mangingisda');
    ok('what is stored is not rewritten by opening it', ((await prisma.officialIntake.findUnique({ where: { id: oi.id } }))?.responses as Body).complainantName.value === 'Pedro Lumang Ayos');
    const os = await put(oc.id, B.cookie, { expectedVersion: 1, status: 'DRAFT', responses: { ...og.body.data.intake.responses, complaintNature: { value: 'Away sa bakod' } } });
    ok('and it saves in the new form', os.status === 200 && (await prisma.officialIntake.findUnique({ where: { id: oi.id } }))?.formVersion === bl.version, `${os.status} ${os.body.error ?? ''}`);
    ok('its first version stays in the history as it was', ((await prisma.officialIntakeRevision.findFirst({ where: { intakeId: oi.id, version: 1 } }))?.responses as Body).complainantName.value === 'Pedro Lumang Ayos');

    console.log('\nThe VAWC intake stays VAWC');
    const vs = await start(vc.id, V.cookie);
    ok('a VAWC case starts the VAWC intake form', vs.status === 201 && vs.body.data.intake.formType === 'VAWC_INTAKE');
    ok('the blotter officer cannot open it', (await json(await intakeGET(req(`/api/cases/${vc.id}/official-intake`, B.cookie), params(vc.id)))).status === 404);
    const legacy = await mkCase({});
    await prisma.officialIntake.create({ data: { caseId: legacy.id, residentId: r.id, status: 'DRAFT', version: 1, formVersion: 'old', responses: {}, startedById: B.id, updatedById: B.id } });
    const lg = await json(await intakeGET(req(`/api/cases/${legacy.id}/official-intake`, B.cookie), params(legacy.id)));
    ok('an intake begun before the forms were split reopens as the form it was begun on', lg.body.data.formType === 'VAWC_INTAKE' && lg.body.data.intake.formType === 'VAWC_INTAKE');

    console.log('\nUrgent on the Blotter Intake Form');
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
