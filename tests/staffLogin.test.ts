/**
 * Staff sign-in security: failed attempts are limited, a correct sign-in is
 * never slowed down, and the session is only in the httpOnly cookie.
 * Run with:  npm run test:stafflogin
 * Uses one temporary official (PROBE-SL), removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { POST as loginPOST } from '../app/api/auth/login/route';
import { POST as logoutPOST } from '../app/api/auth/logout/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const login = (email: string, password: string, ip: string) => loginPOST(new NextRequest('http://localhost/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }),
}));

async function main() {
  const email = `probe.sl.${process.pid}@safcom.local`;
  const other = `probe.sl.other.${process.pid}@safcom.local`;
  const PW = 'Fictional-Pass-123';
  const ids: string[] = [];
  try {
    for (const e of [email, other]) {
      ids.push((await prisma.user.create({ data: { email: e, name: 'PROBE-SL official', password: await bcrypt.hash(PW, 4), role: 'officer' } })).id);
    }
    const ip = `10.9.${process.pid % 250}.1`;

    const good = await login(email, PW, ip);
    const goodBody = await good.json();
    const cookie = good.headers.get('set-cookie') ?? '';
    ok('a correct sign-in works', good.status === 200 && goodBody.data?.user?.email === email);
    ok('the session is not in the response body (cookie only)', !('token' in (goodBody.data ?? {})) && !JSON.stringify(goodBody).includes('eyJ'));
    ok('the session cookie is httpOnly and SameSite=Lax', /safcom_token=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=lax/i.test(cookie));
    ok('the cookie is Secure on the live site (production)', /secure: process\.env\.NODE_ENV === 'production'/.test(await import('node:fs').then(f => f.readFileSync('app/api/auth/login/route.ts', 'utf8'))));

    const wrong = [];
    for (let i = 0; i < 5; i++) wrong.push((await login(email, 'wrong-password-1', ip)).status);
    ok('five wrong passwords: refused each time (401)', wrong.every(s => s === 401), wrong.join(','));
    const locked = await login(email, PW, ip);
    const lockedBody = await locked.json();
    ok('the sixth attempt is refused even with the right password (429), with when to try again', locked.status === 429 && lockedBody.code === 'TOO_MANY_ATTEMPTS'
      && Number(locked.headers.get('retry-after')) > 0 && /Wait \d+ minute/.test(lockedBody.error ?? ''));
    ok('...from another connection too: the limit is on the account', (await login(email, PW, '10.250.0.9')).status === 429);
    ok('another official is not affected', (await login(other, PW, ip)).status === 200);
    ok('an unknown account is limited the same way (no hint which accounts exist)', await (async () => {
      const s = [];
      for (let i = 0; i < 6; i++) s.push((await login(`nobody.${process.pid}@safcom.local`, 'x', '10.251.0.1')).status);
      return s.slice(0, 5).every(x => x === 401) && s[5] === 429;
    })());

    const ip2 = '10.252.0.7';
    for (let i = 0; i < 4; i++) await login(other, 'wrong-password-2', ip2);
    ok('a correct sign-in before the limit clears the count', (await login(other, PW, ip2)).status === 200
      && (await login(other, 'wrong-password-3', ip2)).status === 401 && (await login(other, PW, ip2)).status === 200);

    const out = await logoutPOST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }));
    ok('signing out clears the cookie with the same protections', /safcom_token=;/.test(out.headers.get('set-cookie') ?? '') && /HttpOnly/i.test(out.headers.get('set-cookie') ?? ''));
  } finally {
    await prisma.authSession.deleteMany({ where: { kind: 'staff', subjectId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  ok('every test row removed', await prisma.user.count({ where: { email: { startsWith: 'probe.sl.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
