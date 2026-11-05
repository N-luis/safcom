/**
 * Automatic reporting desk (Blotter / VAWC) - lib/reportDesk.ts and its use
 * when a resident files a report - through the real routes and the real
 * database. Groq is replaced by a fake that answers per scenario (nothing
 * leaves the machine, no free quota is used) and can be made "unavailable".
 *
 * Run with:  npm run test:reportdesk
 *            npm run test:reportdesk -- --live   (also reads the fictional reports with the real Groq)
 *
 * Temporary rows are marked PROBE-RD and removed at the end, with their audit
 * rows; today's app-wide AI usage row is put back as it was.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import { recommendDesk, type DeskInput, type DeskRecommendation } from '../lib/reportDesk';
import { runIntake } from '../lib/intakeServer';
import { deskFor } from '../lib/reportDeskServer';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';
import { GET as casesGET } from '../app/api/cases/route';
import { PATCH as classPATCH } from '../app/api/cases/[id]/classification/route';
import { GET as cronGET } from '../app/api/cron/desk-classification/route';

const LIVE = process.argv.includes('--live');
process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_TIMEOUT_MS = LIVE ? '20000' : '2000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RD';
// A tag in every report, so the AI's cache never answers a later run from this one.
const RUN = `ref ${process.pid}`;

// ── The fictional reports ──
const T = {
  property: `Nagtayo po ang kapitbahay namin ng bakod na lumampas ng dalawang metro sa lupa namin noong Lunes. Ayaw niyang alisin kahit pinakiusapan na namin. (${RUN})`,
  noise: `Gabi-gabi pong malakas ang videoke ng kapitbahay namin hanggang alas-tres ng madaling araw at hindi kami makatulog. Ilang beses na namin silang kinausap. (${RUN})`,
  theft: `Ninakaw po ang bisikleta ko sa harap ng sari-sari store kahapon ng hapon habang bumibili ako. May nakakita raw na lalaking sumakay dito. (${RUN})`,
  vawc: `Sinasaktan po ako ng asawa ko. Kagabi sinampal niya ako at sinabing papatayin niya ako kapag umalis ako ng bahay. (${RUN})`,
  vague: `May problema po dito sa amin, sana po matulungan ninyo kami. (${RUN})`,
  contradictory: `Sinuntok ako ng lasing sa kanto kagabi at nasugatan ako sa mukha. (${RUN})`,
  maybeVawc: `Nag-aaway na naman po ang mag-asawa sa tabi ng bahay namin at may naririnig akong sumisigaw na babae, parang may nababasag. (${RUN})`,
  downVawc: `Tinutulak at minumura po ako ng live-in partner ko tuwing lasing siya, at natatakot na ako sa kanya. (${RUN})`,
  downPlain: `May nagtatapon po ng basura sa bakanteng lote sa tapat ng bahay namin tuwing gabi at mabaho na. (${RUN})`,
};
// What the fake Groq reads each report as - a category from the matrix, or unsure.
const FAKE_CATEGORY: [string, string, 'high' | 'medium' | 'low'][] = [
  [T.property, 'Trespassing', 'high'], [T.noise, 'Noise Complaint', 'high'], [T.theft, 'Theft & Robbery', 'high'],
  [T.vawc, 'Domestic Violence', 'high'], [T.vague, 'UNCLEAR', 'low'], [T.contradictory, 'Assault', 'high'],
  [T.maybeVawc, 'Noise Complaint', 'medium'], [T.downVawc, 'Domestic Violence', 'high'],
  // When the AI comes back, it reads the dumping report as a VAWC matter - so the retry has to move it.
  [T.downPlain, 'Domestic Violence', 'high'],
];

const fake = { down: false, calls: 0 };
const realFetch = globalThis.fetch;
if (!LIVE) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('api.groq.com')) return realFetch(url, init);
    fake.calls++;
    if (fake.down) return new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503 });
    const user = String(JSON.parse(String(init?.body)).messages[1].content);
    const hit = FAKE_CATEGORY.find(([text]) => user.includes(text.slice(0, 60)));
    const fw = hit && /Domestic|Abuse|Harassment|Violence/.test(hit[1]) ? 'VAWC' : 'BLOTTER';
    const sid = new RegExp(`\\[(S\\d+)\\] ${fw} [^\\n]*Level 1 `).exec(user)?.[1] ?? 'S0';
    const reply = {
      // A category needs a quoted fact behind it, or the checker drops it (lib/aiClassifier.ts checkResponse).
      facts: hit && hit[2] !== 'low' ? [{ key: fw === 'VAWC' ? 'partner' : 'neighbors', quote: hit[0].slice(0, 24) }] : [],
      slots: [], category: hit?.[1] ?? 'UNCLEAR', categoryConfidence: hit?.[2] ?? 'low', alternativeCategories: [], reasons: [],
      assessment: {
        framework: fw, riskLevel: null, riskLabel: 'x', criteria: [], informationSufficient: true, essentialMissing: [],
        classificationStatus: 'PRELIMINARY', understanding: `Read against ${sid}.`, missingInformation: [], uncertainty: [],
        recommendedNextAction: 'Talk to the reporter.', urgentHumanReview: false, affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT',
      },
    };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { total_tokens: 40 } }), { status: 200 });
  }) as typeof fetch;
}

const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const json = async (res: Response | undefined) => res
  ? { status: res.status, body: await res.json().catch(() => ({})) as Body }
  : { status: 0, body: {} as Body };
const P = (id: string) => ({ params: Promise.resolve({ id }) });

/** The decision logic alone, on hand-made readings. */
function rules() {
  console.log('\nThe decision, on its own');
  const base: DeskInput = {
    result: { route: 'Blotter', classificationStatus: 'suggested', categoryConfidence: 'high', informationCompleteness: 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT',
      conflicts: [], alternativeCategories: [], suggestedCaseCategory: 'Noise Complaint', missingInformation: [], categoryRationale: [],
      supportingIndicators: [{ label: 'Loud noise', quote: 'malakas ang videoke', source: 'report' }], language: 'tagalog' },
    ai: { requested: true, used: true, status: 'ok', model: 'm', category: 'Noise Complaint', categoryConfidence: 'high', alternativeCategories: [] },
    sources: [{ framework: 'BLOTTER', sectionTitle: 'Level 1', pageNumber: 2, riskLevel: 1, riskLabel: 'Low', strength: 'strong' }],
    facts: ['noise', 'neighbors'],
    knowledgeBaseAvailable: true,
  };
  const d = (o: Partial<DeskInput> & { r?: Partial<DeskInput['result']>; a?: Partial<DeskInput['ai']> }) =>
    recommendDesk({ ...base, ...o, result: { ...base.result, ...o.r }, ai: { ...base.ai, ...o.a } });
  const plain = d({});
  ok('agreeing readings of a community matter: BLOTTER, on the blotter desk', plain.decision === 'BLOTTER' && plain.desk === 'BLOTTER' && !plain.confidentialReview);
  ok('it carries the explanation, the quoted indicators, the sources and a timestamp', plain.explanation.length > 0 && plain.indicators[0].quote === 'malakas ang videoke'
    && plain.sources.length === 1 && !Number.isNaN(Date.parse(plain.classifiedAt)));
  const v = d({ r: { route: 'VAWC', suggestedCaseCategory: 'Domestic Violence' }, a: { category: 'Domestic Violence' } });
  ok('a VAWC reading: VAWC, confidential', v.decision === 'VAWC' && v.desk === 'VAWC' && v.confidentialReview && v.filedCategory === 'Domestic Violence');
  const alt = d({ r: { alternativeCategories: ['Domestic Violence'] } });
  ok('a Blotter reading with a VAWC alternative: an official decides, and it is held on the VAWC desk as "VAWC - Other"',
    alt.decision === 'HUMAN_REVIEW' && alt.desk === 'VAWC' && alt.filedCategory === 'VAWC - Other' && alt.possibleVawc);
  const couple = d({ facts: ['partner', 'noise', 'household'] });
  ok('a partner in the report keeps it off the blotter queue even when a Blotter category won', couple.desk === 'VAWC' && couple.decision === 'HUMAN_REVIEW');
  ok('family or a child with harm does too', d({ facts: ['family', 'force'] }).desk === 'VAWC' && d({ facts: ['minor', 'threat'] }).desk === 'VAWC');
  ok('a land dispute between siblings, or children making noise, does not', d({ facts: ['family', 'boundary', 'household'] }).desk === 'BLOTTER'
    && d({ facts: ['minor', 'noise', 'curfew'] }).desk === 'BLOTTER');
  const aiV = d({ a: { category: 'Domestic Violence', categoryConfidence: 'low' } });
  ok('even an unsure AI reading of VAWC keeps it off the ordinary blotter queue', aiV.desk === 'VAWC' && aiV.confidentialReview);
  const disagree = d({ a: { category: 'Theft & Robbery' } });
  ok('readings that agree on the desk but not the category stay on the blotter desk', disagree.decision === 'BLOTTER');
  ok('how complete it is for the risk assessment does not decide the desk', d({ r: { informationCompleteness: 'INSUFFICIENT' } }).decision === 'BLOTTER');
  const vague = d({ r: { informationCompleteness: 'INSUFFICIENT', classificationStatus: 'needs_review', categoryConfidence: 'low', suggestedCaseCategory: 'Other' } });
  ok('too little to place it: NEEDS_CLARIFICATION, with neutral questions, never forced', vague.decision === 'NEEDS_CLARIFICATION' && vague.clarificationNeeded
    && vague.questions.length >= 2 && vague.questions.length <= 5);
  ok('the questions are in the report\'s language', vague.questions.some(q => /nangyari/.test(q)));
  const conflict = d({ r: { conflicts: ['Whether anyone was hurt: the written report and the answer disagree.'] } });
  ok('a report that contradicts itself: NEEDS_CLARIFICATION', conflict.decision === 'NEEDS_CLARIFICATION' && conflict.questions.some(q => /magkaibang|differ/.test(q)));
  const down = d({ a: { used: false, status: 'error', category: null } });
  ok('the AI could not run: HUMAN_REVIEW, waiting for it - no guessed desk decision', down.decision === 'HUMAN_REVIEW' && down.awaitingAi && down.ai.category === null);
  const downV = d({ a: { used: false, status: 'daily_limit', category: null }, r: { route: 'VAWC', suggestedCaseCategory: 'VAWC - Other' } });
  ok('...and a VAWC indicator from the rules still keeps it confidential meanwhile', downV.desk === 'VAWC' && downV.awaitingAi);
  ok('every recommendation says it is not a legal finding', [plain, v, vague, down].every(r => r.explanation.some(e => /not a legal finding/.test(e))));
  const noKb = d({ sources: [], knowledgeBaseAvailable: false });
  ok('no knowledge base: no source invented, and it says so', noKb.sources.length === 0 && noKb.explanation.some(e => /knowledge base could not be reached/.test(e)));
}

async function main() {
  rules();
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const savedSecret = process.env.CRON_SECRET;
  try {
    const R = await prisma.resident.create({ data: { residentNumber: `${TAG}-r-${process.pid}`, firstName: 'Probe', lastName: 'Desk',
      age: 34, gender: 'Female', barangay: 'Ayukit', address: 'temporary test row', emailVerified: true } });
    residents.push(R.id);
    const resCookie = `resident_token=${signResidentToken({ residentId: R.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    const mkUser = async (k: string, role: string) => {
      const u = await prisma.user.create({ data: { email: `probe.rd.${k}.${process.pid}@safcom.local`, name: `${TAG} ${k}`, password: pw, role } });
      users.push(u.id);
      return { ...u, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
    };
    const B = await mkUser('blotter', 'officer');
    const V = await mkUser('vawc', 'vawc_officer');

    // Filed as the page now files it: no report type, no category - only what happened.
    const file = async (text: string, extra: Body = {}) => {
      const out = await json(await filePOST(req('/api/resident/cases', resCookie, 'POST', {
        description: text, intakeNarrative: text, reportingRelationship: 'SELF', intakeAnswers: [], barangay: 'Ayukit', ...extra,
      })));
      if (out.body?.data?.id) caseIds.push(out.body.data.id);
      return out;
    };
    const stored = async (id: string) => {
      const c = await prisma.case.findUnique({ where: { id }, select: { caseType: true, reportPath: true, requiresOfficerReview: true, description: true,
        intake: { select: { narrative: true, suggestedCaseCategory: true } },
        assessmentHistory: { where: { kind: 'desk_recommendation' }, orderBy: { createdAt: 'asc' } } } });
      return { ...c!, desks: c!.assessmentHistory.map(h => h.rationale as unknown as DeskRecommendation) };
    };
    const isVawcCase = (t: string) => /Domestic|Abuse|Harassment|Stalking|Trafficking|Violence|VAWC/.test(t);

    if (!LIVE) {
    console.log('\nFictional reports, filed with no report type chosen');
    const cases: Record<string, string> = {};
    for (const [k, text, desk] of [['property', T.property, 'BLOTTER'], ['noise', T.noise, 'BLOTTER'], ['theft', T.theft, 'BLOTTER']] as const) {
      const r = await file(text);
      const s = await stored(r.body.data.id);
      cases[k] = r.body.data.id;
      ok(`${k}: filed (201) on the blotter desk, recommended BLOTTER`, r.status === 201 && !isVawcCase(s.caseType) && s.desks[0]?.decision === desk && s.desks[0].desk === 'BLOTTER',
        `${r.status} ${s.caseType} ${s.desks[0]?.decision}`);
    }
    const v = await file(T.vawc);
    const vs = await stored(v.body.data.id);
    cases.vawc = v.body.data.id;
    ok('possible VAWC: on the VAWC desk, confidential review recommended', v.status === 201 && isVawcCase(vs.caseType) && vs.desks[0].decision === 'VAWC'
      && vs.desks[0].confidentialReview, `${vs.caseType} ${vs.desks[0]?.decision}`);
    ok('the resident is told it is confidential - without naming the desk', v.body.data.desk?.confidentialReview === true && !('filedCategory' in v.body.data.desk));
    const q = await file(T.vague);
    const qs = await stored(q.body.data.id);
    ok('too little to go on: filed anyway, NEEDS_CLARIFICATION, for an officer, with questions for the resident', q.status === 201 && qs.desks[0].decision === 'NEEDS_CLARIFICATION'
      && qs.requiresOfficerReview && q.body.data.desk.clarificationNeeded && q.body.data.desk.questions.length > 0, `${qs.desks[0]?.decision}`);
    const c = await file(T.contradictory, { intakeAnswers: [{ slot: 'injury', kind: 'option', value: 'no' }] });
    const cs = await stored(c.body.data.id);
    ok('a report that contradicts its own answer: NEEDS_CLARIFICATION', c.status === 201 && cs.desks[0].decision === 'NEEDS_CLARIFICATION', `${cs.desks[0]?.decision}`);
    const m = await file(T.maybeVawc);
    const ms = await stored(m.body.data.id);
    cases.maybe = m.body.data.id;
    ok('a quarrel between a couple, read as a noise complaint: never the ordinary blotter queue - held on the VAWC desk',
      m.status === 201 && isVawcCase(ms.caseType) && ms.desks[0].possibleVawc && ms.desks[0].confidentialReview, `${ms.caseType} ${ms.desks[0]?.decision}`);
    ok('the original narrative is kept word for word', ms.intake?.narrative === T.maybeVawc && ms.description === T.maybeVawc);
    ok('no report type is stored as if the resident chose one', [vs, qs, ms].every(x => x.reportPath === null));
    ok('sources are only knowledge-base chunks actually retrieved, from both desks\' matrices', [vs, ms].every(x => x.desks[0].sources.every(s => ['BLOTTER', 'VAWC'].includes(s.framework) && s.sectionTitle)));

    console.log('\nGroq unavailable');
    fake.down = true;
    const d1 = await file(T.downVawc);
    const d2 = await file(T.downPlain);
    const d1s = await stored(d1.body.data.id); const d2s = await stored(d2.body.data.id);
    ok('the reports are still filed', d1.status === 201 && d2.status === 201);
    ok('no desk is guessed: HUMAN_REVIEW, waiting for the AI, for an officer', [d1s, d2s].every(x => x.desks[0].decision === 'HUMAN_REVIEW' && x.desks[0].awaitingAi && x.requiresOfficerReview));
    ok('the resident is told it is saved and will be classified', d1.body.data.desk?.awaitingAi === true);
    ok('a VAWC indicator from the rules alone keeps it confidential meanwhile', isVawcCase(d1s.caseType), d1s.caseType);
    ok('without one, it waits on the desk the rules read it for', !isVawcCase(d2s.caseType), d2s.caseType);
    process.env.CRON_SECRET = `${TAG}-secret`;
    const cron = () => cronGET(req(`/api/cron/desk-classification?key=${TAG}-secret`, '')).then(json);
    ok('the retry is refused without the secret', (await cronGET(req('/api/cron/desk-classification?key=wrong', '')).then(json)).status === 401);
    const still = await cron();
    ok('while the AI is still down, the retry guesses nothing', still.status === 200 && still.body.data.results.filter((x: Body) => [d1s, d2s].length && x.result === 'still_waiting').length >= 2
      && (await stored(d1.body.data.id)).desks.length === 1);
    fake.down = false;
    const back = await cron();
    const d1b = await stored(d1.body.data.id); const d2b = await stored(d2.body.data.id);
    ok('once it is back, each waiting report is classified and the new recommendation added to the history', back.status === 200 && d1b.desks.length === 2 && !d1b.desks[1].awaitingAi
      && d1b.desks[0].awaitingAi === true, JSON.stringify(back.body.data?.results));
    ok('a report the AI now reads as VAWC is moved onto the VAWC desk', isVawcCase(d2b.caseType) && d2b.desks.at(-1)!.desk === 'VAWC',
      `${d2b.caseType} ${JSON.stringify(back.body.data?.results)} ${JSON.stringify(d2b.desks.at(-1)?.ai)} ${d2b.desks.at(-1)?.decision}`);
    const again = await cron();
    ok('a classified report is not retried again', again.status === 200
      && !again.body.data.results.some((x: Body) => x.result !== 'skipped' && (x.caseNumber === d1.body.data.caseNumber || x.caseNumber === d2.body.data.caseNumber)), JSON.stringify(again.body.data?.results));

    console.log('\nWho sees what');
    const asB = (id: string) => caseGET(req(`/api/cases/${id}`, B.cookie), P(id)).then(json);
    const asV = (id: string) => caseGET(req(`/api/cases/${id}`, V.cookie), P(id)).then(json);
    ok('a blotter officer cannot open the VAWC report - not found', (await asB(cases.vawc)).status === 404);
    ok('nor the one held on the VAWC desk for review', (await asB(cases.maybe)).status === 404);
    ok('the VAWC officer can, with the AI recommendation in its history', (await asV(cases.vawc)).status === 200
      && (await asV(cases.vawc)).body.data.assessmentHistory.some((h: Body) => h.kind === 'desk_recommendation'));
    ok('the blotter officer opens the blotter reports', (await asB(cases.noise)).status === 200);
    const list = await json(await casesGET(req('/api/cases?limit=100&search=' + encodeURIComponent(RUN), B.cookie)));
    const listed = JSON.stringify(list.body);
    ok('the blotter case list leaves the confidential reports out', !listed.includes(cases.vawc) && !listed.includes(cases.maybe));

    console.log('\nAn officer corrects the AI');
    const fix = (id: string, cookie: string, body: Body) => classPATCH(req(`/api/cases/${id}/classification`, cookie, 'PATCH', body), P(id)).then(json);
    ok('a blotter officer cannot touch the held report', (await fix(cases.maybe, B.cookie, { caseType: 'Noise Complaint', reason: 'It is only noise' })).status === 404);
    ok('a change needs a reason', (await fix(cases.maybe, V.cookie, { caseType: 'Noise Complaint' })).status === 400);
    const moved = await fix(cases.maybe, V.cookie, { caseType: 'Noise Complaint', reason: 'Spoke with the reporter: a loud party, no violence' });
    ok('the VAWC officer sends it to the blotter desk, with the reason', moved.status === 200, `${moved.status} ${moved.body.error ?? ''}`);
    const after = await prisma.case.findUnique({ where: { id: cases.maybe }, select: { caseType: true, assessmentHistory: { orderBy: { createdAt: 'asc' } } } });
    const change = after!.assessmentHistory.find(h => h.kind === 'category_change');
    ok('the official decision is recorded apart, with who, when, before and after', after!.caseType === 'Noise Complaint' && change?.actorId === V.id
      && change.previousCaseType === 'VAWC - Other' && change.reason === 'Spoke with the reporter: a loud party, no violence');
    ok('the original AI recommendation is kept as it was', after!.assessmentHistory.some(h => h.kind === 'desk_recommendation' && (h.rationale as Body).filedCategory === 'VAWC - Other'));
    ok('the same case, now on the blotter desk', (await asB(cases.maybe)).status === 200);
    let blocked = false;
    try { await prisma.assessmentHistory.updateMany({ where: { caseId: cases.maybe, kind: 'desk_recommendation' }, data: { reason: 'rewritten' } }); } catch { blocked = true; }
    ok('a stored recommendation cannot be rewritten in the database', blocked);
    }

    if (LIVE) {
      console.log('\nThe real Groq, on the fictional reports (no case is filed)');
      let first = true;
      for (const [k, text] of Object.entries({ property: T.property, noise: T.noise, theft: T.theft, vawc: T.vawc, vague: T.vague, maybeVawc: T.maybeVawc })) {
        // The free plan allows about 7,000 tokens a minute: one report a minute, or the pace guard answers "busy".
        if (!first) await new Promise(r => setTimeout(r, 62_000));
        first = false;
        const analysis = await runIntake({ residentId: R.id, narrative: text, answers: [], selectedCategory: null, street: 'Ayukit', gender: 'Female',
          useAi: true, residentNames: ['Probe', 'Desk'], relationship: 'SELF', turns: [] });
        const rec = await deskFor(analysis, text, true);
        console.log(`    ${k.padEnd(10)} AI ${analysis.grounding.ai?.status}/${analysis.grounding.ai?.hints?.category ?? '-'} -> ${rec.decision}, desk ${rec.desk}${rec.confidentialReview ? ' (confidential)' : ''}, ${rec.sources.length} source(s)`);
        if (k === 'vawc') ok('live: the VAWC report goes to the VAWC desk', rec.desk === 'VAWC');
        if (k === 'noise' || k === 'theft') ok(`live: the ${k} report stays on the blotter desk`, rec.desk === 'BLOTTER');
        if (k === 'maybeVawc') ok('live: the couple\'s quarrel is kept off the ordinary blotter queue', rec.desk === 'VAWC');
        if (k === 'vague') ok('live: the vague report is not forced into a desk decision', rec.decision === 'NEEDS_CLARIFICATION' || rec.decision === 'HUMAN_REVIEW');
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.aiUsage.deleteMany({ where: { OR: residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })) } });
    // A live run used real quota: the day's count keeps it, so the budget guard stays true.
    if (!LIVE) {
      if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
      else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
    }
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.rd.' } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
