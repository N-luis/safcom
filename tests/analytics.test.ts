/**
 * Analytics & Case Intelligence, through the real routes and the real
 * database (in-process; no dev server needed).
 * Run with:  npm run test:analytics
 *
 * The database already holds real cases, so every figure is read before the
 * test's own cases are added and checked by how much it changed. Temporary
 * rows are marked PROBE-AN and removed at the end. No real case is changed.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import {
  groupOfStatus, parseRange, latestAi, emergencyReasons, isHighPriority, hearingRefusal, nextHearingNumber,
  categoryVerdict, completenessOf,
} from '../lib/analytics';
import { GET as analyticsGET } from '../app/api/analytics/[section]/route';
import { GET as streetsGET } from '../app/api/risk/streets/route';
import { GET as hearingsGET, POST as hearingsPOST } from '../app/api/cases/[id]/hearings/route';
import { PATCH as hearingPATCH } from '../app/api/cases/[id]/hearings/[hid]/route';
import { POST as ackPOST, PATCH as ackPATCH } from '../app/api/cases/[id]/acknowledgement/route';
import { GET as ackPDF } from '../app/api/cases/[id]/acknowledgement/pdf/route';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-AN';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  : { status: 0, body: {} as Body };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function pdfText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ');
  return out;
}
const todayPh = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

async function main() {
  const users: string[] = []; const caseIds: string[] = []; const residents: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── The rules ──
    console.log('\nRules');
    ok('every status belongs to one group', groupOfStatus('Open') === 'pending' && groupOfStatus('Pending Resolution') === 'underReview'
      && groupOfStatus('In Progress') === 'ongoing' && groupOfStatus('Closed') === 'resolved');
    const r = parseRange('2026-11-01', '2026-11-01');
    ok('a date range covers the whole Philippine day', r.from?.toISOString() === '2026-10-31T16:00:00.000Z' && r.to?.toISOString() === '2026-11-01T15:59:59.999Z');
    ok('a malformed date is ignored, not guessed', parseRange('yesterday', null).from === null);
    const filing = { createdAt: new Date('2026-10-01'), framework: 'BLOTTER', matrixLevel: 2, matrixLabel: 'MODERATE', assessmentStatus: 'PRELIMINARY',
      aiReading: { used: true, assessment: { status: 'COMPLETED', recommendedNextAction: 'Talk to both parties.', urgentHumanReview: false } } };
    const rerun = { createdAt: new Date('2026-10-05'), framework: 'BLOTTER', matrixLevel: 4, matrixLabel: 'CRITICAL',
      rationale: { status: 'FOR_REVIEW', ai: { used: true, assessment: { status: 'COMPLETED', recommendedNextAction: 'Refer to the PNP.', urgentHumanReview: true } } } };
    ok('the latest re-run is the AI assessment shown', latestAi(filing, rerun)?.level === 4 && latestAi(filing, rerun)?.recommendation === 'Refer to the PNP.');
    ok('without a re-run, the filing assessment', latestAi(filing, null)?.source === 'filing');
    ok('a recommendation only when Groq completed one', latestAi({ ...filing, aiReading: { used: true, assessment: { status: 'ASSESSMENT_UNAVAILABLE', recommendedNextAction: 'x' } } }, null)?.recommendation === null);
    ok('no assessment at all is "none", not a level', latestAi(null, null) === null);
    const urgentNoAi = { status: 'Open', riskLevel: null, triageStatus: 'URGENT_REVIEW', intake: null, safety: null, ai: null };
    ok('an emergency is flagged without any AI result', emergencyReasons(urgentNoAi).length === 1 && isHighPriority(urgentNoAi));
    ok('no level and no flag is not high priority - nothing is invented', !isHighPriority({ ...urgentNoAi, triageStatus: null }));
    ok('a closed case is never in the queue', !isHighPriority({ ...urgentNoAi, status: 'Resolved' }));
    ok('an officer\'s safety assessment flags it', emergencyReasons({ ...urgentNoAi, triageStatus: null, safety: { immediateConcern: 'yes', urgentAssistance: 'no' } }).length === 1);
    ok('a VAWC case never gets a hearing', hearingRefusal('Domestic Violence', [], 1)?.startsWith('VAWC') === true);
    ok('hearing 2 waits for hearing 1', hearingRefusal('Noise Complaint', [], 2) !== null && hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'COMPLETED' }], 2) === null);
    ok('one scheduled hearing at a time', hearingRefusal('Noise Complaint', [{ hearingNumber: 1, status: 'SCHEDULED' }], 1) !== null);
    ok('no fourth hearing', nextHearingNumber([1, 2, 3].map(n => ({ hearingNumber: n, status: 'COMPLETED' }))) === null);
    ok('a desk change is a misrouting', categoryVerdict([{ kind: 'category_change', caseType: 'Noise Complaint', previousCaseType: 'Domestic Violence' }]) === 'misrouted');
    ok('a change within the desk is not', categoryVerdict([{ kind: 'category_change', caseType: 'Noise Complaint', previousCaseType: 'Vandalism' }]) === 'recategorized');
    ok('completeness says nothing about truth - only detail', completenessOf('SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT') === 'complete' && completenessOf(null) === 'unassessed');

    // ── People ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.an.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const V = await mk('vawc', 'vawc_officer');
    const C = await mk('captain', 'admin');
    const S = await mk('sysadmin', 'system_admin');
    const res = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Analytics', age: 30, gender: 'Female', barangay: 'Ayukit', address: 'temporary', emailVerified: true } });
    residents.push(res.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: res.id, email: 'x', name: 'Probe', role: 'resident' })}`;

    const get = (section: string, cookie: string, q = '') => analyticsGET(req(`/api/analytics/${section}?${q}`, cookie), { params: Promise.resolve({ section }) }).then(json);
    const streets = (cookie: string, q: string) => streetsGET(req(`/api/risk/streets?${q}`, cookie)).then(json);
    const today = `from=${todayPh}&to=${todayPh}`;

    // ── Before ──
    const before = {
      ovB: (await get('overview', B.cookie, `scope=blotter&${today}`)).body.data,
      ovSall: (await get('overview', S.cookie, `scope=all&${today}`)).body.data,
      repC: (await get('reporting', C.cookie, 'scope=all')).body.data,
      letC: (await get('letters', C.cookie, 'scope=all')).body.data,
      letS: (await get('letters', S.cookie, 'scope=all')).body.data,
      hearB: (await get('hearings', B.cookie, 'scope=blotter')).body.data,
      strB: (await streets(B.cookie, `scope=blotter&${today}`)).body.data,
      strC: (await streets(C.cookie, `scope=all&${today}`)).body.data,
    };

    // ── The test's cases ──
    let n = 0;
    const mkCase = async (d: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe Analytics', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'temporary test case', status: 'Open', riskLevel: null, residentId: res.id, assignedToId: B.id, ...d } as never });
      caseIds.push(c.id); return c;
    };
    const b1 = await mkCase({ triageStatus: 'URGENT_REVIEW' });
    const b2 = await mkCase({ status: 'In Progress', riskLevel: 'High' });
    await prisma.caseIntake.create({ data: { caseId: b2.id, narrative: 'x', turns: [], informationCompleteness: 'PARTIAL', categoryConfidence: 'medium',
      categoryRationale: [], conflicts: [], route: 'Blotter', supportingIndicators: [], missingInformation: [], recommendedNextSteps: [], reviewReasons: [],
      engineVersion: 'test', framework: 'BLOTTER', matrixLevel: 3, matrixLabel: 'HIGH', assessmentStatus: 'PRELIMINARY',
      aiReading: { used: true, model: 'test', assessment: { status: 'COMPLETED', recommendedNextAction: 'Schedule a talk with both households.', urgentHumanReview: false } } } as never });
    const b3 = await mkCase({ status: 'Resolved', riskLevel: 'Critical' });
    const b4 = await mkCase({ riskLevel: 'Low', informationCompleteness: 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' });
    await prisma.assessmentHistory.create({ data: { caseId: b4.id, kind: 'category_confirm', riskLevel: 'Low', caseType: 'Noise Complaint', rationale: {}, actorId: B.id } });
    const b5 = await mkCase({ status: 'Pending Resolution', informationCompleteness: 'INSUFFICIENT', triageStatus: 'NEEDS_FOLLOW_UP',
      filedAt: new Date(Date.now() - 60 * 86_400_000) });
    await prisma.assessmentHistory.create({ data: { caseId: b5.id, kind: 'category_change', caseType: 'Noise Complaint', previousCaseType: 'Domestic Violence', rationale: {} } });
    const v1 = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id, barangay: 'House 12 behind the chapel', reporterIdentityWithheld: true });
    await prisma.caseSafetyAssessment.create({ data: { caseId: v1.id, immediateConcern: 'yes', dependentsAffected: 'unknown', urgentAssistance: 'no',
      medicalNeeded: 'no', shelterNeeded: 'no', policeOrReferralNeeded: 'yes', updatedById: V.id } });
    await prisma.assessmentHistory.create({ data: { caseId: v1.id, kind: 'officer_override', riskLevel: 'High', rationale: {} } });
    const v2 = await mkCase({ caseType: 'Domestic Violence', status: 'Resolved', assignedToId: V.id });

    // ── 1. Overview ──
    console.log('\nCase overview');
    const ovB = (await get('overview', B.cookie, `scope=blotter&${today}`)).body.data;
    const d = (k: string) => ovB[k] - before.ovB[k];
    ok('total counts the new blotter cases', d('total') === 5, String(d('total')));
    ok('pending / under review / ongoing / resolved', d('pending') === 2 && d('underReview') === 1 && d('ongoing') === 1 && d('resolved') === 1,
      `${d('pending')} ${d('underReview')} ${d('ongoing')} ${d('resolved')}`);
    ok('new reports counts only those filed in the range', d('newReports') === 4, String(d('newReports')));
    ok('the groups add up to the total', ovB.pending + ovB.underReview + ovB.ongoing + ovB.resolved + ovB.other === ovB.total);
    const ovS = (await get('overview', S.cookie, `scope=all&${today}`)).body.data;
    ok('the system administrator\'s counts include VAWC cases', ovS.total - before.ovSall.total === 7, String(ovS.total - before.ovSall.total));
    const blotterAsksVawc = await get('overview', B.cookie, 'scope=vawc');
    ok('a blotter officer asking for VAWC figures gets the blotter\'s', blotterAsksVawc.body.scope === 'blotter');
    ok('a resident session is refused', (await get('overview', resCookie)).status === 401);
    ok('an unknown section is not found', (await get('nothing', B.cookie)).status === 404);

    // ── 3. High priority ──
    console.log('\nHigh-priority cases');
    const prB = (await get('priority', B.cookie, 'scope=blotter')).body.data;
    const ids = prB.cases.map((c: Body) => c.id);
    ok('an emergency with no AI result is listed', ids.includes(b1.id));
    const r1 = prB.cases.find((c: Body) => c.id === b1.id);
    ok('its risk level is not invented', r1?.officialRiskLevel === null && r1?.ai === null && r1?.emergency.length === 1);
    const r2 = prB.cases.find((c: Body) => c.id === b2.id);
    ok('a High case shows the matrix level and Groq\'s recommendation', r2?.ai?.level === 3 && r2?.ai?.recommendation === 'Schedule a talk with both households.');
    ok('emergencies come first', ids.indexOf(b1.id) < ids.indexOf(b2.id));
    ok('a resolved case and a low one are not listed', !ids.includes(b3.id) && !ids.includes(b4.id));
    ok('the blotter never sees the VAWC case', !ids.includes(v1.id));
    ok('rows carry no names, narratives or addresses', !/Probe Analytics|temporary test case|House 12/.test(JSON.stringify(prB)));
    const prV = (await get('priority', V.cookie, 'scope=vawc')).body.data;
    ok('the VAWC desk sees its emergency from the officer\'s safety assessment', prV.cases.some((c: Body) => c.id === v1.id && c.emergency.includes('Officer recorded an immediate safety concern')));
    ok('the system administrator gets no VAWC rows', !(await get('priority', S.cookie, 'scope=all')).body.data.cases.some((c: Body) => c.id === v1.id));
    ok('the captain does', (await get('priority', C.cookie, 'scope=all')).body.data.cases.some((c: Body) => c.id === v1.id));

    // ── 4. Correct reporting ──
    console.log('\nCorrect reporting');
    const rep = (await get('reporting', C.cookie, 'scope=all')).body.data;
    const dr = (k: string) => rep[k] - before.repC[k];
    // b5 is insufficient on the case; b2 is partial on its intake - both incomplete.
    ok('complete and incomplete reports', dr('complete') === 1 && dr('incomplete') === 2, `${dr('complete')} ${dr('incomplete')}`);
    ok('awaiting clarification, and listed', dr('awaitingClarification') === 1 && rep.awaiting.some((c: Body) => c.id === b5.id));
    ok('confirmed category and misrouted report, and listed', dr('confirmed') === 1 && dr('misrouted') === 1 && rep.misroutedCases.some((c: Body) => c.id === b5.id));
    ok('an officer revision of the AI is counted', dr('aiRevised') === 1);
    const repToday = (await get('reporting', C.cookie, `scope=all&${today}`)).body.data;
    ok('the date range applies - the 60-day-old report is outside today', !repToday.awaiting.some((c: Body) => c.id === b5.id));

    // ── 5. Hearings ──
    console.log('\nHearing management');
    const hear = (id: string, cookie: string, body: Body) => hearingsPOST(req(`/api/cases/${id}/hearings`, cookie, 'POST', body), params(id)).then(json);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const refused = await hear(b4.id, B.cookie, { hearingNumber: 1, scheduledAt: soon });
    ok('no hearing before an official reviews eligibility', refused.status === 422 && /review/i.test(refused.body.error ?? ''), refused.body.error);
    await prisma.caseKpReview.create({ data: { caseId: b4.id, decision: 'ELIGIBLE', caseType: 'Noise Complaint', checklist: {}, reviewedById: B.id } });
    // Today, so it can be recorded as held straight away.
    const h1 = await hear(b4.id, B.cookie, { hearingNumber: 1, scheduledAt: new Date().toISOString(), venue: 'Barangay hall' });
    ok('hearing 1 is scheduled', h1.status === 201, `${h1.status} ${h1.body.error ?? ''}`);
    ok('hearing 2 cannot be scheduled while 1 is open', (await hear(b4.id, B.cookie, { hearingNumber: 2, scheduledAt: soon })).status === 422);
    const patch = (id: string, hid: string, body: Body) => hearingPATCH(req(`/api/cases/${id}/hearings/${hid}`, B.cookie, 'PATCH', body), { params: Promise.resolve({ id, hid }) }).then(json);
    const held = await patch(b4.id, h1.body.data.id, { action: 'complete', outcome: 'NOT_SETTLED', complainantAttendance: 'PRESENT', respondentAttendance: 'PRESENT' });
    ok('hearing 1 held, not settled', held.status === 200, `${held.status} ${held.body.error ?? ''}`);
    ok('a held hearing is final', (await patch(b4.id, h1.body.data.id, { action: 'cancel', reason: 'changed mind' })).status === 409);
    const h2 = await hear(b4.id, B.cookie, { hearingNumber: 2, scheduledAt: soon });
    ok('hearing 2 is scheduled', h2.status === 201);
    ok('given a new date', (await patch(b4.id, h2.body.data.id, { action: 'reschedule', reason: 'Respondent is ill', scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })).status === 200);
    const list = (await json(await hearingsGET(req(`/api/cases/${b4.id}/hearings`, B.cookie), params(b4.id)))).body.data;
    const h2row = list.hearings.find((h: Body) => h.hearingNumber === 2);
    ok('one record per hearing, the old date kept in its history', list.hearings.length === 2 && h2row?.rescheduleCount === 1
      && h2row.events.some((e: Body) => e.kind === 'rescheduled' && e.before?.scheduledAt === soon));
    await prisma.case.update({ where: { id: v1.id }, data: { assignedToId: V.id } });
    ok('a VAWC case is refused a hearing', (await hear(v1.id, V.cookie, { hearingNumber: 1, scheduledAt: soon })).status === 422);
    const hb = (await get('hearings', B.cookie, 'scope=blotter')).body.data;
    ok('hearing 1 held, hearing 2 rescheduled, one upcoming', hb.byNumber[0].completed - before.hearB.byNumber[0].completed === 1
      && hb.rescheduled - before.hearB.rescheduled === 1 && hb.upcomingCount - before.hearB.upcomingCount === 1
      && hb.upcoming.some((h: Body) => h.case.id === b4.id && h.hearingNumber === 2), JSON.stringify({ r: hb.rescheduled, u: hb.upcomingCount }));
    const hToday = (await get('hearings', B.cookie, `scope=blotter&${today}`)).body.data;
    ok('a hearing set for next week counts as scheduled under a "today" filter', hToday.byNumber[1].scheduled >= 1
      && hToday.upcoming.some((h: Body) => h.case.id === b4.id));
    const hv = (await get('hearings', V.cookie, 'scope=vawc')).body.data;
    ok('on the VAWC board hearings do not apply; its referrals and follow-ups show instead', hv.applicable === false && hv.vawc !== null && hv.upcoming.length === 0);

    // ── 6. Letters ──
    console.log('\nAcknowledgement letters');
    const ack = (id: string, cookie: string) => ackPOST(req(`/api/cases/${id}/acknowledgement`, cookie, 'POST'), params(id)).then(json);
    const l1 = await ack(b4.id, B.cookie);
    ok('a letter is generated, numbered from the case', l1.status === 201 && l1.body.data.letter.letterNumber === `ACK-${b4.caseNumber}`);
    const again = await ack(b4.id, B.cookie);
    ok('a second request returns the same letter', again.body.data.created === false && again.body.data.letter.id === l1.body.data.letter.id);
    const pdfB = await ackPDF(req(`/api/cases/${b4.id}/acknowledgement/pdf`, B.cookie), params(b4.id));
    const txtB = await pdfText(new Uint8Array(await pdfB!.arrayBuffer()));
    ok('the letter confirms receipt only, under the case number', txtB.includes('confirms receipt only') && txtB.includes(b4.caseNumber) && txtB.includes('Noise Complaint'));
    const lv = await ack(v1.id, V.cookie);
    ok('an anonymous reporter is addressed as "The Reporter"', lv.body.data.letter.recipient === 'The Reporter');
    const txtV = await pdfText(new Uint8Array(await (await ackPDF(req(`/api/cases/${v1.id}/acknowledgement/pdf`, V.cookie), params(v1.id)))!.arrayBuffer()));
    // The officer here is named "PROBE-AN vawc", as seeded desk accounts are ("VAWC Officer ...").
    ok('a VAWC letter names neither the category, the desk nor the desk officer', !/Domestic|VAWC|Violence/i.test(txtV) && txtV.includes(v1.caseNumber));
    ok('issued', (await json(await ackPATCH(req(`/api/cases/${b4.id}/acknowledgement`, B.cookie, 'PATCH', { issueMethod: 'IN_PERSON' }), params(b4.id)))).body.data.letter.status === 'ISSUED');
    const lc = (await get('letters', C.cookie, 'scope=all')).body.data;
    ok('generated, issued and pending counts', lc.generated - before.letC.generated === 2 && lc.issued - before.letC.issued === 1 && lc.pending - before.letC.pending === 1);
    ok('recent letters link to their cases', lc.recent.some((l: Body) => l.case.id === b4.id && l.case.caseNumber === b4.caseNumber));
    const ls = (await get('letters', S.cookie, 'scope=all')).body.data;
    ok('the system administrator counts the VAWC letter but does not see it', ls.generated - before.letS.generated === 2 && !ls.recent.some((l: Body) => l.case.id === v1.id));

    // ── 2. Heatmap filters ──
    console.log('\nStreet heatmap');
    const sB = (await streets(B.cookie, `scope=blotter&${today}`)).body.data;
    ok('the date filter counts today\'s placed blotter cases', sB.placed - before.strB.placed === 4, String(sB.placed - before.strB.placed));
    const sCat = (await streets(B.cookie, `scope=blotter&category=Noise%20Complaint&${today}`)).body.data;
    ok('the category filter narrows it', sCat.total <= sB.total && sCat.total >= 4);
    const sC = (await streets(C.cookie, `scope=all&${today}`)).body.data;
    ok('a VAWC address typed in full is counted, never listed', sC.unplaced - before.strC.unplaced >= 1 && !sC.unplacedValues.some((v: string) => v.includes('House 12')));
    void v2; void b3;
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
    && await prisma.caseHearing.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.acknowledgementLetter.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.an.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
