/**
 * Duplicate and related case detection - the specification's 16 test
 * scenarios, through the rules, the real database and the real routes,
 * in-process. Run with:  npm run test:casematching
 *
 * Needs prisma/sql/024 applied. The AI is turned off for the run, so every
 * result is the database comparison and the rules (scenario 8 is exactly
 * that: Groq unavailable); the AI's answer is tested through its validator
 * (scenario 7). Temporary rows are marked PROBE-CM and removed at the end.
 * Fictional data only.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import {
  indicatorsOf, conflictsOf, ruleClassification, validateAiPair, finalClassification, matchingEstimate, ruleExplanation, caseMatchLabel, pairKey,
  type PairEvidence,
} from '../lib/caseMatching';
import { detectForCase, matchAccess, matchLabels, residentPrecheck } from '../lib/caseMatchingServer';
import { residentNotice } from '../lib/notifications';
import { GET as matchesGET, POST as matchesPOST } from '../app/api/cases/[id]/matches/route';
import { POST as precheckPOST } from '../app/api/resident/cases/duplicate-check/route';
import { POST as filePOSTRaw } from '../app/api/resident/cases/route';
import { GET as casesGET } from '../app/api/cases/route';
import { GET as vawcCasesGET } from '../app/api/vawc/cases/route';
import { GET as updatesGET } from '../app/api/resident/updates/route';
import { VERIFIED_RESIDENT, inBarangay } from './residencyFixtures';

const filePOST = inBarangay(filePOSTRaw);
let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-CM';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const ev = (e: Partial<PairEvidence>): PairEvidence => ({ narrativeSimilarity: 0, dayGap: null, sameStreet: false, metres: null, peopleSimilarity: null, sameCategory: false, ...e });
const classify = (e: PairEvidence) => ruleClassification(indicatorsOf(e), conflictsOf(e));

// Fictional narratives, worded so nothing on file resembles them.
const THEFT = 'PROBE-CM Fictional: ninakaw ang pulang bisikleta ni Kuya Probert sa harap ng sari-sari store ni Aling Zenaida bandang alas-otso ng gabi; dalawang lalaking naka-itim na motor ang tumakas papuntang highway.';
const THEFT_AGAIN = 'PROBE-CM Fictional: ninakaw ang pulang bisikleta ni Kuya Probert sa harap ng tindahan ni Aling Zenaida mga alas-otso ng gabi; dalawang lalaki na naka-itim na motor ang tumakas papunta sa highway.';
const QUARREL = 'PROBE-CM Fictional: nagkasagutan sa basketball court tungkol sa utang na limandaang piso, nagbantang babalikan at sinipa ang gate ng bahay.';
const NOISE = 'PROBE-CM Fictional: malakas na karaoke ng kapitbahay hanggang alas-tres ng madaling araw tuwing Sabado, hindi makatulog ang may sakit na lola.';
const FLOOD = 'PROBE-CM Fictional: barado ang kanal sa kanto kaya umaapaw ang tubig-baha tuwing umuulan at pumapasok sa mga bahay sa looban.';
const VAWC_TEXT = 'PROBE-CM Fictional: sinasaktan ng kinakasama si Ate Probelyn tuwing lasing, may pasa sa braso at pinagbabantaang hindi siya bibigyan ng pera para sa mga anak.';
const PERSON = 'Probert Fictionado Dela Cruzon';
const OTHER_PERSON = 'Zandro Imaginario Pascualito';

async function main() {
  process.env.AI_ENABLED = 'false';
  const users: string[] = []; const residents: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── The rules (pure) ──
    console.log('\nThe rules');
    ok('1. the same story, day, street and person: Potential Duplicate', classify(ev({ narrativeSimilarity: 0.8, dayGap: 0, sameStreet: true, peopleSimilarity: 1, sameCategory: true })) === 'POTENTIAL_DUPLICATE');
    ok('2. the same story, same street, 20 days apart: related at most, never a duplicate', classify(ev({ narrativeSimilarity: 0.8, dayGap: 20, sameStreet: true, sameCategory: true })) === 'RELATED_CASE');
    ok('3. other words, other day, the same person: Related Case', classify(ev({ narrativeSimilarity: 0.1, dayGap: 10, peopleSimilarity: 1, sameCategory: true })) === 'RELATED_CASE');
    ok('4. the same story, same day, another street far away: not a duplicate', classify(ev({ narrativeSimilarity: 0.8, dayGap: 0, differentStreet: true, metres: 2000, sameCategory: true })) !== 'POTENTIAL_DUPLICATE');
    ok('5. the same street, unrelated stories: No Match', classify(ev({ narrativeSimilarity: 0.08, dayGap: 0, sameStreet: true })) === 'NO_MATCH');
    ok('a name alone, an address alone, a category alone: never a duplicate (No Match)', classify(ev({ peopleSimilarity: 1 })) === 'NO_MATCH'
      && classify(ev({ sameStreet: true })) === 'NO_MATCH' && classify(ev({ sameCategory: true })) === 'NO_MATCH');
    ok('6. nothing in common: No Match', classify(ev({ narrativeSimilarity: 0.05, dayGap: 60 })) === 'NO_MATCH');
    const iDup = indicatorsOf(ev({ narrativeSimilarity: 0.8, dayGap: 0, sameStreet: true, peopleSimilarity: 1, sameCategory: true }));
    const est = matchingEstimate(iDup);
    ok('the matching estimate is a number between 0 and 1 from the indicators (shown as an estimate)', est > 0.9 && est <= 1);
    const ex = ruleExplanation(indicatorsOf(ev({ narrativeSimilarity: 0.8, dayGap: null, sameStreet: true })), ev({ narrativeSimilarity: 0.8, dayGap: null, sameStreet: true }), 'POTENTIAL_DUPLICATE');
    ok('uncertainties are stated (a missing date, rules only)', ex.uncertainties.some(u => /no incident date/.test(u)) && ex.uncertainties.some(u => /person must check/.test(u)));

    console.log('\n7. Invalid AI JSON');
    const good = { classification: 'RELATED_CASE', similarity_indicators: { narrative: 'HIGH', incident_date: 'LOW', location: 'HIGH', people_involved: 'LOW', circumstances: 'MEDIUM' },
      matching_information: ['Same street'], differences: ['Different day'], explanation: 'Similar stories on different days.', uncertainties: [], requires_human_review: false };
    ok('7. a valid answer passes - and requires_human_review is forced to true', validateAiPair(good)?.requires_human_review === true);
    ok('7. not JSON / wrong classification / bad indicator / missing field: refused (the rules stand)', validateAiPair('not json') === null && validateAiPair(null) === null
      && validateAiPair({ ...good, classification: 'MERGE' }) === null
      && validateAiPair({ ...good, similarity_indicators: { ...good.similarity_indicators, narrative: 'VERY_HIGH' } }) === null
      && validateAiPair({ ...good, explanation: undefined }) === null && validateAiPair({ ...good, differences: 'x' }) === null);
    ok('the AI can never make a match out of nothing, nor a duplicate the evidence rules out', finalClassification('NO_MATCH', 'POTENTIAL_DUPLICATE', iDup) === 'NO_MATCH'
      && finalClassification('RELATED_CASE', 'POTENTIAL_DUPLICATE', iDup, { datesDiffer: true, placesDiffer: false }) === 'RELATED_CASE'
      && finalClassification('POTENTIAL_DUPLICATE', 'NO_MATCH', iDup) === 'NO_MATCH');
    ok('case labels: Potential Duplicate first, No Match only after a check', caseMatchLabel(true, [{ status: 'PENDING_REVIEW', classification: 'POTENTIAL_DUPLICATE' }, { status: 'RELATED', classification: 'RELATED_CASE' }]) === 'POTENTIAL_DUPLICATE'
      && caseMatchLabel(true, []) === 'NO_MATCH' && caseMatchLabel(false, []) === null && caseMatchLabel(true, [{ status: 'NOT_DUPLICATE', classification: 'POTENTIAL_DUPLICATE' }]) === 'NOT_DUPLICATE');
    ok('who may see: a VAWC match only for the VAWC roles; deciding: the case\'s own desk and the captain', !matchAccess('officer', 'Domestic Violence').view
      && !matchAccess('system_admin', 'Domestic Violence').view && matchAccess('vawc_officer', 'Domestic Violence').review && matchAccess('officer', 'Theft').review
      && matchAccess('vawc_officer', 'Theft').view && !matchAccess('vawc_officer', 'Theft').review && matchAccess('admin', 'Domestic Violence').review && !matchAccess('resident', 'Theft').view);

    // ── People and cases ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.cm.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const CAP = await mk('captain', 'admin');
    const BLO = await mk('blotter', 'officer');
    const VAW = await mk('vawc', 'vawc_officer');
    const SYS = await mk('sysadmin', 'system_admin');
    let n = 0;
    const mkRes = async (first: string, verified = true) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}-${++n}`, firstName: first, lastName: 'Fictional', age: 30, gender: 'Female',
        barangay: 'Biñang 2nd', address: 'Fictional', contactNumber: '09170000000', emailVerified: true, ...(verified ? VERIFIED_RESIDENT : {}) } as never });
      residents.push(r.id);
      return { ...r, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: first, role: 'resident' })}` };
    };
    const R1 = await mkRes('Ana');
    const R2 = await mkRes('Bea');
    const R3 = await mkRes('Cora', false);
    const DAY = new Date('2026-10-20T00:00:00Z');
    const plus = (d: number) => new Date(DAY.getTime() + d * 86_400_000);
    let filed = Date.now() - 3_600_000;
    const mkCase = async (o: { resident: { id: string; firstName: string }; type: string; street: string; text: string; date: Date | null; person?: string }) => {
      const c = await prisma.case.create({ data: {
        caseNumber: `${TAG}-${process.pid}-${caseIds.length + 1}`, residentName: `${o.resident.firstName} Fictional`, residentId: o.resident.id, caseType: o.type,
        barangay: o.street, description: o.text, incidentDate: o.date, filedAt: new Date(filed += 60_000), status: 'Open',
      } });
      caseIds.push(c.id);
      if (o.person) await prisma.caseParty.create({ data: { caseId: c.id, role: 'REPORTED', fullName: o.person } });
      return c;
    };
    const match = (a: string, b: string) => prisma.caseMatch.findUnique({ where: { pairKey: pairKey(a, b) }, include: { events: true } });
    const getM = (id: string, cookie: string) => matchesGET(req(`/api/cases/${id}/matches`, cookie), { params: Promise.resolve({ id }) }).then(json);
    const postM = (id: string, cookie: string, body: Body) => matchesPOST(req(`/api/cases/${id}/matches`, cookie, 'POST', body), { params: Promise.resolve({ id }) }).then(json);
    const precheck = (cookie: string, body: Body) => precheckPOST(req('/api/resident/cases/duplicate-check', cookie, 'POST', body)).then(json);

    console.log('\n1. An exact duplicate');
    const A = await mkCase({ resident: R1, type: 'Theft', street: 'Ortega Compound', text: THEFT, date: DAY, person: PERSON });
    const B = await mkCase({ resident: R2, type: 'Theft', street: 'Ortega Compound', text: THEFT_AGAIN, date: DAY, person: PERSON });
    const aBefore = await prisma.case.findUnique({ where: { id: A.id } });
    const runB = await detectForCase(B.id, { useAi: false });
    const mAB = await match(A.id, B.id);
    ok('1. found: Potential Duplicate, Pending Review, one "detected" event, the database comparison only', mAB?.classification === 'POTENTIAL_DUPLICATE' && mAB.status === 'PENDING_REVIEW'
      && mAB.events.length === 1 && mAB.events[0].kind === 'detected' && mAB.analysis === 'RULES' && !runB.skipped);
    ok('1. what matches, what differs and what is uncertain are recorded', (mAB?.matchingInformation.length ?? 0) > 0 && (mAB?.uncertainties.length ?? 0) > 0 && Boolean(mAB?.explanation));
    const aAfter = await prisma.case.findUnique({ where: { id: A.id } });
    ok('1. neither case is changed by detection', JSON.stringify(aBefore) === JSON.stringify(aAfter));
    ok('1. the desk is told, in general words (no other case, no narrative)', await prisma.notification.count({ where: { caseId: B.id, title: { contains: 'Possible duplicate' }, NOT: { message: { contains: A.caseNumber } } } }) === 1);
    ok('a second check of the same case is not repeated (one scan per case)', (await detectForCase(B.id, { useAi: false })).skipped === true
      && await prisma.caseMatch.count({ where: { pairKey: pairKey(A.id, B.id) } }) === 1);

    console.log('\n2-6. Related, not a duplicate, no match');
    const C2 = await mkCase({ resident: R2, type: 'Theft', street: 'Ortega Compound', text: THEFT_AGAIN, date: plus(20) });
    await detectForCase(C2.id, { useAi: false });
    const mAC = await match(A.id, C2.id);
    ok('2. a similar report 20 days later on the same street: Related Case, not a duplicate', mAC?.classification === 'RELATED_CASE', mAC?.classification ?? 'none');
    const D3 = await mkCase({ resident: R1, type: 'Theft', street: 'J.P. Rizal St.', text: QUARREL, date: plus(10), person: PERSON });
    await detectForCase(D3.id, { useAi: false });
    const mAD = await match(A.id, D3.id);
    ok('3. a new incident with the same person: Related Case', mAD?.classification === 'RELATED_CASE', mAD?.classification ?? 'none');
    const E4 = await mkCase({ resident: R2, type: 'Theft', street: 'J.P. Rizal St.', text: THEFT_AGAIN, date: DAY });
    await detectForCase(E4.id, { useAi: false });
    const mAE = await match(A.id, E4.id);
    ok('4. a similar story the same day on another street: not a Potential Duplicate', mAE?.classification !== 'POTENTIAL_DUPLICATE', mAE?.classification ?? 'none');
    const F5 = await mkCase({ resident: R2, type: 'Noise Complaint', street: 'Ortega Compound', text: NOISE, date: DAY });
    await detectForCase(F5.id, { useAi: false });
    ok('5. the same street and day, an unrelated incident: no match recorded', (await match(A.id, F5.id)) === null);
    const G6 = await mkCase({ resident: R1, type: 'Other', street: 'J.P. Rizal St.', text: FLOOD, date: plus(-90) });
    await detectForCase(G6.id, { useAi: false });
    const scanG = await prisma.caseMatchScan.findUnique({ where: { caseId: G6.id } });
    ok('6. no match: the check is recorded as done, nothing paired with the test cases, label No Match Found',
      scanG?.status === 'DONE' && await prisma.caseMatch.count({ where: { OR: [{ caseId: G6.id }, { matchedCaseId: G6.id }] } }) === 0
      && (await matchLabels([G6.id], 'officer')).get(G6.id) === 'NO_MATCH');

    console.log('\n8. Groq unavailable');
    ok('8. with the AI unavailable the check still runs on the rules, and says so', scanG?.aiStatus === 'off' || scanG?.aiStatus === 'none');
    const H8 = await mkCase({ resident: R1, type: 'Theft', street: 'Ortega Compound', text: THEFT, date: DAY });
    const r8 = await detectForCase(H8.id, { useAi: true });   // AI asked for, AI_ENABLED=false: Groq is "off"
    const mAH = await match(A.id, H8.id);
    ok('8. AI asked for but unavailable: matches stored from the rules (analysis RULES), aiStatus "off"', !r8.skipped && r8.aiStatus === 'off' && mAH?.analysis === 'RULES'
      && mAH.classification === 'POTENTIAL_DUPLICATE', JSON.stringify(r8));

    console.log('\n9. A resident and other residents\' cases');
    const p9 = await precheck(R2.cookie, { description: THEFT, incidentDate: '2026-10-20', street: 'Ortega Compound', people: [PERSON] });
    const p9s = JSON.stringify(p9.body);
    ok('9. their own similar report is shown to them (reference, status, why)', p9.status === 200 && p9.body.data.own.some((o: Body) => o.id === B.id)
      && p9.body.data.result === 'POTENTIAL_DUPLICATE' && p9.body.data.message === 'We found a report that may be similar to your submission. Please review the information before continuing.');
    ok('9. another resident\'s report: only "may exist" - never its reference, words, people or status', !p9s.includes(A.caseNumber) && !p9s.includes(A.id)
      && !p9s.includes('Zenaida') && !p9s.includes('Ana') && p9.body.data.own.every((o: Body) => [B.id, C2.id, E4.id, F5.id].includes(o.id)));
    const p9b = await precheck(R3.cookie, { description: THEFT, street: 'Ortega Compound' });
    ok('9. an unverified account gets no check (403), and a resident cannot open officials\' match routes', p9b.status === 403
      && (await getM(A.id, R1.cookie)).status === 401 && (await postM(A.id, R1.cookie, { action: 'recheck' })).status === 401);
    const beforeCount = await prisma.caseMatch.count();
    await precheck(R1.cookie, { description: THEFT_AGAIN, incidentDate: '2026-10-20', street: 'Ortega Compound' });
    ok('9. the check before filing stores nothing', await prisma.caseMatch.count() === beforeCount);
    const pureOwn = await residentPrecheck(R1.id, { description: THEFT, caseType: null, incidentDate: DAY, street: 'Ortega Compound', latitude: null, longitude: null, partyNames: [] }, false);
    ok('9. their own earlier report found by the server function too', pureOwn.own.some(o => o.id === A.id));

    console.log('\n10-11. VAWC confidentiality');
    const V1 = await mkCase({ resident: R1, type: 'Domestic Violence', street: 'Ortega Compound', text: VAWC_TEXT, date: DAY, person: OTHER_PERSON });
    const V2 = await mkCase({ resident: R2, type: 'Domestic Violence', street: 'Ortega Compound', text: VAWC_TEXT, date: DAY, person: OTHER_PERSON });
    await detectForCase(V2.id, { useAi: false });
    const mV = await match(V1.id, V2.id);
    ok('10. the VAWC pair is found, on the VAWC desk', mV?.desk === 'VAWC' && mV.classification === 'POTENTIAL_DUPLICATE');
    ok('10. a blotter case is never paired with a VAWC case (the theft and the VAWC report share a street and day)', await prisma.caseMatch.count({ where: { OR: [
      { caseId: { in: [V1.id, V2.id] }, matchedCaseId: { notIn: [V1.id, V2.id] } }, { matchedCaseId: { in: [V1.id, V2.id] }, caseId: { notIn: [V1.id, V2.id] } }] } }) === 0);
    let crossRefused = false;
    try { await prisma.caseMatch.create({ data: { caseId: A.id, matchedCaseId: V1.id, pairKey: pairKey(A.id, V1.id), desk: 'BLOTTER', classification: 'RELATED_CASE', matchingEstimate: 0.5, indicators: {}, ruleIndicators: {}, evidence: {}, explanation: 'x', analysis: 'RULES' } }); }
    catch { crossRefused = true; }
    ok('10. the database itself refuses a blotter-VAWC pair', crossRefused);
    const b10 = await getM(V2.id, BLO.cookie);
    const s10 = await getM(V2.id, SYS.cookie);
    ok('10. a blotter officer and the system administrator: the VAWC case\'s matches are "not found"', b10.status === 404 && s10.status === 404 && !JSON.stringify(b10.body).includes(V1.caseNumber));
    ok('10. a blotter officer cannot decide a VAWC match through a blotter case', (await postM(A.id, BLO.cookie, { action: 'confirm_duplicate', matchId: mV!.id })).status === 404
      && (await prisma.caseMatch.findUnique({ where: { id: mV!.id } }))?.status === 'PENDING_REVIEW');
    const p10 = await precheck(R2.cookie, { description: VAWC_TEXT, incidentDate: '2026-10-20', street: 'Ortega Compound', people: [OTHER_PERSON] });
    ok('10. another resident\'s VAWC report is never even hinted at to a resident', p10.status === 200 && p10.body.data.otherReportMayExist === false
      && !JSON.stringify(p10.body).includes(V1.caseNumber));
    const v11 = await getM(V2.id, VAW.cookie);
    const m11 = v11.body.data?.matches?.find((m: Body) => m.other.id === V1.id);
    ok('11. a VAWC officer sees the VAWC match - reference, date, category, indicators, explanation, status - and may decide it', v11.status === 200 && v11.body.data.canReview === true
      && m11?.other.caseNumber === V1.caseNumber && m11.other.caseType === 'Domestic Violence' && m11.indicators.narrative === 'HIGH' && m11.statusLabel === 'Pending Review'
      && Boolean(m11.explanation) && Array.isArray(m11.differences) && Boolean(m11.detectedAt));
    ok('11. a VAWC officer may see a blotter case\'s matches but not decide them', (await getM(A.id, VAW.cookie)).body.data?.canReview === false
      && (await postM(A.id, VAW.cookie, { action: 'mark_related', matchId: mAB!.id })).status === 403);
    const vawcList = await json(await vawcCasesGET(req('/api/vawc/cases?limit=50', VAW.cookie)));
    ok('11. the VAWC case list labels the cases', vawcList.body.data?.cases?.find((c: Body) => c.id === V2.id)?.matchLabel === 'POTENTIAL_DUPLICATE');

    console.log('\n12. Confirm duplicate');
    const stale = await postM(B.id, BLO.cookie, { action: 'confirm_duplicate', matchId: mAB!.id, expectedStatus: 'FURTHER_REVIEW' });
    ok('12. a decision on a match someone else changed meanwhile is refused (409)', stale.status === 409);
    const c12 = await postM(B.id, BLO.cookie, { action: 'confirm_duplicate', matchId: mAB!.id, expectedStatus: 'PENDING_REVIEW' });
    const after12 = await match(A.id, B.id);
    ok('12. confirmed: Verified Duplicate, the older case primary, reviewer and time recorded', c12.status === 200 && after12?.status === 'VERIFIED_DUPLICATE'
      && after12.primaryCaseId === A.id && after12.reviewedById === BLO.id && Boolean(after12.reviewedAt), JSON.stringify(c12.body).slice(0, 200));
    const e12 = after12?.events.find(e => e.kind === 'reviewed');
    ok('12. the history: who, from which status to which, the primary case', e12?.actorId === BLO.id && e12.fromStatus === 'PENDING_REVIEW' && e12.toStatus === 'VERIFIED_DUPLICATE' && e12.primaryCaseId === A.id);
    ok('12. both cases are kept, unchanged', await prisma.case.count({ where: { id: { in: [A.id, B.id] } } }) === 2
      && JSON.stringify(await prisma.case.findUnique({ where: { id: A.id } })) === JSON.stringify(aAfter));
    let rewrite = false;
    try { await prisma.caseMatchEvent.update({ where: { id: e12!.id }, data: { reason: 'changed' } }); } catch { rewrite = true; }
    ok('12. the history cannot be rewritten (database trigger)', rewrite);
    const upd = await json(await updatesGET(req('/api/resident/updates', R2.cookie)));
    const notice = JSON.stringify(upd.body);
    ok('12. the duplicate\'s reporter is told in general words - no other case, no other person', notice.includes('describes the same incident as another report')
      && !notice.includes(A.caseNumber) && !notice.includes('Ana'));
    ok('12. the primary case\'s reporter is not told anything about the other report', !JSON.stringify(await json(await updatesGET(req('/api/resident/updates', R1.cookie)))).includes('duplicate'));
    const n12 = residentNotice({ type: 'case_duplicate_confirmed', message: `Confirmed as a duplicate of ${A.caseNumber}` }, null);
    const w12 = residentNotice({ type: 'case_duplicate_withdrawn', message: 'x' }, null);
    ok('12. the notice is on the resident allow-list with fixed words (never the stored message)', Boolean(n12) && !n12!.message.includes(A.caseNumber) && Boolean(w12));
    const list12 = await json(await casesGET(req('/api/cases?limit=50&sortBy=filedAt&sortDir=desc', BLO.cookie)));
    const rowA = list12.body.data?.cases?.find((c: Body) => c.id === A.id);
    const rowB = list12.body.data?.cases?.find((c: Body) => c.id === B.id);
    const panelB = (await getM(B.id, BLO.cookie)).body.data;
    // B still has another pending potential duplicate (H8: the same story, day and street), so that comes first on its label.
    ok('12. Case Monitoring labels: the most pressing first; the panel shows the confirmed pair as Verified Duplicate', rowA?.matchLabel === 'POTENTIAL_DUPLICATE'
      && rowB?.matchLabel === 'POTENTIAL_DUPLICATE' && panelB?.matches.find((m: Body) => m.id === mAB!.id)?.status === 'VERIFIED_DUPLICATE'
      && panelB.matches.find((m: Body) => m.id === mAB!.id)?.primaryCaseId === A.id, `${rowA?.matchLabel} ${rowB?.matchLabel}`);
    ok('12. no VAWC case reaches a blotter officer list', !list12.body.data.cases.some((c: Body) => c.id === V1.id || c.id === V2.id));
    const onlyConfirmed = await prisma.caseMatch.findMany({ where: { OR: [{ caseId: V2.id }, { matchedCaseId: V2.id }] } });
    const cV = await postM(V2.id, VAW.cookie, { action: 'confirm_duplicate', matchId: mV!.id, primaryCaseId: V2.id });
    ok('12. a case whose only match is confirmed is labelled Verified Duplicate; the official may choose the primary case', onlyConfirmed.length === 1 && cV.status === 200
      && (await matchLabels([V1.id], 'vawc_officer')).get(V1.id) === 'VERIFIED_DUPLICATE' && (await match(V1.id, V2.id))?.primaryCaseId === V2.id);
    const again = await postM(B.id, BLO.cookie, { action: 'not_duplicate', matchId: mAB!.id });
    ok('12. changing a decision already made needs a reason', again.status === 400);

    console.log('\n13. Mark as related');
    const c13 = await postM(A.id, CAP.cookie, { action: 'mark_related', matchId: mAD!.id });
    const g13 = await getM(D3.id, BLO.cookie);
    const m13 = g13.body.data?.matches?.find((m: Body) => m.id === mAD!.id);
    ok('13. related: status Related Case, decided by the captain, and each case links to the other', c13.status === 200 && m13?.status === 'RELATED'
      && m13.other.id === A.id && m13.reviewedBy === `${TAG} captain`);

    console.log('\n14. Not a duplicate');
    const n14 = await postM(A.id, BLO.cookie, { action: 'not_duplicate', matchId: mAH!.id });
    ok('14. without a reason: refused', n14.status === 400 && (await prisma.caseMatch.findUnique({ where: { id: mAH!.id } }))?.status === 'PENDING_REVIEW');
    const y14 = await postM(A.id, BLO.cookie, { action: 'not_duplicate', matchId: mAH!.id, reason: 'Different bicycle - checked with both reporters.' });
    const a14 = await match(A.id, H8.id);
    ok('14. with a reason: Not a Duplicate, the reason and the reviewer recorded', y14.status === 200 && a14?.status === 'NOT_DUPLICATE'
      && a14.reviewReason === 'Different bicycle - checked with both reporters.' && a14.reviewedById === BLO.id
      && a14.events.some(e => e.kind === 'reviewed' && e.reason === a14.reviewReason));
    const f14 = await postM(A.id, BLO.cookie, { action: 'further_review', matchId: mAC!.id, reason: 'Ask the desk lead' });
    ok('request further review: the match stays open (Further Review Requested)', f14.status === 200 && (await match(A.id, C2.id))?.status === 'FURTHER_REVIEW');
    const r14 = await postM(A.id, BLO.cookie, { action: 'recheck' });
    ok('checking again keeps every official decision', r14.status === 200 && (await match(A.id, B.id))?.status === 'VERIFIED_DUPLICATE'
      && (await match(A.id, H8.id))?.status === 'NOT_DUPLICATE' && (await match(A.id, D3.id))?.status === 'RELATED');
    const log = await prisma.reporterAccessLog.findMany({ where: { caseId: { in: [A.id, V2.id] }, fields: { has: 'case_matches' } } });
    ok('every view and decision is in the access log, refusals too', log.some(l => l.outcome === 'denied' && l.caseId === V2.id) && log.some(l => l.code === 'not_duplicate:review'));

    console.log('\n15. An urgent report despite a match');
    const u15 = await precheck(R1.cookie, { description: THEFT, incidentDate: '2026-10-20', street: 'Ortega Compound', urgent: true });
    ok('15. the check is skipped for an urgent report', u15.status === 200 && u15.body.data.skipped === 'urgent' && u15.body.data.result === 'NO_MATCH');
    const f15 = await json(await filePOST(req('/api/resident/cases', R1.cookie, 'POST', { description: THEFT, barangay: 'Ortega Compound', incidentDate: '2026-10-20', reportingRelationship: 'SELF' })));
    const id15 = f15.body.data?.id as string | undefined;
    if (id15) caseIds.push(id15);
    ok('15. a report that matches an earlier one is filed all the same (201)', f15.status === 201 && Boolean(id15), `${f15.status} ${f15.body.error ?? ''}`);
    if (id15) {
      await detectForCase(id15, { useAi: false });
      const m15 = await match(A.id, id15);
      ok('15. and is flagged for an official afterwards - the report itself untouched', m15?.classification === 'POTENTIAL_DUPLICATE'
        && (await prisma.case.findUnique({ where: { id: id15 } }))?.description.startsWith(THEFT) === true);
    }

    console.log('\n16. Concurrent submissions');
    const K1 = await mkCase({ resident: R2, type: 'Theft', street: 'Ortega Compound', text: THEFT_AGAIN, date: DAY, person: PERSON });
    const both = await Promise.allSettled([detectForCase(K1.id, { useAi: false }), detectForCase(K1.id, { useAi: false })]);
    ok('16. the same case checked twice at once: one runs, one skips, nothing fails', both.every(r => r.status === 'fulfilled')
      && both.filter(r => r.status === 'fulfilled' && r.value.skipped).length === 1, JSON.stringify(both.map(r => r.status === 'fulfilled' ? r.value : String(r.reason))));
    const forced = await Promise.allSettled([detectForCase(K1.id, { useAi: false, force: true }), detectForCase(K1.id, { useAi: false, force: true })]);
    ok('16. two forced checks at once: no error, one record per pair', forced.every(r => r.status === 'fulfilled')
      && await prisma.caseMatch.count({ where: { pairKey: pairKey(A.id, K1.id) } }) === 1, JSON.stringify(forced.map(r => r.status === 'fulfilled' ? 'ok' : String(r.reason))));
    let dupRefused = false;
    try { await prisma.caseMatch.create({ data: { caseId: K1.id, matchedCaseId: A.id, pairKey: pairKey(K1.id, A.id), desk: 'BLOTTER', classification: 'RELATED_CASE', matchingEstimate: 0.5, indicators: {}, ruleIndicators: {}, evidence: {}, explanation: 'x', analysis: 'RULES' } }); }
    catch { dupRefused = true; }
    ok('16. the database refuses a second record of the same pair (either way round)', dupRefused);
  } finally {
    await prisma.notification.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });   // matches, their history and scans go with the cases
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.caseMatch.count({ where: { case: { caseNumber: { startsWith: TAG } } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0 && await prisma.user.count({ where: { email: { startsWith: 'probe.cm.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
