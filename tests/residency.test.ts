/**
 * Residency verification and the jurisdiction - the specification's 17 test
 * scenarios, through the real routes and the real database, in-process.
 * Run with:  npm run test:residency
 *
 * Needs prisma/sql/023 applied. The AI is turned off for the run (no Groq
 * call), so every answer here is the server's own rules. Temporary rows are
 * marked PROBE-RS and removed at the end; the jurisdiction configuration is
 * put back as it was. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { checkLocation, matchStreet, normalizeName, boundaryProblem, eligibilityAnswer, DEFAULT_JURISDICTION, type JurisdictionConfig } from '../lib/jurisdiction';
import { jurisdictionPromptBlock, explanationAgrees } from '../lib/aiJurisdiction';
import { forgetJurisdiction, registrationAddressRefusal } from '../lib/jurisdictionServer';
import { GET as residencyGET, PUT as residencyPUT } from '../app/api/resident/residency/route';
import { GET as appsGET } from '../app/api/residency/applications/route';
import { GET as appGET, POST as appPOST } from '../app/api/residency/applications/[id]/route';
import { GET as jurGET, PUT as jurPUT } from '../app/api/jurisdiction/route';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { POST as intakePOST } from '../app/api/resident/intake/route';
import { GET as myRefGET, POST as refPOST } from '../app/api/resident/referrals/route';
import { GET as staffRefGET, PATCH as staffRefPATCH } from '../app/api/residency/referrals/route';
import { POST as eligPOST } from '../app/api/resident/eligibility/route';
import { PUT as residentAdminPUT } from '../app/api/residents/[id]/route';
import { GET as meGET, PATCH as mePATCH } from '../app/api/auth/resident-me/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RS';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };

// A square of about 1 km around the configured centre, for the pure boundary checks only (not an official boundary).
const C = { lat: 14.795956, lng: 120.9297673 };
const square = (d: number) => ({ type: 'Polygon' as const, coordinates: [[[C.lng - d, C.lat - d], [C.lng + d, C.lat - d], [C.lng + d, C.lat + d], [C.lng - d, C.lat + d], [C.lng - d, C.lat - d]]] });
const WITH_BOUNDARY: JurisdictionConfig = { ...DEFAULT_JURISDICTION, boundary: square(0.005), boundarySource: 'test square' };
const HOME = { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', street: 'Ortega Compound', houseNumber: '12' };
const INCIDENT = { incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd' };

async function main() {
  process.env.AI_ENABLED = 'false';
  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const savedConfig = await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } });
  try {
    // ── The rules (pure) ──
    console.log('\nThe rules');
    ok('names compare without accents, case or spacing; "II" reads as "2nd"', normalizeName('Biñang II') === normalizeName('binang 2nd') && normalizeName('BOCAUE') === 'bocaue');
    const s5 = checkLocation({ ...HOME, barangay: 'Taal', latitude: C.lat, longitude: C.lng }, WITH_BOUNDARY, 'residence');
    ok('5. another barangay chosen, pin inside the boundary: flagged for a person, never approved', s5.status === 'NEEDS_REVIEW' && s5.flags.includes('PIN_INSIDE_OTHER_ADDRESS'));
    const s6 = checkLocation({ ...HOME, latitude: C.lat + 0.02, longitude: C.lng }, WITH_BOUNDARY, 'residence');
    ok('6. the barangay chosen, pin outside the boundary: flagged for a person', s6.status === 'NEEDS_REVIEW' && s6.flags.includes('PIN_OUTSIDE_BOUNDARY') && s6.boundary === 'OUTSIDE');
    const inside = checkLocation({ ...HOME, latitude: C.lat, longitude: C.lng }, WITH_BOUNDARY, 'residence');
    ok('3. the barangay chosen and the pin inside the boundary: inside', inside.status === 'INSIDE' && inside.boundary === 'INSIDE' && inside.flags.length === 0);
    const noBoundary = checkLocation({ ...HOME, latitude: C.lat, longitude: C.lng }, DEFAULT_JURISDICTION, 'residence');
    ok('no boundary configured: no polygon is guessed - a person reviews the pin', noBoundary.status === 'NEEDS_REVIEW' && noBoundary.boundary === 'NOT_CONFIGURED');
    const s7 = matchStreet('Ortega Compund');
    ok('7. a misspelt street: not matched, a suggestion offered, nothing corrected', !s7.known && s7.match === null && s7.suggestions.includes('Ortega Compound') && s7.input === 'Ortega Compund');
    ok('a street on the list in another spelling ("St." / "Street") is recognised', matchStreet('J.P. Rizal Street').match === 'J.P. Rizal St.');
    ok('a boundary in [lat, lng] order is refused, not used', /longitude, latitude/.test(boundaryProblem({ type: 'Polygon', coordinates: [[[14.79, 120.93], [14.8, 120.93], [14.8, 120.94], [14.79, 120.93]]] }) ?? ''));
    ok('the AI is told the configured jurisdiction and that it never decides', /Biñang 2nd, Bocaue, Bulacan/.test(jurisdictionPromptBlock(DEFAULT_JURISDICTION))
      && /never approve or reject a resident account/i.test(jurisdictionPromptBlock()) && /Never override/.test(jurisdictionPromptBlock()));
    ok('an AI explanation that contradicts the server is not used', !explanationAgrees('OUTSIDE', 'Nasa sakop kayo.') && explanationAgrees('OUTSIDE', 'Ang lugar ay nasa labas ng sakop ng SafeComm.')
      && !explanationAgrees('INSIDE', 'This is outside the jurisdiction.') && !explanationAgrees('NEEDS_REVIEW', 'Your account is approved.'));
    const ea = eligibilityAnswer('PENDING_VERIFICATION', null, checkLocation({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'X' }, DEFAULT_JURISDICTION, 'incident'));
    ok('the structured answer: every field from the server\'s checks', ea.incident_location_status === 'OUTSIDE' && ea.referral_required && !ea.jurisdiction_match
      && ea.recommended_destination === 'Taal, Bocaue, Bulacan' && !ea.may_proceed && ea.ai_used === false);

    // ── People ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.rs.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const CAP = await mk('captain', 'admin');
    const BLO = await mk('blotter', 'officer');
    const VAW = await mk('vawc', 'vawc_officer');
    const SYS = await mk('sysadmin', 'system_admin');
    let n = 0;
    const mkRes = async (first: string, data: Record<string, unknown> = {}) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-${++n}`, firstName: first, lastName: 'Fictional', age: 30, gender: 'Female',
        barangay: 'Biñang 2nd', address: 'Fictional', contactNumber: '09170000000', emailVerified: true, ...data } as never });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const put = (cookie: string, body: Body) => residencyPUT(req('/api/resident/residency', cookie, 'PUT', body)).then(json);
    const getRes = async (cookie: string) => (await json(await residencyGET(req('/api/resident/residency', cookie)))).body.data;
    const decide = (id: string, cookie: string, body: Body) => appPOST(req(`/api/residency/applications/${id}`, cookie, 'POST', body), { params: Promise.resolve({ id }) }).then(json);
    const file = (cookie: string, body: Body) => filePOST(req('/api/resident/cases', cookie, 'POST', body)).then(json);
    const NOISE = 'Fictional: malakas na videoke sa kapitbahay tuwing gabi hanggang alas-dos ng madaling araw, hindi kami makatulog.';

    // 1. A Google sign-in is never a resident account by itself.
    console.log('\n1-2. Registration: complete details required');
    // The address check the registration route runs before any record is made (registrationAddressRefusal);
    // the whole registration, with Supabase Auth, is tested in tests/residentAuth.test.ts.
    const r1 = await registrationAddressRefusal({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd' });
    ok('1. a profile without the full residential address is refused before any record is made', r1?.status === 400 && (r1.body.missing as string[]).includes('Street'));
    ok('1. a complete address in the barangay is not refused at registration', (await registrationAddressRefusal(HOME)) === null);
    const Gmail = await mkRes('Gmail');   // what a Google sign-in leaves behind before the residency is complete
    ok('1. a resident record with residency incomplete cannot file a standard report', (await file(Gmail.cookie, { description: NOISE, barangay: 'Ortega Compound', ...INCIDENT })).status === 403
      && (await json(await intakePOST(req('/api/resident/intake', Gmail.cookie, 'POST', { narrative: NOISE })))).status === 403);
    ok('1. the portal says so (resident-me: not a verified resident)', (await json(await meGET(req('/api/auth/resident-me', Gmail.cookie)))).body.data.verifiedResident === false);
    const s2 = await put(Gmail.cookie, { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', street: '', submit: true });
    ok('2. an incomplete address is not submitted, and says what is missing', s2.status === 400 && s2.body.code === 'ADDRESS_INCOMPLETE' && s2.body.missing.includes('Street'));

    console.log('\n3-4. Inside and outside');
    const s3 = await put(Gmail.cookie, { ...HOME, latitude: C.lat, longitude: C.lng, locationSource: 'MAP', submit: true });
    const g3 = await getRes(Gmail.cookie);
    ok('3. an address in the barangay goes to an official: Pending Verification (never approved by itself)', s3.status === 201 && g3.residency.status === 'PENDING_VERIFICATION'
      && g3.location.latitude === Math.round(C.lat * 1e6) / 1e6 && g3.check.flags.includes('BOUNDARY_NOT_CONFIGURED'));
    const Out = await mkRes('Outsider');
    const s4 = await put(Out.cookie, { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'Fictional St', submit: true });
    ok('4. another barangay: refused with where to go instead; not submitted', s4.status === 422 && s4.body.code === 'OUTSIDE_JURISDICTION' && s4.body.destination.barangay === 'Taal'
      && (await prisma.resident.findUnique({ where: { id: Out.id } }))?.residencyStatus === 'INCOMPLETE'
      && await prisma.residencyEvent.count({ where: { residentId: Out.id, kind: 'outside_refused' } }) === 1);
    const r4 = await registrationAddressRefusal({ province: 'Bulacan', municipality: 'Marilao', barangay: 'Loma de Gato', street: 'Fictional St' });
    ok('4. registering from another municipality: refused before anything is stored', r4?.status === 422 && r4.body.code === 'OUTSIDE_JURISDICTION');
    const Spell = await mkRes('Speller');
    const s7r = await put(Spell.cookie, { ...HOME, street: 'Ortega Compund', locationSource: 'NONE', submit: true });
    const spellRow = await prisma.resident.findUnique({ where: { id: Spell.id } });
    ok('7. a misspelt street: submitted for a person to check, kept as typed, the suggestion shown', s7r.status === 201 && spellRow?.street === 'Ortega Compund'
      && (spellRow?.addressCheck as Body)?.flags.includes('STREET_NOT_ON_RECORD') && /Ortega Compound/.test(s7r.body.data.check.explanation));

    // ── Verification ──
    console.log('\n8-9. Verification by an authorised official');
    const list = await json(await appsGET(req('/api/residency/applications', CAP.cookie)));
    ok('the captain sees the pending applications and the counts', list.status === 200 && list.body.data.rows.some((r: Body) => r.id === Gmail.id) && list.body.data.counts.PENDING_VERIFICATION >= 2);
    ok('blotter, VAWC and system admin may not verify (403)', (await json(await appsGET(req('/api/residency/applications', BLO.cookie)))).status === 403
      && (await json(await appsGET(req('/api/residency/applications', VAW.cookie)))).status === 403 && (await json(await appsGET(req('/api/residency/applications', SYS.cookie)))).status === 403
      && (await decide(Gmail.id, BLO.cookie, { action: 'approve' })).status === 403);
    const one = await json(await appGET(req(`/api/residency/applications/${Gmail.id}`, CAP.cookie), { params: Promise.resolve({ id: Gmail.id }) }));
    ok('the captain opens the applicant: address, home location, the check now', one.status === 200 && one.body.data.location.latitude === Math.round(C.lat * 1e6) / 1e6 && one.body.data.checkNow.selection === 'MATCH');
    const ap = await decide(Gmail.id, CAP.cookie, { action: 'approve' });
    const gRow = await prisma.resident.findUnique({ where: { id: Gmail.id } });
    ok('8. approved: Verified, with the verifier and the date, account active, logged', ap.status === 200 && gRow?.residencyStatus === 'VERIFIED' && gRow.residencyVerifiedById === CAP.id
      && gRow.residencyVerifiedAt !== null && gRow.status === 'Active' && await prisma.residencyEvent.count({ where: { residentId: Gmail.id, kind: 'approved', actorId: CAP.id } }) === 1
      && await prisma.activity.count({ where: { entityId: Gmail.id, type: 'residency_verified' } }) === 1);
    ok('a decided application cannot be decided again', (await decide(Gmail.id, CAP.cookie, { action: 'reject', reason: 'second decision' })).status === 409);
    const rj = await decide(Spell.id, CAP.cookie, { action: 'reject', reason: 'Fictional: the street is not in this barangay.' });
    const sp = await getRes(Spell.cookie);
    ok('9. rejected with a reason the resident sees; the account stays restricted; may correct and resubmit', rj.status === 200 && sp.residency.status === 'REJECTED'
      && /not in this barangay/.test(sp.residency.note) && (await file(Spell.cookie, { description: NOISE, barangay: 'Ortega Compound', ...INCIDENT })).status === 403
      && (await put(Spell.cookie, { ...HOME, locationSource: 'NONE', submit: true })).status === 201);
    ok('...a request for more information is recorded the same way', (await decide(Spell.id, CAP.cookie, { action: 'request_info', note: 'Fictional: give the house number.' })).status === 200
      && (await getRes(Spell.cookie)).residency.status === 'NEEDS_INFO');

    // ── Reports ──
    console.log('\n10-14, 16. Reports');
    const f10 = await file(Gmail.cookie, { description: NOISE, intakeNarrative: NOISE, barangay: 'Ortega Compound', ...INCIDENT });
    if (f10.body.data?.id) caseIds.push(f10.body.data.id);
    ok('10. a verified resident, incident inside: filed as usual', f10.status === 201, `${f10.status} ${f10.body.error ?? ''}`);
    const f11 = await file(Gmail.cookie, { description: NOISE, barangay: 'Fictional St', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin' });
    ok('11. a verified resident, incident outside: not a case; where to go; a referral may be saved', f11.status === 422 && f11.body.code === 'OUTSIDE_JURISDICTION'
      && f11.body.destination.municipality === 'Marilao' && f11.body.referralAvailable === true && Array.isArray(f11.body.emergencyContacts));
    const ref11 = await json(await refPOST(req('/api/resident/referrals', Gmail.cookie, 'POST', { province: 'Bulacan', municipality: 'Marilao', barangay: 'Lambakin', street: 'Fictional St', summary: 'Fictional summary' })));
    ok('11. ...saved as an outside-jurisdiction referral record (not a case)', ref11.status === 201 && ref11.body.data.kind === 'OUTSIDE_JURISDICTION');
    const f12 = await file(Out.cookie, { description: NOISE, barangay: 'Ortega Compound', ...INCIDENT });
    ok('12. a non-verified account: standard reporting refused, with guidance and the emergency numbers', f12.status === 403 && f12.body.code === 'RESIDENCY_NOT_VERIFIED' && f12.body.emergencyContacts.length > 0);
    const ref12 = await json(await refPOST(req('/api/resident/referrals', Out.cookie, 'POST', { province: HOME.province, municipality: HOME.municipality, barangay: HOME.barangay, street: HOME.street, summary: 'Fictional', reportingRelationship: 'ON_BEHALF' })));
    ok('12/13. ...their report can still be kept, for staff-assisted intake (unverified reporter)', ref12.status === 201 && ref12.body.data.kind === 'UNVERIFIED_REPORTER');
    const f13 = await file(Gmail.cookie, { description: NOISE, intakeNarrative: NOISE, barangay: 'Ortega Compound', ...INCIDENT, reportingRelationship: 'ON_BEHALF',
      affectedParty: { fullName: 'Fictional Lola', relationship: 'Grandmother' }, reportedParty: { fullName: 'Fictional Neighbour' } });
    if (f13.body.data?.id) caseIds.push(f13.body.data.id);
    const parties13 = f13.body.data?.id ? await prisma.caseParty.findMany({ where: { caseId: f13.body.data.id }, select: { role: true, fullName: true } }) : [];
    ok('13. on behalf of another person: filed; reporter, person affected and person reported kept apart', f13.status === 201
      && parties13.some(p => p.role === 'AFFECTED' && p.fullName === 'Fictional Lola') && parties13.some(p => p.role === 'REPORTED' && p.fullName === 'Fictional Neighbour'), `${f13.status} ${f13.body.error ?? ''}`);
    const ref14 = await json(await refPOST(req('/api/resident/referrals', Out.cookie, 'POST', { urgent: true, province: HOME.province, municipality: HOME.municipality, barangay: HOME.barangay, street: HOME.street, summary: 'Fictional: may sinasaktan ngayon' })));
    const capNote = await prisma.notification.findFirst({ where: { userId: CAP.id, title: 'Urgent referral received' }, orderBy: { createdAt: 'desc' } });
    ok('14. an urgent concern is never discarded: kept as an urgent referral, the emergency numbers returned, the captain told', ref14.status === 201 && ref14.body.data.kind === 'URGENT'
      && ref14.body.data.emergencyContacts.length > 0 && Boolean(capNote) && !/sinasaktan/.test(capNote?.message ?? ''));
    const sr = await json(await staffRefGET(req('/api/residency/referrals?status=ALL', CAP.cookie)));
    ok('the captain reviews referral records (urgent first); the desks may not', sr.status === 200 && sr.body.data.rows[0].urgent === true
      && (await json(await staffRefGET(req('/api/residency/referrals', BLO.cookie)))).status === 403);
    ok('...and marks one reviewed', (await json(await staffRefPATCH(req('/api/residency/referrals', CAP.cookie, 'PATCH', { id: ref14.body.data.id, status: 'REVIEWED', note: 'Fictional: called the resident' })))).status === 200);
    ok('a resident sees their own referral records, without the review notes', (await json(await myRefGET(req('/api/resident/referrals', Out.cookie)))).body.data.every((x: Body) => !('reviewNote' in x)));
    ok('16. direct API: no incident place - refused as incomplete', (await file(Gmail.cookie, { description: NOISE, barangay: 'Ortega Compound' })).body.code === 'INCIDENT_LOCATION_INCOMPLETE');
    ok('16. direct API: a barangay street but another barangay named - refused as outside', (await file(Gmail.cookie, { description: NOISE, barangay: 'Ortega Compound', ...INCIDENT, incidentBarangay: 'Taal' })).body.code === 'OUTSIDE_JURISDICTION');
    ok('16. direct API: "verified" fields in a residency request are refused', (await put(Out.cookie, { ...HOME, residencyStatus: 'VERIFIED' })).status === 403);
    const el = await json(await eligPOST(req('/api/resident/eligibility', Gmail.cookie, 'POST', { incident: { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Taal', street: 'X' } })));
    ok('the eligibility answer for the form: the structured fields, from the server', el.status === 200 && el.body.data.incident_location_status === 'OUTSIDE' && el.body.data.referral_required === true
      && el.body.data.requires_human_review === false && el.body.data.ai_used === false);

    // ── 15. Who may change a verification ──
    console.log('\n15, 17. Changing a verification');
    ok('15. a blotter officer cannot edit a resident record (403)', (await json(await residentAdminPUT(req(`/api/residents/${Out.id}`, BLO.cookie, 'PUT', { status: 'Active' }), { params: Promise.resolve({ id: Out.id }) }))).status === 403);
    ok('15. the captain cannot set residency there either (403)', (await json(await residentAdminPUT(req(`/api/residents/${Out.id}`, CAP.cookie, 'PUT', { residencyStatus: 'VERIFIED' }), { params: Promise.resolve({ id: Out.id }) }))).status === 403);
    let dbRefused = false;
    try { await prisma.resident.update({ where: { id: Out.id }, data: { residencyStatus: 'VERIFIED' } }); } catch { dbRefused = true; }
    ok('15. the database refuses "Verified" without the verifier and the date', dbRefused);
    ok('15. a resident cannot change the address through the profile route', (await json(await mePATCH(req('/api/auth/resident-me', Out.cookie, 'PATCH', { address: 'Elsewhere' })))).status === 400);
    const s17 = await put(Gmail.cookie, { ...HOME, street: 'J.P. Rizal St.', latitude: C.lat, longitude: C.lng, locationSource: 'MAP' });
    const g17 = await getRes(Gmail.cookie);
    ok('17. a verified resident who changes the address is no longer verified until checked again', s17.status === 200 && g17.residency.status === 'INCOMPLETE'
      && (await file(Gmail.cookie, { description: NOISE, barangay: 'Ortega Compound', ...INCIDENT })).status === 403
      && await prisma.residencyEvent.count({ where: { residentId: Gmail.id, kind: 'address_changed' } }) >= 1);
    ok('17. ...resubmitted, it waits for an official again', (await put(Gmail.cookie, { ...HOME, street: 'J.P. Rizal St.', latitude: C.lat, longitude: C.lng, locationSource: 'MAP', submit: true })).status === 201
      && (await getRes(Gmail.cookie)).residency.status === 'PENDING_VERIFICATION');

    // ── The boundary configuration ──
    console.log('\nThe boundary configuration');
    ok('the desks cannot change the jurisdiction (403)', (await json(await jurPUT(req('/api/jurisdiction', BLO.cookie, 'PUT', { boundary: square(0.005), boundarySource: 'x' })))).status === 403);
    ok('a boundary without its source is refused', (await json(await jurPUT(req('/api/jurisdiction', SYS.cookie, 'PUT', { boundary: square(0.005) })))).status === 400);
    const setB = await json(await jurPUT(req('/api/jurisdiction', SYS.cookie, 'PUT', { boundary: square(0.005), boundarySource: 'PROBE test square (not official)' })));
    forgetJurisdiction();
    const after = (await getRes(Gmail.cookie));
    ok('the administrator sets a boundary; checks use it at once', setB.status === 200 && after.jurisdiction.boundaryConfigured === true && after.check.boundary === 'INSIDE'
      && (await json(await jurGET(req('/api/jurisdiction', CAP.cookie)))).body.data.boundarySource === 'PROBE test square (not official)');
  } finally {
    // The jurisdiction exactly as it was (no row: none).
    if (savedConfig) await prisma.jurisdictionConfig.update({ where: { id: 'default' }, data: { barangay: savedConfig.barangay, barangayAliases: savedConfig.barangayAliases,
      municipality: savedConfig.municipality, province: savedConfig.province, boundary: savedConfig.boundary ?? undefined, boundarySource: savedConfig.boundarySource, updatedById: savedConfig.updatedById } });
    else await prisma.jurisdictionConfig.deleteMany({ where: { id: 'default' } });
    forgetJurisdiction();
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }, { entityId: { in: residents } }, { entityType: 'JurisdictionConfig', userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.jurisdictionReferral.deleteMany({ where: { residentId: { in: residents } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: [...caseIds, ...residents] } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed, the jurisdiction as it was', await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.rs.' } } }) === 0
    && (savedConfig ? true : await prisma.jurisdictionConfig.count() === 0));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
