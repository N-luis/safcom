/**
 * KP Forms - saving and loading through the real routes and the real
 * database, in-process. Needs migration 021. Run with:  npm run test:kpforms:api
 * Temporary rows are marked PROBE-KP and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { prefilledIntake, recordData } from '../lib/kpForms/forms';
import { GET as casesGET } from '../app/api/kp-forms/cases/route';
import { GET as listGET, POST as createPOST } from '../app/api/kp-forms/route';
import { GET as oneGET, PUT as onePUT, DELETE as oneDELETE } from '../app/api/kp-forms/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-KP';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Body });
/** JSON with sorted keys: Postgres jsonb keeps its own key order. */
const stable = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const refuse = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

async function main() {
  const pid = process.pid;
  const users: string[] = []; const cases: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.kp.${k}.${pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const C = await mk('captain', 'admin');
    const V = await mk('vawc', 'vawc_officer');
    const SA = await mk('sysadmin', 'system_admin');
    const mkCase = async (n: string, d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${pid}-${n}`, residentName: 'Juana Probe', barangay: 'Probe Street', status: 'Open', ...d } as never });
      cases.push(c.id); return c;
    };
    const KW = await mkCase('W', { caseType: 'Assault', description: '[Walk-in Report 2026-11-17 09:00]\n\nSinaktan ako sa braso ng kapitbahay.' });
    await prisma.caseParty.create({ data: { caseId: KW.id, role: 'REPORTED', fullName: 'Pedro Probe', source: 'official' } });
    const KVW = await mkCase('V', { caseType: 'Domestic Violence', description: '[Walk-in Report 2026-11-17 10:00]\n\nfictional' });
    const KN = await mkCase('N', { caseType: 'Assault', description: 'filed online - fictional' });

    console.log('Walk-in reports and their prefill');
    const list = await json(await casesGET(req(`/api/kp-forms/cases?q=${encodeURIComponent(`${TAG}-${pid}`)}`, B.cookie)));
    const ids = (list.body.data?.rows ?? []).map((r: Body) => r.id);
    ok('the picker lists the walk-in blotter report', list.status === 200 && ids.includes(KW.id), JSON.stringify(list.body).slice(0, 200));
    ok('...not a VAWC walk-in report, not a case filed online', !ids.includes(KVW.id) && !ids.includes(KN.id));
    const det = await json(await listGET(req(`/api/kp-forms?caseId=${KW.id}`, B.cookie)));
    const pf = det.body.data?.prefill;
    ok('prefill: case number, nature, complainant, respondent, narrative (without the system line)', det.status === 200 && pf.caseNumber === KW.caseNumber && pf.caseType === 'Assault'
      && pf.complainant === 'Juana Probe' && pf.respondents.join() === 'Pedro Probe' && pf.narrative === 'Sinaktan ako sa braso ng kapitbahay.', JSON.stringify(pf));
    ok('no form saved yet', det.body.data.records.length === 0);

    console.log('\nSave, reopen, update, delete');
    const s = prefilledIntake(KW.id, pf);
    s.forms.KP7.reliefSought = 'Fictional: humingi ng tawad.';
    const c1 = await json(await createPOST(req('/api/kp-forms', B.cookie, 'POST', { caseId: KW.id, formType: 'KP7', data: recordData('KP7', s) })));
    const rid = c1.body.data?.id as string;
    const row = rid ? await prisma.kpFormRecord.findUnique({ where: { id: rid } }) : null;
    ok('saved, linked to the walk-in report, with who saved it', c1.status === 201 && row?.walkInReportId === KW.id && row.formType === 'KP7' && row.caseNo === KW.caseNumber && row.createdById === B.id,
      `${c1.status} ${c1.body.error ?? ''}`);
    const got = await json(await oneGET(req(`/api/kp-forms/${rid}`, B.cookie), { params: Promise.resolve({ id: rid }) }));
    ok('reopened with every value', got.status === 200 && stable(got.body.data.data) === stable(recordData('KP7', s)));
    s.forms.KP7.reliefSought = 'Fictional: bayaran ang gamot.';
    s.shared.caseNo = 'UB-2026-001';
    const up = await json(await onePUT(req(`/api/kp-forms/${rid}`, C.cookie, 'PUT', { data: recordData('KP7', s) }), { params: Promise.resolve({ id: rid }) }));
    const row2 = await prisma.kpFormRecord.findUnique({ where: { id: rid } });
    ok('updated (by the Punong Barangay), the case number in the list follows', up.status === 200 && row2?.caseNo === 'UB-2026-001' && row2.updatedById === C.id
      && (row2.data as Body).form.reliefSought === 'Fictional: bayaran ang gamot.' && row2.createdById === B.id);
    const det2 = await json(await listGET(req(`/api/kp-forms?caseId=${KW.id}`, B.cookie)));
    ok('the walk-in report lists it', det2.body.data.records.length === 1 && det2.body.data.records[0].formType === 'KP7');
    const c9 = await json(await createPOST(req('/api/kp-forms', B.cookie, 'POST', { caseId: KW.id, formType: 'KP9', data: recordData('KP9', s) })));
    ok('another form on the same report', c9.status === 201);
    ok('an unknown form is refused (route and database)', (await json(await createPOST(req('/api/kp-forms', B.cookie, 'POST', { caseId: KW.id, formType: 'KP99', data: recordData('KP7', s) })))).status === 400
      && await refuse(() => prisma.kpFormRecord.create({ data: { walkInReportId: KW.id, formType: 'KP99', data: {}, createdById: B.id } })));
    ok('a record cannot be moved to another report (database)', await refuse(() => prisma.kpFormRecord.update({ where: { id: rid }, data: { walkInReportId: KN.id } })));

    console.log('\nWho may, and never on a VAWC case');
    ok('a blotter official: the VAWC report does not exist', (await json(await listGET(req(`/api/kp-forms?caseId=${KVW.id}`, B.cookie)))).status === 404
      && (await json(await createPOST(req('/api/kp-forms', B.cookie, 'POST', { caseId: KVW.id, formType: 'KP7', data: recordData('KP7', s) })))).status === 404);
    const cv = await json(await createPOST(req('/api/kp-forms', C.cookie, 'POST', { caseId: KVW.id, formType: 'KP7', data: recordData('KP7', s) })));
    ok('the Punong Barangay is told why (RA 9262)', cv.status === 422 && /RA 9262/.test(cv.body.error ?? ''));
    ok('the database refuses a KP form on a VAWC case too', await refuse(() => prisma.kpFormRecord.create({ data: { walkInReportId: KVW.id, formType: 'KP7', data: {}, createdById: C.id } })));
    ok('the VAWC desk and the system administrator are refused', (await json(await casesGET(req('/api/kp-forms/cases', V.cookie)))).status === 403
      && (await json(await oneGET(req(`/api/kp-forms/${rid}`, SA.cookie), { params: Promise.resolve({ id: rid }) }))).status === 403);
    const resCookie = `resident_token=${signResidentToken({ residentId: 'x', email: 'x', name: 'x', role: 'resident' })}`;
    ok('residents and anyone signed out are refused', (await json(await listGET(req(`/api/kp-forms?caseId=${KW.id}`, resCookie)))).status === 401
      && (await json(await createPOST(req('/api/kp-forms', '', 'POST', { caseId: KW.id, formType: 'KP7', data: recordData('KP7', s) })))).status === 401);
    ok('the public API roles cannot read the table (RLS on, nothing granted)',
      (await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM information_schema.role_table_grants WHERE table_name = 'kp_form_records' AND grantee IN ('anon','authenticated')`)[0].n === BigInt(0)
      && (await prisma.$queryRaw<{ r: boolean }[]>`SELECT relrowsecurity AS r FROM pg_class WHERE relname = 'kp_form_records'`)[0].r === true);

    const del = await json(await oneDELETE(req(`/api/kp-forms/${rid}`, B.cookie, 'DELETE'), { params: Promise.resolve({ id: rid }) }));
    ok('deleted', del.status === 200 && !(await prisma.kpFormRecord.findUnique({ where: { id: rid } })) && (await json(await oneGET(req(`/api/kp-forms/${rid}`, B.cookie), { params: Promise.resolve({ id: rid }) }))).status === 404);
  } finally {
    await prisma.case.deleteMany({ where: { id: { in: cases } } });   // its KP forms go with it
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.kpFormRecord.count({ where: { walkInReportId: { in: cases } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.kp.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
