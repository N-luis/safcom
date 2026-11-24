/**
 * Automatic incident jurisdiction detection and referrals - the specification's
 * 15 test scenarios, through the real routes and the real database, in-process.
 * Run with:  npm run test:incidentreferral
 *
 * Needs prisma/sql/028 applied. The AI is turned off for the run (no Groq
 * call): the jurisdiction decision never uses it. Uses the configured
 * boundary when there is one; otherwise a test square around the Barangay
 * Hall is set for the run and the configuration put back afterwards.
 * Temporary rows are marked PROBE-IR and removed at the end. Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createCanvas } from '@napi-rs/canvas';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { checkLocation, incidentOutcome, type JurisdictionConfig } from '../lib/jurisdiction';
import { forgetJurisdiction, loadJurisdiction } from '../lib/jurisdictionServer';
import { pointForStreet } from '../lib/streetPoints';
import { BARANGAY_STREETS } from '../lib/streets';
import { POST as filePOST, GET as myCasesGET } from '../app/api/resident/cases/route';
import { GET as myRefGET } from '../app/api/resident/referrals/route';
import { GET as staffRefGET, PATCH as staffRefPATCH } from '../app/api/residency/referrals/route';
import { GET as refPhotoGET } from '../app/api/residency/referrals/[id]/attachments/[aid]/route';
import { GET as jurPublicGET } from '../app/api/registration/jurisdiction/route';
import { VERIFIED_RESIDENT } from './residencyFixtures';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-IR';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };

/** The Biñang 2nd Barangay Hall (inside the boundary), a point in Bunlo and one in Granville past the PNR (both outside). */
const HALL = { lat: 14.795956, lng: 120.9297673 };
const BUNLO = { lat: 14.790123, lng: 120.932042 };
const GRANVILLE = { lat: 14.8053472, lng: 120.9295381 };
const square = (d: number) => ({ type: 'Polygon' as const, coordinates: [[[HALL.lng - d, HALL.lat - d], [HALL.lng + d, HALL.lat - d], [HALL.lng + d, HALL.lat + d], [HALL.lng - d, HALL.lat + d], [HALL.lng - d, HALL.lat - d]]] });
const IN = { incidentProvince: 'Bulacan', incidentMunicipality: 'Bocaue', incidentBarangay: 'Biñang 2nd' };
const NOISE = (n: string) => `Fictional ${n}: malakas na videoke ng kapitbahay tuwing gabi hanggang alas-dos ng madaling araw, hindi kami makatulog. (${TAG} ${process.pid})`;
const VAWC = `Fictional: sinasaktan po ng asawa niya ang kapitbahay naming babae. Kagabi sinampal niya siya at sinabing papatayin niya kapag umalis siya ng bahay. (${TAG} ${process.pid})`;
const jpeg = (hue: number) => {
  const c = createCanvas(64, 48); const g = c.getContext('2d');
  g.fillStyle = `hsl(${hue},60%,50%)`; g.fillRect(0, 0, 64, 48);
  return `data:image/jpeg;base64,${c.toBuffer('image/jpeg').toString('base64')}`;
};

async function main() {
  process.env.AI_ENABLED = 'false';
  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = []; const refIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const savedConfig = await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } });
  const casesBefore = await prisma.case.count();
  const otherRefsBefore = await prisma.jurisdictionReferral.count();
  try {
    // A boundary is needed for the geographic checks: the configured one, or a test square for this run.
    forgetJurisdiction();
    let cfg = await loadJurisdiction(true);
    if (!cfg.boundary) {
      await prisma.jurisdictionConfig.upsert({ where: { id: 'default' }, update: { boundary: square(0.004), boundarySource: `${TAG} test square (not official)` },
        create: { id: 'default', barangay: 'Biñang 2nd', barangayAliases: cfg.barangayAliases, municipality: 'Bocaue', province: 'Bulacan', boundary: square(0.004), boundarySource: `${TAG} test square (not official)` } });
      forgetJurisdiction(); cfg = await loadJurisdiction(true);
    }
    const C: JurisdictionConfig = cfg;

    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.ir.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const CAP = await mk('captain', 'admin');
    const BLO = await mk('blotter', 'officer');
    const VAW = await mk('vawc', 'vawc_officer');
    const SYS = await mk('sysadmin', 'system_admin');
    let n = 0;
    const mkRes = async (first: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-${++n}`, firstName: first, lastName: 'Fictional', age: 30, gender: 'Female',
        barangay: 'Biñang 2nd', address: 'Fictional', contactNumber: '09170000000', emailVerified: true, ...VERIFIED_RESIDENT } as never });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const A = await mkRes('Ana');
    const B = await mkRes('Bea');
    const file = async (cookie: string, body: Body) => {
      const r = await json(await filePOST(req('/api/resident/cases', cookie, 'POST', body)));
      if (r.body.data?.caseNumber && r.body.data?.id) caseIds.push(r.body.data.id);
      if (r.body.data?.referral?.id) refIds.push(r.body.data.referral.id);
      return r;
    };
    const act = (cookie: string, body: Body) => staffRefPATCH(req('/api/residency/referrals', cookie, 'PATCH', body)).then(json);
    const detail = (cookie: string, id: string) => staffRefGET(req(`/api/residency/referrals?id=${id}`, cookie)).then(json);
    const casesOf = (residentId: string) => prisma.case.count({ where: { residentId } });

    // ── The rules (pure: the same function the form runs as the resident types) ──
    console.log('\nThe rules');
    const pure = (i: Body) => checkLocation({ province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', ...i }, C, 'incident');
    ok('a boundary is configured for the run', Boolean(C.boundary));
    ok('every street point on the barangay list lies inside the boundary (the street map never drops a pin outside)',
      (BARANGAY_STREETS as readonly string[]).every(s => { const p = pointForStreet(s); return !p || pure({ street: s, latitude: p.lat, longitude: p.lng }).boundary === 'INSIDE'; }));
    ok('the barangay and a pin inside: inside', pure({ street: 'J.P. Rizal St.', latitude: HALL.lat, longitude: HALL.lng }).status === 'INSIDE');
    ok('a street on the barangay\'s own list, no pin: inside (the trusted street list)', pure({ street: 'Ortega Compound' }).status === 'INSIDE');
    const s5 = pure({ street: 'J.P. Rizal St.', latitude: BUNLO.lat, longitude: BUNLO.lng });
    ok('5. the barangay named, the pin outside the boundary: the mismatch is detected - verification, not inside', s5.status === 'NEEDS_REVIEW' && s5.flags.includes('PIN_OUTSIDE_BOUNDARY') && incidentOutcome(s5) === 'LOCATION_VERIFICATION');
    const s6a = pure({ street: 'G. Cruz Street', latitude: GRANVILLE.lat, longitude: GRANVILLE.lng });
    const s6b = pure({ barangay: 'Turo', street: 'G. Cruz Street', latitude: GRANVILLE.lat, longitude: GRANVILLE.lng });
    ok('6. a street outside Biñang 2nd picked on the map: never inside (verification when the barangay says otherwise, a referral when it agrees)',
      incidentOutcome(s6a) === 'LOCATION_VERIFICATION' && incidentOutcome(s6b) === 'REFERRAL');
    const before7 = pure({ street: 'J.P. Rizal St.', latitude: HALL.lat, longitude: HALL.lng });
    const after7 = pure({ barangay: 'Taal', street: 'Fictional St' });
    const back7 = pure({ street: 'J.P. Rizal St.', latitude: HALL.lat, longitude: HALL.lng });
    ok('7. a location changed after the referral appeared: recalculated each time (case -> referral -> case)',
      incidentOutcome(before7) === 'CASE' && incidentOutcome(after7) === 'REFERRAL' && incidentOutcome(back7) === 'CASE');
    const s8 = pure({ street: 'Purok Fictional Sampaguita' });
    ok('8. an unverified street, no pin: verification requested, nothing guessed', s8.status === 'NEEDS_REVIEW' && s8.flags.includes('STREET_NOT_ON_RECORD') && s8.flags.includes('LOCATION_UNVERIFIED'));
    ok('8. a landmark alone, no street and no pin: verification', pure({ details: 'near the chapel' }).status === 'NEEDS_REVIEW');
    ok('another barangay with the pin inside ours: a contradiction for a person - never "outside" or "inside" by itself',
      pure({ barangay: 'Biñang 1st', street: 'X', latitude: HALL.lat, longitude: HALL.lng }).status === 'NEEDS_REVIEW');
    const pub = await json(await jurPublicGET());
    ok('the form gets the same jurisdiction to check against (names, spellings, boundary - public geography only)',
      pub.status === 200 && Array.isArray(pub.body.data.barangayAliases) && pub.body.data.boundaryConfigured === true && !('boundarySource' in pub.body.data));

    // ── 1 and 10. Inside: the normal report, unchanged ──
    console.log('\n1, 10. Inside the jurisdiction');
    const before1 = await casesOf(A.id);
    const f1 = await file(A.cookie, { description: NOISE('inside'), intakeNarrative: NOISE('inside'), barangay: 'J.P. Rizal St.', ...IN, latitude: HALL.lat, longitude: HALL.lng, submissionKey: `${TAG}-in-${process.pid}` });
    ok('1/10. Biñang 2nd, a verified street, the pin inside: filed as a SafeComm case', f1.status === 201 && /^SC-/.test(f1.body.data?.caseNumber ?? '') && !f1.body.data?.referral, `${f1.status} ${f1.body.error ?? ''}`);
    const c1 = f1.body.data?.id ? await prisma.case.findUnique({ where: { id: f1.body.data.id }, include: { intake: true } }) : null;
    ok('10. ...with the intake reading, the category and the desk as before', Boolean(c1?.intake) && Boolean(c1?.caseType) && (await casesOf(A.id)) === before1 + 1);
    const mine = await json(await myCasesGET(req('/api/resident/cases', A.cookie)));
    ok('10. ...and it shows in My Cases', JSON.stringify(mine.body).includes(f1.body.data?.caseNumber ?? '!!'));

    // ── 2, 3, 4, 9, 11. Outside: a referral, not a case ──
    console.log('\n2-4, 9, 11. Outside the jurisdiction');
    const beforeOut = await casesOf(A.id);
    const f2 = await file(A.cookie, { description: NOISE('Taal'), barangay: 'Fictional St', ...IN, incidentBarangay: 'Taal' });
    ok('2. another barangay in Bocaue: a referral, automatically', f2.status === 201 && f2.body.data.outcome === 'REFERRAL' && f2.body.data.referral.kind === 'OUTSIDE_JURISDICTION'
      && /^REF-\d{4}-\d{4}$/.test(f2.body.data.referral.referenceNumber ?? ''), `${f2.status} ${JSON.stringify(f2.body).slice(0, 200)}`);
    ok('2. ...with the reason and the validation result written by the server', /outside the authorized jurisdiction of Barangay Biñang 2nd, Bocaue, Bulacan/.test(f2.body.data.referral.reason ?? '')
      && /another barangay/.test(f2.body.data.referral.validationResult ?? ''));
    const f3 = await file(A.cookie, { description: NOISE('Marilao'), barangay: 'Fictional St', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin' });
    ok('3. another municipality: a referral', f3.status === 201 && f3.body.data.outcome === 'REFERRAL' && /municipality/.test(f3.body.data.referral.reason));
    const f4 = await file(A.cookie, { description: NOISE('Pampanga'), barangay: 'Fictional St', incidentProvince: 'Pampanga', incidentMunicipality: 'San Fernando', incidentBarangay: 'Dolores' });
    ok('4. another province: a referral', f4.status === 201 && f4.body.data.outcome === 'REFERRAL' && /province/.test(f4.body.data.referral.reason));
    ok('2-4. ...and no case was created for any of them', (await casesOf(A.id)) === beforeOut);
    const f9 = await file(A.cookie, {
      description: NOISE('with details'), intakeNarrative: NOISE('with details'), barangay: 'Fictional Ave', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin',
      incidentLocationDetails: 'Fictional: near the chapel', incidentDate: '2026-11-20', incidentTimeApprox: 'Morning (6 AM - 12 NN)', witnessInfo: 'Fictional: a neighbour heard it',
      reportingRelationship: 'THIRD_PARTY', affectedPersonNote: 'My fictional neighbour',
      affectedParty: { fullName: 'Fictional Lola', relationship: 'Neighbour' }, reportedParty: { fullName: 'Fictional Person' },
      residentOriginalNarrative: 'Fictional: my own words', narrativeAssist: 'EDITED',
      attachments: [{ name: 'gate.jpg', dataUrl: jpeg(30) }], submissionKey: `${TAG}-out9-${process.pid}`,
    });
    const r9 = f9.body.data?.referral?.id ? await prisma.jurisdictionReferral.findUnique({ where: { id: f9.body.data.referral.id }, include: { attachments: true, events: true } }) : null;
    const p9 = (r9?.reportPayload ?? {}) as Body;
    ok('9. an outside report: a referral record with everything already entered (description, date and time, place, people, the organized narrative, photos)',
      f9.status === 201 && r9?.summary?.includes('with details') === true && r9?.incidentTimeApprox === 'Morning (6 AM - 12 NN)' && r9?.locationDetails === 'Fictional: near the chapel'
      && p9.affectedParty?.fullName === 'Fictional Lola' && p9.reportedParty?.fullName === 'Fictional Person' && p9.witnessInfo === 'Fictional: a neighbour heard it'
      && r9?.residentOriginalNarrative === 'Fictional: my own words' && r9?.narrativeAssist === 'EDITED' && r9?.attachments.length === 1 && !('attachments' in p9), `${f9.status} ${f9.body.error ?? ''}`);
    ok('9. ...its creation is in the history, with the location check as it stood', r9?.events.length === 1 && r9.events[0].kind === 'created' && Boolean((r9.events[0].snapshot as Body)?.check));
    ok('11. a third-party reporter, incident outside: referred on the incident place, the reporter kept apart from the person affected',
      r9?.reportingRelationship === 'THIRD_PARTY' && r9?.kind === 'OUTSIDE_JURISDICTION');
    const again9 = await file(A.cookie, { description: NOISE('with details'), barangay: 'Fictional Ave', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin', submissionKey: `${TAG}-out9-${process.pid}` });
    ok('a retry with the same submission key: the same referral, never a second one', again9.status === 200 && again9.body.data.referral.id === r9?.id);
    const capNote = await prisma.notification.findFirst({ where: { userId: CAP.id, title: { contains: f9.body.data?.referral?.referenceNumber ?? '!!' } } });
    ok('9. the captain is notified - without what it says', Boolean(capNote) && !/videoke|Lola/.test(capNote?.message ?? ''));
    ok('emergency guidance comes with every referral (configured numbers only), and no office is said to have accepted it',
      Array.isArray(f9.body.data.emergencyContacts) && f9.body.data.guidance.some((g: string) => /no other office has accepted it/.test(g)));

    // ── 5, 8. Uncertain: held for verification ──
    console.log('\n5, 8. Uncertain locations');
    const before5 = await casesOf(B.id);
    const f5 = await file(B.cookie, { description: NOISE('pin outside'), intakeNarrative: NOISE('pin outside'), barangay: 'J.P. Rizal St.', ...IN, latitude: BUNLO.lat, longitude: BUNLO.lng });
    ok('5. Biñang 2nd chosen, the pin outside the boundary: held for verification - not a case, not "outside"',
      f5.status === 201 && f5.body.data.outcome === 'LOCATION_VERIFICATION' && f5.body.data.referral.status === 'FOR_VERIFICATION' && (await casesOf(B.id)) === before5);
    const f8 = await file(B.cookie, { description: NOISE('unknown street'), intakeNarrative: NOISE('unknown street'), barangay: 'Purok Fictional Sampaguita', ...IN,
      attachments: [{ name: 'corner.jpg', dataUrl: jpeg(200) }], affectedParty: { fullName: 'Fictional Kid' } });
    ok('8. an unverified street: held for verification', f8.status === 201 && f8.body.data.outcome === 'LOCATION_VERIFICATION');

    // ── 12. VAWC outside: confidential ──
    console.log('\n12. A VAWC concern outside the jurisdiction');
    const f12 = await file(B.cookie, { description: VAWC, intakeNarrative: VAWC, barangay: 'Fictional St', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin', reportingRelationship: 'THIRD_PARTY' });
    const r12 = await prisma.jurisdictionReferral.findUnique({ where: { id: f12.body.data?.referral?.id ?? '' } });
    ok('12. kept confidential (the rules read a possible VAWC concern)', f12.status === 201 && r12?.confidential === true && r12?.recommendedDesk === 'VAWC', JSON.stringify({ c: r12?.confidential, d: r12?.recommendedDesk }));
    const capList = await json(await staffRefGET(req('/api/residency/referrals?status=ALL', CAP.cookie)));
    const vawList = await json(await staffRefGET(req('/api/residency/referrals?status=ALL', VAW.cookie)));
    const ids = (l: Body) => (l.body.data?.rows ?? []).map((x: Body) => x.id) as string[];
    ok('12. the captain sees every referral; the VAWC desk only the confidential ones', ids(capList).includes(r12?.id ?? '!') && ids(capList).includes(f2.body.data.referral.id)
      && ids(vawList).includes(r12?.id ?? '!') && !ids(vawList).includes(f2.body.data.referral.id));
    ok('12. the blotter desk and the system administrator see none (403), and cannot open one by id',
      (await json(await staffRefGET(req('/api/residency/referrals', BLO.cookie)))).status === 403 && (await json(await staffRefGET(req('/api/residency/referrals', SYS.cookie)))).status === 403
      && (await detail(BLO.cookie, r12?.id ?? '')).status === 403);
    ok('12. the VAWC desk cannot open a non-confidential referral either (not found)', (await detail(VAW.cookie, f2.body.data.referral.id)).status === 404);
    const vawNote = await prisma.notification.findFirst({ where: { userId: VAW.id, title: { contains: r12?.referenceNumber ?? '!!' } } });
    ok('12. the VAWC desk is told of the confidential one - never of the others', Boolean(vawNote)
      && !(await prisma.notification.findFirst({ where: { userId: VAW.id, title: { contains: f2.body.data.referral.referenceNumber } } })));
    const d9 = await detail(CAP.cookie, r9?.id ?? '');
    const photoId = d9.body.data?.attachments?.[0]?.id ?? '';
    const ph = await refPhotoGET(req(`/api/residency/referrals/${r9?.id}/attachments/${photoId}`, CAP.cookie), { params: Promise.resolve({ id: r9?.id ?? '', aid: photoId }) });
    const phBlo = await refPhotoGET(req(`/api/residency/referrals/${r9?.id}/attachments/${photoId}`, BLO.cookie), { params: Promise.resolve({ id: r9?.id ?? '', aid: photoId }) });
    ok('the referral\'s photos: for those who may open it, never the blotter desk', ph.status === 200 && ph.headers.get('content-type') === 'image/jpeg' && phBlo.status === 404);

    // ── 13. Bypassing the form ──
    console.log('\n13. Direct API calls');
    const f13a = await file(A.cookie, { description: NOISE('bypass'), barangay: 'Fictional St', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin', isWithinJurisdiction: true });
    ok('13. a client that says "within the jurisdiction" is refused outright', f13a.status === 400 && /isWithinJurisdiction/.test(f13a.body.error ?? ''));
    const f13b = await file(A.cookie, { description: NOISE('bypass 2'), barangay: 'Fictional St', incidentProvince: 'Bulacan', incidentMunicipality: 'Marilao', incidentBarangay: 'Lambakin', outcome: 'CASE' });
    ok('13. ...and one that names the outcome', f13b.status === 400);
    const before13 = await casesOf(A.id);
    const f13c = await file(A.cookie, { description: NOISE('bypass 3'), barangay: 'Ortega Compound', ...IN, incidentBarangay: 'Taal', latitude: BUNLO.lat, longitude: BUNLO.lng });
    ok('13. an outside place sent straight to the API (with one of our street names): still a referral, not a case', f13c.status === 201 && f13c.body.data.outcome === 'REFERRAL' && (await casesOf(A.id)) === before13);

    // ── 14. Officials act; residents see only what is meant for them ──
    console.log('\n14. Status updates');
    const id2 = f2.body.data.referral.id as string;
    ok('14. "Referred" cannot be set by hand without the forwarding record', (await act(CAP.cookie, { id: id2, action: 'status', status: 'REFERRED' })).status === 400);
    ok('14. an acknowledgment cannot be recorded before it was forwarded', (await act(CAP.cookie, { id: id2, action: 'acknowledged', note: 'Fictional' })).status === 400);
    ok('14. the captain marks it ready, with a message for the reporter', (await act(CAP.cookie, { id: id2, action: 'status', status: 'READY_FOR_REFERRAL', note: 'Fictional internal: checked with the reporter', residentMessage: 'We will refer this to Barangay Taal.' })).status === 200);
    ok('14. ...records the receiving office and that it was forwarded', (await act(CAP.cookie, { id: id2, action: 'forwarded', receivingOffice: 'Barangay Taal, Bocaue (fictional desk)', note: 'Fictional: sent by hand' })).status === 200);
    ok('14. ...a forwarding date in the future is refused', (await act(CAP.cookie, { id: id2, action: 'forwarded', receivingOffice: 'X office', forwardedAt: '2099-01-01', note: 'Fictional' })).status === 400);
    const ack = await act(CAP.cookie, { id: id2, action: 'acknowledged', note: 'Fictional: their secretary confirmed receipt by phone', residentMessage: 'Barangay Taal confirmed they received it.' });
    const r14 = await prisma.jurisdictionReferral.findUnique({ where: { id: id2 } });
    ok('14. ...and the acknowledgment, only when recorded', ack.status === 200 && r14?.status === 'ACKNOWLEDGED' && Boolean(r14?.acknowledgedAt) && Boolean(r14?.forwardedAt));
    ok('14. a blotter officer cannot change a referral', (await act(BLO.cookie, { id: id2, action: 'note', note: 'Fictional' })).status === 403);
    const my = await json(await myRefGET(req('/api/resident/referrals', A.cookie)));
    const mine2 = (my.body.data as Body[]).find(x => x.id === id2);
    const txt2 = JSON.stringify(mine2 ?? {});
    ok('14. the resident sees the reference, place, reason, status and the messages meant for them', Boolean(mine2) && mine2?.referenceNumber === f2.body.data.referral.referenceNumber
      && mine2?.statusLabel === 'Acknowledged by Receiving Office' && /Barangay Taal confirmed/.test(txt2) && /We will refer this/.test(txt2) && /outside the authorized jurisdiction/.test(mine2?.reason ?? ''));
    ok('14. ...never the internal notes, the receiving office record or anyone else\'s referral', !/Fictional internal|secretary|fictional desk/.test(txt2)
      && !('receivingOffice' in (mine2 ?? {})) && !(my.body.data as Body[]).some(x => x.id === r12?.id));
    let dbAck = false;
    try { await prisma.jurisdictionReferral.update({ where: { id: f3.body.data.referral.id }, data: { status: 'ACKNOWLEDGED' } }); } catch { dbAck = true; }
    ok('14. the database itself refuses "Acknowledged" without the recorded acknowledgment', dbAck);
    let dbEvent = false;
    try { await prisma.jurisdictionReferralEvent.updateMany({ where: { referralId: id2 }, data: { note: 'rewritten' } }); } catch { dbEvent = true; }
    ok('the referral history cannot be rewritten (insert-only)', dbEvent);
    ok('every action is in the audit log', await prisma.activity.count({ where: { entityType: 'JurisdictionReferral', entityId: id2, type: 'referral_updated' } }) >= 3);

    // ── 7 (server). A location corrected after the referral: checked again, the old decision kept ──
    console.log('\n7. Re-checking a corrected location');
    const id3 = f3.body.data.referral.id as string;
    const re = await act(CAP.cookie, { id: id3, action: 'relocate', note: 'Fictional: the reporter called - it was on J.P. Rizal St. by the hall',
      location: { province: 'Bulacan', municipality: 'Bocaue', barangay: 'Biñang 2nd', street: 'J.P. Rizal St.', latitude: HALL.lat, longitude: HALL.lng } });
    const r7 = await prisma.jurisdictionReferral.findUnique({ where: { id: id3 }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    const ev7 = r7?.events.find(e => e.kind === 'location_rechecked');
    ok('7. the server checks the corrected place again: now inside, so it waits for an official to file it as a case',
      re.status === 200 && re.body.data.outcome === 'CASE' && r7?.kind === 'LOCATION_VERIFICATION' && r7?.status === 'FOR_VERIFICATION');
    ok('7. ...and the earlier decision stays in the history', (ev7?.snapshot as Body)?.before?.kind === 'OUTSIDE_JURISDICTION' && (ev7?.snapshot as Body)?.before?.municipality === 'Marilao');

    // ── Verification decisions ──
    console.log('\nVerification decisions');
    const id5 = f5.body.data.referral.id as string;
    ok('a record waiting for verification cannot be forwarded on', (await act(CAP.cookie, { id: id5, action: 'forwarded', receivingOffice: 'X office', note: 'Fictional' })).status === 400);
    const co = await act(CAP.cookie, { id: id5, action: 'confirm_outside', note: 'Fictional: the pin was right - it was in Bunlo' });
    const r5 = await prisma.jurisdictionReferral.findUnique({ where: { id: id5 } });
    ok('an official confirms the place outside: it becomes a referral (pending review)', co.status === 200 && r5?.kind === 'OUTSIDE_JURISDICTION' && r5?.status === 'PENDING_REVIEW');
    const id8 = f8.body.data.referral.id as string;
    const fc = await act(CAP.cookie, { id: id8, action: 'file_as_case', note: 'Fictional: Purok Sampaguita is in Biñang 2nd (checked with the purok leader)' });
    if (fc.body.data?.caseId) caseIds.push(fc.body.data.caseId);
    const c8 = fc.body.data?.caseId ? await prisma.case.findUnique({ where: { id: fc.body.data.caseId }, include: { intake: true, attachments: true, parties: true } }) : null;
    const r8 = await prisma.jurisdictionReferral.findUnique({ where: { id: id8 } });
    ok('an official confirms the place inside: filed as the SafeComm case it would have been - the same pipeline, photos and people included',
      fc.status === 200 && Boolean(c8?.intake) && c8?.attachments.length === 1 && c8?.parties.some(p => p.fullName === 'Fictional Kid') === true && c8?.residentId === B.id, `${fc.status} ${fc.body.error ?? ''}`);
    ok('...the referral is closed and linked to the case', r8?.status === 'CLOSED' && r8?.caseId === c8?.id);
    const myB = await json(await myRefGET(req('/api/resident/referrals', B.cookie)));
    ok('...and the resident is told the case number', ((myB.body.data as Body[]).find(x => x.id === id8)?.updates ?? []).some((u: Body) => u.message.includes(c8?.caseNumber ?? '!!')));
    ok('a closed record cannot be filed twice', (await act(CAP.cookie, { id: id8, action: 'file_as_case', note: 'Fictional again' })).status === 409);
    ok('a record already confirmed outside is not filed as a case', (await act(CAP.cookie, { id: id5, action: 'file_as_case', note: 'Fictional' })).status === 400);
    ok('the VAWC desk may act on the confidential one it sees', (await act(VAW.cookie, { id: r12?.id ?? '', action: 'note', note: 'Fictional: VAWC desk reviewed' })).status === 200);

    // ── 15. Nothing else touched ──
    console.log('\n15. Existing records');
    ok('15. cases outside this run are unchanged in number', (await prisma.case.count()) - caseIds.length === casesBefore, `${await prisma.case.count()} - ${caseIds.length} vs ${casesBefore}`);
  } finally {
    if (savedConfig) await prisma.jurisdictionConfig.update({ where: { id: 'default' }, data: { boundary: savedConfig.boundary ?? undefined, boundarySource: savedConfig.boundarySource } });
    else await prisma.jurisdictionConfig.deleteMany({ where: { id: 'default' } });
    forgetJurisdiction();
    const refs = await prisma.jurisdictionReferral.findMany({ where: { residentId: { in: residents } }, select: { id: true } });
    const allRefIds = [...new Set([...refIds, ...refs.map(r => r.id)])];
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }, { entityId: { in: [...allRefIds, ...residents] } }] } });
    await prisma.jurisdictionReferral.deleteMany({ where: { id: { in: allRefIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed, other referrals untouched, the jurisdiction as it was', await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.ir.' } } }) === 0 && await prisma.jurisdictionReferral.count() === otherRefsBefore
    && (savedConfig ? JSON.stringify((await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' } }))?.boundary) === JSON.stringify(savedConfig.boundary) : await prisma.jurisdictionConfig.count() === 0));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
