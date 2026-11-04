/**
 * The two-panel VAWC intake, part 2: draft autosave, the audit trail,
 * access and the PDF - through the real routes and the real database
 * (in-process; no dev server needed). Part 1 is intakePreviewRender.test.tsx.
 * Run with:  npm run test:intakepreview
 *
 * All data is fictional. Temporary rows are marked PROBE-IP and removed at
 * the end, with their audit rows.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { ALL_ITEMS, appliesTo, type Responses } from '../lib/officialIntakeForm';
import { fictional, narrative, NARRATIVE_END } from './intakeFixtures';
import { GET as intakeGET, POST as intakePOST, PUT as intakePUT } from '../app/api/cases/[id]/official-intake/route';
import { GET as pdfGET } from '../app/api/cases/[id]/official-intake/pdf/route';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-IP';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' '));
  return out;
}
const squash = (s: string) => s.replace(/\s+/g, '');

async function main() {
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  try {
    // ── People and cases ──
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.ip.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const V = await mkUser('vawc', 'vawc_officer');
    const V2 = await mkUser('vawc2', 'vawc_officer');
    const B = await mkUser('blotter', 'officer');
    const C = await mkUser('captain', 'admin');
    const S = await mkUser('sysadmin', 'system_admin');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Preview', age: 31, gender: 'Female', barangay: 'Ayukit', address: 'temporary', emailVerified: true } });
    residents.push(R.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    const K = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}`, residentName: 'Probe Preview', caseType: 'Domestic Violence', barangay: 'Test',
      description: 'temporary fictional case', status: 'Open', residentId: R.id, assignedToId: V.id, reportingRelationship: 'SELF', municipality: 'Bocaue', province: 'Bulacan' } });
    caseIds.push(K.id);
    const get = (cookie: string) => intakeGET(req(`/api/cases/${K.id}/official-intake`, cookie), params(K.id)).then(json);
    const put = (cookie: string, body: Body) => intakePUT(req(`/api/cases/${K.id}/official-intake`, cookie, 'PUT', body), params(K.id)).then(json);
    const revisions = () => prisma.officialIntakeRevision.count({ where: { intake: { caseId: K.id } } });

    // ── 3. Drafts that save themselves ──
    console.log('\nDraft autosave');
    const st = await json(await intakePOST(req(`/api/cases/${K.id}/official-intake`, V.cookie, 'POST'), params(K.id)));
    ok('the intake is started on the existing case, by its id', st.status === 201 && (await prisma.officialIntake.findUnique({ where: { caseId: K.id } }))?.caseId === K.id);
    const v1 = st.body.data.intake.version as number;
    const base = st.body.data.intake.responses as Responses;
    const a1 = await put(V.cookie, { expectedVersion: v1, status: 'DRAFT', autosave: true, responses: { ...base, positionTitle: { value: 'VAWC Desk Officer' } } });
    ok('an autosave keeps the draft current', a1.status === 200 && a1.body.data.intake.version === v1 + 1 && a1.body.data.intake.responses.positionTitle?.value === 'VAWC Desk Officer');
    const a2 = await put(V.cookie, { expectedVersion: v1 + 1, status: 'DRAFT', autosave: true, responses: { ...a1.body.data.intake.responses, clientCode: { value: 'CC-PROBE-0042' } } });
    ok('pauses in typing do not each add a revision', a2.status === 200 && a1.body.data.revisionKept === false && a2.body.data.revisionKept === false && await revisions() === 1);
    ok('no new case is created by saving', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 1);
    const m1 = await put(V.cookie, { expectedVersion: v1 + 2, status: 'DRAFT', responses: { ...fictional() } });
    const lastRev = await prisma.officialIntakeRevision.findFirst({ where: { intake: { caseId: K.id } }, orderBy: { version: 'desc' } });
    ok('a deliberate save keeps a revision listing everything changed since the last one kept', m1.status === 200 && m1.body.data.revisionKept === true && await revisions() === 2
      && ['positionTitle', 'clientCode', 'description'].every(k => lastRev!.changedKeys.includes(k)));
    const reopened = await get(V.cookie);
    ok('reopening the draft brings back every answer', reopened.status === 200 && reopened.body.data.intake.status === 'DRAFT'
      && reopened.body.data.intake.responses.description?.value === narrative(2) && reopened.body.data.intake.responses.typeOfViolence?.value.length === 3);
    const stale = await put(V.cookie, { expectedVersion: v1, status: 'DRAFT', autosave: true, responses: { ...fictional(), occupation: { value: 'stale' } } });
    ok('an autosave from an out-of-date tab is refused, not merged', stale.status === 409 && (await get(V.cookie)).body.data.intake.responses.occupation === undefined);
    ok('an autosave cannot complete the intake', (await put(V.cookie, { expectedVersion: v1 + 3, status: 'COMPLETED', autosave: true, responses: fictional() })).status === 422);
    ok('the original report is untouched', (await prisma.case.findUnique({ where: { id: K.id } }))?.description === 'temporary fictional case');

    // ── 4. Audit ──
    console.log('\nAudit');
    const log = await prisma.reporterAccessLog.findMany({ where: { caseId: K.id, actorId: V.id }, select: { code: true, outcome: true, fields: true } });
    const codes = log.map(l => l.code);
    ok('views, autosaves and saves are each recorded', codes.filter(c => c === 'save:autosave').length === 2 && codes.includes('save:draft') && codes.some(c => c === 'assigned'));
    ok('the audit rows hold no answers', !JSON.stringify(log).includes('Dela Prueba') && !JSON.stringify(log).includes('Paragraph'));

    // ── 5. Who may open it ──
    console.log('\nAccess');
    ok('a blotter officer is told the case does not exist', (await get(B.cookie)).status === 404);
    ok('so is the system administrator', (await get(S.cookie)).status === 404);
    ok('a resident session is not an official', (await get(resCookie)).status === 401);
    ok('another VAWC officer, not assigned, may not open it', (await get(V2.cookie)).status === 403);
    const cap = await get(C.cookie);
    ok('the captain may view it but not edit it', cap.status === 200 && cap.body.data.access.edit === false
      && (await put(C.cookie, { expectedVersion: v1 + 3, status: 'DRAFT', autosave: true, responses: fictional() })).status === 403);
    ok('the PDF is refused to the blotter officer', (await pdfGET(req(`/api/cases/${K.id}/official-intake/pdf`, B.cookie), params(K.id)))!.status === 404);
    ok('refusals are recorded too', await prisma.reporterAccessLog.count({ where: { caseId: K.id, outcome: 'denied' } }) >= 5);

    // ── 6. The PDF follows the same five pages ──
    console.log('\nPDF');
    const pdf = await pdfPages(new Uint8Array(await (await pdfGET(req(`/api/cases/${K.id}/official-intake/pdf`, V.cookie), params(K.id)))!.arrayBuffer()));
    const pageOf = (t: string) => pdf.findIndex(p => squash(p).includes(squash(t))) + 1;
    ok('five pages for a normal account', pdf.length === 5, String(pdf.length));
    ok('each page starts where the form\'s does', pageOf('18. Current Civil Status') === 2 && pageOf('31. Type of Violence') === 3 && pageOf('32. Description of the Incident') === 4 && pageOf('41. Name') === 5,
      [pageOf('18. Current Civil Status'), pageOf('31. Type of Violence'), pageOf('32. Description of the Incident'), pageOf('41. Name')].join());
    ok('CONFIDENTIAL and "Page n of 5" on every page', pdf.every((p, i) => p.includes('CONFIDENTIAL') && p.includes(`Page ${i + 1} of 5`)));
    ok('the Client Code and Incident No. on pages 2 to 5', pdf.slice(1).every(p => p.includes('CC-PROBE-0042') && p.includes('INC-PROBE-0099')));
    ok('every page says it is a SafeComm digital copy, not an official form', pdf.every(p => squash(p).includes(squash('not an official government-issued form'))));
    const longSave = await put(V.cookie, { expectedVersion: (await get(V.cookie)).body.data.intake.version, status: 'DRAFT', responses: { ...fictional(), description: { value: narrative(40) } } });
    const pdfLong = await pdfPages(new Uint8Array(await (await pdfGET(req(`/api/cases/${K.id}/official-intake/pdf`, V.cookie), params(K.id)))!.arrayBuffer()));
    const all = squash(pdfLong.join(' '));
    ok('a long narrative continues onto the next page, whole', longSave.status === 200 && pdfLong.length > 5 && all.includes(squash(NARRATIVE_END)) && all.includes(squash('Paragraph 40:'))
      && pdfLong.some(p => p.includes('(continued)')), String(pdfLong.length));
    ok('...and section D still starts on its own page after it', pdfLong.findIndex(p => squash(p).includes(squash('41. Name'))) > pdfLong.findIndex(p => squash(p).includes(squash('32. Description of the Incident'))));
    const filled = ALL_ITEMS.filter(i => appliesTo(i, fictional()) === 'hidden').map(i => i.no).filter(Boolean);
    ok('items that do not apply and are empty are left out, not drawn as empty boxes', filled.includes('8') && !squash(pdf.join(' ')).includes(squash('8. Name of Informant')));
  } finally {
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
    && await prisma.officialIntake.count({ where: { caseId: { in: caseIds } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.ip.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
