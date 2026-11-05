/**
 * The Blotter and VAWC report forms, the people in a report, the officer's
 * safety assessment and referrals, and re-running the AI assessment - through
 * the real routes and the real database, with Groq replaced by a fake that
 * answers from the matrix passages it was actually sent (nothing leaves the
 * machine, no free quota is used).
 * Run with:  npm run test:caserecords
 *
 * Temporary rows are marked PROBE-CR and removed at the end, with their audit
 * rows; today's app-wide AI usage row is put back as it was.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import {
  referralRefusal, safetyIsUrgent, caseNumberLabel, incidentDateSchema, affectedPartySchema, INITIAL_CATEGORIES,
} from '../lib/caseRecords';
import { POST as filePOST, GET as myCasesGET } from '../app/api/resident/cases/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';
import { GET as recordsGET, PUT as recordsPUT } from '../app/api/cases/[id]/records/route';
import { PUT as safetyPUT } from '../app/api/cases/[id]/safety/route';
import { POST as referralPOST } from '../app/api/cases/[id]/referrals/route';
import { PATCH as referralPATCH } from '../app/api/cases/[id]/referrals/[rid]/route';
import { GET as aiGET, POST as aiPOST } from '../app/api/cases/[id]/ai-assessment/route';

process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_TIMEOUT_MS = '2000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

// ─── A fake Groq that cites what it was sent, and records what that was ─────
const fake = { sent: [] as string[], urgent: false };
function reply(user: string) {
  const fw = /\] VAWC /.test(user) && !/\] BLOTTER /.test(user) ? 'VAWC' : 'BLOTTER';
  const sid = new RegExp(`\\[(S\\d+)\\] ${fw} [^\\n]*Level 1 `).exec(user)?.[1] ?? 'S0';
  return {
    facts: [], slots: [], category: 'UNCLEAR', categoryConfidence: 'medium', alternativeCategories: [], reasons: [],
    assessment: {
      framework: fw, riskLevel: null, riskLabel: 'x', criteria: [],
      informationSufficient: true, essentialMissing: [], classificationStatus: 'PRELIMINARY',
      understanding: `Read against ${sid}.`, missingInformation: ['When it started'], uncertainty: [],
      recommendedNextAction: 'Talk to the reporter.', urgentHumanReview: fake.urgent,
      affectedPerson: 'OTHER_PERSON', reporterKnowledge: 'DIRECT',
    },
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  const user = String(body.messages[1].content);
  fake.sent.push(user);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(user)) } }], usage: { total_tokens: 40 } }), { status: 200 });
}) as typeof fetch;

const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  : { status: 0, body: {} as Body };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const BLOTTER_TEXT = 'Gabi-gabi pong maingay ang videoke ng kapitbahay namin hanggang alas-dos ng madaling araw. Kinausap ko na sila pero hindi pa rin tumitigil. Walang nasaktan at walang nagbanta.';
const VAWC_TEXT = 'Nakita ko pong sinampal at sinuntok ng asawa niya ang kapitbahay naming babae kagabi sa harap ng bahay nila. May pasa siya sa mukha. Nangyari na rin ito noong isang buwan.';
const TAG = 'PROBE-CR';

async function main() {
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    // ── The rules, without the database ──
    console.log('\nRules');
    ok('a VAWC case is never referred to the Lupon', referralRefusal('LUPON', 'Domestic Violence') !== null);
    ok('a blotter case may be', referralRefusal('LUPON', 'Noise Complaint') === null);
    ok('a VAWC case may go to the PNP Women and Children Protection Desk', referralRefusal('PNP_WCPD', 'Domestic Violence') === null);
    ok('an immediate concern starts the urgent workflow', safetyIsUrgent({ immediateConcern: 'yes', urgentAssistance: 'no' }));
    ok('"not known" does not', !safetyIsUrgent({ immediateConcern: 'unknown', urgentAssistance: 'unknown' }));
    ok('each desk names its number', caseNumberLabel('Domestic Violence') === 'VAWC Reference No.' && caseNumberLabel('Noise Complaint') === 'Blotter Entry No.');
    ok('an incident date in the future is refused', !incidentDateSchema.safeParse('2999-01-01').success);
    ok('an age that is not a number is refused', !affectedPartySchema.safeParse({ age: 'thirty' }).success);
    ok('nothing about a person is required', affectedPartySchema.safeParse({}).success);
    ok('the forms offer only their own desk\'s categories',
      !INITIAL_CATEGORIES.BLOTTER.includes('Domestic Violence') && INITIAL_CATEGORIES.VAWC.includes('Domestic Violence'));

    // ── People ──
    const mkRes = async (k: string) => {
      const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${k}-${process.pid}`, firstName: `Probe${k}`, lastName: 'Records',
        age: 34, gender: 'Female', barangay: 'Ayukit', address: 'temporary test row', emailVerified: true } });
      residents.push(r.id); return r;
    };
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.cr.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const R = await mkRes('Reporter');
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    const V = await mkUser('vawc', 'vawc_officer');
    const V2 = await mkUser('vawc2', 'vawc_officer');
    const B = await mkUser('blotter', 'officer');
    const CAPT = await mkUser('captain', 'admin');
    const SYS = await mkUser('sysadmin', 'system_admin');
    const file = async (body: Body) => {
      const out = await json(await filePOST(req('/api/resident/cases', resCookie, 'POST', body)));
      if (out.body?.data?.id) caseIds.push(out.body.data.id);
      return out;
    };

    // ── A resident files a Blotter report ──
    console.log('\nA resident files a Blotter report');
    fake.sent = [];
    const b = await file({
      reportPath: 'BLOTTER', caseType: 'Noise Complaint', description: BLOTTER_TEXT, intakeNarrative: BLOTTER_TEXT,
      reportingRelationship: 'SELF', intakeAnswers: [], barangay: 'Ayukit',
      incidentDate: '2026-10-20', incidentTimeApprox: 'mga alas-dos ng madaling araw', witnessInfo: 'Ang asawa ko, narinig din niya',
      reportedParty: { fullName: 'Juan Probe', relationship: 'Kapitbahay', details: 'Nakatira sa kabilang bahay' },
    });
    ok('the report is filed', b.status === 201, `${b.status} ${b.body.error ?? ''}`);
    const bCase = await prisma.case.findUnique({ where: { id: b.body.data.id }, include: { parties: true, intake: true } });
    ok('filed on the Blotter desk', bCase?.caseType === 'Noise Complaint', bCase?.caseType);
    ok('form, channel, date, time and witnesses are kept', bCase?.reportPath === 'BLOTTER' && bCase.reportingChannel === 'ONLINE'
      && bCase.incidentDate?.toISOString().slice(0, 10) === '2026-10-20' && bCase.incidentTimeApprox === 'mga alas-dos ng madaling araw'
      && bCase.witnessInfo === 'Ang asawa ko, narinig din niya');
    ok('the person reported is stored on their own', bCase?.parties.length === 1 && bCase.parties[0].role === 'REPORTED'
      && bCase.parties[0].fullName === 'Juan Probe' && bCase.parties[0].source === 'reporter');
    ok('the original narrative is kept as written', bCase?.intake?.narrative === BLOTTER_TEXT);
    const bSent = fake.sent.join('\n');
    ok('the AI was sent the actual narrative', bSent.includes('videoke'));
    ok('a Blotter report is assessed against the Blotter matrix', /\] BLOTTER [^\n]*Level/.test(bSent) && !/\] VAWC [^\n]*Level/.test(bSent));

    // ── A resident files a VAWC report for someone else ──
    console.log('\nA resident files a VAWC report for a neighbour');
    fake.sent = [];
    const v = await file({
      reportPath: 'VAWC', description: VAWC_TEXT, intakeNarrative: VAWC_TEXT, reportingRelationship: 'THIRD_PARTY',
      affectedPersonNote: 'kapitbahay naming babae', intakeAnswers: [], barangay: 'Ayukit',
      affectedParty: { fullName: 'Maria Probe', age: 29, relationship: 'Kapitbahay', dependentsAffected: 'yes' },
      reportedParty: { fullName: 'Pedro Probe', relationship: 'Asawa ng biktima' },
    });
    ok('the report is filed', v.status === 201, `${v.status} ${v.body.error ?? ''}`);
    const vCase = await prisma.case.findUnique({ where: { id: v.body.data.id }, include: { parties: { orderBy: { role: 'asc' } } } });
    ok('filed on the VAWC desk', ['Domestic Violence', 'Physical Abuse', 'VAWC - Other'].includes(vCase?.caseType ?? ''), vCase?.caseType);
    const aff = vCase?.parties.find(p => p.role === 'AFFECTED'); const rep = vCase?.parties.find(p => p.role === 'REPORTED');
    ok('reporter, person affected and person reported are three separate records', vCase?.residentId === R.id
      && aff?.fullName === 'Maria Probe' && aff.age === 29 && aff.dependentsAffected === 'yes' && rep?.fullName === 'Pedro Probe');
    // Filing never links a party to an account; only an official does, by the resident number.
    ok('neither is linked to a resident account', aff?.residentId === null && rep?.residentId === null);
    const vSent = fake.sent.join('\n');
    ok('the AI was sent the actual narrative', vSent.includes('sinampal'));
    ok('a VAWC report is assessed against the VAWC matrix', /\] VAWC [^\n]*Level/.test(vSent) && !/\] BLOTTER [^\n]*Level/.test(vSent));
    ok('the reporter is not assumed to be the victim-survivor', /THIRD_PARTY|someone else|another person/i.test(vSent));

    // ── A form that does not match the report ──
    console.log('\nThe form chosen and the report disagree');
    const m = await file({ reportPath: 'VAWC', description: BLOTTER_TEXT, intakeNarrative: BLOTTER_TEXT, reportingRelationship: 'SELF', intakeAnswers: [], barangay: 'Ayukit' });
    const mCase = await prisma.case.findUnique({ where: { id: m.body.data.id }, include: { intake: true } });
    // Filed on the confidential form: held on the VAWC desk until a VAWC
    // officer confirms it, with the AI's own reading kept beside it.
    // The page no longer asks which form; an older one that still sends
    // "VAWC" only ever makes it more confidential.
    const mDesk = (await prisma.assessmentHistory.findFirst({ where: { caseId: mCase!.id, kind: 'desk_recommendation' } }))?.rationale as Body | undefined;
    ok('VAWC form (an older page), blotter content: held on the VAWC desk and flagged', mCase?.caseType === 'VAWC - Other' && mCase.requiresOfficerReview
      && mCase.intake?.suggestedCaseCategory === 'Noise Complaint'
      && mDesk?.decision === 'HUMAN_REVIEW' && mDesk.confidentialReview === true
      && (mCase.intake?.reviewReasons as string[]).some(r => r.includes('Needs an official to decide the desk')));
    const m2 = await file({ reportPath: 'BLOTTER', description: VAWC_TEXT, intakeNarrative: VAWC_TEXT, reportingRelationship: 'THIRD_PARTY', intakeAnswers: [], barangay: 'Ayukit' });
    const m2Case = await prisma.case.findUnique({ where: { id: m2.body.data.id }, include: { intake: true } });
    const m2Desk = (await prisma.assessmentHistory.findFirst({ where: { caseId: m2Case!.id, kind: 'desk_recommendation' } }))?.rationale as Body | undefined;
    ok('Blotter form (an older page), VAWC content: the choice is not followed - filed on the VAWC desk at once, confidential',
      ['Domestic Violence', 'Physical Abuse', 'VAWC - Other'].includes(m2Case?.caseType ?? '') && m2Desk?.desk === 'VAWC' && m2Desk.confidentialReview === true);

    // ── What a resident cannot do or see ──
    console.log('\nResidents');
    ok('a resident cannot send officer-only records', (await file({ description: BLOTTER_TEXT, reportingRelationship: 'SELF', referrals: [] })).status === 400);
    const mine = JSON.stringify((await json(await myCasesGET(req('/api/resident/cases', resCookie)))).body);
    ok('the resident\'s case list carries no officer records', !/safetyAssessment|referral|"parties"|immediateConcern/.test(mine));
    ok('a resident cannot open the officer records', (await recordsGET(req(`/api/cases/${vCase!.id}/records`, resCookie), params(vCase!.id)))?.status === 401);

    // ── Who may open the VAWC case's records ──
    console.log('\nAccess to the VAWC case');
    await prisma.case.update({ where: { id: vCase!.id }, data: { assignedToId: V.id } });
    const recs = (cookie: string) => recordsGET(req(`/api/cases/${vCase!.id}/records`, cookie), params(vCase!.id)).then(json);
    const asV = await recs(V.cookie);
    ok('the assigned VAWC officer reads them, with both people', asV.status === 200 && asV.body.data.parties.length === 2
      && asV.body.data.report.caseNumberLabel === 'VAWC Reference No.', String(asV.status));
    ok('a blotter officer is told it does not exist', (await recs(B.cookie)).status === 404);
    ok('the system administrator is told it does not exist', (await recs(SYS.cookie)).status === 404);
    ok('nor can they open the case itself', (await caseGET(req(`/api/cases/${vCase!.id}`, SYS.cookie), params(vCase!.id)))?.status === 404);
    const asCapt = await recs(CAPT.cookie);
    ok('the captain may read them, but not record on them', asCapt.status === 200 && asCapt.body.data.access.edit === false);
    ok('another VAWC officer, not assigned, may not', (await recs(V2.cookie)).status === 403);
    ok('every look is logged, without content', await prisma.reporterAccessLog.count({ where: { caseId: vCase!.id, fields: { has: 'case_records' } } }) >= 5);

    // ── Safety assessment ──
    console.log('\nSafety assessment');
    const safety = (cookie: string, body: Body) => safetyPUT(req(`/api/cases/${vCase!.id}/safety`, cookie, 'PUT', body), params(vCase!.id)).then(json);
    const answers = { immediateConcern: 'no', dependentsAffected: 'yes', urgentAssistance: 'no', medicalNeeded: 'unknown',
      shelterNeeded: 'no', policeOrReferralNeeded: 'yes', initialAction: 'Kinausap ang biktima nang pribado.' };
    const s1 = await safety(V.cookie, { ...answers, expectedVersion: 0 });
    ok('the assigned officer records it', s1.status === 200 && s1.body.data.safety.version === 1, `${s1.status} ${s1.body.error ?? ''}`);
    ok('no urgent flag when there is no immediate concern', s1.body.data.flaggedUrgent === false);
    ok('the captain cannot record on a VAWC case not assigned to them', (await safety(CAPT.cookie, { ...answers, expectedVersion: 1 })).status === 403);
    ok('a stale save is refused', (await safety(V.cookie, { ...answers, expectedVersion: 0 })).status === 409);
    const notesBefore = await prisma.notification.count({ where: { caseId: vCase!.id } });
    const s2 = await safety(V.cookie, { ...answers, immediateConcern: 'yes', expectedVersion: 1 });
    const vAfter = await prisma.case.findUnique({ where: { id: vCase!.id } });
    ok('an immediate concern raises urgent review at once', s2.body.data?.flaggedUrgent === true && vAfter?.triageStatus === 'URGENT_REVIEW');
    ok('and notifies the desks', await prisma.notification.count({ where: { caseId: vCase!.id } }) === notesBefore + 1);
    ok('the risk level is left alone', vAfter?.riskLevel === vCase!.riskLevel);
    ok('both versions are kept in the history', await prisma.assessmentHistory.count({ where: { caseId: vCase!.id, kind: 'safety_assessment' } }) === 2);
    ok('an unanswered question is refused, not taken as "no"', (await safety(V.cookie, { ...answers, immediateConcern: undefined, expectedVersion: 2 })).status === 400);

    // ── Referrals ──
    console.log('\nReferrals');
    const refer = (id: string, cookie: string, body: Body) => referralPOST(req(`/api/cases/${id}/referrals`, cookie, 'POST', body), params(id)).then(json);
    const lupon = await refer(vCase!.id, V.cookie, { agency: 'LUPON', referredAt: '2026-10-25' });
    ok('a VAWC case cannot be referred to the Lupon', lupon.status === 422, String(lupon.status));
    const wcpd = await refer(vCase!.id, V.cookie, { agency: 'PNP_WCPD', referredAt: '2026-10-25', reason: 'Para sa reklamo' });
    ok('it can be referred to the PNP Women and Children Protection Desk', wcpd.status === 201);
    await prisma.case.update({ where: { id: bCase!.id }, data: { assignedToId: B.id } });
    ok('a blotter case can go to the Lupon', (await refer(bCase!.id, B.cookie, { agency: 'LUPON', referredAt: '2026-10-25' })).status === 201);
    ok('"Other" needs the office named', (await refer(bCase!.id, B.cookie, { agency: 'OTHER', referredAt: '2026-10-25' })).status === 400);
    const cross = await referralPATCH(req(`/api/cases/${bCase!.id}/referrals/${wcpd.body.data.id}`, B.cookie, 'PATCH', { status: 'COMPLETED' }),
      { params: Promise.resolve({ id: bCase!.id, rid: wcpd.body.data.id }) });
    ok('another case\'s referral cannot be reached through this case', cross?.status === 404);

    // ── Officer record of a person ──
    console.log('\nAn official records the person reported');
    const put = await json(await recordsPUT(req(`/api/cases/${vCase!.id}/records`, V.cookie, 'PUT', { role: 'REPORTED', party: { fullName: 'Pedro Probe Santos', age: 35 } }), params(vCase!.id)));
    const people = await prisma.caseParty.findMany({ where: { caseId: vCase!.id, role: 'REPORTED' } });
    ok('kept beside the reporter\'s version, which is unchanged', put.status === 200 && people.length === 2
      && people.some(p => p.source === 'reporter' && p.fullName === 'Pedro Probe') && people.some(p => p.source === 'official' && p.age === 35));

    // ── Re-running the AI assessment ──
    console.log('\nRe-running the AI assessment');
    const intakeBefore = await prisma.caseIntake.findUnique({ where: { caseId: bCase!.id } });
    const levelBefore = (await prisma.case.findUnique({ where: { id: bCase!.id } }))?.riskLevel;
    fake.sent = []; fake.urgent = false;
    const rerun = (id: string, cookie: string, body: Body) => aiPOST(req(`/api/cases/${id}/ai-assessment`, cookie, 'POST', body), params(id)).then(json);
    ok('a reason is required', (await rerun(bCase!.id, B.cookie, { reason: '' })).status === 400);
    const r1 = await rerun(bCase!.id, B.cookie, { reason: 'Nakausap ang complainant', newInformation: 'Tatlong linggo na itong nangyayari gabi-gabi.' });
    ok('the assigned officer re-runs it', r1.status === 201, `${r1.status} ${r1.body.error ?? ''}`);
    ok('the AI is sent the original report and the new information, set apart', fake.sent.some(s => s.includes('videoke') && s.includes('Tatlong linggo')));
    const intakeAfter = await prisma.caseIntake.findUnique({ where: { caseId: bCase!.id } });
    ok('the reading at filing is not overwritten', intakeAfter?.narrative === intakeBefore?.narrative
      && intakeAfter?.matrixLevel === intakeBefore?.matrixLevel && JSON.stringify(intakeAfter?.aiReading) === JSON.stringify(intakeBefore?.aiReading));
    ok('the case level is not changed by it', (await prisma.case.findUnique({ where: { id: bCase!.id } }))?.riskLevel === levelBefore);
    const listed = await json(await aiGET(req(`/api/cases/${bCase!.id}/ai-assessment`, B.cookie), params(bCase!.id)));
    ok('the officer sees the filing assessment, the re-run and the official one apart', listed.status === 200
      && Boolean(listed.body.data.atFiling) && listed.body.data.reruns.length === 1 && 'official' in listed.body.data
      && listed.body.data.reruns[0].newInformation === 'Tatlong linggo na itong nangyayari gabi-gabi.');
    ok('the re-run carries the retrieved matrix references', Array.isArray(listed.body.data.reruns[0].references) && listed.body.data.reruns[0].references.length > 0);
    fake.urgent = true;
    // New information, as an officer would bring: the same text again is
    // answered from the AI client's cache, which is the point of the cache.
    const r2 = await rerun(bCase!.id, B.cookie, { reason: 'Bagong pahayag mula sa saksi', newInformation: 'Tatlong kapitbahay na rin ang nagreklamo tungkol dito.' });
    ok('an urgent AI result raises urgent review, independently of the level', r2.body.data?.flaggedUrgent === true
      && (await prisma.case.findUnique({ where: { id: bCase!.id } }))?.triageStatus === 'URGENT_REVIEW');
    fake.urgent = false;
    ok('both re-runs are kept', await prisma.assessmentHistory.count({ where: { caseId: bCase!.id, kind: 'ai_reassessment' } }) === 2);
    ok('a blotter officer cannot re-run a VAWC case', (await rerun(vCase!.id, B.cookie, { reason: 'Trying it' })).status === 404);
    const row = await prisma.assessmentHistory.findFirst({ where: { caseId: bCase!.id, kind: 'ai_reassessment' } });
    let blocked = false;
    try { await prisma.assessmentHistory.update({ where: { id: row!.id }, data: { reason: 'rewritten' } }); } catch { blocked = true; }
    ok('a kept assessment cannot be rewritten in the database', blocked);
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.aiUsage.deleteMany({ where: { OR: [...residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })),
      ...users.map(id => ({ bucket: { startsWith: `resident:staff:${id}:` } }))] } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0
    && await prisma.caseParty.count({ where: { caseId: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.cr.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
