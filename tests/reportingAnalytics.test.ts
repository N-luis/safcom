/**
 * Reporting analytics - the charts, the case types and the VAWC women-and-
 * children statistics - through the real routes and the real database
 * (in-process; no dev server). Run with:  npm run test:reportinganalytics
 *
 * Every test case is filed in March 2001, a month no real report is in, so
 * each figure can be checked exactly. Fictional data only; every row is
 * marked PROBE-RA and removed at the end. No real case is read for a figure
 * here or changed.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import {
  ageOn, ageAtIncident, demographicOf, abuseTypesOf, personKeyOf, shownCount, completenessBucket, aiBucket, victimFromIntake, normalizeClientCode,
} from '../lib/reportingStats';
import { GET as analyticsGET } from '../app/api/analytics/[section]/route';
import { GET as vsGET, POST as vsPOST } from '../app/api/cases/[id]/victim-survivors/route';
import { PATCH as vsPATCH, DELETE as vsDELETE } from '../app/api/cases/[id]/victim-survivors/[vid]/route';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RA';
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res ? { status: res.status, body: await res.json().catch(() => ({})) as Body } : { status: 0, body: {} as Body };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const MARCH = 'from=2001-03-01&to=2001-03-31';

async function main() {
  const users: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── The counting rules ──
    console.log('\nCounting rules');
    ok('age in full years, birthday not yet reached', ageOn(d('1990-06-10'), d('2001-06-09')) === 10 && ageOn(d('1990-06-10'), d('2001-06-10')) === 11);
    const rec = (o: Partial<{ sexAtBirth: string | null; birthDate: Date | null; ageAtIncident: number | null; clientCode: string | null }>) =>
      ({ id: 'x', sexAtBirth: null, birthDate: null, ageAtIncident: null, clientCode: null, ...o });
    ok('the recorded age at the incident wins', ageAtIncident(rec({ ageAtIncident: 12, birthDate: d('1950-01-01') }), d('2001-01-01'), d('2001-02-01')).age === 12);
    ok('else the birthdate at the incident date', ageAtIncident(rec({ birthDate: d('1990-01-01') }), d('2001-01-01'), d('2010-01-01')).age === 11);
    ok('without an incident date, a child on the day reported was a child at the incident', demographicOf(rec({ birthDate: d('1995-01-01') }), null, d('2001-03-01')) === 'child');
    ok('...but an adult on the day reported is not assumed an adult at the incident', demographicOf(rec({ sexAtBirth: 'female', birthDate: d('1970-01-01') }), null, d('2001-03-01')) === 'female_age_unknown');
    ok('a woman: recorded female, 18 or over at the incident', demographicOf(rec({ sexAtBirth: 'female', ageAtIncident: 18 }), null, d('2001-03-01')) === 'woman');
    ok('a child: under 18 at the incident, whatever the sex', demographicOf(rec({ sexAtBirth: 'male', ageAtIncident: 17 }), null, d('2001-03-01')) === 'child'
      && demographicOf(rec({ ageAtIncident: 3 }), null, d('2001-03-01')) === 'child');
    ok('sex not recorded on an adult is "not recorded", never guessed', demographicOf(rec({ ageAtIncident: 30 }), null, d('2001-03-01')) === 'not_recorded');
    ok('nothing recorded is "not recorded"', demographicOf(rec({}), null, d('2001-03-01')) === 'not_recorded');
    ok('the same client code is one person, however typed', personKeyOf(rec({ clientCode: ' vc-001 ' })) === personKeyOf(rec({ clientCode: 'VC-001' })) && normalizeClientCode('  ') === null);
    ok('without a client code, each record is its own person', personKeyOf({ ...rec({}), id: 'a' }) !== personKeyOf({ ...rec({}), id: 'b' }));
    ok('RA 9262 types from a completed intake form - several per case', abuseTypesOf({ caseType: 'Domestic Violence', categoryReviewed: false, intakeCompleted: true,
      intakeViolence: ['ipv_physical', 'ipv_psychological', 'rape_marital'] }).types.join() === 'physical,psychological');
    ok('a draft intake form adds nothing', abuseTypesOf({ caseType: 'Domestic Violence', categoryReviewed: false, intakeCompleted: false, intakeViolence: ['ipv_physical'] }).basis === 'awaiting_review');
    ok('an AI category no official reviewed adds nothing', abuseTypesOf({ caseType: 'Physical Abuse', categoryReviewed: false, intakeCompleted: false, intakeViolence: null }).types.length === 0);
    ok('a reviewed category naming one type counts it', abuseTypesOf({ caseType: 'Emotional Abuse', categoryReviewed: true, intakeCompleted: false, intakeViolence: null }).types.join() === 'psychological');
    ok('a reviewed category naming none (Child Abuse) is "other category"', abuseTypesOf({ caseType: 'Child Abuse', categoryReviewed: true, intakeCompleted: false, intakeViolence: null }).basis === 'other_category');
    ok('small counts withheld from aggregate-only viewers, never from VAWC staff', shownCount(2, false) === null && shownCount(0, false) === 0 && shownCount(3, false) === 3 && shownCount(1, true) === 1);
    ok('awaiting clarification takes a report out of its completeness segment', completenessBucket({ status: 'Open', triageStatus: 'NEEDS_FOLLOW_UP',
      informationCompleteness: 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT', intake: null }) === 'awaitingClarification'
      && completenessBucket({ status: 'Closed', triageStatus: 'NEEDS_FOLLOW_UP', informationCompleteness: 'PARTIAL', intake: null }) === 'incomplete');
    ok('an AI result is never counted as an officer decision', aiBucket([{ kind: 'ai_reassessment' }], true) === 'awaiting' && aiBucket([], false) === 'none');
    ok('the intake form\'s Section B, without a name', JSON.stringify(victimFromIntake('c1', { victimName: { value: { first: 'Secret' } }, sexAtBirth: { value: 'female' }, birthdate: { value: '1980-01-01' } })) .includes('Secret') === false);

    // ── People ──
    const mk = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.ra.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mk('blotter', 'officer');
    const V = await mk('vawc', 'vawc_officer');
    const C = await mk('captain', 'admin');
    const S = await mk('sysadmin', 'system_admin');

    // ── Fictional reports, March 2001 (and one in April) ──
    let n = 0;
    const mkCase = async (data: Record<string, unknown>) => {
      const c = await prisma.case.create({ data: { caseNumber: `${TAG}-${process.pid}-${++n}`, residentName: 'Probe Person Name', caseType: 'Noise Complaint',
        barangay: 'Ortega Compound', description: 'Fictional narrative text', status: 'Open', riskLevel: null, assignedToId: B.id, filedAt: d('2001-03-10'), ...data } as never });
      caseIds.push(c.id); return c;
    };
    const hist = (caseId: string, kind: string, extra: Record<string, unknown> = {}) => prisma.assessmentHistory.create({ data: { caseId, kind, rationale: {}, ...extra } as never });
    const intakeOf = (caseId: string, responses: Record<string, unknown>) => prisma.officialIntake.create({ data: { caseId, status: 'COMPLETED', formVersion: 'test',
      formType: 'VAWC_INTAKE', responses: responses as never, startedById: V.id, updatedById: V.id, completedById: V.id, completedAt: new Date() } });
    const victim = (caseId: string, v: Record<string, unknown>) => prisma.caseVictimSurvivor.create({ data: { caseId, recordedById: V.id, ...v } as never });

    // Blotter
    const b1 = await mkCase({ caseType: 'Noise Complaint', informationCompleteness: 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' });
    await hist(b1.id, 'category_confirm', { caseType: 'Noise Complaint' }); await hist(b1.id, 'officer_confirm');
    const b2 = await mkCase({ caseType: 'Theft & Robbery', informationCompleteness: 'PARTIAL', triageStatus: 'NEEDS_FOLLOW_UP' });
    await prisma.caseIntake.create({ data: { caseId: b2.id, narrative: 'x', turns: [], informationCompleteness: 'PARTIAL', categoryConfidence: 'medium',
      categoryRationale: [], conflicts: [], route: 'Blotter', supportingIndicators: [], missingInformation: [], recommendedNextSteps: [], reviewReasons: [],
      engineVersion: 'test', framework: 'BLOTTER', matrixLevel: 2, matrixLabel: 'MODERATE', assessmentStatus: 'PRELIMINARY', aiReading: { used: true } } as never });
    const b3 = await mkCase({ caseType: 'Noise Complaint' });
    await hist(b3.id, 'category_change', { caseType: 'Noise Complaint', previousCaseType: 'Domestic Violence' }); await hist(b3.id, 'officer_override');
    await hist(b3.id, 'ai_reassessment'); await hist(b3.id, 'ai_reassessment');
    const b4 = await mkCase({ caseType: 'Vandalism', filedAt: d('2001-04-15') });
    // VAWC
    const v1 = await mkCase({ caseType: 'Physical Abuse', assignedToId: V.id, incidentDate: d('2001-02-20') });
    await hist(v1.id, 'category_confirm', { caseType: 'Physical Abuse' });
    await intakeOf(v1.id, { typeOfViolence: { value: ['ipv_physical', 'ipv_psychological'] } });
    await victim(v1.id, { sexAtBirth: 'female', birthDate: d('1970-05-05'), clientCode: 'VC-001' });   // a woman
    await victim(v1.id, { sexAtBirth: 'female', birthDate: d('1995-06-01'), clientCode: 'VC-002' });   // her child
    const v2 = await mkCase({ caseType: 'Domestic Violence', assignedToId: V.id, incidentDate: d('2001-03-01'), informationCompleteness: 'INSUFFICIENT' });
    await victim(v2.id, { sexAtBirth: 'female', birthDate: d('1970-05-05'), clientCode: ' vc-001 ' }); // the same woman, another case
    const v3 = await mkCase({ caseType: 'Economic Abuse', assignedToId: V.id });
    await hist(v3.id, 'category_change', { caseType: 'Economic Abuse', previousCaseType: 'Domestic Violence' });
    await victim(v3.id, { sexAtBirth: 'female' });                                                       // age missing
    await victim(v3.id, { sexAtBirth: 'male', ageAtIncident: 10 });                                     // a boy, no client code
    const v4 = await mkCase({ caseType: 'Child Abuse', assignedToId: V.id });
    await hist(v4.id, 'category_confirm', { caseType: 'Child Abuse' });                                  // no victim recorded
    const v5 = await mkCase({ caseType: 'Sexual Violence', assignedToId: V.id });
    await hist(v5.id, 'category_confirm', { caseType: 'Sexual Violence' });
    await intakeOf(v5.id, { victimName: { value: { first: 'Fictional', last: 'Intakename' } }, sexAtBirth: { value: 'female' }, birthdate: { value: '1980-01-01' },
      clientCode: { value: 'VC-005' }, incidentDate: { value: '2001-03-01' }, typeOfViolence: { value: ['ipv_sexual', 'ipv_economic'] } });

    const get = (cookie: string, q: string) => analyticsGET(req(`/api/analytics/reporting?${q}`, cookie), { params: Promise.resolve({ section: 'reporting' }) }).then(json);
    const cases = (cookie: string, q: string) => analyticsGET(req(`/api/analytics/reporting-cases?${q}`, cookie), { params: Promise.resolve({ section: 'reporting-cases' }) }).then(json);

    // ── All desks, March, as the Barangay Captain (may open VAWC cases) ──
    console.log('\nThe charts, all desks, March 2001');
    const all = (await get(C.cookie, `scope=all&${MARCH}`)).body.data;
    ok('8 reports in the period (the April one left out)', all.total === 8, String(all.total));
    ok('summary: total, complete, awaiting clarification, awaiting officer review', all.summary.total === 8 && all.summary.complete === 1
      && all.summary.awaitingClarification === 1 && all.summary.awaitingReview === 1, JSON.stringify(all.summary));
    ok('completeness: each report once, adding up to the total', all.completeness.complete === 1 && all.completeness.incomplete === 1
      && all.completeness.awaitingClarification === 1 && all.completeness.unassessed === 5
      && Object.values(all.completeness as Record<string, number>).reduce((a, b) => a + b, 0) === all.total, JSON.stringify(all.completeness));
    ok('officer-reviewed classification', all.classification.confirmed === 4 && all.classification.misrouted === 1 && all.classification.recategorized === 1
      && all.classification.unreviewed === 2, JSON.stringify(all.classification));
    ok('AI review: confirmed, revised and awaiting kept apart; re-runs counted as events on cases', all.ai.confirmed === 1 && all.ai.revised === 1
      && all.ai.awaiting === 1 && all.ai.reruns === 2 && all.ai.rerunCases === 1, JSON.stringify(all.ai));
    ok('blotter case types from the records', JSON.stringify(all.caseTypes.blotter.types) === JSON.stringify([{ type: 'Noise Complaint', count: 2 }, { type: 'Theft & Robbery', count: 1 }]),
      JSON.stringify(all.caseTypes.blotter));
    const vt = Object.fromEntries(all.caseTypes.vawc.types.map((t: Body) => [t.key, t.count]));
    ok('RA 9262 types: physical 1, psychological 1, sexual 1, economic 2', vt.physical === 1 && vt.psychological === 1 && vt.sexual === 1 && vt.economic === 2, JSON.stringify(vt));
    ok('overlap shown, never added up as cases: 3 cases with a type, 2 with more than one, while the bars total 5',
      all.caseTypes.vawc.withAnyType === 3 && all.caseTypes.vawc.multiType === 2 && Object.values(vt as Record<string, number>).reduce((a, b) => a + b, 0) === 5 && all.caseTypes.vawc.cases === 5);
    ok('a VAWC case whose category no official reviewed is "awaiting review"; one outside the four is "other category"',
      all.caseTypes.vawc.awaitingReview === 1 && all.caseTypes.vawc.otherCategory === 1);

    console.log('\nVAWC - women and children');
    const p = all.people;
    ok('women affected: 2 distinct (the same woman on two cases counted once)', p.persons.women === 2, JSON.stringify(p.persons));
    ok('children affected: 2 distinct (one coded, one without a code)', p.persons.children === 2);
    ok('victim-survivors with missing sex or age shown as not recorded', p.persons.notRecorded === 1);
    ok('5 distinct victim-survivors in all - reporters and persons reported never counted', p.persons.total === 5);
    ok('cases involving women 3, children 2, both 1 - each case once', p.cases.withWomen === 3 && p.cases.withChildren === 2 && p.cases.withBoth === 1, JSON.stringify(p.cases));
    ok('a case with no victim-survivor recorded is counted as such, not as zero people', p.cases.noVictimRecorded === 1 && p.cases.multipleVictims === 2);
    ok('the completed intake form counts while nothing else is recorded (v5\'s woman)', p.cases.withWomen === 3);
    ok('no name, narrative or client code leaves through the figures', !/Probe Person Name|Fictional|Intakename|VC-00/.test(JSON.stringify(all)));

    // ── Filters ──
    console.log('\nFilters');
    const f = async (q: string) => (await get(C.cookie, `scope=all&${MARCH}&${q}`)).body.data;
    const blotter = await f('desk=BLOTTER');
    ok('desk Blotter: 3 reports, no VAWC sections', blotter.total === 3 && blotter.caseTypes.vawc === null && blotter.people === null);
    const vawc = await f('desk=VAWC');
    ok('desk VAWC: 5 reports, no blotter types', vawc.total === 5 && vawc.caseTypes.blotter === null);
    ok('women: the 3 cases involving women', (await f('group=women')).total === 3);
    ok('children: the 2 cases involving children', (await f('group=children')).total === 2);
    ok('women and children: the 1 case with both', (await f('group=both')).total === 1);
    const eco = await f('desk=VAWC&type=abuse:economic');
    ok('type Economic abuse: its 2 cases, and every chart follows', eco.total === 2 && eco.people.cases.total === 2 && eco.completeness.unassessed + eco.completeness.incomplete === 2);
    ok('type Noise Complaint: its 2 reports', (await f('type=Noise%20Complaint')).total === 2);
    ok('April alone: only the Vandalism report', (await get(C.cookie, 'scope=all&from=2001-04-01&to=2001-04-30')).body.data.total === 1);
    const empty = (await get(C.cookie, 'scope=all&from=2001-06-01&to=2001-06-30')).body.data;
    ok('an empty period: total 0, and no figure made up', empty.total === 0 && empty.people.persons.total === 0 && empty.caseTypes.blotter.types.length === 0);
    ok('the case-type choices list the blotter categories and the four RA 9262 types', all.typeOptions.blotter.includes('Noise Complaint')
      && all.typeOptions.vawc.map((o: Body) => o.value).join() === 'abuse:physical,abuse:psychological,abuse:sexual,abuse:economic');

    // ── The case list behind a segment ──
    console.log('\nClick-through case lists');
    const w = (await cases(C.cookie, `scope=all&${MARCH}&segment=people:women`)).body.data;
    ok('cases involving women: v1, v2, v5', w.total === 3 && [v1.id, v2.id, v5.id].every(id => w.cases.some((c: Body) => c.id === id)));
    ok('a listed case has a reference, category, desk, status and date - no person', !/Probe Person Name|Fictional/.test(JSON.stringify(w)) && 'caseNumber' in w.cases[0] && !('residentName' in w.cases[0]));
    const aw = (await cases(B.cookie, `scope=blotter&${MARCH}&segment=completeness:awaitingClarification`)).body.data;
    ok('the blotter officer\'s awaiting-clarification list', aw.total === 1 && aw.cases[0].id === b2.id);
    ok('an unknown segment is refused', (await cases(C.cookie, `scope=all&segment=anything`)).status === 400);

    // ── Who may see what ──
    console.log('\nAccess and privacy');
    const asBlotter = await get(B.cookie, `scope=all&${MARCH}&desk=VAWC&group=women`);
    ok('a blotter officer asking for VAWC figures gets the blotter\'s only', asBlotter.body.scope === 'blotter' && asBlotter.body.data.people === null
      && asBlotter.body.data.caseTypes.vawc === null && asBlotter.body.data.total === 3, JSON.stringify({ scope: asBlotter.body.scope, total: asBlotter.body.data.total }));
    ok('...and cannot list VAWC cases', (await cases(B.cookie, `scope=all&${MARCH}&segment=people:women`)).status === 403);
    const sys = (await get(S.cookie, `scope=all&${MARCH}`)).body.data;
    ok('the system administrator gets aggregates with small counts withheld', sys.people.exact === false && sys.people.persons.women === null
      && sys.people.cases.withWomen === 3 && sys.people.cases.withBoth === null && sys.caseTypes.vawc.types.find((t: Body) => t.key === 'physical').count === null,
      JSON.stringify(sys.people));
    ok('...and no VAWC case list', (await cases(S.cookie, `scope=all&${MARCH}&segment=people:children`)).status === 403);
    const sysAll = (await cases(S.cookie, `scope=all&${MARCH}&segment=all`)).body.data;
    ok('...a mixed list shows blotter cases only, without saying how many VAWC were left out', sysAll.cases.every((c: Body) => c.desk === 'BLOTTER')
      && sysAll.vawcWithheld === true && !('notShown' in sysAll));
    const vo = (await get(V.cookie, `scope=vawc&${MARCH}`)).body.data;
    ok('the VAWC officer sees exact VAWC counts', vo.people.exact === true && vo.people.persons.women === 2 && vo.total === 5);

    // ── Recording victim-survivors ──
    console.log('\nRecording victim-survivors (VAWC case page)');
    const P = (id: string) => ({ params: Promise.resolve({ id }) });
    const PV = (id: string, vid: string) => ({ params: Promise.resolve({ id, vid }) });
    const add = await json(await vsPOST(req(`/api/cases/${v4.id}/victim-survivors`, V.cookie, 'POST', { sexAtBirth: 'female', ageAtIncident: 9, clientCode: 'vc-404' }), P(v4.id)));
    ok('the assigned VAWC officer records a child victim-survivor', add.status === 201 && add.body.data.clientCode === 'VC-404', `${add.status} ${add.body.error ?? ''}`);
    ok('a sex value outside the list is refused', (await json(await vsPOST(req(`/api/cases/${v4.id}/victim-survivors`, V.cookie, 'POST', { sexAtBirth: 'unknown' }), P(v4.id)))).status === 400);
    ok('a birthdate in the future is refused', (await json(await vsPOST(req(`/api/cases/${v4.id}/victim-survivors`, V.cookie, 'POST', { birthDate: '2999-01-01' }), P(v4.id)))).status === 400);
    ok('a blotter officer cannot see a VAWC case\'s victim-survivors (not found)', (await json(await vsGET(req(`/api/cases/${v4.id}/victim-survivors`, B.cookie), P(v4.id)))).status === 404);
    ok('nor record one', (await json(await vsPOST(req(`/api/cases/${v4.id}/victim-survivors`, B.cookie, 'POST', { sexAtBirth: 'female' }), P(v4.id)))).status === 404);
    ok('victim-survivors are for VAWC cases only', (await json(await vsPOST(req(`/api/cases/${b1.id}/victim-survivors`, B.cookie, 'POST', { sexAtBirth: 'female' }), P(b1.id)))).status === 409);
    const after = (await get(C.cookie, `scope=all&${MARCH}`)).body.data.people;
    ok('the statistics follow: 3 children, no case without a victim-survivor', after.persons.children === 3 && after.cases.noVictimRecorded === 0, JSON.stringify(after));
    const v5list = (await json(await vsGET(req(`/api/cases/${v5.id}/victim-survivors`, V.cookie), P(v5.id)))).body.data;
    ok('the case page offers the intake form\'s victim-survivor to copy, without a name', v5list.fromIntake?.sexAtBirth === 'female' && v5list.fromIntake.clientCode === 'VC-005'
      && !JSON.stringify(v5list).includes('Fictional'));
    const fix = await json(await vsPATCH(req(`/api/cases/${v4.id}/victim-survivors/${add.body.data.id}`, V.cookie, 'PATCH', { sexAtBirth: 'female', ageAtIncident: 19, clientCode: 'VC-404' }), PV(v4.id, add.body.data.id)));
    ok('a record can be corrected (age 9 -> 19: now a woman)', fix.status === 200 && (await get(C.cookie, `scope=all&${MARCH}`)).body.data.people.persons.women === 3);
    ok('removing needs a reason', (await json(await vsDELETE(req(`/api/cases/${v4.id}/victim-survivors/${add.body.data.id}`, V.cookie, 'DELETE', {}), PV(v4.id, add.body.data.id)))).status === 400);
    const rm = await json(await vsDELETE(req(`/api/cases/${v4.id}/victim-survivors/${add.body.data.id}`, V.cookie, 'DELETE', { reason: 'Recorded on the wrong case' }), PV(v4.id, add.body.data.id)));
    const kept = await prisma.caseVictimSurvivor.findUnique({ where: { id: add.body.data.id } });
    ok('a removed record is kept with who and why, and left out of the figures', rm.status === 200 && Boolean(kept?.removedAt) && kept?.removedReason === 'Recorded on the wrong case'
      && (await get(C.cookie, `scope=all&${MARCH}`)).body.data.people.persons.women === 2);
    void b4; void b3;
  } finally {
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  ok('every test row removed', await prisma.case.count({ where: { caseNumber: { startsWith: TAG } } }) === 0
    && await prisma.caseVictimSurvivor.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.ra.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
