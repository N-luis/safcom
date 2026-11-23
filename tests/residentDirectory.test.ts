/**
 * Resident Directory (Blotter and VAWC dashboards) - through the real routes
 * and the real database, in-process. Run with:  npm run test:residentdirectory
 * Temporary rows are marked PROBE-RD and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { strictestPreference, contactAdvice, nameWhere, DIRECTORY_PAGE_SIZE } from '../lib/residentDirectory';
import { GET as listGET } from '../app/api/officials/residents/route';
import { POST as profilePOST } from '../app/api/officials/residents/[rid]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RD';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const req = (path: string, cookie: string, method = 'GET') => new NextRequest(`http://localhost${path}`, { method, headers: { Cookie: cookie } });
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Body });

async function main() {
  console.log('Rules');
  ok('the strictest safe-contact wish wins', strictestPreference(['call_ok', 'no_phone', 'text_first']) === 'no_phone'
    && strictestPreference(['call_ok', 'text_first']) === 'text_first' && strictestPreference([null, 'bogus']) === null);
  ok('"do not call" blocks the call, and does not say which report or what kind',
    !contactAdvice('no_phone', true).callAllowed && !/vawc|case|report|abuse|violence/i.test(contactAdvice('no_phone', true).guidance));
  ok('no number, no call', !contactAdvice('call_ok', false).callAllowed);
  ok('a search of two words needs both', nameWhere('ana probe').length === 2 && nameWhere('   ').length === 0);

  const pid = process.pid;
  const last = `Probevh${pid}`;
  const users: string[] = []; const residents: string[] = []; const cases: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const mk = async (k: string, role: string, active = true) => {
      const u = await prisma.user.create({ data: { email: `probe.rd.${k}.${pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role, active } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const V = await mk('vawc', 'vawc_officer');
    const C = await mk('captain', 'admin');
    const SA = await mk('sysadmin', 'system_admin');
    const OFF = await mk('inactive', 'officer', false);
    let n = 0;
    const mkRes = async (first: string, d: Record<string, unknown> = {}) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${pid}-${++n}`, firstName: first, lastName: last, age: 30, gender: 'Female',
        barangay: 'Ayukit', address: `${first} fictional address`, contactNumber: '+639170000001', email: `${first.toLowerCase()}.${pid}@example.invalid`,
        status: 'Active', emailVerified: true, password: 'PROBE-HASH-MUST-NOT-LEAK', username: `probe_rd_${pid}_${n}`, notes: 'PROBE-INTERNAL-NOTE',
        clerkId: `probe_clerk_${pid}_${n}`, ...d } });
      residents.push(r.id); return r;
    };
    const R1 = await mkRes('Alma');                                               // has a VAWC report: "do not call"
    const R2 = await mkRes('Bea');                                                // never reported
    const R3 = await mkRes('Cora', { status: 'Rejected' });                        // rejected registration
    const R4 = await mkRes('Dina', { status: 'Pending' });                        // a blotter report: "text first"
    const R5 = await mkRes('Ella', { contactNumber: null });                      // no number
    for (const f of ['Faye', 'Gina', 'Hana', 'Ivy', 'Joy', 'Kim']) await mkRes(f);  // enough for two pages
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-CASE-${pid}-${cases.length + 1}`, residentName: 'Fictional', barangay: 'Probe Street',
        description: 'fictional', status: 'Open', ...d } as never });
      cases.push(c.id); return c;
    };
    const KV = await mkCase({ caseType: 'Domestic Violence', residentId: R1.id, assignedToId: V.id, contactPreference: 'no_phone', riskLevel: 'High' });
    await mkCase({ caseType: 'Noise Complaint', residentId: R1.id, assignedToId: B.id, contactPreference: 'call_ok' });
    await mkCase({ caseType: 'Noise Complaint', residentId: R4.id, assignedToId: B.id, contactPreference: 'text_first' });

    const list = (cookie: string, q = '', page = 1) => listGET(req(`/api/officials/residents?q=${encodeURIComponent(q)}&page=${page}`, cookie)).then(json);
    const view = (cookie: string, id: string) => profilePOST(req(`/api/officials/residents/${id}`, cookie, 'POST'), { params: Promise.resolve({ rid: id }) }).then(json);

    console.log('\n1-3, 7-8  The list');
    const lb = await list(B.cookie, last);
    const lv = await list(V.cookie, last);
    ok('Blotter and VAWC officials both get the directory', lb.status === 200 && lv.status === 200, `${lb.status} ${lv.status}`);
    ok('names only: each row has an id and a name, nothing else', (lb.body.data.rows as Body[]).every(r => Object.keys(r).sort().join() === 'id,name'));
    ok('no contact detail anywhere in the list', !/\+63917|example\.invalid|fictional address/.test(JSON.stringify(lb.body)));
    ok('a resident who never reported is listed', JSON.stringify(lb.body).includes(R2.id));
    ok('a rejected registration is not', !JSON.stringify(lb.body).includes(R3.id) && lb.body.data.total === 10, String(lb.body.data.total));
    ok('pages run on the database: two pages, no overlap, nothing missing', await (async () => {
      const p1 = (lb.body.data.rows as Body[]).map(r => r.id); const p2 = ((await list(B.cookie, last, 2)).body.data.rows as Body[]).map(r => r.id);
      return lb.body.data.pages === 2 && p1.length === DIRECTORY_PAGE_SIZE && p2.length === 10 - DIRECTORY_PAGE_SIZE && !p1.some(id => p2.includes(id));
    })());
    ok('search is by name, any case, every word', ((await list(B.cookie, `alma ${last.toUpperCase()}`)).body.data.rows as Body[]).map(r => r.id).join() === R1.id);
    ok('a search with no match is empty, not an error', (await list(B.cookie, `${last} nobody`)).body.data.total === 0);

    console.log('\n4-6  View Full Details');
    const p1 = await view(B.cookie, R2.id);
    const res = p1.body.data?.resident;
    ok('opens the right resident, by id', p1.status === 200 && res?.id === R2.id && res.fullName === `Bea ${last}`);
    ok('the full profile: address, number, e-mail, registration date', res?.address === 'Bea fictional address' && res.phone === '+639170000001'
      && res.email === `bea.${pid}@example.invalid` && Boolean(res.registeredAt) && res.accountStatus === 'Active');
    ok('never a password, sign-in id, username, internal note or risk flag', !/PROBE-HASH|probe_clerk|probe_rd_|PROBE-INTERNAL/.test(JSON.stringify(p1.body))
      && !['password', 'clerkId', 'supabaseUserId', 'username', 'notes', 'riskLevel'].some(k => k in (res ?? {})));
    ok('no resident ID and no verification state (ID verification was removed)', !['residentNumber', 'emailVerified'].some(k => k in (res ?? {}))
      && !JSON.stringify(p1.body).includes(`${TAG}-${pid}-`) && !/verified/i.test(JSON.stringify(p1.body)));
    ok('no preference given: no contact note at all', p1.body.data.contact === null);
    ok('no call link is sent: the number is there to copy', !('telHref' in p1.body.data) && !JSON.stringify(p1.body).includes('tel:') && res?.phone === '+639170000001');
    ok('a name is not an id: looking up by name finds nothing', (await view(B.cookie, `Bea ${last}`)).status === 404);
    const p4 = await view(B.cookie, R4.id);
    ok('"text first" on one of their reports: that advice is shown', p4.body.data.contact.callAllowed && /Text first/.test(p4.body.data.contact.label));
    ok('no number: nothing to copy', (await view(B.cookie, R5.id)).body.data.resident.phone === null);

    console.log('\n9-10  Who may see it, and what stays confidential');
    const pb1 = await view(B.cookie, R1.id);
    ok('"do not call" on any report wins over "calls are fine" on another', !pb1.body.data.contact.callAllowed && /Do not call/.test(pb1.body.data.contact.label));
    ok('...and the Blotter official is not told it comes from a VAWC report', !/vawc|domestic|violence|abuse|PROBE-RD-\d+-\d/i.test(JSON.stringify(pb1.body.data.contact))
      && !JSON.stringify(pb1.body).includes(KV.caseNumber) && !/Domestic Violence|caseType|cases/.test(JSON.stringify(pb1.body)));
    ok('the VAWC official gets the same profile - no case in it either', JSON.stringify((await view(V.cookie, R1.id)).body.data.resident) === JSON.stringify(pb1.body.data.resident));
    ok('the Punong Barangay may use it', (await list(C.cookie, last)).status === 200);
    ok('the system administrator may not', (await list(SA.cookie, last)).status === 403 && (await view(SA.cookie, R2.id)).status === 403);
    ok('an inactive official may not', (await list(OFF.cookie, last)).status === 401 && (await view(OFF.cookie, R2.id)).status === 401);
    ok('no sign-in: refused', (await list('', last)).status === 401 && (await view('', R2.id)).status === 401);
    const resCookie = `resident_token=${signResidentToken({ residentId: R2.id, email: 'x', name: 'Bea', role: 'resident' })}`;
    ok('a resident session: refused', (await list(resCookie, last)).status === 401 && (await view(resCookie, R1.id)).status === 401);
    ok('a rejected registration cannot be opened', (await view(B.cookie, R3.id)).status === 404);
    const logs = await prisma.reporterAccessLog.findMany({ where: { residentId: R2.id, code: 'directory_view' } });
    ok('each view is in the access log: who, role, resident, what was shown', logs.length === 1 && logs[0].actorId === B.id && logs[0].actorRole === 'officer'
      && logs[0].caseId === '(resident-directory)' && ['email', 'phone', 'profile'].every(f => logs[0].fields.includes(f)));
    ok('refusals are logged too', (await prisma.reporterAccessLog.count({ where: { actorId: SA.id, outcome: 'denied' } })) >= 1);
  } finally {
    await prisma.case.deleteMany({ where: { id: { in: cases } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { residentId: { in: residents } }, { caseId: { in: cases } }] } });
    });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.activity.deleteMany({ where: { userId: { in: users } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.rd.' } } }) === 0 && await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
