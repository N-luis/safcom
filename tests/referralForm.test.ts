/**
 * Annex B - Referral Form: recorded with a referral, prefilled from the case,
 * corrected later, and downloaded as a PDF - through the real routes and the
 * real database (in-process). Run with:  npm run test:referralform
 * Fictional data only; every row is marked PROBE-RF and removed at the end.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { EMERGENCY_CONTACTS } from '../lib/safecommConfig';
import { referralFormSchema } from '../lib/referralForm';
import { GET as prefillGET, POST as referralPOST } from '../app/api/cases/[id]/referrals/route';
import { GET as referralGET, PATCH as referralPATCH, PUT as referralPUT } from '../app/api/cases/[id]/referrals/[rid]/route';
import { GET as pdfGET } from '../app/api/cases/[id]/referrals/[rid]/pdf/route';
import { GET as recordsGET } from '../app/api/cases/[id]/records/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RF';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const P = (id: string) => ({ params: Promise.resolve({ id }) });
const PR = (id: string, rid: string) => ({ params: Promise.resolve({ id, rid }) });
async function pdfText(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ');
  return { text: out.replace(/\s+/g, ' '), pages: doc.numPages };
}
const todayPh = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    console.log('\nThe form\'s rules');
    ok('an age outside 0-120 is refused', !referralFormSchema.safeParse({ clientAge: 130 }).success && !referralFormSchema.safeParse({ clientAge: 'thirty' }).success);
    ok('sex only as recorded: Female, Male, Intersex or blank', referralFormSchema.safeParse({ clientSex: 'Female' }).success && referralFormSchema.safeParse({ clientSex: '' }).success
      && !referralFormSchema.safeParse({ clientSex: 'F' }).success);
    ok('a phone or fax number may not contain letters', !referralFormSchema.safeParse({ guardianContact: 'call me' }).success && referralFormSchema.safeParse({ feedbackLandline: '(044) 309-3314' }).success);
    ok('an email address must look like one', !referralFormSchema.safeParse({ feedbackEmail: 'not-an-email' }).success && referralFormSchema.safeParse({ feedbackEmail: 'desk@brgy.gov.ph' }).success);
    ok('every field may be left blank - it prints as a line', referralFormSchema.safeParse({}).success);

    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.rf.${k}.${process.pid}@safcom.local`, name: `Probe ${k}`, password: pw, role } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer'), B2 = await mk('blotter2', 'officer'), V = await mk('vawc', 'vawc_officer'), A = await mk('admin', 'admin');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Lorna', lastName: 'Probereferral', age: 41, gender: 'Female',
      barangay: 'Ayukit', address: '12 Sampaguita St, Purok 2', contactNumber: '09170000031', emailVerified: true } });
    residents.push(R.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Lorna', role: 'resident' })}`;
    const mkCase = async (k: string, data: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${k}-${process.pid}`, residentName: 'Lorna Probereferral', barangay: 'Ortega Compound', description: 'Fictional report',
        status: 'Open', residentId: R.id, municipality: 'Bocaue', province: 'Bulacan', ...data } as never });
      caseIds.push(c.id); return c;
    };
    const bc = await mkCase('B', { caseType: 'Noise Complaint', assignedToId: B.id, reportingRelationship: 'SELF' });
    const vc = await mkCase('V', { caseType: 'Domestic Violence', assignedToId: V.id, reportingRelationship: 'THIRD_PARTY' });
    await prisma.caseParty.create({ data: { caseId: vc.id, role: 'AFFECTED', fullName: 'Carmela Probeclient', age: 29, address: 'Purok 4, near the chapel', source: 'official', updatedById: V.id } });
    await prisma.caseVictimSurvivor.create({ data: { caseId: vc.id, sexAtBirth: 'female', ageAtIncident: 29, recordedById: V.id } });

    console.log('\nPrefilled from the case');
    const pb = (await json(await prefillGET(req(`/api/cases/${bc.id}/referrals`, B.cookie), P(bc.id)))).body.data;
    ok('reporting for themselves: the client is the reporter, from their own account', pb.form.clientName === 'Lorna Probereferral' && pb.form.clientAge === '41'
      && pb.form.clientSex === 'Female' && pb.form.clientAddress === '12 Sampaguita St, Purok 2', JSON.stringify(pb.form));
    ok('the referring party is this barangay\'s blotter desk, with the barangay hall\'s configured number', /Blotter Desk/.test(pb.form.feedbackTo)
      && pb.form.feedbackCellPhone === (EMERGENCY_CONTACTS.find(x => /barangay hall/i.test(x.label))?.number ?? ''));
    ok('referred by: the official, with their designation', pb.form.referredByName === 'Probe blotter' && pb.form.referredByDesignation === 'Blotter Officer');
    ok('nothing is guessed: the guardian and the receiving office stay blank', pb.form.guardianName === '' && pb.form.toAddress === '' && pb.form.toContactPerson === '');
    ok('each prefilled value says where it came from', pb.from.clientName === "the reporter's account" && pb.from.clientSex === "the reporter's account");
    const pv = (await json(await prefillGET(req(`/api/cases/${vc.id}/referrals`, V.cookie), P(vc.id)))).body.data;
    ok('reporting for someone else: the client is the person affected, from the official record', pv.form.clientName === 'Carmela Probeclient' && pv.form.clientAge === '29');
    ok('sex as an official recorded it on the VAWC case', pv.form.clientSex === 'Female' && pv.from.clientSex === 'the victim-survivor record');
    ok('the VAWC desk is the referring party there', /VAWC Desk/.test(pv.form.feedbackTo) && pv.form.referredByDesignation === 'VAWC Officer');
    ok('an officer the case is not assigned to cannot open the prefill', (await json(await prefillGET(req(`/api/cases/${bc.id}/referrals`, B2.cookie), P(bc.id)))).status === 403);

    console.log('\nRecording a referral with its form');
    const form = { ...pb.form, toAddress: 'Bocaue Municipal Police Station, MacArthur Highway', toContactPerson: 'PCpl. Ana Probe',
      guardianName: 'Jose Probereferral (husband)', guardianContact: '0917 000 0032', guardianAddress: 'Same address',
      servicesRequested: 'Blotter certification and patrol visit', feedbackEmail: 'blotter@brgy-probe.gov.ph', feedbackLandline: '(044) 309-3314', feedbackFax: '' };
    const bad = await json(await referralPOST(req(`/api/cases/${bc.id}/referrals`, B.cookie, 'POST', { agency: 'PNP', referredAt: todayPh, reason: 'x', form: { ...form, feedbackEmail: 'nope' } }), P(bc.id)));
    ok('a bad email in the form stops the referral, with a message', bad.status === 400 && /email/i.test(bad.body.error ?? ''));
    ok('...so does an age of 200', (await json(await referralPOST(req(`/api/cases/${bc.id}/referrals`, B.cookie, 'POST', { agency: 'PNP', referredAt: todayPh, form: { clientAge: 200 } }), P(bc.id)))).status === 400);
    const add = await json(await referralPOST(req(`/api/cases/${bc.id}/referrals`, B.cookie, 'POST', { agency: 'PNP', referredAt: todayPh,
      reason: 'Repeated night-time disturbance with threats; the reporter asks for police assistance.', status: 'REFERRED', form }), P(bc.id)));
    ok('the referral is saved with its form, on this case', add.status === 201 && add.body.data.caseId === bc.id && add.body.data.clientName === 'Lorna Probereferral'
      && add.body.data.toContactPerson === 'PCpl. Ana Probe' && add.body.data.feedbackFax === null && Boolean(add.body.data.formUpdatedAt), `${add.status} ${add.body.error ?? ''}`);
    const rid = add.body.data.id as string;
    const recs = (await json(await recordsGET(req(`/api/cases/${bc.id}/records`, B.cookie), P(bc.id)))).body.data;
    ok('the case\'s records list it with the form', recs.referrals.some((r: Body) => r.id === rid && r.servicesRequested === 'Blotter certification and patrol visit'));
    ok('a VAWC case still cannot be referred to the Lupon', (await json(await referralPOST(req(`/api/cases/${vc.id}/referrals`, V.cookie, 'POST', { agency: 'LUPON', referredAt: todayPh, form: {} }), P(vc.id)))).status === 422);

    console.log('\nThe live form editor');
    const one = await json(await referralGET(req(`/api/cases/${bc.id}/referrals/${rid}`, B.cookie), PR(bc.id, rid)));
    ok('reopens a saved referral with its form and its desk', one.status === 200 && one.body.data.referral.form.toContactPerson === 'PCpl. Ana Probe'
      && one.body.data.desk === 'BLOTTER' && one.body.data.caseNumber === bc.caseNumber && one.body.data.access.edit === true, `${one.status} ${one.body.error ?? ''}`);
    ok('...for the officer the case is assigned to, not another', (await json(await referralGET(req(`/api/cases/${bc.id}/referrals/${rid}`, B2.cookie), PR(bc.id, rid)))).status === 403);
    ok('a blotter officer cannot open a VAWC case\'s referral that way (not found)', (await json(await referralGET(req(`/api/cases/${vc.id}/referrals/${rid}`, B.cookie), PR(vc.id, rid)))).status === 404);
    ok('the new-form prefill names the desk, so only that desk\'s offices are offered', pb.desk === 'BLOTTER' && pv.desk === 'VAWC');

    console.log('\nThe PDF');
    const pdfRes = await pdfGET(req(`/api/cases/${bc.id}/referrals/${rid}/pdf`, B.cookie), PR(bc.id, rid));
    ok('downloads as a PDF file named after the case', pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf'
      && /attachment; filename="Referral-PROBE-RF-B-\d+-\d{4}-\d{2}-\d{2}\.pdf"/.test(pdfRes.headers.get('content-disposition') ?? ''), pdfRes.headers.get('content-disposition') ?? String(pdfRes.status));
    const t = await pdfText(pdfRes);
    ok('one page, headed REFERRAL FORM as on the form - no ANNEX B, nothing added', t.pages === 1 && t.text.includes('REFERRAL FORM') && !t.text.includes('ANNEX B') && !t.text.includes('Prepared in SafeComm'));
    ok('every label of the form, in its order', ['Case No.', 'Date of Referral', 'To:', 'Address', 'Contact Person', 'Name of Client', 'Age', 'Sex', 'Name of Family/Guardian', 'Contact No.',
      'Reason/s for Referral', 'Specific Service/s Requested', 'Please refer to attached report/ intake form/case summary for more information.',
      'Feedback requested and send to Referring Party/Agency:', 'Cell Phone No.', 'Landline No.', 'Email address:', 'Fax No.', 'Referred by:', 'Signature over Printed Name', 'Designation']
      .every((l, i, a) => t.text.includes(l) && (i === 0 || t.text.indexOf(l) >= t.text.indexOf(a[i - 1]) || ['Address', 'Contact Person', 'Age', 'Sex'].includes(l))));
    ok('the recorded values are printed: case no., office, client, guardian, reason, services, referring party', [bc.caseNumber, 'PNP police station', 'Bocaue Municipal Police Station',
      'PCpl. Ana Probe', 'Lorna Probereferral', '41', 'Female', 'Jose Probereferral (husband)', '0917 000 0032', 'Repeated night-time disturbance', 'Blotter certification and patrol visit',
      'blotter@brgy-probe.gov.ph', '(044) 309-3314', 'Probe blotter', 'Blotter Officer'].every(v => t.text.includes(v)), t.text.slice(0, 400));
    const old = await prisma.caseReferral.create({ data: { caseId: bc.id, agency: 'SOCIAL_WELFARE', referredAt: new Date(), reason: null, createdById: B.id } });
    const oldText = await pdfText(await pdfGET(req(`/api/cases/${bc.id}/referrals/${old.id}/pdf`, B.cookie), PR(bc.id, old.id)));
    ok('a referral recorded before the form still downloads - blank lines, nothing made up', oldText.text.includes('Name of Client') && !oldText.text.includes('Lorna Probereferral')
      && oldText.text.includes('Social welfare office'));
    ok('an officer the case is not assigned to cannot download it (same rule as the case records)', (await pdfGET(req(`/api/cases/${bc.id}/referrals/${rid}/pdf`, B2.cookie), PR(bc.id, rid))).status === 403);
    ok('an admin (oversight) can', (await pdfGET(req(`/api/cases/${bc.id}/referrals/${rid}/pdf`, A.cookie), PR(bc.id, rid))).status === 200);
    ok('each download is in the access log', (await prisma.reporterAccessLog.count({ where: { caseId: bc.id, fields: { has: 'referral_form_pdf' }, outcome: 'permitted' } })) >= 3);

    console.log('\nCorrecting the form later');
    const put = await json(await referralPUT(req(`/api/cases/${bc.id}/referrals/${old.id}`, B.cookie, 'PUT', { reason: 'Family needs counselling', form: { clientName: 'Lorna Probereferral', servicesRequested: 'Family counselling' } }), PR(bc.id, old.id)));
    ok('an older referral\'s form can be filled in, reason included', put.status === 200 && put.body.data.clientName === 'Lorna Probereferral' && put.body.data.reason === 'Family needs counselling' && Boolean(put.body.data.formUpdatedAt));
    ok('a bad value is refused there too', (await json(await referralPUT(req(`/api/cases/${bc.id}/referrals/${old.id}`, B.cookie, 'PUT', { form: { clientSex: 'unknown' } }), PR(bc.id, old.id)))).status === 400);
    ok('an officer the case is not assigned to cannot change it', (await json(await referralPUT(req(`/api/cases/${bc.id}/referrals/${old.id}`, B2.cookie, 'PUT', { form: {} }), PR(bc.id, old.id)))).status === 403);
    ok('the status change still works as before', (await json(await referralPATCH(req(`/api/cases/${bc.id}/referrals/${rid}`, B.cookie, 'PATCH', { status: 'ACKNOWLEDGED' }), PR(bc.id, rid)))).status === 200);

    console.log('\nConnected to its own case only; VAWC restricted');
    const vadd = await json(await referralPOST(req(`/api/cases/${vc.id}/referrals`, V.cookie, 'POST', { agency: 'PNP_WCPD', referredAt: todayPh, reason: 'Protection and medico-legal', form: pv.form }), P(vc.id)));
    ok('a VAWC referral with its form', vadd.status === 201);
    const vrid = vadd.body.data.id as string;
    ok('another case\'s referral through this case is not found', (await pdfGET(req(`/api/cases/${bc.id}/referrals/${vrid}/pdf`, B.cookie), PR(bc.id, vrid))).status === 404
      && (await json(await referralPUT(req(`/api/cases/${bc.id}/referrals/${vrid}`, B.cookie, 'PUT', { form: {} }), PR(bc.id, vrid)))).status === 404);
    ok('a blotter officer cannot download a VAWC referral form (not found)', (await pdfGET(req(`/api/cases/${vc.id}/referrals/${vrid}/pdf`, B.cookie), PR(vc.id, vrid))).status === 404);
    const vt = await pdfText(await pdfGET(req(`/api/cases/${vc.id}/referrals/${vrid}/pdf`, V.cookie), PR(vc.id, vrid)));
    ok('the VAWC officer can, with the client from the official record', vt.text.includes('Carmela Probeclient') && vt.text.includes('PNP Women and Children Protection Desk'));
    ok('a resident session cannot download any referral form', (await pdfGET(req(`/api/cases/${bc.id}/referrals/${rid}/pdf`, resCookie), PR(bc.id, rid))).status === 401);
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
    && await prisma.caseReferral.count({ where: { caseId: { in: caseIds } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.rf.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
