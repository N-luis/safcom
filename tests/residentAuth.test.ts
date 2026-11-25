/**
 * Resident authentication (Supabase Auth), registration in one step, the
 * jurisdiction, and the official's verification - the specification's
 * scenarios, through the real routes, the real database and the real
 * Supabase Auth project, in-process.  Run with:  npm run test:residentauth
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY in .env (the suite says so and stops if one is
 * missing). No email leaves the machine: the mailer hands every message to
 * the test (setMailSinkForTests), which opens the links itself. The AI is off
 * for the run. Every resident, official, case and Supabase user made here is
 * fictional (PROBE-RA, @example.com) and removed at the end; the jurisdiction
 * configuration is put back as it was.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { setMailSinkForTests } from '../lib/email';
import { supabaseAuthMissing, findUserByEmail, deleteAuthUser } from '../lib/supabaseAuth';
import { forgetJurisdiction } from '../lib/jurisdictionServer';
import { DEFAULT_JURISDICTION } from '../lib/jurisdiction';
import { POST as registerPOST } from '../app/api/residents/register/route';
import { POST as loginPOST } from '../app/api/auth/resident-login/route';
import { POST as logoutPOST } from '../app/api/auth/resident-logout/route';
import { POST as verifyPOST } from '../app/api/auth/verify-email/route';
import { POST as resendPOST } from '../app/api/auth/resend-verification/route';
import { POST as pwAskPOST, PUT as pwSetPUT } from '../app/api/auth/resident-password/route';
import { GET as residencyGET, PUT as residencyPUT } from '../app/api/resident/residency/route';
import { PATCH as mePATCH } from '../app/api/auth/resident-me/route';
import { POST as decidePOST } from '../app/api/residency/applications/[id]/route';
import { GET as appsGET } from '../app/api/residency/applications/route';
import { POST as filePOST, GET as myCasesGET } from '../app/api/resident/cases/route';
import { POST as referralPOST } from '../app/api/resident/referrals/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { POST as eligibilityPOST } from '../app/api/resident/eligibility/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RA';
const ORIGIN = 'http://localhost';
const req = (path: string, cookie = '', method = 'GET', body?: unknown, ip = '10.9.8.7') => new NextRequest(`${ORIGIN}${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body, cookie: res.headers.get('set-cookie') ?? '' } : { status: 0, body: {} as Body, cookie: '' };
const cookieOf = (setCookie: string) => (/resident_token=([^;]+)/.exec(setCookie)?.[1] ? `resident_token=${/resident_token=([^;]+)/.exec(setCookie)![1]}` : '');

// The mail the routes send, caught here.
const mail: { to: string; subject: string; text: string }[] = [];
const lastLink = (to: string) => {
  const m = [...mail].reverse().find(x => x.to === to && /https?:\/\/\S+(token_hash=)/.test(x.text));
  const url = m ? /(https?:\/\/\S+token_hash=\S+)/.exec(m.text)?.[1] : null;
  if (!url) return null;
  const u = new URL(url);
  return { path: u.pathname, origin: u.origin, tokenHash: u.searchParams.get('token_hash')!, type: u.searchParams.get('type')!, subject: m!.subject };
};

const C = { lat: 14.795956, lng: 120.9297673 };
const square = (d: number) => ({ type: 'Polygon' as const, coordinates: [[[C.lng - d, C.lat - d], [C.lng + d, C.lat - d], [C.lng + d, C.lat + d], [C.lng - d, C.lat + d], [C.lng - d, C.lat - d]]] });
const HOME = { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', street: 'Ortega Compound', houseNumber: '12' };
/** The incident place for a referral record (it takes no house number). */
const PLACE = { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', street: 'Ortega Compound' };
const PW = 'Probe-pass-2026';
let n = 0;
const emailOf = (k: string) => `probe.rauth.${k}.${process.pid}.${++n}@example.com`;
const registration = (email: string, extra: Body = {}) => ({
  email, password: PW, confirmPassword: PW, firstName: 'Probe', lastName: `Fictional${n}`, birthDate: '1990-05-01', gender: 'Female',
  contactNumber: '+63 917 000 0001', altContactNumber: '0918-000-0002', ...HOME, purok: 'Purok 3', postalCode: '3018',
  latitude: C.lat, longitude: C.lng, locationSource: 'MAP', ...extra,
});
const NOISE = 'Fictional: malakas na karaoke ng kapitbahay hanggang alas-tres ng madaling araw tuwing Sabado, hindi makatulog ang may sakit na lola.';

async function main() {
  process.env.AI_ENABLED = 'false';
  const missing = supabaseAuthMissing();
  if (missing) {
    console.log(`\nNOT RUN: ${missing.join(', ')} missing from .env - the Supabase Auth scenarios cannot run without it.`);
    process.exitCode = 1;
    return;
  }
  setMailSinkForTests(m => mail.push({ to: m.to, subject: m.subject, text: m.text }));
  const users: string[] = []; const caseIds: string[] = []; const emails: string[] = [];
  const savedConfig = await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } });
  const pwHash = await bcrypt.hash(`${TAG}-unused`, 4);
  const residentByEmail = (e: string) => prisma.resident.findFirst({ where: { email: e } });
  try {
    // A test boundary (a square around the configured centre - NOT an official boundary), so pins can be inside or outside.
    await prisma.jurisdictionConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...DEFAULT_JURISDICTION, boundary: square(0.005), boundarySource: `${TAG} test square (not official)` },
      update: { boundary: square(0.005), boundarySource: `${TAG} test square (not official)` } });
    forgetJurisdiction();
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.rauth.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pwHash, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const CAP = await mk('captain', 'admin');
    const BLO = await mk('blotter', 'officer');
    const VAW = await mk('vawc', 'vawc_officer');
    let regIp = 0;
    const register = (body: Body, ip?: string) => registerPOST(req('/api/residents/register', '', 'POST', body, ip ?? `10.20.${process.pid % 250}.${++regIp}`)).then(json);
    const login = (email: string, password: string) => loginPOST(req('/api/auth/resident-login', '', 'POST', { email, password }, `10.1.${n}.${n}`)).then(json);
    const decide = (id: string, cookie: string, body: Body) => decidePOST(req(`/api/residency/applications/${id}`, cookie, 'POST', body), { params: Promise.resolve({ id }) }).then(json);

    // ── 1. A new resident registers ──
    console.log('\n1. A new resident registers (one step)');
    const E1 = emailOf('ana'); emails.push(E1);
    const r1 = await register(registration(E1));
    const res1 = await residentByEmail(E1);
    const sb1 = await findUserByEmail(E1);
    ok('1. registered (201): one resident profile, Pending Verification, linked to a new Supabase Auth user', r1.status === 201 && res1?.residencyStatus === 'PENDING_VERIFICATION'
      && Boolean(res1.supabaseUserId) && sb1?.id === res1.supabaseUserId, `${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);
    ok('1. every part of the address, the second number, postal code and home pin are saved', res1?.street === 'Ortega Compound' && res1.houseNumber === '12' && res1.purok === 'Purok 3'
      && res1.postalCode === '3018' && res1.homeLatitude !== null && res1.homeLocationSource === 'MAP' && res1.contactNumber === '+639170000001' && res1.altContactNumber === '+639180000002');
    ok('1. no password in SafeComm\'s tables (Supabase Auth keeps it, hashed)', res1?.password === null && !JSON.stringify(res1).includes(PW));
    ok('1. the email is not confirmed yet, and a confirmation link was sent (SafeComm\'s own page): "Verify Your SafeComm Account"', !sb1?.email_confirmed_at && lastLink(E1)?.path === '/verify-email' && lastLink(E1)?.type === 'signup'
      && lastLink(E1)?.subject === 'Verify Your SafeComm Account');
    ok('1. the residency history: registered, then submitted', (await prisma.residencyEvent.findMany({ where: { residentId: res1!.id }, orderBy: { createdAt: 'asc' } })).map(e => e.kind).join() === 'registered,submitted');

    // ── 2. Incomplete address ──
    console.log('\n2. Incomplete address');
    const E2 = emailOf('incomplete');
    const r2a = await register(registration(E2, { houseNumber: '' }));
    const r2b = await register(registration(E2, { street: '' }));
    const { street: _s, ...noStreetKey } = registration(E2); void _s;
    const r2c = await register(noStreetKey);
    ok('2. no house number / no street / street left out: refused (400), nothing created - no profile, no Supabase user', r2a.status === 400 && r2b.status === 400 && r2c.status === 400
      && !(await residentByEmail(E2)) && !(await findUserByEmail(E2)));

    // ── 3. Inside the boundary ──
    console.log('\n3. Inside the configured boundary');
    ok('3. the pin inside the (test) boundary and the address in Biñang 2nd: inside - and still only Pending Verification', r1.body.data?.check?.status === 'INSIDE'
      && r1.body.data.check.boundary === 'INSIDE' && res1?.residencyStatus === 'PENDING_VERIFICATION');

    // ── 4. Outside ──
    console.log('\n4. Outside the jurisdiction');
    const E4 = emailOf('taal');
    const r4 = await register(registration(E4, { barangay: 'Taal', street: 'Fictional St', latitude: null, longitude: null, locationSource: 'NONE' }));
    ok('4. another barangay: refused (422) with where to go instead; nothing created', r4.status === 422 && r4.body.code === 'OUTSIDE_JURISDICTION' && r4.body.destination?.barangay === 'Taal'
      && !(await residentByEmail(E4)) && !(await findUserByEmail(E4)));
    const r4b = await register(registration(emailOf('marilao'), { municipality: 'Marilao', barangay: 'Loma de Gato', street: 'Fictional St' }));
    ok('4. another municipality: refused too, even with a pin placed inside the barangay', r4b.status === 422 && r4b.body.code === 'OUTSIDE_JURISDICTION');

    // ── 5. Inconsistent pin ──
    console.log('\n5. Coordinates that do not match the address');
    const E5 = emailOf('farpin'); emails.push(E5);
    const r5 = await register(registration(E5, { latitude: C.lat + 0.03, longitude: C.lng }));
    const res5 = await residentByEmail(E5);
    ok('5. the address in Biñang 2nd but the pin far outside: registered for a person to check (Needs review, flagged), never verified', r5.status === 201
      && r5.body.data.check.status === 'NEEDS_REVIEW' && r5.body.data.check.flags.includes('PIN_OUTSIDE_BOUNDARY') && res5?.residencyStatus === 'PENDING_VERIFICATION');

    // ── 6. Email confirmation ──
    console.log('\n6. Email confirmation, still pending residency');
    const l6a = await login(E1, PW);
    ok('6. signing in before confirming the email: refused (403 EMAIL_NOT_VERIFIED)', l6a.status === 403 && l6a.body.code === 'EMAIL_NOT_VERIFIED', `${l6a.status} ${l6a.body.code}`);
    const link1 = lastLink(E1)!;
    const v6 = await json(await verifyPOST(req('/api/auth/verify-email', '', 'POST', { token_hash: link1.tokenHash, type: link1.type })));
    ok('6. the emailed link confirms the email and signs the resident in', v6.status === 200 && Boolean(cookieOf(v6.cookie)) && v6.body.data.residencyStatus === 'PENDING_VERIFICATION', `${v6.status} ${JSON.stringify(v6.body).slice(0, 160)}`);
    const v6b = await json(await verifyPOST(req('/api/auth/verify-email', '', 'POST', { token_hash: link1.tokenHash, type: link1.type })));
    ok('6. the same link a second time: refused (used)', v6b.status === 400 && v6b.body.code === 'LINK_EXPIRED', `${v6b.status} ${v6b.body.code}`);
    const l6 = await login(E1, PW);
    const A = cookieOf(l6.cookie);
    ok('6. confirmed: signs in (Supabase Auth) - and the residency is still Pending Verification', l6.status === 200 && Boolean(A) && l6.body.data.resident.residencyStatus === 'PENDING_VERIFICATION');
    ok('6. a wrong password: refused, with the set-up hint for old accounts', (await login(E1, 'Wrong-pass-1')).status === 401);
    const g6 = await json(await residencyGET(req('/api/resident/residency', A)));
    ok('6. the resident sees their own status', g6.status === 200 && g6.body.data.residency.status === 'PENDING_VERIFICATION');

    // ── 11. Pending: standard reporting refused, urgent never ──
    console.log('\n11. Reporting while pending');
    const f11 = await json(await filePOST(req('/api/resident/cases', A, 'POST', { description: NOISE, barangay: 'Ortega Compound', reportingRelationship: 'SELF',
      incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd', incidentLocationDetails: 'Fictional' })));
    ok('11. a standard report while pending: refused (403 RESIDENCY_NOT_VERIFIED), nothing filed', f11.status === 403 && f11.body.code === 'RESIDENCY_NOT_VERIFIED');
    const u11 = await json(await referralPOST(req('/api/resident/referrals', A, 'POST', { urgent: true, summary: 'Fictional: urgent help needed', ...PLACE })));
    ok('11. an urgent report is never blocked by the pending residency (saved for the barangay at once)', u11.status === 201 && u11.body.data.kind === 'URGENT', `${u11.status} ${JSON.stringify(u11.body).slice(0, 120)}`);

    // ── 16. Other officers cannot verify ──
    console.log('\n16-17. Who may verify');
    const b16 = await decide(res1!.id, BLO.cookie, { action: 'approve' });
    const v16 = await decide(res1!.id, VAW.cookie, { action: 'approve' });
    const r16 = await decidePOST(req(`/api/residency/applications/${res1!.id}`, A, 'POST', { action: 'approve' }), { params: Promise.resolve({ id: res1!.id }) }).then(json);
    ok('16. a blotter officer, a VAWC officer, and the resident themself cannot approve; status unchanged', b16.status === 403 && v16.status === 403 && r16.status === 401
      && (await prisma.resident.findUnique({ where: { id: res1!.id } }))?.residencyStatus === 'PENDING_VERIFICATION', `${b16.status} ${v16.status} ${r16.status}`);
    ok('16. the officers cannot even list the applications', (await json(await appsGET(req('/api/residency/applications', BLO.cookie)))).status === 403);

    // ── 17. The resident cannot set their own status ──
    const p17 = await json(await residencyPUT(req('/api/resident/residency', A, 'PUT', { ...HOME, residencyStatus: 'VERIFIED' })));
    const reg17 = await register({ ...registration(emailOf('self')), residencyStatus: 'VERIFIED' });
    ok('17. the resident cannot set their own residency status, at registration or after (403)', p17.status === 403 && reg17.status === 403);
    // Directly against Supabase, with the public key and the resident's own Supabase session.
    const direct = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const s17 = await direct.auth.signInWithPassword({ email: E1, password: PW });
    const read17 = await direct.from('Resident').select('id, residencyStatus').limit(5);
    const write17 = await direct.from('Resident').update({ residencyStatus: 'VERIFIED' }).eq('id', res1!.id).select('id');
    const cases17 = await direct.from('Case').select('id').limit(1);
    await direct.auth.signOut().catch(() => undefined);
    ok('17. signed in to Supabase directly, the resident can read and change nothing (row level security, no grants)', !s17.error
      && (Boolean(read17.error) || (read17.data ?? []).length === 0) && (Boolean(write17.error) || (write17.data ?? []).length === 0) && (Boolean(cases17.error) || (cases17.data ?? []).length === 0)
      && (await prisma.resident.findUnique({ where: { id: res1!.id } }))?.residencyStatus === 'PENDING_VERIFICATION',
      `${s17.error?.message ?? ''} ${read17.error?.code ?? read17.data?.length} ${write17.error?.code ?? write17.data?.length}`);

    // ── 7. The captain approves ──
    console.log('\n7-9. The official\'s decisions');
    const list7 = await json(await appsGET(req('/api/residency/applications?status=PENDING_VERIFICATION', CAP.cookie)));
    const row7 = list7.body.data?.rows?.find((x: Body) => x.id === res1!.id);
    ok('Resident Verification lists the application with name, email, contact, address, dates and status', row7?.email === E1 && row7.contactNumber === '+639170000001'
      && /Ortega Compound/.test(row7.address) && Boolean(row7.registeredAt) && row7.status === 'PENDING_VERIFICATION' && row7.emailVerified === true);
    const mailsBefore = mail.length;
    const a7 = await decide(res1!.id, CAP.cookie, { action: 'approve' });
    const after7 = await prisma.resident.findUnique({ where: { id: res1!.id } });
    ok('7. approved: Verified, with the verifier and the time; the decision is in the history', a7.status === 200 && after7?.residencyStatus === 'VERIFIED' && after7.residencyVerifiedById === CAP.id
      && Boolean(after7.residencyVerifiedAt) && await prisma.residencyEvent.count({ where: { residentId: res1!.id, kind: 'approved', actorId: CAP.id } }) === 1);
    ok('7. the resident is notified: by email and on their updates', mail.slice(mailsBefore).some(m => m.to === E1 && /verified/i.test(m.subject))
      && (await json(await updatesGET(req('/api/resident/updates', A)))).body.data?.some((u: Body) => u.title === 'Residency update' && /verified/i.test(u.message)));

    // ── 12. Verified, inside ──
    console.log('\n12-14. Reporting once verified');
    const f12 = await json(await filePOST(req('/api/resident/cases', A, 'POST', { description: NOISE, barangay: 'Ortega Compound', reportingRelationship: 'SELF',
      incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd', incidentLocationDetails: 'Fictional' })));
    if (f12.body.data?.id) caseIds.push(f12.body.data.id);
    ok('12. verified resident, incident inside: filed (201)', f12.status === 201, `${f12.status} ${f12.body.error ?? ''}`);
    // ── 13. Verified, outside ──
    const f13 = await json(await filePOST(req('/api/resident/cases', A, 'POST', { description: NOISE, barangay: 'Fictional St', reportingRelationship: 'SELF',
      incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Taal', incidentLocationDetails: 'Fictional' })));
    ok('13. verified resident, incident outside: not filed as a case - saved as a referral automatically (028)', f13.status === 201 && f13.body.data?.outcome === 'REFERRAL' && !f13.body.data?.caseNumber);
    const ref13 = await json(await referralPOST(req('/api/resident/referrals', A, 'POST', { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'Fictional St', summary: 'Fictional: outside incident' })));
    ok('13. ...and kept as an outside-the-jurisdiction referral for the barangay', ref13.status === 201 && ref13.body.data.kind === 'OUTSIDE_JURISDICTION');

    // ── 8. Reject (with a reason) - on the second resident ──
    const res5id = res5!.id;
    const r8a = await decide(res5id, CAP.cookie, { action: 'reject' });
    const r8 = await decide(res5id, CAP.cookie, { action: 'reject', reason: 'The pin is outside the barangay - please correct your home location.' });
    const s8 = await prisma.resident.findUnique({ where: { id: res5id } });
    ok('8. rejecting needs a reason; with one: Rejected, the reason recorded and the resident emailed', r8a.status === 400 && r8.status === 200 && s8?.residencyStatus === 'REJECTED'
      && s8.residencyNote === 'The pin is outside the barangay - please correct your home location.' && mail.some(m => m.to === E5 && /not approved/i.test(m.subject)));
    // ── 14. Third party, not verified ──
    const link5 = lastLink(E5)!;
    const v5 = await json(await verifyPOST(req('/api/auth/verify-email', '', 'POST', { token_hash: link5.tokenHash, type: link5.type })));
    const B = cookieOf(v5.cookie);
    const g8 = await json(await residencyGET(req('/api/resident/residency', B)));
    ok('8. a rejected resident can still sign in and sees the reason', v5.status === 200 && g8.body.data.residency.status === 'REJECTED' && /pin is outside/.test(g8.body.data.residency.note ?? ''));
    const t14 = await json(await referralPOST(req('/api/resident/referrals', B, 'POST', { reportingRelationship: 'THIRD_PARTY', summary: 'Fictional: a neighbour in Biñang 2nd may be hurt', ...PLACE })));
    const t14row = t14.body.data?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: t14.body.data.id } }) : null;
    ok('14. a non-verified reporter telling about someone else: kept for staff review, the reporter not taken for the person affected', t14.status === 201
      && t14.body.data.kind === 'UNVERIFIED_REPORTER' && t14row?.reportingRelationship === 'THIRD_PARTY');

    // ── 10. Correct and resubmit ──
    console.log('\n10. The resident corrects the address');
    const p10 = await json(await residencyPUT(req('/api/resident/residency', B, 'PUT', { ...HOME, purok: 'Purok 3', latitude: C.lat, longitude: C.lng, locationSource: 'MAP', submit: true })));
    ok('10. corrected and submitted again: Pending Verification (a correction is never self-approval)', p10.status === 201 && p10.body.status === 'PENDING_VERIFICATION');
    // ── 9. Request more information ──
    const q9 = await decide(res5id, CAP.cookie, { action: 'request_info', note: 'Please give your house number as on your gate.' });
    const g9 = await json(await residencyGET(req('/api/resident/residency', B)));
    ok('9. more information requested: Requires Additional Information; the resident sees what is needed and is emailed', q9.status === 200
      && g9.body.data.residency.status === 'NEEDS_INFO' && /house number/.test(g9.body.data.residency.note ?? '') && mail.some(m => m.to === E5 && /more information/i.test(m.subject)));
    const p9 = await json(await residencyPUT(req('/api/resident/residency', B, 'PUT', { ...HOME, houseNumber: '12-B', purok: 'Purok 3', latitude: C.lat, longitude: C.lng, locationSource: 'MAP', submit: true })));
    ok('9. the resident answers by updating and submitting: Pending Verification again', p9.status === 201 && p9.body.status === 'PENDING_VERIFICATION');

    // ── 15. Bypassing the form ──
    console.log('\n15. Direct API requests');
    const E15 = emailOf('bypass');
    const b15a = await register({ ...registration(E15), barangay: 'Taal', latitude: C.lat, longitude: C.lng });
    const b15b = await register({ ...registration(E15), password: 'short', confirmPassword: 'short' });
    const b15c = await register({ ...registration(E15), confirmPassword: 'Different-pass-9' });
    const b15d = await register({ ...registration(E15), role: 'admin' });
    const b15e = await register({ ...registration(E15), extraField: 1 });
    const b15f = await register({ ...registration(E15), locationSource: 'MAP', latitude: null, longitude: null });
    ok('15. outside address with an inside pin / weak password / mismatch / a role / an unknown field / "MAP" without a pin: all refused, nothing created',
      b15a.status === 422 && b15b.status === 400 && b15c.status === 400 && b15d.status === 403 && b15e.status === 400 && b15f.status === 400
      && !(await residentByEmail(E15)) && !(await findUserByEmail(E15)), [b15a, b15b, b15c, b15d, b15e, b15f].map(x => x.status).join());
    // Philippine mobile numbers only, stored the standard way (+639XXXXXXXXX).
    const p15a = await register(registration(emailOf('phone1'), { contactNumber: '12312312123' }));
    const p15b = await register(registration(emailOf('phone2'), { contactNumber: '0817 000 0001' }));
    const p15c = await register(registration(emailOf('phone3'), { altContactNumber: '0917 000 00011' }));
    ok('15. a number that is not a Philippine mobile number (12312312123, 0817..., 12 digits): refused, nothing created', p15a.status === 400 && p15b.status === 400
      && p15c.status === 400 && /\+63/.test(p15a.body.error ?? ''), [p15a, p15b, p15c].map(x => `${x.status} ${x.body.error ?? ''}`).join(' | '));
    const me15bad = await json(await mePATCH(req('/api/auth/resident-me', A, 'PATCH', { contactNumber: '12312312123' })));
    const me15 = await json(await mePATCH(req('/api/auth/resident-me', A, 'PATCH', { contactNumber: '0919-000-0003' })));
    ok('15. on the profile too: a wrong number refused; 0919-000-0003 saved as +639190000003', me15bad.status === 400 && me15.status === 200
      && (await prisma.resident.findUnique({ where: { id: res1!.id } }))?.contactNumber === '+639190000003', `${me15bad.status} ${me15.status}`);
    const dup15 = await register(registration(E1));
    ok('15. the same email twice: refused (409), no second profile', dup15.status === 409 && await prisma.resident.count({ where: { email: E1 } }) === 1);

    // ── 18-19. Accounts from before (Clerk and the old password) ──
    console.log('\n18-19. Accounts from before Supabase Auth');
    const E18 = emailOf('clerk'); emails.push(E18);
    const old = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-1`, firstName: 'Probe', lastName: 'Clerkuser', age: 40, gender: 'Female', barangay: 'Biñang 2nd',
      address: 'Fictional', contactNumber: '09170000002', email: E18, clerkId: `user_${TAG}_${process.pid}`, emailVerified: true, residencyStatus: 'VERIFIED', residencyVerifiedAt: new Date(),
      residencyVerifiedById: CAP.id, province: 'Bulacan', municipality: 'Bocaue' } });
    const oldCase = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-C1`, residentName: 'Probe Clerkuser', residentId: old.id, caseType: 'Noise Complaint', barangay: 'Ortega Compound', description: NOISE } });
    caseIds.push(oldCase.id);
    const E18b = emailOf('oldpw'); emails.push(E18b);
    await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-2`, firstName: 'Probe', lastName: 'Oldpassword', age: 40, gender: 'Female', barangay: 'Biñang 2nd',
      address: 'Fictional', email: E18b, username: `probe_ra_${process.pid}`, password: await bcrypt.hash('Old-pass-123', 4), emailVerified: true } });
    const l18 = await login(E18b, 'Old-pass-123');
    ok('18. an old SafeComm password no longer signs in (it was never moved): refused with the set-up hint', l18.status === 401 && /set up|Forgot password/i.test(l18.body.hint ?? ''));
    const u18 = await login(`probe_ra_${process.pid}`, 'Old-pass-123');
    ok('18. by old username too: refused the same way', u18.status === 401);
    const ask = await json(await pwAskPOST(req('/api/auth/resident-password', '', 'POST', { email: E18 })));
    const nobody = await json(await pwAskPOST(req('/api/auth/resident-password', '', 'POST', { email: emailOf('nobody') })));
    const setLink = lastLink(E18);
    ok('18. "Forgot password or set up": the same answer for an account and for nobody; the Clerk account gets a set-up link', ask.status === 200 && nobody.status === 200
      && ask.body.data.message === nobody.body.data.message && setLink?.type === 'invite' && setLink.path === '/reset-password' && /Set up/i.test(setLink.subject));
    // A test sender (onboarding@resend.dev) delivers to nobody but the provider account's owner: everyone is told - the same way.
    const testSender = /@resend\.dev\b/i.test(process.env.EMAIL_FROM ?? '');
    ok('18. when residents cannot receive email (a test sender), everyone asking is told so - the same for an account and for nobody',
      ask.body.data.deliveryWarning === nobody.body.data.deliveryWarning && Boolean(ask.body.data.deliveryWarning) === (testSender || !process.env.EMAIL_SERVER),
      `testSender=${testSender} warning=${ask.body.data.deliveryWarning ?? 'none'}`);
    const weak18 = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: setLink!.tokenHash, type: 'invite', password: 'abc', confirmPassword: 'abc' })));
    const set18 = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: setLink!.tokenHash, type: 'invite', password: PW, confirmPassword: PW })));
    const old18 = await prisma.resident.findUnique({ where: { id: old.id } });
    ok('18. a weak password is refused; then the password is set, the same profile linked (clerk id kept as the record), signed in', weak18.status === 400
      && set18.status === 200 && set18.body.data.signedIn === true && Boolean(old18?.supabaseUserId) && old18?.clerkId === `user_${TAG}_${process.pid}`
      && await prisma.resident.count({ where: { email: E18 } }) === 1, `${set18.status} ${JSON.stringify(set18.body).slice(0, 160)}`);
    const l19 = await login(E18, PW);
    const OLD = cookieOf(l19.cookie);
    const my19 = await json(await myCasesGET(req('/api/resident/cases', OLD)));
    const cases19 = (my19.body.data?.cases ?? my19.body.data ?? []) as Body[];
    ok('19. signs in with the new password; their case from before is still theirs, and still Verified', l19.status === 200 && cases19.some(c => c.id === oldCase.id)
      && l19.body.data.resident.residencyStatus === 'VERIFIED', `${l19.status} ${my19.status}`);
    const askPw = await json(await pwAskPOST(req('/api/auth/resident-password', '', 'POST', { email: E18b })));
    const pwLink = lastLink(E18b);
    await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: pwLink!.tokenHash, type: pwLink!.type, password: PW, confirmPassword: PW }));
    ok('18. an old-password account recovers the same way', askPw.status === 200 && pwLink?.type === 'invite' && (await login(E18b, PW)).status === 200);

    // The real-world case: an account from before asked for its set-up link, which never arrived (the mail
    // server was not working) - its Supabase user exists, invited and unconfirmed. Asking again must work.
    const askFrom = (email: string, ip: string) => pwAskPOST(new NextRequest(`${ORIGIN}/api/auth/resident-password`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email }) }));
    const E18c = emailOf('lostlink'); emails.push(E18c);
    const lost = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-3`, firstName: 'Probe', lastName: 'Lostlink', age: 40, gender: 'Female', barangay: 'Biñang 2nd',
      address: 'Fictional', email: E18c, clerkId: `user_${TAG}_${process.pid}_c`, emailVerified: true, residencyStatus: 'PENDING_VERIFICATION' } });
    const lostCase = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-C3`, residentName: 'Probe Lostlink', residentId: lost.id, caseType: 'Noise Complaint', barangay: 'Ortega Compound', description: NOISE } });
    caseIds.push(lostCase.id);
    await askFrom(E18c, '10.31.0.1');
    const firstLink = lastLink(E18c)!;
    const invited = await findUserByEmail(E18c);
    await askFrom(` ${E18c.toUpperCase()} `, '10.31.0.2');
    const secondLink = lastLink(E18c)!;
    ok('18c. asked again after the first link was lost: one Supabase user (no second one), a fresh set-up link for the same address (spaces and capitals ignored)',
      Boolean(invited) && !invited!.email_confirmed_at && secondLink.type === 'invite' && secondLink.tokenHash !== firstLink.tokenHash && /Set up/i.test(secondLink.subject)
      && (await findUserByEmail(E18c))?.id === invited!.id, `${secondLink.type} ${secondLink.subject}`);
    const set18c = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: secondLink.tokenHash, type: 'invite', password: PW, confirmPassword: PW })));
    const lostAfter = await prisma.resident.findUnique({ where: { id: lost.id } });
    ok('18c. the fresh link sets the password and links the same profile - residency untouched (still Pending, not approved), no second profile', set18c.status === 200
      && lostAfter?.supabaseUserId === invited!.id && lostAfter?.residencyStatus === 'PENDING_VERIFICATION' && await prisma.resident.count({ where: { email: { equals: E18c, mode: 'insensitive' } } }) === 1,
      `${set18c.status} ${JSON.stringify(set18c.body).slice(0, 140)}`);
    const old18c = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: firstLink.tokenHash, type: 'invite', password: 'Another-pass-9', confirmPassword: 'Another-pass-9' })));
    const l18c = await login(E18c, PW);
    const my18c = await json(await myCasesGET(req('/api/resident/cases', cookieOf(l18c.cookie))));
    ok('18c. the lost (older) link no longer works; the resident signs in with the new password and still has their case', old18c.status === 400 && l18c.status === 200
      && ((my18c.body.data?.cases ?? my18c.body.data ?? []) as Body[]).some(c => c.id === lostCase.id), `old=${old18c.status} login=${l18c.status}`);
    await askFrom(E18c, '10.31.0.3');
    ok('18c. once linked, Forgot Password sends an ordinary reset link', lastLink(E18c)?.type === 'recovery' && lastLink(E18c)?.subject === 'Reset Your SafeComm Password');

    // The same, by a reset link (what Supabase allows when a fresh set-up link cannot be made): it also proves the mailbox.
    const E18d = emailOf('lostreset'); emails.push(E18d);
    const lostD = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-4`, firstName: 'Probe', lastName: 'Lostreset', age: 40, gender: 'Female', barangay: 'Biñang 2nd',
      address: 'Fictional', email: E18d, clerkId: `user_${TAG}_${process.pid}_d`, emailVerified: true } });
    await askFrom(E18d, '10.31.0.4');
    const sbAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
    const rec = await sbAdmin.auth.admin.generateLink({ type: 'recovery', email: E18d });
    const set18d = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: rec.data.properties!.hashed_token, type: 'recovery', password: PW, confirmPassword: PW })));
    ok('18d. an invited, unconfirmed user can also finish with a reset link: password set, the profile linked, signs in', set18d.status === 200 && set18d.body.data.signedIn === true
      && Boolean((await prisma.resident.findUnique({ where: { id: lostD.id } }))?.supabaseUserId) && (await login(E18d, PW)).status === 200,
      `${set18d.status} ${JSON.stringify(set18d.body).slice(0, 140)}`);

    // ── Reset, resend, sign out ──
    console.log('\nPassword reset, resend, sign-out');
    // The link points to the configured site, whatever address the request came in on (no "reset poisoning").
    process.env.APP_URL = 'https://safecomm.example.org';
    await pwAskPOST(new NextRequest('http://evil.example/api/auth/resident-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.30.0.1', Host: 'evil.example' },
      body: JSON.stringify({ email: E1 }) }));
    delete process.env.APP_URL;
    const reset = lastLink(E1)!;
    ok('the reset email: "Reset Your SafeComm Password", its link on the configured site (not the address the request came in on)', reset.subject === 'Reset Your SafeComm Password'
      && reset.origin === 'https://safecomm.example.org' && reset.path === '/reset-password', `${reset.subject} ${reset.origin}`);
    const before = mail.length;
    const NEWPW = 'Probe-newpass-77';
    const rs = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: reset.tokenHash, type: reset.type, password: NEWPW, confirmPassword: NEWPW })));
    ok('forgot password: a reset link (recovery); the new password works and the old one no longer does', reset.type === 'recovery' && rs.status === 200
      && (await login(E1, NEWPW)).status === 200 && (await login(E1, PW)).status === 401);
    const changed = mail.slice(before).find(m => m.to === E1 && m.subject === 'Your SafeComm Password Has Been Updated');
    ok('after the change, "Your SafeComm Password Has Been Updated" is sent - with no link that signs anyone in', Boolean(changed) && !/token_hash/.test(changed!.text));
    // 029: a new password ends every session signed in with the old one - here, the one this test has used since step 6.
    const staleA = await json(await eligibilityPOST(req('/api/resident/eligibility', A, 'POST', { incident: { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'X' } })));
    ok('the new password signs out the sessions made with the old one (another device)', staleA.status === 401 && staleA.body.code === 'SESSION_ENDED', `${staleA.status}`);
    const A2 = cookieOf((await loginPOST(req('/api/auth/resident-login', '', 'POST', { email: E1, password: NEWPW }, '10.1.99.99'))).headers.get('set-cookie') ?? '');
    const rs2 = await json(await pwSetPUT(req('/api/auth/resident-password', '', 'PUT', { token_hash: reset.tokenHash, type: reset.type, password: NEWPW, confirmPassword: NEWPW })));
    ok('a reset link used twice: refused', rs2.status === 400 && rs2.body.code === 'LINK_EXPIRED');
    const E20 = emailOf('resend'); emails.push(E20);
    await register(registration(E20));
    const rsd = await json(await resendPOST(req('/api/auth/resend-verification', '', 'POST', { email: E20 })));
    const rsdNobody = await json(await resendPOST(req('/api/auth/resend-verification', '', 'POST', { email: emailOf('none') })));
    const again = lastLink(E20)!;
    const va = await json(await verifyPOST(req('/api/auth/verify-email', '', 'POST', { token_hash: again.tokenHash, type: again.type })));
    ok('resend confirmation: the same answer for anyone; the new link confirms', rsd.status === 200 && rsd.body.data.message === rsdNobody.body.data.message && again.type === 'magiclink' && va.status === 200);
    const out = await logoutPOST(req('/api/auth/resident-logout', '', 'POST'));
    ok('sign out clears the resident session cookie', /resident_token=;/.test(out.headers.get('set-cookie') ?? '') || /resident_token=.*Max-Age=0/i.test(out.headers.get('set-cookie') ?? ''));
    ok('no mail contains a password', mail.every(m => !m.text.includes(PW) && !m.text.includes(NEWPW)));

    // ── 20. The AI still assists, and never decides ──
    console.log('\n20. AI');
    const e20 = await json(await eligibilityPOST(req('/api/resident/eligibility', A2, 'POST', { incident: { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'X' } })));
    ok('20. the eligibility assistant still answers from the server\'s checks (AI off for this run: rules only)', e20.status === 200 && e20.body.data.incident_location_status === 'OUTSIDE'
      && e20.body.data.ai_used === false && e20.body.data.referral_required === true, `${e20.status} ${JSON.stringify(e20.body).slice(0, 300)}`);
  } finally {
    setMailSinkForTests(null);
    if (savedConfig) await prisma.jurisdictionConfig.update({ where: { id: 'default' }, data: { barangay: savedConfig.barangay, barangayAliases: savedConfig.barangayAliases,
      municipality: savedConfig.municipality, province: savedConfig.province, boundary: savedConfig.boundary ?? undefined, boundarySource: savedConfig.boundarySource, updatedById: savedConfig.updatedById } });
    else await prisma.jurisdictionConfig.deleteMany({ where: { id: 'default' } });
    if (savedConfig && savedConfig.boundary === null) await prisma.$executeRaw`UPDATE "JurisdictionConfig" SET "boundary" = NULL WHERE "id" = 'default'`;
    forgetJurisdiction();
    const residents = await prisma.resident.findMany({ where: { OR: [{ email: { startsWith: 'probe.rauth.' } }, { residentNumber: { startsWith: TAG } }] }, select: { id: true, supabaseUserId: true, email: true } });
    const rids = residents.map(r => r.id);
    const allCases = (await prisma.case.findMany({ where: { OR: [{ id: { in: caseIds } }, { residentId: { in: rids } }] }, select: { id: true } })).map(c => c.id);
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: allCases } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: allCases } }, { userId: { in: users } }, { entityId: { in: rids } }] } });
    await prisma.case.deleteMany({ where: { id: { in: allCases } } });
    await prisma.jurisdictionReferral.deleteMany({ where: { residentId: { in: rids } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: [...allCases, ...rids] } }, { actorId: { in: users } }] } });
    });
    await prisma.authSession.deleteMany({ where: { kind: 'resident', subjectId: { in: rids } } });
    await prisma.resident.deleteMany({ where: { id: { in: rids } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    // The Supabase users: by the links, and by email for any left unlinked.
    for (const r of residents) if (r.supabaseUserId) await deleteAuthUser(r.supabaseUserId);
    for (const e of emails) { const u = await findUserByEmail(e).catch(() => null); if (u) await deleteAuthUser(u.id); }
  }
  const leftUsers = await Promise.all(emails.map(e => findUserByEmail(e).catch(() => null)));
  ok('every test row and every test Supabase user removed; the jurisdiction as it was', await prisma.resident.count({ where: { OR: [{ email: { startsWith: 'probe.rauth.' } }, { residentNumber: { startsWith: TAG } }] } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.rauth.' } } }) === 0 && leftUsers.every(u => !u)
    && (await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } }))?.boundarySource !== `${TAG} test square (not official)`);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
