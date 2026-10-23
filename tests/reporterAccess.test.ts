/**
 * Reporter contact access: the policy, then the live endpoints.
 * Run with:  npm run test:reporter   (the dev server must be running; BASE_URL
 * defaults to http://localhost:3000)
 *
 * Part 2 creates temporary officials, residents and cases (all marked
 * PROBE-RA), calls the real API with real session tokens, and removes every
 * one of them at the end - including their audit rows, through the purge
 * switch the append-only trigger allows.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { decideReporterAccess, maskPhone, maskEmail, isUrgent, type Actor, type CaseFacts } from '../lib/reporterAccess';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

const TAG = 'PROBE-RA';
const PHONE_A = '09170000101';
const PHONE_B = '09170000202';
const PHONE_U = '09170000303';

function policy() {
  console.log('1. the policy');
  const officer: Actor = { id: 'o1', role: 'officer', active: true };
  const vawcOfficer: Actor = { id: 'v1', role: 'vawc_officer', active: true };
  const captain: Actor = { id: 'c1', role: 'admin', active: true };
  const base: CaseFacts = { caseType: 'Noise Complaint', assignedToId: 'o1', riskLevel: 'Low', requiresOfficerReview: false, immediateSafetyConcern: false };
  const vawc: CaseFacts = { ...base, caseType: 'Domestic Violence', assignedToId: 'v1' };
  const reason = 'Need to schedule the mediation visit';

  ok('blotter officer, own blotter case -> allowed, no reason needed', decideReporterAccess(officer, base).allowed
    && !decideReporterAccess(officer, base).reasonRequired);
  ok('blotter officer, VAWC case -> denied and hidden', (d => !d.allowed && d.code === 'vawc_restricted' && d.hidden)(decideReporterAccess(officer, vawc)));
  ok('...even if assigned to them and urgent', !decideReporterAccess(officer, { ...vawc, assignedToId: 'o1', riskLevel: 'Critical' }).allowed);
  ok('blotter officer, someone else’s case -> not_assigned, cannot take it', (d => !d.allowed && d.code === 'not_assigned' && !d.canClaim)(decideReporterAccess(officer, { ...base, assignedToId: 'o2' })));
  ok('blotter officer, unassigned case -> not_assigned, may take it', (d => !d.allowed && d.canClaim)(decideReporterAccess(officer, { ...base, assignedToId: null })));
  ok('a Critical label alone does not open someone else’s case', !decideReporterAccess(officer, { ...base, assignedToId: 'o2', riskLevel: 'Critical', immediateSafetyConcern: true }).allowed);
  ok('VAWC officer, own VAWC case -> needs a reason', (d => !d.allowed && d.code === 'reason_required')(decideReporterAccess(vawcOfficer, vawc)));
  ok('...given one -> allowed', decideReporterAccess(vawcOfficer, vawc, reason).allowed);
  ok('...a too-short reason is not one', !decideReporterAccess(vawcOfficer, vawc, 'call').allowed);
  ok('VAWC officer, blotter case -> wrong desk', decideReporterAccess(vawcOfficer, { ...base, assignedToId: 'v1' }).code === 'wrong_desk');
  ok('captain, case another officer holds, not urgent -> not applicable', decideReporterAccess(captain, base, reason).code === 'oversight_not_applicable');
  ok('captain, urgent case, with reason -> oversight', (d => d.allowed && d.basis === 'oversight')(decideReporterAccess(captain, { ...base, riskLevel: 'High' }, reason)));
  ok('captain, urgent case, no reason -> reason_required', decideReporterAccess(captain, { ...base, riskLevel: 'High' }).code === 'reason_required');
  ok('captain, unassigned blotter case -> oversight with reason', decideReporterAccess(captain, { ...base, assignedToId: null }, reason).allowed);
  ok('captain, unassigned VAWC case that is not urgent -> denied (stricter)', !decideReporterAccess(captain, { ...vawc, assignedToId: null }, reason).allowed);
  ok('captain, urgent VAWC case -> oversight with reason', decideReporterAccess(captain, { ...vawc, assignedToId: null, immediateSafetyConcern: true }, reason).allowed);
  ok('a deactivated account -> denied', decideReporterAccess({ ...officer, active: false }, base).code === 'inactive');
  ok('an unknown role -> denied', decideReporterAccess({ id: 'x', role: 'resident', active: true }, base).code === 'role_not_permitted');
  ok('urgency: High, Critical, review or danger now', isUrgent({ riskLevel: 'High', requiresOfficerReview: false, immediateSafetyConcern: false })
    && isUrgent({ riskLevel: 'Low', requiresOfficerReview: true, immediateSafetyConcern: false })
    && !isUrgent({ riskLevel: 'Medium', requiresOfficerReview: false, immediateSafetyConcern: false }));
  ok('masking keeps 4 + 2 digits only', maskPhone('09171234567') === '0917 ••• ••67' && maskPhone(null) === null);
  ok('e-mail masking keeps the first letter and domain', maskEmail('maria.santos@mail.com') === 'm•••@mail.com');
}

async function live() {
  console.log('\n2. the endpoints, live');
  const up = await fetch(`${BASE}/login`).then(r => r.ok).catch(() => false);
  if (!up) { ok(`dev server reachable at ${BASE}`, false, 'start it with npm run dev'); return; }

  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const mkUser = (key: string, role: string, active = true) => prisma.user.create({
    data: { email: `probe.ra.${key}@safcom.local`, name: `${TAG} ${key}`, password: pw, role, active },
  });
  const mkResident = (key: string, phone: string | null) => prisma.resident.create({
    data: { residentNumber: `${TAG}-${key}`, firstName: 'Probe', lastName: key, age: 30, gender: 'Female', barangay: 'Ayukit',
      address: 'temporary test row', contactNumber: phone, email: phone ? `probe.ra.res.${key}@safcom.local` : null, emailVerified: true },
  });
  const users: { id: string }[] = [];
  const residents: { id: string }[] = [];
  const caseIds: string[] = [];
  try {
    const blotter = await mkUser('blotter', 'officer'); users.push(blotter);
    const blotter2 = await mkUser('blotter2', 'officer'); users.push(blotter2);
    const vawcO = await mkUser('vawc', 'vawc_officer'); users.push(vawcO);
    const captain = await mkUser('captain', 'admin'); users.push(captain);
    const inactive = await mkUser('inactive', 'officer', false); users.push(inactive);
    const resA = await mkResident('A', PHONE_A); residents.push(resA);
    const resB = await mkResident('B', PHONE_B); residents.push(resB);
    const resNone = await mkResident('NONE', null); residents.push(resNone);
    const resU = await mkResident('U', PHONE_U); residents.push(resU);

    let n = 0;
    const mkCase = async (d: { caseType: string; residentId: string; assignedToId: string | null; riskLevel?: string;
      requiresOfficerReview?: boolean; contactPreference?: string; contactSafetyNote?: string }) => {
      const c = await prisma.case.create({ data: {
        caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe', barangay: 'Ortega Compound', description: 'temporary test case',
        status: 'Open', riskLevel: d.riskLevel ?? 'Low', caseType: d.caseType, residentId: d.residentId, assignedToId: d.assignedToId,
        requiresOfficerReview: d.requiresOfficerReview ?? false, contactPreference: d.contactPreference ?? null, contactSafetyNote: d.contactSafetyNote ?? null,
      } });
      caseIds.push(c.id); return c;
    };
    const mine = await mkCase({ caseType: 'Noise Complaint', residentId: resA.id, assignedToId: blotter.id });
    const others = await mkCase({ caseType: 'Noise Complaint', residentId: resB.id, assignedToId: blotter2.id });
    const unassigned = await mkCase({ caseType: 'Vandalism', residentId: resB.id, assignedToId: null });
    const vawcCase = await mkCase({ caseType: 'Domestic Violence', residentId: resB.id, assignedToId: vawcO.id });
    const noPhone = await mkCase({ caseType: 'Noise Complaint', residentId: resNone.id, assignedToId: blotter.id });
    const urgent = await mkCase({ caseType: 'Assault', residentId: resU.id, assignedToId: blotter.id, riskLevel: 'High',
      requiresOfficerReview: true, contactPreference: 'no_phone', contactSafetyNote: 'Only message through the app after 6 PM' });

    const staff = (u: { id: string; email: string }, role: string) => `safcom_token=${signToken({ userId: u.id, email: u.email, role })}`;
    const T = {
      blotter: staff(blotter, 'officer'), blotter2: staff(blotter2, 'officer'), vawc: staff(vawcO, 'vawc_officer'),
      captain: staff(captain, 'admin'), inactive: staff(inactive, 'officer'),
      // A session that claims a role the account does not have.
      forged: staff(blotter, 'admin'),
      resident: `resident_token=${signResidentToken({ residentId: resA.id, email: 'x', name: 'Probe A', role: 'resident' })}`,
    };
    const call = async (path: string, cookie: string | null, body?: unknown) => {
      const res = await fetch(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'manual',
        headers: { ...(cookie && { Cookie: cookie }), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, text, json, cache: res.headers.get('cache-control') ?? '' };
    };
    const reveal = (id: string, cookie: string | null, reason?: string) =>
      call(`/api/cases/${id}/reporter/reveal`, cookie, { fields: ['phone', 'email'], ...(reason && { reason }) });
    const data = (r: { json: Record<string, unknown> }) => (r.json.data ?? {}) as Record<string, unknown>;
    const lastLog = async (caseId: string, actorId?: string) => prisma.reporterAccessLog.findFirst({
      where: { caseId, ...(actorId && { actorId }) }, orderBy: { createdAt: 'desc' },
    });
    const REASON = 'Scheduling the follow-up visit with the reporter';

    // 1. An authorised blotter officer, assigned case
    const sum1 = await call(`/api/cases/${mine.id}/reporter`, T.blotter);
    ok('[1] summary: masked number, may reveal', sum1.status === 200 && (data(sum1).contact as { phoneMasked: string }).phoneMasked === '0917 ••• ••01'
      && (data(sum1).access as { canReveal: boolean }).canReveal === true, sum1.text.slice(0, 200));
    ok('[1] the summary never carries the full number', !sum1.text.includes(PHONE_A) && /no-store/.test(sum1.cache));
    const r1 = await reveal(mine.id, T.blotter);
    ok('[1] reveal -> the number and a tel: link', r1.status === 200 && data(r1).phone === PHONE_A && data(r1).telHref === `tel:${PHONE_A}`, r1.text.slice(0, 200));
    ok('[1] ...not cached', /no-store/.test(r1.cache));
    const log1 = await lastLog(mine.id, blotter.id);
    ok('[1] logged as permitted, without the number', log1?.outcome === 'permitted' && log1.code === 'assigned'
      && log1.fields.join() === 'phone,email' && !JSON.stringify(log1).includes(PHONE_A));
    const detail = await call(`/api/cases/${mine.id}`, T.blotter);
    ok('[1] the general case detail never carries the number', detail.status === 200 && !detail.text.includes(PHONE_A));

    // 2. Blotter officer -> VAWC case
    const s2 = await call(`/api/cases/${vawcCase.id}/reporter`, T.blotter);
    const r2 = await reveal(vawcCase.id, T.blotter, REASON);
    ok('[2] blotter officer on a VAWC case: not found, nothing revealed', s2.status === 404 && r2.status === 404 && !r2.text.includes(PHONE_B));
    const log2 = await lastLog(vawcCase.id, blotter.id);
    ok('[2] the attempt is logged as denied (vawc_restricted)', log2?.outcome === 'denied' && log2.code === 'vawc_restricted');
    ok('[2] a forged "admin" session does not help: the role is read from the account',
      (await reveal(vawcCase.id, T.forged, REASON)).status === 404);

    // 3. VAWC officer, assigned VAWC case
    const r3a = await reveal(vawcCase.id, T.vawc);
    ok('[3] VAWC officer without a reason -> 403 reason_required', r3a.status === 403 && r3a.json.code === 'reason_required' && !r3a.text.includes(PHONE_B));
    const r3 = await reveal(vawcCase.id, T.vawc, REASON);
    ok('[3] with a reason -> the number', r3.status === 200 && data(r3).phone === PHONE_B);
    const log3 = await lastLog(vawcCase.id, vawcO.id);
    ok('[3] logged with the reason', log3?.outcome === 'permitted' && log3.reason === REASON);
    const s3 = await call(`/api/cases/${vawcCase.id}/reporter`, T.vawc);
    ok('[3] VAWC caution shown on the case', typeof (data(s3).safety as { caution: string | null })?.caution === 'string');

    // 4. Unrelated or unassigned case
    const r4a = await reveal(others.id, T.blotter);
    ok('[4] someone else’s case -> 403 not_assigned', r4a.status === 403 && r4a.json.code === 'not_assigned' && !r4a.text.includes(PHONE_B));
    const s4 = await call(`/api/cases/${unassigned.id}/reporter`, T.blotter);
    ok('[4] unassigned case: no masked number, may take it', s4.status === 200 && (data(s4).contact as { phoneMasked: string | null }).phoneMasked === null
      && (data(s4).access as { canClaim: boolean }).canClaim === true);
    ok('[4] unassigned case -> reveal refused', (await reveal(unassigned.id, T.blotter)).status === 403);
    ok('[4] taking a case another officer holds -> 409', (await call(`/api/cases/${others.id}/claim`, T.blotter, {})).status === 409);
    ok('[4] VAWC officer cannot take a blotter case', (await call(`/api/cases/${unassigned.id}/claim`, T.vawc, {})).status === 403);
    const claim = await call(`/api/cases/${unassigned.id}/claim`, T.blotter, {});
    const took = await prisma.activity.findFirst({ where: { caseId: unassigned.id, type: 'assignment' } });
    ok('[4] taking an unassigned case on their desk works, and is recorded', claim.status === 200 && Boolean(took));
    ok('[4] ...after which the reveal is allowed', (await reveal(unassigned.id, T.blotter)).status === 200);
    ok('[4] a second officer cannot take it now', (await call(`/api/cases/${unassigned.id}/claim`, T.blotter2, {})).status === 409);
    ok('[4] a deactivated officer is refused, even on their desk', (await reveal(mine.id, T.inactive)).status === 403);

    // 5. A resident
    const r5 = await call(`/api/cases/${others.id}/reporter`, T.resident);
    const r5b = await reveal(others.id, T.resident);
    ok('[5] resident session on the staff endpoints -> refused, no number', r5.status >= 300 && r5b.status >= 300
      && !r5.text.includes(PHONE_B) && !r5b.text.includes(PHONE_B), `${r5.status} ${r5b.status}`);
    const dir = await call('/api/residents?limit=100', T.resident);
    ok('[5] resident session on the resident directory -> refused', dir.status >= 300 && !dir.text.includes(PHONE_B));
    const me = await call('/api/auth/resident-me', T.resident);
    ok('[5] the resident sees their own number only', me.status === 200 && me.text.includes(PHONE_A) && !me.text.includes(PHONE_B));

    // 6. No session
    const r6 = await reveal(mine.id, null);
    const s6 = await call(`/api/cases/${mine.id}/reporter`, null);
    ok('[6] unauthenticated -> refused, nothing revealed', r6.status >= 300 && s6.status >= 300 && !r6.text.includes(PHONE_A) && !s6.text.includes(PHONE_A),
      `${r6.status} ${s6.status}`);

    // 7. Changing the case id
    const r7 = await reveal(others.id, T.blotter);
    ok('[7] swapping in another case’s id -> denied', r7.status === 403);
    const bogus = `${mine.id}x`;
    const r7b = await reveal(bogus, T.blotter);
    ok('[7] an id that does not exist -> 404', r7b.status === 404);
    const r7c = await reveal(encodeURIComponent(`' OR '1'='1`), T.blotter);
    ok('[7] an injection-shaped id -> 404, nothing revealed', r7c.status === 404 && !/0917000/.test(r7c.text));

    // 8. Denials recorded
    const denied = await prisma.reporterAccessLog.findMany({ where: { actorId: blotter.id, outcome: 'denied' } });
    const codes = new Set(denied.map(d => d.code));
    ok('[8] denied attempts are in the log with their reason codes', ['vawc_restricted', 'not_assigned', 'not_found'].every(c => codes.has(c)), [...codes].join(','));
    ok('[8] the log never holds a phone number', !JSON.stringify(denied).includes('0917000'));
    const logId = denied[0]?.id;
    let updateRefused = false; let deleteRefused = false;
    try { await prisma.reporterAccessLog.update({ where: { id: logId }, data: { outcome: 'permitted' } }); } catch { updateRefused = true; }
    try { await prisma.reporterAccessLog.delete({ where: { id: logId } }); } catch { deleteRefused = true; }
    ok('[8] the log cannot be altered or deleted (database trigger)', updateRefused && deleteRefused
      && (await prisma.reporterAccessLog.findUnique({ where: { id: logId } }))?.outcome === 'denied');

    // 9. No phone on file
    const s9 = await call(`/api/cases/${noPhone.id}/reporter`, T.blotter);
    const r9 = await reveal(noPhone.id, T.blotter);
    ok('[9] missing phone: summary says so', s9.status === 200 && (data(s9).contact as { hasPhone: boolean }).hasPhone === false);
    ok('[9] reveal -> no number, no link, a plain message', r9.status === 200 && data(r9).phone === null && data(r9).telHref === null
      && typeof data(r9).missing === 'string');
    ok('[9] logged as no_contact_on_file', (await lastLog(noPhone.id, blotter.id))?.code === 'no_contact_on_file');

    // 10. Urgent, with a safe-contact warning
    const s10 = await call(`/api/cases/${urgent.id}/reporter`, T.blotter);
    const sf = data(s10).safety as { preference: string; allowCall: boolean; note: string };
    ok('[10] urgent case shows its state and the reporter’s warning', (data(s10).urgency as { urgent: boolean }).urgent === true
      && sf?.preference === 'no_phone' && sf.allowCall === false && sf.note.includes('after 6 PM'));
    const r10 = await reveal(urgent.id, T.blotter);
    ok('[10] the number is shown but no call or text link is offered', r10.status === 200 && data(r10).phone === PHONE_U
      && data(r10).telHref === null && data(r10).smsHref === null);
    const c10 = await reveal(urgent.id, T.captain);
    ok('[10] captain oversight on the urgent case needs a reason', c10.status === 403 && c10.json.code === 'reason_required');
    const c10b = await reveal(urgent.id, T.captain, REASON);
    ok('[10] ...and with one is allowed, logged as oversight', c10b.status === 200 && (await lastLog(urgent.id, captain.id))?.code === 'oversight');
    ok('[10] captain on a non-urgent case another officer holds -> refused', (await reveal(mine.id, T.captain, REASON)).json.code === 'oversight_not_applicable');

    // The resident directory
    const dirOfficer = await call('/api/residents?limit=100&search=PROBE-RA', T.blotter);
    const dirCaptain = await call('/api/residents?limit=100&search=PROBE-RA', T.captain);
    ok('directory: officers get no contact details', dirOfficer.status === 200 && !dirOfficer.text.includes(PHONE_A));
    ok('directory: the captain still does', dirCaptain.status === 200 && dirCaptain.text.includes(PHONE_A));
    ok('directory detail: officers get no contact details', !(await call(`/api/residents/${resA.id}`, T.blotter)).text.includes(PHONE_A));
  } finally {
    await prisma.activity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents.map(r => r.id) } } });
    const userIds = users.map(u => u.id);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { caseId: { in: caseIds } }] } });
    });
    await prisma.activity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  ok('every test row removed', await prisma.user.count({ where: { email: { startsWith: 'probe.ra.' } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0);
}

async function database() {
  console.log('\n3. the database');
  const open = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`;
  ok('RLS is on for every table in public', open.length === 0, open.map(t => t.tablename).join(','));
  const grants = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`;
  ok('the public API roles have no access to any table', grants[0].n === 0, String(grants[0].n));
}

async function main() {
  policy();
  await live();
  await database();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
