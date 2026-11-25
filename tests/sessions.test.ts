/**
 * Sessions that can be ended, shared rate limits, and who manages staff
 * accounts (029). Through the real routes and the real database, in-process.
 * Run with:  npm run test:sessions
 *
 * Temporary rows are marked PROBE-SS and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { signToken, issueStaffSession } from '../lib/auth';
import { issueResidentSession, signResidentToken } from '../lib/residentAuth';
import { rateLimit, failuresExceeded, recordFailure, clearFailures } from '../lib/rateLimit';
import { POST as loginPOST } from '../app/api/auth/login/route';
import { POST as logoutPOST } from '../app/api/auth/logout/route';
import { POST as residentLogoutPOST } from '../app/api/auth/resident-logout/route';
import { GET as meGET } from '../app/api/auth/me/route';
import { GET as residentMeGET } from '../app/api/auth/resident-me/route';
import { POST as usersPOST } from '../app/api/users/route';
import { PUT as userPUT, DELETE as userDELETE } from '../app/api/users/[id]/route';
import { PUT as residentAdminPUT } from '../app/api/residents/[id]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-SS';
const req = (path: string, cookie = '', method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'user-agent': 'PROBE-SS test' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const P = (id: string) => ({ params: Promise.resolve({ id }) });
const staff = (t: string) => `safcom_token=${t}`;
const res = (t: string) => `resident_token=${t}`;
const me = async (t: string) => (await meGET(req('/api/auth/me', staff(t)))).status;
const resMe = async (t: string) => (await residentMeGET(req('/api/auth/resident-me', res(t)))).status;
const hashKey = (k: string) => createHash('sha256').update(`safecomm-rate-limit:${k}`).digest('hex');

async function main() {
  const users: string[] = []; const residents: string[] = []; const rlKeys: string[] = [];
  const PW = 'Fictional-Pass-123';
  try {
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.ss.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: await bcrypt.hash(PW, 4), role } });
      users.push(u.id); return u;
    };
    const CAP = await mk('captain', 'admin');
    const OFF = await mk('officer', 'officer');
    const SYS = await mk('sysadmin', 'system_admin');

    // ── Staff sessions ──
    console.log('\nOfficials\' sessions');
    const login = await loginPOST(req('/api/auth/login', '', 'POST', { email: OFF.email, password: PW }));
    const cookie = login.headers.get('set-cookie') ?? '';
    const t1 = /safcom_token=([^;]+)/.exec(cookie)?.[1] ?? '';
    const payload = JSON.parse(Buffer.from(t1.split('.')[1] ?? '', 'base64url').toString() || '{}');
    const row = payload.sid ? await prisma.authSession.findUnique({ where: { id: payload.sid } }) : null;
    ok('signing in makes a session, and the token carries its id', login.status === 200 && Boolean(row) && row?.kind === 'staff' && row?.subjectId === OFF.id && row?.userAgent === 'PROBE-SS test');
    ok('an official\'s session lasts 12 hours (cookie and token)', /Max-Age=43200/.test(cookie) && payload.exp - payload.iat === 43200);
    ok('the session works', await me(t1) === 200);
    const out = await logoutPOST(req('/api/auth/logout', staff(t1), 'POST'));
    ok('signing out ends the session itself - the same token no longer works', out.status === 200 && await me(t1) === 401
      && Boolean((await prisma.authSession.findUnique({ where: { id: payload.sid } }))?.revokedAt));
    const a = await issueStaffSession(OFF); const b = await issueStaffSession(OFF);
    ok('two devices, two sessions', await me(a.token) === 200 && await me(b.token) === 200);
    await logoutPOST(req('/api/auth/logout', staff(a.token), 'POST', { everywhere: true }));
    ok('"sign out everywhere" ends every session of that official', await me(a.token) === 401 && await me(b.token) === 401);

    // ── Staff management: only the captain and the system administrator ──
    console.log('\nManaging staff accounts');
    const capT = (await issueStaffSession(CAP)).token;
    const offT = (await issueStaffSession(OFF)).token;
    const sysT = (await issueStaffSession(SYS)).token;
    const offCreates = await usersPOST(req('/api/users', staff(offT), 'POST', { name: 'Fictional Intruder', email: `probe.ss.x.${process.pid}@safcom.local`, password: 'Fictional-Pass-1', role: 'admin' }));
    ok('a blotter officer cannot create an account (403) - not even a captain\'s', offCreates.status === 403
      && await prisma.user.count({ where: { email: `probe.ss.x.${process.pid}@safcom.local` } }) === 0);
    ok('a blotter officer cannot change another official\'s password or role (403)',
      (await userPUT(req(`/api/users/${CAP.id}`, staff(offT), 'PUT', { password: 'Taken-over-123' }), P(CAP.id))).status === 403
      && (await userPUT(req(`/api/users/${OFF.id}`, staff(offT), 'PUT', { role: 'admin' }), P(OFF.id))).status === 403
      && await bcrypt.compare(PW, (await prisma.user.findUnique({ where: { id: CAP.id } }))!.password));
    ok('a blotter officer cannot deactivate anyone (403)', (await userDELETE(req(`/api/users/${CAP.id}`, staff(offT), 'DELETE'), P(CAP.id))).status === 403);
    const newUser = await usersPOST(req('/api/users', staff(sysT), 'POST', { name: 'Fictional New Officer', email: `probe.ss.new.${process.pid}@safcom.local`, password: 'Fictional-Pass-1', role: 'officer' }));
    const newId = (await newUser.json()).data?.id; if (newId) users.push(newId);
    ok('the system administrator can create one', newUser.status === 201 || newUser.status === 200, String(newUser.status));
    const offT2 = (await issueStaffSession(OFF)).token;
    ok('the captain changes an official\'s password: every session of theirs ends', (await userPUT(req(`/api/users/${OFF.id}`, staff(capT), 'PUT', { password: 'Fictional-New-456' }), P(OFF.id))).status === 200
      && await me(offT) === 401 && await me(offT2) === 401 && await me(capT) === 200);
    const offT3 = (await issueStaffSession(OFF)).token;
    ok('deactivating an official ends their sessions at once', (await userDELETE(req(`/api/users/${OFF.id}`, staff(capT), 'DELETE'), P(OFF.id))).status === 200 && await me(offT3) === 401);

    // ── Tokens that are not what they claim ──
    console.log('\nTokens');
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Fictional', lastName: 'Resident', age: 30, gender: 'Female',
      barangay: 'Biñang 2nd', address: 'Fictional', contactNumber: '09170000000', emailVerified: true } as never });
    residents.push(R.id);
    const rT = await issueResidentSession({ residentId: R.id, email: 'x', name: 'Fictional' });
    ok('a resident\'s token is never accepted as an official\'s', await me(rT) === 401);
    ok('an official\'s token is never accepted as a resident\'s', await resMe(capT) === 401);
    const env = process.env as Record<string, string | undefined>;
    const prevEnv = env.NODE_ENV;
    const bare = signToken({ userId: CAP.id, email: CAP.email, role: 'admin' });
    const bareR = signResidentToken({ residentId: R.id, email: 'x', name: 'Fictional', role: 'resident' });
    env.NODE_ENV = 'production';
    const bareLive = [await me(bare), await resMe(bareR)];
    env.NODE_ENV = prevEnv;
    ok('on the live site a token without a session (any token made before 029) is refused', bareLive.every(s => s === 401), bareLive.join(','));

    // ── Resident sessions ──
    console.log('\nResidents\' sessions');
    ok('a resident session works', await resMe(rT) === 200);
    const rOut = await residentLogoutPOST(req('/api/auth/resident-logout', res(rT), 'POST'));
    ok('a resident signing out ends the session', rOut.status === 200 && await resMe(rT) === 401);
    const rT2 = await issueResidentSession({ residentId: R.id, email: 'x', name: 'Fictional' });
    ok('a resident account suspended by the captain is signed out everywhere', (await residentAdminPUT(req(`/api/residents/${R.id}`, staff(capT), 'PUT', { status: 'Suspended' }), P(R.id))).status === 200
      && await resMe(rT2) === 401);

    // ── Shared rate limits ──
    console.log('\nRate limits shared by every server instance');
    const prevStore = env.RATE_LIMIT_STORE;
    env.RATE_LIMIT_STORE = 'db';
    try {
      const key = `probe-ss:${process.pid}:${Date.now()}`; rlKeys.push(key);
      const r = [];
      for (let i = 0; i < 4; i++) r.push((await rateLimit(key, { max: 3, windowMs: 60_000 })).allowed);
      const stored = await prisma.rateLimitCounter.findUnique({ where: { key: hashKey(key) } });
      ok('counted in the database: 3 allowed, the 4th refused', r.join(',') === 'true,true,true,false' && stored?.count === 4, r.join(','));
      ok('the stored key is a hash - not the email, IP or id it was made from', /^[0-9a-f]{64}$/.test(stored?.key ?? '') && !(stored?.key ?? '').includes('probe'));
      // Another instance has its own memory but the same database: what it sees is the database's count.
      await prisma.rateLimitCounter.update({ where: { key: hashKey(key) }, data: { count: 0 } });
      ok('the count lives in the database, not in this instance\'s memory', (await rateLimit(key, { max: 3, windowMs: 60_000 })).allowed);
      const fk = `probe-ss-fail:${process.pid}:${Date.now()}`; rlKeys.push(fk);
      for (let i = 0; i < 5; i++) await recordFailure(fk, { windowMs: 60_000 });
      const lim = await failuresExceeded(fk, { max: 5, windowMs: 60_000 });
      await clearFailures(fk);
      ok('failed sign-ins are counted there too, and cleared on success', lim.limited && lim.retryAfterSeconds > 0 && !(await failuresExceeded(fk, { max: 5, windowMs: 60_000 })).limited);
      const lk = `probe.ss.lock.${process.pid}@safcom.local`; rlKeys.push(`staff-login-fail:acct:${lk}`, 'staff-login-fail:ip:10.77.0.1');
      const st = [];
      for (let i = 0; i < 6; i++) st.push((await loginPOST(new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.0.1' }, body: JSON.stringify({ email: lk, password: 'x' }) }))).status);
      ok('the staff sign-in lockout uses the shared store', st.slice(0, 5).every(s => s === 401) && st[5] === 429
        && Boolean(await prisma.rateLimitCounter.findUnique({ where: { key: hashKey(`staff-login-fail:acct:${lk}`) } })), st.join(','));
    } finally {
      if (prevStore === undefined) delete env.RATE_LIMIT_STORE; else env.RATE_LIMIT_STORE = prevStore;
    }
  } finally {
    await prisma.rateLimitCounter.deleteMany({ where: { key: { in: rlKeys.map(hashKey) } } });
    await prisma.authSession.deleteMany({ where: { subjectId: { in: [...users, ...residents] } } });
    await prisma.activity.deleteMany({ where: { userId: { in: users } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.user.count({ where: { email: { startsWith: 'probe.ss.' } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.authSession.count({ where: { userAgent: 'PROBE-SS test' } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
