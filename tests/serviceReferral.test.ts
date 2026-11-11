/**
 * The Service Referral Form, part 2 - through the real routes and the real
 * database (in-process): who may create, see and download one; the draft,
 * issue, acknowledgement and cancel workflow; repeated clicks; several
 * referrals on one case; the issued document and its hash.
 * Run with:  npm run test:servicereferral:db   (needs .env and prisma/sql/012 applied)
 *
 * Fictional data only; every row is marked PROBE-SR and removed at the end.
 */
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { GET as listGET, POST as createPOST } from '../app/api/cases/[id]/service-referrals/route';
import { GET as oneGET, PUT as savePUT } from '../app/api/cases/[id]/service-referrals/[rid]/route';
import { POST as issuePOST } from '../app/api/cases/[id]/service-referrals/[rid]/issue/route';
import { POST as ackPOST } from '../app/api/cases/[id]/service-referrals/[rid]/acknowledgement/route';
import { POST as cancelPOST } from '../app/api/cases/[id]/service-referrals/[rid]/cancel/route';
import { GET as pdfGET } from '../app/api/cases/[id]/service-referrals/[rid]/pdf/route';
import { POST as scanPOST } from '../app/api/cases/[id]/service-referrals/[rid]/attachments/route';
import { GET as scanGET } from '../app/api/cases/[id]/service-referrals/[rid]/attachments/[aid]/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-SR';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const P = (id: string) => ({ params: Promise.resolve({ id }) });
const PR = (id: string, rid: string) => ({ params: Promise.resolve({ id, rid }) });
const todayPh = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const tomorrowPh = new Date(Date.now() + 32 * 3600_000).toISOString().slice(0, 10);

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string, extra: Record<string, unknown> = {}) => {
      const u = await prisma.user.create({ data: { email: `probe.sr.${k}.${process.pid}@safcom.local`, name: `Maria Probe ${k}`, password: pw, role, ...extra } });
      users.push(u.id); return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mk('vawc', 'vawc_officer', { phone: '0917 000 0101' });
    const V2 = await mk('vawc2', 'vawc_officer');
    const B = await mk('blotter', 'officer');
    const A = await mk('captain', 'admin');
    const S = await mk('sysadmin', 'system_admin');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Liza', lastName: 'Probeclient', age: 33, gender: 'Female',
      barangay: 'Testville', address: '7 Probe St', emailVerified: true } });
    residents.push(R.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Liza', role: 'resident' })}`;
    const mkCase = async (k: string, data: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${k}-${process.pid}`, residentName: 'Liza Probeclient', barangay: 'Probe St',
        description: 'FICTIONAL NARRATIVE - must never appear on a referral', status: 'Open', residentId: R.id, ...data } as never });
      caseIds.push(c.id); return c;
    };
    const vc = await mkCase('V', { caseType: 'Domestic Violence', assignedToId: V.id, reportingRelationship: 'SELF', contactPreference: 'no_phone' });
    const vcOther = await mkCase('V2', { caseType: 'Domestic Violence', assignedToId: V2.id });
    const bc = await mkCase('B', { caseType: 'Noise Complaint', assignedToId: B.id });
    await prisma.officialIntake.create({ data: { caseId: vc.id, residentId: R.id, formVersion: 'probe', formType: 'VAWC_INTAKE', startedById: V.id, updatedById: V.id,
      responses: { clientCode: { value: 'CC-PROBE-77' }, incidentNo: { value: 'INC-PROBE-88' } } } });
    await prisma.caseSafetyAssessment.create({ data: { caseId: vc.id, immediateConcern: 'no', dependentsAffected: 'no', urgentAssistance: 'no', medicalNeeded: 'no',
      shelterNeeded: 'yes', policeOrReferralNeeded: 'no', updatedById: V.id } });

    console.log('\nWho may create a referral');
    const key1 = `probe-${process.pid}-aaaa-1`;
    ok('a blotter officer: the VAWC case does not exist', (await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, B.cookie, 'POST', { requestKey: key1 }), P(vc.id)))).status === 404);
    ok('the system administrator: not found either', (await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, S.cookie, 'POST', { requestKey: key1 }), P(vc.id)))).status === 404);
    ok('a VAWC officer the case is not assigned to: refused', (await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, V2.cookie, 'POST', { requestKey: key1 }), P(vc.id)))).status === 403);
    ok('the captain (oversight) on a case not assigned to them: refused', (await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, A.cookie, 'POST', { requestKey: key1 }), P(vc.id)))).status === 403);
    ok('a resident session: refused', (await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, resCookie, 'POST', { requestKey: key1 }), P(vc.id)))).status === 401);
    ok('a blotter case: the form is for VAWC cases', (await json(await createPOST(req(`/api/cases/${bc.id}/service-referrals`, B.cookie, 'POST', { requestKey: key1 }), P(bc.id)))).status === 422);

    const [c1, c1again] = await Promise.all([
      json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, V.cookie, 'POST', { requestKey: key1 }), P(vc.id))),
      json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, V.cookie, 'POST', { requestKey: key1 }), P(vc.id))),
    ]);
    ok('the assigned VAWC officer creates one', [200, 201].includes(c1.status) && Boolean(c1.body.data?.id), `${c1.status} ${c1.body.error ?? ''}`);
    ok('the same click twice makes one draft, not two', c1.body.data?.id === c1again.body.data?.id
      && await prisma.serviceReferral.count({ where: { caseId: vc.id } }) === 1);
    const rid = c1.body.data.id as string;

    console.log('\nOpened from its case, prefilled from exact sources');
    const one = await json(await oneGET(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie), PR(vc.id, rid)));
    const r0 = one.body.data.referral;
    ok('linked to the case by its id; numbered after the case', r0.caseId === vc.id && r0.reference === `SR-${vc.caseNumber}-1` && one.body.data.context.caseNumber === vc.caseNumber);
    ok('client code and incident no. from the official intake, each with its source', r0.form.clientCode === 'CC-PROBE-77' && r0.form.incidentNo === 'INC-PROBE-88'
      && /intake/.test(r0.prefilled.clientCode.source));
    ok('position, contact no. and email from the officer\'s account', r0.form.position === 'VAWC Officer' && r0.form.contactNo === '0917 000 0101' && r0.form.email === V.email);
    ok('the officer\'s name is not split by guess', r0.form.referredByLast === '' && r0.form.referredByFirst === '' && one.body.data.me.name === V.name);
    ok('nothing about the receiving organization or the service is assumed', r0.form.destination === '' && r0.form.services.length === 0 && r0.form.receivingAgency === '' && r0.form.actionTaken === '');
    ok('the narrative is not copied anywhere into it', !JSON.stringify(one.body).includes('FICTIONAL NARRATIVE'));
    ok('the safe-contact preference and a suggestion from the safety assessment are shown as context', one.body.data.context.contactPreference === 'no_phone'
      && one.body.data.context.suggestions.some((s: Body) => s.service === 'SHELTER'));
    ok('another case\'s id cannot reach it', (await json(await oneGET(req(`/api/cases/${vcOther.id}/service-referrals/${rid}`, V2.cookie), PR(vcOther.id, rid)))).status === 404);
    ok('the captain may view it', (await json(await oneGET(req(`/api/cases/${vc.id}/service-referrals/${rid}`, A.cookie), PR(vc.id, rid)))).status === 200);
    ok('a blotter officer may not (not found)', (await json(await oneGET(req(`/api/cases/${vc.id}/service-referrals/${rid}`, B.cookie), PR(vc.id, rid)))).status === 404);

    console.log('\nSaving a draft');
    const form = { ...r0.form, referringOrganization: 'Barangay Probe VAWC Desk', actionTaken: 'Intake done; safety plan made.', referredByLast: 'Probe', referredByFirst: 'Maria',
      addressBarangay: 'Testville', addressCity: 'Probe City', destination: 'SWDO', services: ['SHELTER', 'PSYCHOSOCIAL'],
      receivingAgency: 'MSWDO Probe City', receivingAddress: 'Municipal Hall', receivingContactPerson: 'Pedro Probe', receivingContactNo: '(044) 000-0000', clientSignatory: 'CLIENT' };
    const sv = await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie, 'PUT', { expectedVersion: 1, form }), PR(vc.id, rid)));
    ok('saved, version 2, destination and services copied for the history', sv.status === 200 && sv.body.data.referral.version === 2 && sv.body.data.referral.destination === 'SWDO'
      && sv.body.data.referral.receivingOrganization === 'MSWDO Probe City', `${sv.status} ${sv.body.error ?? ''}`);
    ok('a stale save (old version) is refused, not merged', (await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie, 'PUT', { expectedVersion: 1, form: { ...form, position: 'X' } }), PR(vc.id, rid)))).status === 409);
    ok('Section C cannot be written through the form', (await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie, 'PUT', { expectedVersion: 2, form: { ...form, ackStatus: 'ACKNOWLEDGED' } }), PR(vc.id, rid)))).status === 400);
    ok('another VAWC officer cannot save it', (await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V2.cookie, 'PUT', { expectedVersion: 2, form }), PR(vc.id, rid)))).status === 403);
    ok('the saved draft reopens as saved', (await json(await oneGET(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie), PR(vc.id, rid)))).body.data.referral.form.receivingContactPerson === 'Pedro Probe');
    ok('the case itself is unchanged', Boolean((await prisma.case.findUnique({ where: { id: vc.id }, select: { status: true, description: true } }))?.description.startsWith('FICTIONAL')));
    const draftPdf = await pdfGET(req(`/api/cases/${vc.id}/service-referrals/${rid}/pdf`, V.cookie), PR(vc.id, rid));
    ok('a draft PDF, named by referral number only', draftPdf.status === 200 && draftPdf.headers.get('content-type') === 'application/pdf'
      && new RegExp(`filename="Service-Referral-SR-${TAG}-V-\\d+-1-DRAFT\\.pdf"`).test(draftPdf.headers.get('content-disposition') ?? '')
      && !/Liza|Probeclient/.test(draftPdf.headers.get('content-disposition') ?? ''), draftPdf.headers.get('content-disposition') ?? '');
    ok('never cached', draftPdf.headers.get('cache-control') === 'no-store, private');

    console.log('\nIssuing');
    ok('acknowledgement before issue is refused', (await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, V.cookie, 'POST',
      { status: 'ACKNOWLEDGED', basis: 'VERBAL', receivedByName: 'X Y', dateReceived: todayPh }), PR(vc.id, rid)))).status === 409);
    ok('issuing without confirming the recipient is refused', (await json(await issuePOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/issue`, V.cookie, 'POST',
      { expectedVersion: 2, issuedVia: 'HAND_DELIVERED' }), PR(vc.id, rid)))).status === 400);
    const [i1, i2] = await Promise.all([
      json(await issuePOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/issue`, V.cookie, 'POST', { expectedVersion: 2, issuedVia: 'HAND_DELIVERED', recipientVerified: true }), PR(vc.id, rid))),
      json(await issuePOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/issue`, V.cookie, 'POST', { expectedVersion: 2, issuedVia: 'HAND_DELIVERED', recipientVerified: true }), PR(vc.id, rid))),
    ]);
    ok('a double click issues it once; the second is refused', [i1.status, i2.status].sort().join() === '200,409', `${i1.status} ${i2.status} ${i1.body.error ?? ''} ${i2.body.error ?? ''}`);
    const issued = await prisma.serviceReferral.findUnique({ where: { id: rid } });
    ok('issued: awaiting acknowledgement, recipient confirmed, document stored with its hash', issued?.status === 'ISSUED' && issued.ackStatus === 'AWAITING' && Boolean(issued.recipientVerifiedAt)
      && Boolean(issued.issuedDocument) && createHash('sha256').update(issued.issuedDocument!).digest('hex') === issued.documentSha256);
    ok('Section C is not filled in by issuing', issued?.ackReceivedByName === null && issued.ackDateReceived === null && issued.ackRecordedById === null);
    ok('an issued form can no longer be saved', (await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid}`, V.cookie, 'PUT', { expectedVersion: issued!.version, form: { ...form, position: 'Y' } }), PR(vc.id, rid)))).status === 409);
    let rewritten = false;
    try { await prisma.serviceReferral.update({ where: { id: rid }, data: { form: { ...form, position: 'Tampered' } } }); rewritten = true; } catch { /* the trigger refuses */ }
    ok('the database itself refuses to rewrite an issued form', !rewritten);
    const issuedPdf = await pdfGET(req(`/api/cases/${vc.id}/service-referrals/${rid}/pdf`, A.cookie), PR(vc.id, rid));
    const bytes = new Uint8Array(await issuedPdf.arrayBuffer());
    ok('the issued PDF is the stored document, byte for byte', issuedPdf.status === 200 && createHash('sha256').update(bytes).digest('hex') === issued?.documentSha256
      && issuedPdf.headers.get('x-document-sha256') === issued?.documentSha256);
    ok('a blotter officer cannot download it (not found)', (await pdfGET(req(`/api/cases/${vc.id}/service-referrals/${rid}/pdf`, B.cookie), PR(vc.id, rid))).status === 404);
    ok('nor a resident', (await pdfGET(req(`/api/cases/${vc.id}/service-referrals/${rid}/pdf`, resCookie), PR(vc.id, rid))).status === 401);
    ok('each download is in the access log, and in the referral\'s history', await prisma.reporterAccessLog.count({ where: { caseId: vc.id, fields: { has: 'service_referral_pdf' }, outcome: 'permitted' } }) >= 2
      && await prisma.serviceReferralEvent.count({ where: { referralId: rid, type: 'DOCUMENT_GENERATED' } }) >= 2);

    console.log('\nSection C - the receiving organization\'s acknowledgement');
    ok('a date received in the future is refused', (await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, V.cookie, 'POST',
      { status: 'ACKNOWLEDGED', basis: 'SIGNED_COPY', receivedByName: 'Rosa Probe', dateReceived: tomorrowPh }), PR(vc.id, rid)))).status === 400);
    ok('the captain may view but not record it on a case not assigned to them', (await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, A.cookie, 'POST',
      { status: 'RETURNED', basis: 'VERBAL', remarks: 'Missing intake form copy' }), PR(vc.id, rid)))).status === 403);
    const ret = await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, V.cookie, 'POST',
      { status: 'RETURNED', basis: 'VERBAL', remarks: 'Missing intake form copy' }), PR(vc.id, rid)));
    ok('returned for follow-up, with the reason', ret.status === 200 && ret.body.data.referral.ack.status === 'RETURNED');
    const ack = await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, V.cookie, 'POST',
      { status: 'ACKNOWLEDGED', basis: 'SIGNED_COPY', receivedByName: 'Rosa Probe', position: 'Social Worker', clientCode: 'MSW-PROBE', dateReceived: todayPh, remarks: 'Received' }), PR(vc.id, rid)));
    ok('then received, recorded with who and when', ack.status === 200 && ack.body.data.referral.ack.status === 'ACKNOWLEDGED' && ack.body.data.referral.ack.recordedBy === V.name
      && Boolean(ack.body.data.referral.ack.recordedAt) && ack.body.data.referral.ack.basis === 'SIGNED_COPY');
    ok('a recorded receipt is final', (await json(await ackPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/acknowledgement`, V.cookie, 'POST',
      { status: 'RETURNED', basis: 'VERBAL', remarks: 'changed mind' }), PR(vc.id, rid)))).status === 409);
    ok('an acknowledged referral cannot be cancelled', (await json(await cancelPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/cancel`, V.cookie, 'POST', { reason: 'no longer needed' }), PR(vc.id, rid)))).status === 409);
    const afterAck = await prisma.serviceReferral.findUnique({ where: { id: rid }, select: { documentSha256: true, issuedDocument: true } });
    ok('the issued document did not change when Section C was recorded', afterAck?.documentSha256 === issued?.documentSha256);

    console.log('\nScans of signed copies');
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64')}`;
    const sc = await json(await scanPOST(req(`/api/cases/${vc.id}/service-referrals/${rid}/attachments`, V.cookie, 'POST', { kind: 'ACKNOWLEDGEMENT', dataUrl: png }), PR(vc.id, rid)));
    ok('a scan of the signed acknowledgement is kept with the referral', sc.status === 201 && sc.body.data.referral.attachments.length === 1);
    const aid = sc.body.data.referral.attachments[0].id as string;
    const PA = { params: Promise.resolve({ id: vc.id, rid, aid }) };
    ok('the officer can open it; a blotter officer cannot', (await scanGET(req('/x', V.cookie), PA)).status === 200 && (await scanGET(req('/x', B.cookie), { params: Promise.resolve({ id: vc.id, rid, aid }) })).status === 404);
    ok('it is not reachable as a report photo', (await prisma.caseAttachment.count({ where: { caseId: vc.id } })) === 0);

    console.log('\nSeveral referrals on one case');
    const c2 = await json(await createPOST(req(`/api/cases/${vc.id}/service-referrals`, V.cookie, 'POST', { requestKey: `probe-${process.pid}-bbbb-2` }), P(vc.id)));
    const rid2 = c2.body.data.id as string;
    ok('a second referral gets its own number', c2.status === 201 && c2.body.data.reference === `SR-${vc.caseNumber}-2`);
    await json(await savePUT(req(`/api/cases/${vc.id}/service-referrals/${rid2}`, V.cookie, 'PUT', { expectedVersion: 1, form: { ...form, destination: 'BARANGAY', services: ['BPO'], receivingAgency: 'Office of the Punong Barangay' } }), PR(vc.id, rid2)));
    const list = await json(await listGET(req(`/api/cases/${vc.id}/service-referrals`, V.cookie), P(vc.id)));
    const byId = (id: string) => list.body.data.referrals.find((x: Body) => x.id === id);
    ok('the history lists both, each with its own destination and status', list.body.data.referrals.length === 2 && byId(rid).destination === 'SWDO' && byId(rid).ack.status === 'ACKNOWLEDGED'
      && byId(rid2).destination === 'BARANGAY' && byId(rid2).status === 'DRAFT' && byId(rid2).ack.status === null);
    ok('the first referral was not overwritten', byId(rid).receivingOrganization === 'MSWDO Probe City' && byId(rid).form.services.join() === 'PSYCHOSOCIAL,SHELTER');
    const can = await json(await cancelPOST(req(`/api/cases/${vc.id}/service-referrals/${rid2}/cancel`, V.cookie, 'POST', { reason: 'Client chose not to proceed' }), PR(vc.id, rid2)));
    ok('a draft can be cancelled - kept, not deleted', can.status === 200 && can.body.data.referral.status === 'CANCELLED' && await prisma.serviceReferral.count({ where: { id: rid2 } }) === 1);
    ok('the captain sees the history; a blotter officer does not', (await json(await listGET(req(`/api/cases/${vc.id}/service-referrals`, A.cookie), P(vc.id)))).status === 200
      && (await json(await listGET(req(`/api/cases/${vc.id}/service-referrals`, B.cookie), P(vc.id)))).status === 404);

    console.log('\nThe audit trail, and what residents see');
    const types = (await prisma.serviceReferralEvent.findMany({ where: { referralId: rid }, select: { type: true } })).map(e => e.type);
    ok('created, saved, issued, returned, acknowledged, scan and downloads are all in the referral\'s history',
      ['CREATED', 'SAVED', 'ISSUED', 'RETURNED', 'ACKNOWLEDGED', 'SCAN_ADDED', 'DOCUMENT_GENERATED'].every(t => types.includes(t)), types.join());
    let edited = false;
    try { await prisma.serviceReferralEvent.updateMany({ where: { referralId: rid }, data: { note: 'rewritten' } }); edited = true; } catch { /* append-only */ }
    ok('the history cannot be rewritten', !edited);
    const acts = await prisma.activity.findMany({ where: { caseId: vc.id, type: 'service_referral' }, select: { message: true } });
    ok('the case timeline has the referral steps, with no names of the client or the receiving office', acts.length >= 4
      && acts.every(a => !/Liza|Probeclient|MSWDO Probe City|Pedro Probe|Rosa Probe/.test(a.message)), acts.map(a => a.message).join(' | '));
    const upd = await json(await updatesGET(req('/api/resident/updates', resCookie)));
    ok('the resident\'s updates show none of it', upd.status === 200 && !JSON.stringify(upd.body).includes('Service referral'));
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
    && await prisma.serviceReferral.count({ where: { caseId: { in: caseIds } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.sr.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
