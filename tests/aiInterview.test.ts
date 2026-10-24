/**
 * The Groq interview and assessment, through the real API routes and the
 * real database, with Groq itself replaced by a fake - so nothing is sent
 * anywhere and no free quota is used.
 * Run with:  npm run test:interview
 *
 * Temporary residents, officials and cases are marked PROBE-IV and removed
 * at the end, with their audit rows (through the purge switch the
 * append-only trigger allows). Today's app-wide usage row is put back as it
 * was before the run.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey, callGroq } from '../lib/aiClassifier';
import { retrieveSources, assessWithSources, checkAssessment, type SourceChunk } from '../lib/aiAssessment';
import { UNSAFE_QUESTION, sameQuestion, runInterview } from '../lib/aiInterview';
import { runIntake } from '../lib/intakeServer';
import type { KbDb } from '../lib/knowledgeBase';
import { POST as intakePOST } from '../app/api/resident/intake/route';
import { POST as filePOST, GET as myCasesGET } from '../app/api/resident/cases/route';
import { GET as caseGET } from '../app/api/cases/[id]/route';
import { GET as casesGET } from '../app/api/cases/route';
import { GET as residentGET } from '../app/api/residents/[id]/route';
import { POST as revealPOST } from '../app/api/cases/[id]/reporter/reveal/route';

// Fast and roomy for a test run; the free-plan caps still bound them.
process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_TIMEOUT_MS = '2000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── A fake Groq, chosen per call by the schema name ─────────────────────────

type Sent = { name: string; system: string; user: string };
const sent: Sent[] = [];
const fake: {
  mode: 'ok' | 'malformed' | 'wrong_shape' | '429' | 'timeout';
  interview: (user: string) => unknown;
  assessment: (user: string) => unknown;
} = { mode: 'ok', interview: () => GOOD_INTERVIEW, assessment: u => assessmentFor(u) };

const GOOD_INTERVIEW = {
  understanding: 'The report says the reporter heard a neighbour shouting for help and someone threatening her.',
  possibleCategories: ['Assault', 'Domestic Violence', 'Witchcraft'],
  missingInformation: ['Whether the person is safe now', 'Whether anyone was hurt'],
  questions: [
    { text: 'Is the neighbour in danger right now?', answerType: 'yes_no', slot: 'safety' },
    { text: 'Can you confront him and ask why he did it?', answerType: 'short_text', slot: 'none' },
    { text: 'Did you see it happen, hear it, or were you told about it?', answerType: 'short_text', slot: 'none' },
    { text: 'Is the neighbour in danger right now?', answerType: 'yes_no', slot: 'none' },
  ],
  immediateDangerToAssess: true, possibleOngoingDanger: false, dangerQuote: null, sufficientForPreliminary: false,
};

/** An assessment that cites the passages it was actually sent - plus one invented criterion and a phone number. */
function assessmentFor(user: string) {
  const sid = (fw: string, level: number) => new RegExp(`\\[(S\\d+)\\] ${fw} [^\\n]*Level ${level} `).exec(user)?.[1] ?? 'S0';
  const quote = /threatening her|nagbabanta sa kanya|Sinasaktan ako/.exec(user)?.[0] ?? 'not in the report';
  return {
    facts: quote === 'not in the report' ? [] : [{ key: 'threat', quote }],
    slots: [], category: 'Assault', categoryConfidence: 'medium', alternativeCategories: [], reasons: ['A threat is reported.'],
    assessment: {
      framework: 'BLOTTER', riskLevel: 5, riskLabel: 'made up',
      criteria: [
        { level: 3, criterion: 'Credible verbal threats', source: sid('BLOTTER', 3), reportQuote: quote },
        { level: 5, criterion: 'Witchcraft accusations', source: sid('BLOTTER', 5), reportQuote: quote },
      ],
      classificationStatus: 'PRELIMINARY', understanding: 'The reporter states they heard a threat.',
      missingInformation: ['Whether anyone was hurt'], uncertainty: ['The reporter did not see it'],
      recommendedNextAction: 'Call the reporter at 0917 123 4567 and record a statement.', urgentHumanReview: false,
      affectedPerson: 'OTHER_PERSON', reporterKnowledge: 'HEARD',
    },
  };
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  const name = body.response_format.json_schema.name as string;
  sent.push({ name, system: body.messages[0].content, user: body.messages[1].content });
  if (fake.mode === '429') return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
  if (fake.mode === 'timeout') {
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  const reply = fake.mode === 'malformed' ? 'this is not json {'
    : fake.mode === 'wrong_shape' ? JSON.stringify({ questions: 'none' })
      : JSON.stringify(name === 'interview_round' ? fake.interview(body.messages[1].content) : fake.assessment(body.messages[1].content));
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { total_tokens: 40 } }), { status: 200 });
}) as typeof fetch;

// ─── Calling the routes in-process ───────────────────────────────────────────

const req = (path: string, cookie: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
// Response bodies are read loosely here; the assertions say what each must hold.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const N_THIRD = "I heard my neighbor shouting for help last night. I heard someone threatening her, but I didn't see what happened.";
const N_TL = 'Narinig ko kagabi na sumisigaw ng tulong ang kapitbahay namin at may nagbabanta sa kanya.';
const N_DANGER = 'Sinasaktan ako ng asawa ko ngayon mismo, nandito pa siya sa bahay, tulungan niyo ako.';
const N_THIN = 'May problema ako.';

const TAG = 'PROBE-IV';

async function main() {
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  const mkResident = async (key: string) => {
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${key}-${process.pid}`, firstName: 'Mariel', lastName: `Probe${key}`,
      age: 30, gender: 'Female', barangay: 'Ayukit', address: 'temporary test row', contactNumber: '09170000555', emailVerified: true } });
    residents.push(r.id);
    return { id: r.id, cookie: `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Probe', role: 'resident' })}` };
  };
  const mkUser = async (key: string, role: string) => {
    const u = await prisma.user.create({ data: { email: `probe.iv.${key}.${process.pid}@safcom.local`, name: `${TAG} ${key}`, password: pw, role } });
    users.push(u.id);
    return { id: u.id, cookie: `safcom_token=${signToken({ userId: u.id, email: u.email, role })}` };
  };
  const file = async (cookie: string, body: Record<string, unknown>) => {
    const r = await json(await filePOST(req('/api/resident/cases', cookie, { description: body.intakeNarrative, ...body })));
    if (r.body?.data?.id) caseIds.push(r.body.data.id);
    return r;
  };

  try {
    const A = await mkResident('A');
    const B = await mkResident('B');
    const officer = await mkUser('blotter', 'officer');

    console.log('1. question generation');
    sent.length = 0;
    const r1 = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD, relationship: 'THIRD_PARTY', wantQuestions: true })));
    const iv = r1.body.data?.interview;
    ok('Groq questions come back, structured', r1.status === 200 && iv?.used === true && Array.isArray(iv.questions), JSON.stringify(r1.body).slice(0, 200));
    ok('...the unsafe "confront him" question is removed', !iv.questions.some((q: { text: string }) => /confront/i.test(q.text)));
    ok('...the repeated question is removed', iv.questions.filter((q: { text: string }) => /in danger right now/.test(q.text)).length === 1);
    ok('...danger now is asked first, tagged to the rules’ safety question', iv.questions[0]?.slot === 'safety' && iv.immediateDangerToAssess === true);
    ok('...ids and answer types are set on the server', iv.questions.every((q: { id: string; answerType: string }) => /^r1q\d$/.test(q.id) && q.answerType));
    ok('...an unknown category is dropped from "may fit"', !iv.possibleCategories.includes('Witchcraft'));
    ok('...the rules’ reading still comes back alongside', typeof r1.body.data.informationCompleteness === 'string');
    ok('third-party framing reaches the prompt', /THIRD_PARTY - the incident involves someone else/.test(sent[0]?.user ?? ''));
    ok('the resident’s name and phone are not sent', !/Mariel|ProbeA|0917/.test(sent.map(s => s.user).join(' ')));
    ok('the prompt forbids confronting, investigating and collecting evidence',
      /Never ask the reporter to confront/.test(sent[0]?.system ?? '') && /investigate/.test(sent[0]?.system ?? ''));
    ok('the unsafe-question filter catches Filipino too', UNSAFE_QUESTION.test('Puwede mo bang kausapin mo siya tungkol dito?')
      && UNSAFE_QUESTION.test('Kunan mo ng litrato ang bahay nila') && !UNSAFE_QUESTION.test('Nasa panganib ba siya ngayon?'));
    ok('near-duplicates are recognised', sameQuestion('Is the neighbour in danger right now?', 'Is the neighbour in danger now?')
      && !sameQuestion('Is the neighbour in danger right now?', 'Has this happened before?'));
    const calls = sent.length;
    await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD, relationship: 'THIRD_PARTY',
      turns: [{ ...iv.questions[0], kind: 'option', value: 'unsure' }], wantQuestions: false })));
    ok('answering inside a round does not call Groq again', sent.length === calls);

    console.log('\n2. the language of the report');
    sent.length = 0;
    await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_TL, relationship: 'THIRD_PARTY', wantQuestions: true })));
    await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' Again.', relationship: 'SELF', wantQuestions: true })));
    ok('a Tagalog report asks for Filipino questions', /LANGUAGE: Filipino/.test(sent[0]?.user ?? ''));
    ok('an English report asks for English questions', /LANGUAGE: English/.test(sent[1]?.user ?? ''));

    console.log('\n3. bad answers, limits, timeouts, no key');
    fake.mode = 'malformed';
    const m = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' (malformed)', wantQuestions: true })));
    ok('non-JSON from Groq -> interview error, rules question instead, still 200', m.status === 200 && m.body.data.interview.status === 'error'
      && m.body.data.interview.used === false && Boolean(m.body.data.nextQuestion));
    fake.mode = 'wrong_shape';
    const w = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' (shape)', wantQuestions: true })));
    ok('JSON in the wrong shape -> rejected, not shown', w.body.data.interview.used === false && w.body.data.interview.questions.length === 0);
    fake.mode = '429';
    const rl = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' (429)', wantQuestions: true })));
    ok('429 from Groq -> rate_limited, report still workable', rl.status === 200 && rl.body.data.interview.status === 'rate_limited');
    await sleep(1200);
    fake.mode = 'timeout';
    const to = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' (timeout)', wantQuestions: true })));
    ok('a Groq timeout -> error after the time limit, never a hang', to.status === 200 && to.body.data.interview.status === 'error');
    fake.mode = 'ok';
    const key = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = '';
    sent.length = 0;
    const off = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD + ' (no key)', relationship: 'THIRD_PARTY', wantQuestions: true })));
    ok('no API key -> AI off, nothing sent, the rules ask', off.body.data.interview.status === 'off' && sent.length === 0 && Boolean(off.body.data.nextQuestion));
    ok('...and the rules’ question is about the other person, not "are you safe"',
      /As far as you know, is anyone in danger/.test(off.body.data.nextQuestion?.text ?? ''), off.body.data.nextQuestion?.text);
    process.env.GROQ_API_KEY = key;
    const limitTurns = [1, 2, 3].map(r => ({ id: `r${r}q1`, round: r, text: `Question ${r} about the report?`, answerType: 'yes_no', slot: null, kind: 'skipped' }));
    sent.length = 0;
    const lim = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_THIRD, turns: limitTurns, wantQuestions: true })));
    ok('after three rounds no more are asked, and Groq is not called', lim.body.data.interview.status === 'limit_reached' && sent.length === 0);
    const failingStore = { reserve: async () => { throw new Error('db down'); }, adjust: async () => {}, read: async () => ({ requests: 0, tokens: 0 }) };
    sent.length = 0;
    const dbDown = await callGroq({ name: 'x', schema: {}, system: 's', user: 'u-db', residentId: 'r' }, { store: failingStore });
    ok('usage table unreachable -> nothing sent, the rules answer', dbDown.status === 'error' && sent.length === 0);

    console.log('\n4. immediate danger');
    process.env.GROQ_API_KEY = '';
    const dz = await json(await intakePOST(req('/api/resident/intake', A.cookie, { narrative: N_DANGER, relationship: 'SELF', wantQuestions: true })));
    ok('with the AI off, the rules still flag danger now', dz.body.data.immediateSafetyConcern === true);
    process.env.GROQ_API_KEY = key;
    fake.interview = () => ({ ...GOOD_INTERVIEW, possibleOngoingDanger: true, dangerQuote: 'nandito pa siya sa bahay' });
    const d2 = await runInterview({ narrative: N_DANGER, relationship: 'SELF', turns: [], residentId: A.id, language: 'tl', knownSlots: [] });
    ok('the AI’s "happening now" counts only with the words to show it', d2.possibleOngoingDanger === true && d2.dangerQuote === 'nandito pa siya sa bahay');
    fake.interview = () => ({ ...GOOD_INTERVIEW, possibleOngoingDanger: true, dangerQuote: 'he has a gun pointed at me' });
    // Different words, so this is not the cached answer to the one above.
    const d3 = await runInterview({ narrative: N_DANGER + ' Kanina pa ito.', relationship: 'SELF', turns: [], residentId: A.id, language: 'tl', knownSlots: [] });
    ok('...an invented quote does not raise the alarm', d3.possibleOngoingDanger === false && d3.dangerQuote === null);
    fake.interview = () => ({ ...GOOD_INTERVIEW, questions: [{ text: 'Has this happened before?', answerType: 'yes_no', slot: 'recurrence' }] });
    const inj = await json(await intakePOST(req('/api/resident/intake', B.cookie, { narrative: 'Sinuntok ako ng kapitbahay namin kahapon sa kanto.', wantQuestions: true })));
    ok('if the AI leaves out "danger now", the rules’ safety question is put first', inj.body.data.interview.questions[0]?.slot === 'safety'
      && /^r1s$/.test(inj.body.data.interview.questions[0]?.id));
    fake.interview = () => GOOD_INTERVIEW;

    console.log('\n5. the matrices: retrieval, checking, failure');
    const vawcOnly = await retrieveSources(['VAWC'], 'sinakal ako', []);
    ok('VAWC retrieval returns only VAWC passages, levels 1-5', vawcOnly.ok && vawcOnly.chunks.every(c => c.documentType === 'VAWC')
      && [1, 2, 3, 4, 5].every(l => vawcOnly.chunks.some(c => c.riskLevel === l)));
    const blotterOnly = await retrieveSources(['BLOTTER'], 'ninakaw ang bisikleta', []);
    ok('Blotter retrieval returns only Blotter passages', blotterOnly.ok && blotterOnly.chunks.every(c => c.documentType === 'BLOTTER'));
    sent.length = 0;
    await runIntake({ residentId: A.id, narrative: 'Sinuntok ako ng kapitbahay namin kagabi sa tapat ng tindahan.', useAi: true, relationship: 'SELF' });
    const clearUser = sent.find(s => s.name === 'report_assessment')?.user ?? '';
    ok('a clearly blotter report is assessed against the Blotter matrix only', /\] BLOTTER /.test(clearUser) && !/\] VAWC /.test(clearUser));
    sent.length = 0;
    await runIntake({ residentId: A.id, narrative: 'May problema kami sa bahay ng asawa ko at ng kapitbahay.', useAi: true, relationship: 'SELF' });
    const unclearUser = sent.find(s => s.name === 'report_assessment')?.user ?? '';
    ok('an unclear report is given both matrices', /\] BLOTTER /.test(unclearUser) && /\] VAWC /.test(unclearUser));
    const g = await runIntake({ residentId: A.id, narrative: N_THIRD, useAi: true, relationship: 'THIRD_PARTY' });
    const a = g.grounding.ai?.assessment;
    ok('a criterion found in the source and the report is kept, with the document’s label', a?.level === 3
      && a.criteria.length === 1 && a.criteria[0].criterion === 'Credible verbal threats' && a.label === 'HIGH — Serious Non-Domestic Dispute', JSON.stringify(a).slice(0, 300));
    ok('...an invented criterion is discarded, not believed', a?.droppedCriteria === 1 && !a.criteria.some(c => /Witchcraft/.test(c.criterion)));
    ok('...the model’s "Level 5" does not stand without a criterion', a?.level !== 5);
    ok('...a phone number in its suggested action is removed', !/0917/.test(a?.recommendedNextAction ?? '') && /\[number removed\]/.test(a?.recommendedNextAction ?? ''));
    ok('...category, level, status, missing info and next action are separate fields',
      a !== undefined && a !== null && 'suggestedCategory' in a && 'classificationStatus' in a && a.missingInformation.length > 0 && a.uncertainty.length > 0);
    ok('...third-party roles are kept apart', a?.affectedPerson === 'OTHER_PERSON' && a.reporterKnowledge === 'HEARD');
    ok('...the VAWC/Blotter status is stored with it', /do not establish legal guilt/.test(a?.frameworkStatus ?? ''));
    const chunks = (await retrieveSources(['BLOTTER'], 'x', [])).chunks as SourceChunk[];
    const fakeLevel = checkAssessment({ ...assessmentFor('').assessment, criteria: [{ level: 3, criterion: 'Credible verbal threats', source: 'S99', reportQuote: 'threatening her' }] },
      { sourceText: N_THIRD, chunks });
    ok('a criterion citing a passage that was not sent is discarded', fakeLevel?.level === null && fakeLevel.droppedCriteria === 1);
    const thin = await runIntake({ residentId: A.id, narrative: N_THIN, useAi: true, relationship: 'SELF' });
    ok('too little information -> no level from the AI, not PRELIMINARY', thin.grounding.ai?.assessment?.level === null
      && thin.result.assessmentStatus !== 'PRELIMINARY', `${thin.grounding.ai?.assessment?.level} ${thin.result.assessmentStatus}`);
    const brokenDb = {
      $queryRaw: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
      $transaction: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
    } as KbDb;
    const down = await assessWithSources({ narrative: N_THIRD, relationship: 'THIRD_PARTY', residentId: A.id, frameworks: ['BLOTTER'] }, { db: brokenDb });
    ok('matrix text unreachable -> ASSESSMENT_UNAVAILABLE, says why', down.assessment?.status === 'ASSESSMENT_UNAVAILABLE'
      && /knowledge base/.test(down.assessment.unavailableReason ?? ''));
    const downIntake = await runIntake({ residentId: A.id, narrative: N_THIRD + ' (kb down)', useAi: true, relationship: 'THIRD_PARTY' }, brokenDb);
    ok('...and the case goes to a person, the matrix not claimed as consulted', downIntake.result.assessmentStatus !== 'PRELIMINARY'
      && downIntake.result.reviewReasons.some(r => /AI assessment unavailable/.test(r)));
    fake.assessment = u => ({ ...assessmentFor(u), assessment: { ...assessmentFor(u).assessment, criteria: [], riskLevel: null } });
    const lower = await runIntake({ residentId: A.id, narrative: 'Sinuntok ako ng kapitbahay namin kagabi sa tapat ng tindahan. (lower)', useAi: true, relationship: 'SELF' });
    ok('the AI finding less than the rules never lowers the level; it sends it for review', lower.result.riskLevel === 'High'
      && lower.result.assessmentStatus === 'FOR_REVIEW', `${lower.result.riskLevel} ${lower.result.assessmentStatus}`);
    fake.assessment = u => assessmentFor(u);

    console.log('\n6. filing: what is kept');
    const turns = [
      { id: 'r1q1', round: 1, text: 'Is the neighbour in danger right now?', answerType: 'yes_no', slot: 'safety', kind: 'option', value: 'unsure' },
      { id: 'r1q2', round: 1, text: 'Did you see it happen, hear it, or were you told about it?', answerType: 'short_text', slot: null, kind: 'text', answerText: 'I heard it through the wall' },
      { id: 'r1q3', round: 1, text: 'Was anyone hurt?', answerType: 'yes_no', slot: 'injury', kind: 'skipped' },
      { id: 'r2q1', round: 2, text: 'Has this happened before?', answerType: 'yes_no', slot: 'recurrence', kind: 'declined' },
    ];
    const f = await file(A.cookie, { intakeNarrative: N_THIRD, reportingRelationship: 'THIRD_PARTY', affectedPersonNote: 'the woman next door', intakeTurns: turns, intakeAnswers: [] });
    ok('a third-party report is filed', f.status === 201, JSON.stringify(f.body).slice(0, 200));
    const stored = await prisma.case.findUnique({ where: { id: f.body.data.id }, include: { intake: true } });
    ok('the original narrative is kept exactly', stored?.intake?.narrative === N_THIRD && stored.description.startsWith(N_THIRD));
    const iv2 = stored?.intake?.aiInterview as { turns: typeof turns; relationship: string } | null;
    // JSONB keeps the content, not the key order, so compare key by key.
    const canon = (x: unknown) => JSON.stringify(x, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v);
    ok('every question is kept with its answer, skip or "prefer not to answer"', canon(iv2?.turns) === canon(turns)
      && iv2?.relationship === 'THIRD_PARTY', `${JSON.stringify(iv2?.turns)} vs ${JSON.stringify(turns)}`);
    ok('relationship and affected person are stored; the reporter is not made the victim', stored?.reportingRelationship === 'THIRD_PARTY'
      && stored.affectedPersonNote === 'the woman next door' && !stored.reporterIdentityWithheld);
    const aiStored = stored?.intake?.aiReading as { assessment?: { status: string; level: number; at: string; sources: unknown[] } } | null;
    ok('the AI assessment is stored with its sources and time', aiStored?.assessment?.status === 'COMPLETED' && aiStored.assessment.level === 3
      && Boolean(aiStored.assessment.at) && (aiStored.assessment.sources?.length ?? 0) > 0);
    ok('the AI’s classification is never what the browser sent', !('intakeClassification' in (f.body.data ?? {}))
      && stored?.caseType === g.result.suggestedCaseCategory);
    const unsafeTurn = await file(A.cookie, { intakeNarrative: N_THIRD, reportingRelationship: 'SELF',
      intakeTurns: [{ id: 'bad id', round: 1, text: 'x', answerType: 'yes_no', slot: null, kind: 'skipped' }] });
    ok('a malformed interview record is refused, not stored', unsafeTurn.status === 400);

    console.log('\n7. anonymous reporting');
    const an = await file(B.cookie, { intakeNarrative: N_TL, reportingRelationship: 'ANONYMOUS', contactPreference: 'call_ok', intakeTurns: [] });
    ok('an anonymous report is filed', an.status === 201);
    const anon = await prisma.case.findUnique({ where: { id: an.body.data.id } });
    ok('...under "Anonymous reporter", identity withheld, no contact preference kept',
      anon?.residentName === 'Anonymous reporter' && anon.reporterIdentityWithheld && anon.contactPreference === null && anon.residentId === B.id);
    const det = await json(await caseGET(req(`/api/cases/${anon!.id}`, officer.cookie), params(anon!.id)));
    ok('the officer’s case view has no resident link or name', det.status === 200 && det.body.data.resident === null && det.body.data.residentId === null
      && !JSON.stringify(det.body).includes('ProbeB'));
    const list = await json(await casesGET(req('/api/cases?search=Anonymous%20reporter&limit=100', officer.cookie)));
    ok('the case list has no resident link for it', list.body.data.cases.filter((c: { id: string }) => c.id === anon!.id).every((c: { residentId: string | null }) => c.residentId === null));
    const dir = await json(await residentGET(req(`/api/residents/${B.id}`, officer.cookie), params(B.id)));
    ok('the resident directory does not list it under the resident', !JSON.stringify(dir.body).includes(anon!.caseNumber));
    const rv = await json(await revealPOST(req(`/api/cases/${anon!.id}/reporter/reveal`, officer.cookie, { fields: ['phone'], reason: 'Need to follow up on this' }), params(anon!.id)));
    ok('contact reveal is refused for every role, and logged', rv.status === 403 && rv.body.code === 'identity_withheld'
      && (await prisma.reporterAccessLog.count({ where: { caseId: anon!.id, code: 'identity_withheld' } })) === 1);
    const mine = await json(await myCasesGET(req('/api/resident/cases?limit=50', B.cookie)));
    ok('the reporter still sees it in My Cases', JSON.stringify(mine.body).includes(anon!.caseNumber));

    console.log('\n8. other people’s reports');
    const other = await json(await myCasesGET(req('/api/resident/cases?limit=50', A.cookie)));
    ok('a resident does not see another resident’s report', !JSON.stringify(other.body).includes(anon!.caseNumber));
    const asResident = await json(await caseGET(req(`/api/cases/${f.body.data.id}`, B.cookie), params(f.body.data.id)));
    ok('a resident session cannot open the officers’ case view', asResident.status === 401);
    const urgent = await file(A.cookie, { intakeNarrative: N_DANGER, reportingRelationship: 'SELF', intakeTurns: [] });
    const u = await prisma.case.findUnique({ where: { id: urgent.body.data.id }, include: { intake: true, notifications: true } });
    ok('a danger-now report is filed, marked urgent, and the desks notified', urgent.status === 201 && u?.intake?.urgentReview === true
      && u.requiresOfficerReview && u.notifications.length > 0);
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { actorId: { in: users } }] } });
    });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.activity.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.aiUsage.deleteMany({ where: { OR: residents.map(r => ({ bucket: { startsWith: `resident:${r}:` } })) } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0
    && await prisma.user.count({ where: { email: { startsWith: 'probe.iv.' } } }) === 0);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
