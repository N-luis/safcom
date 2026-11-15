/**
 * Long reports, structured-output failures, contradictions, the evaluation
 * metrics and the safety readings. Groq is replaced by a fake: nothing is
 * sent anywhere. The matrix passages are read from the real knowledge base
 * (read-only), as the filing route does.
 *
 *   npm run test:staged
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { aiConfig, callGroq, Pacer, NOW_WORDS, type UsageStore } from '../lib/aiClassifier';
import { splitNarrative, checkSection, assessWithSources, checkAssessment, retrieveSources, STAGED_FROM_CHARS, SECTION_CHARS } from '../lib/aiAssessment';
import { analyzeIntake, triageStatusFor } from '../lib/intake';
import { confusion, levelAgreement } from './eval/metrics';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

const store: UsageStore = { reserve: async () => ({ ok: true }), adjust: async () => {}, read: async () => ({ requests: 0, tokens: 0 }) };
const cfg = { ...aiConfig({ GROQ_API_KEY: 'test-key-not-real' }), maxWaitMs: 60_000, tokensPerMinute: 10_000_000, requestsPerMinute: 10_000 };
const deps = () => ({ config: cfg, store, pacer: new Pacer(Date.now, async () => {}) });
const groqReply = (content: unknown, tokens = 1000) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: tokens } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } });

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'eval/classificationDataset.json'), 'utf8')) as { cases: { id: string; narrative: string }[] };
const LONG = dataset.cases.find(c => c.id === 'very-long-unconscious-at-end')!.narrative;

function splitting() {
  console.log('1. splitting a long report');
  const parts = splitNarrative(LONG);
  ok(`a ${LONG.length}-character report is longer than one reading (${STAGED_FROM_CHARS})`, LONG.length > STAGED_FROM_CHARS);
  ok(`it splits into ${parts.length} sections, none over ${SECTION_CHARS} characters`, parts.length > 1 && parts.every(p => p.length <= SECTION_CHARS));
  ok('nothing is lost and the order is kept', ws(parts.join(' ')) === ws(LONG));
  ok('the last paragraph (the most serious event) is in the last section', parts.at(-1)!.includes('nawalan ako ng malay'));
  const wall = 'salita '.repeat(900).trim();
  const wallParts = splitNarrative(wall);
  ok('one long paragraph with no full stops still splits, at spaces, losing nothing', wallParts.length > 1 && wallParts.every(p => p.length <= SECTION_CHARS) && ws(wallParts.join(' ')) === ws(wall));
  const sentences = Array.from({ length: 40 }, (_, i) => `Pangungusap bilang ${i + 1} tungkol sa nangyari.`).join(' ');
  const sp = splitNarrative(sentences, 300);
  ok('a long paragraph splits at sentence ends', sp.every(p => /\.$/.test(p)) && ws(sp.join(' ')) === ws(sentences));
  ok('a short report is one section', splitNarrative('Tinulak ako ng asawa ko.').length === 1);
}

function sectionChecks() {
  console.log('\n2. checking one section\'s answer');
  const text = 'Kanina po, sinakal niya ako. Nandito pa po siya ngayon.';
  const c = checkSection({
    facts: [{ key: 'choking', quote: 'sinakal niya ako' }, { key: 'weapon', quote: 'may baril siya' }, { key: 'imminent', quote: 'sinakal niya ako' },
      { key: 'imminent', quote: 'Nandito pa po siya ngayon' }, { key: 'madeUp', quote: 'sinakal niya ako' }],
    slots: [{ slot: 'timing', value: 'yes', quote: 'Nandito pa po siya ngayon' }],
    incidents: [{ summary: 'Strangled.', timing: 'recent', quote: 'sinakal niya ako' }, { summary: 'Invented.', timing: 'past', quote: 'sinuntok niya ako' }],
  }, text, 3);
  ok('facts quoted from the section are kept, with the section number', Boolean(c?.facts.some(f => f.key === 'choking' && f.section === 3)));
  ok('a fact whose words are not in the section is dropped', !c?.facts.some(f => f.key === 'weapon'));
  ok('"happening now" needs words that say so', c?.facts.filter(f => f.key === 'imminent').length === 1);
  ok('an unknown fact name is dropped', !c?.facts.some(f => f.key === 'madeUp'));
  ok('an incident whose quote is not in the section is dropped', c?.incidents.length === 1);
  ok('an answer out of shape is refused', checkSection({ facts: 'x' }, text, 1) === null);
}

async function staged() {
  console.log('\n3. a long report, read in stages (fake Groq)');
  const calls: { name: string; user: string }[] = [];
  const fetchFake: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const name = body.response_format.json_schema.name as string;
    const user = body.messages[1].content as string;
    calls.push({ name, user });
    if (name === 'report_section') {
      const facts: { key: string; quote: string }[] = [];
      const incidents: { summary: string; timing: string; quote: string }[] = [];
      if (user.includes('Una ay sampal lang')) { facts.push({ key: 'force', quote: 'Una ay sampal lang' }); incidents.push({ summary: 'Slapped during arguments.', timing: 'past', quote: 'Una ay sampal lang' }); }
      if (user.includes('Sinakal po niya ako')) {
        facts.push({ key: 'choking', quote: 'Sinakal po niya ako' }, { key: 'unconscious', quote: 'nawalan ako ng malay' }, { key: 'imminent', quote: 'Nasa bahay pa po siya ngayon' });
        incidents.push({ summary: 'Strangled until unconscious tonight.', timing: 'recent', quote: 'Sinakal po niya ako' });
      }
      facts.push({ key: 'weapon', quote: 'may hawak siyang baril' }); // not in any section: must be dropped
      return groqReply({ facts, slots: [], incidents });
    }
    // The final stage: names no facts of its own, cites Level 5.
    return groqReply({
      facts: [], slots: [], category: 'Domestic Violence', categoryConfidence: 'high', alternativeCategories: [], reasons: ['The reporter states she was strangled.'],
      assessment: {
        framework: 'VAWC', riskLevel: 5, riskLabel: 'x',
        criteria: [{ level: 5, criterion: 'severe violence causing unconsciousness', source: 'S5', reportQuote: 'nawalan ako ng malay' },
          { level: 4, criterion: 'weapon displayed', source: 'S4', reportQuote: 'may hawak siyang baril' }],
        informationSufficient: true, essentialMissing: [], classificationStatus: 'PRELIMINARY', understanding: 'The reporter states that she was strangled.',
        missingInformation: [], uncertainty: [], contradictions: [], recommendedNextAction: 'Treat as an emergency.', urgentHumanReview: true,
        affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT',
      },
    });
  };
  const r = await assessWithSources({ narrative: LONG, relationship: 'SELF', residentId: 'test:staged', frameworks: ['VAWC'] }, { ...deps(), fetch: fetchFake });
  const sections = splitNarrative(LONG).length;
  ok(`one call per section (${sections}) and one final call`, calls.filter(c => c.name === 'report_section').length === sections
    && calls.filter(c => c.name === 'report_assessment_staged').length === 1, calls.map(c => c.name).join(','));
  const parts = splitNarrative(LONG);
  ok('no single request carries every section verbatim', calls.every(c => !parts.every(p => c.user.includes(p))));
  const final = calls.find(c => c.name === 'report_assessment_staged')!.user;
  ok('the final stage sees the first section\'s finding and the last section\'s', final.includes('Una ay sampal lang') && final.includes('Sinakal po niya ako'));
  ok('...in the order written', final.indexOf('Una ay sampal lang') < final.indexOf('Sinakal po niya ako'));
  ok('...and the last section verbatim', final.includes("THE REPORT'S LAST SECTION, VERBATIM"));
  ok('the reading is used, marked staged, with the section count', r.used && r.assessment?.readMode === 'staged' && r.assessment.sections === sections && r.stages === sections + 1);
  ok('facts found in the sections reach the rules, though the final stage named none', ['force', 'choking', 'unconscious', 'imminent'].every(k => r.hints?.facts.some(f => f.key === k)),
    r.hints?.facts.map(f => f.key).join(','));
  ok('a fact no section actually contains never arrives', !r.hints?.facts.some(f => f.key === 'weapon'));
  ok('the Level 5 criterion is kept; the one backed by words not in the report is dropped, with the reason',
    r.assessment?.level === 5 && r.assessment.droppedCriteria === 1 && /not in the report/.test(r.assessment.droppedDetail?.[0] ?? ''), JSON.stringify(r.assessment?.droppedDetail));
  ok('the matrix version used is recorded', Boolean(r.assessment?.matrixVersions?.[0]?.sourceHash && r.assessment.matrixVersions[0].importedAt));

  // A section the provider will not read: the whole staged reading is unavailable, not half-used.
  let n = 0;
  const failSecond: typeof fetch = async (u, init) => (++n === 2 ? new Response('{}', { status: 500 }) : fetchFake(u, init));
  const half = await assessWithSources({ narrative: `${LONG}\n\nDagdag na talata para hindi ma-cache.`, relationship: 'SELF', residentId: 'test:staged', frameworks: ['VAWC'] }, { ...deps(), fetch: failSecond });
  ok('if any section cannot be read, nothing partial is used and it says so', !half.used && half.assessment?.status === 'ASSESSMENT_UNAVAILABLE');
}

async function providerFailures() {
  console.log('\n4. structured-output failures and the provider\'s limits');
  const req = (tag: string) => ({ name: 'probe', schema: { type: 'object' }, system: 's', user: `u ${tag}`, residentId: 'test:retry' });
  const invalid = () => new Response(JSON.stringify({ error: { code: 'json_validate_failed', message: 'Generated JSON does not match the expected schema.' } }), { status: 400 });
  let a = 0;
  const once: typeof fetch = async () => (++a === 1 ? invalid() : groqReply({ fine: true }));
  const r1 = await callGroq(req('retry'), { ...deps(), fetch: once });
  ok('an answer that fails the schema is asked for once more, and the second is used', r1.status === 'ok' && r1.retried === true && a === 2);
  let b = 0;
  const twice: typeof fetch = async () => { b++; return invalid(); };
  const r2 = await callGroq(req('twice'), { ...deps(), fetch: twice });
  ok('...but only once: two failures are an error', r2.status === 'error' && b === 2);
  let c = 0;
  const tooLarge: typeof fetch = async () => { c++; return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 9100' } }), { status: 413 }); };
  const r3 = await callGroq(req('large'), { ...deps(), fetch: tooLarge });
  ok('a request over the per-request limit is reported as too large, not retried as is', r3.status === 'too_large' && c === 1);
  const down: typeof fetch = async () => { throw new Error('network down'); };
  const r4 = await callGroq(req('down'), { ...deps(), fetch: down });
  ok('a network failure is an error, never a throw', r4.status === 'error');

  // A short report refused as too large is read in stages instead.
  let calls = 0;
  const largeThenSections: typeof fetch = async (_u, init) => {
    calls++;
    const name = JSON.parse(String(init?.body)).response_format.json_schema.name as string;
    if (name === 'report_assessment') return new Response(JSON.stringify({ error: { message: 'Request too large for model' } }), { status: 413 });
    if (name === 'report_section') return groqReply({ facts: [{ key: 'force', quote: 'Tinulak ako' }], slots: [], incidents: [] });
    return groqReply({ facts: [], slots: [], category: 'Domestic Violence', categoryConfidence: 'medium', alternativeCategories: [], reasons: [],
      assessment: { framework: 'VAWC', riskLevel: null, riskLabel: null, criteria: [], informationSufficient: false, essentialMissing: ['When it happened'],
        classificationStatus: 'NEEDS_MORE_INFORMATION', understanding: 'x', missingInformation: [], uncertainty: [], contradictions: [],
        recommendedNextAction: 'Ask when it happened.', urgentHumanReview: false, affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT' } });
  };
  const r5 = await assessWithSources({ narrative: 'Tinulak ako ng asawa ko kanina sa bahay namin.', relationship: 'SELF', residentId: 'test:large', frameworks: ['VAWC'] },
    { ...deps(), fetch: largeThenSections });
  ok('a report refused as too large is read in stages instead', r5.used && r5.assessment?.readMode === 'staged' && calls === 3, `${calls} calls`);
}

async function contradictions() {
  console.log('\n5. contradictions');
  const chunks = (await retrieveSources(['BLOTTER'], 'x', [])).chunks;
  const text = 'Sinuntok ako ng kapitbahay ko kahapon. Pero hindi naman niya ako sinaktan, nag-usap lang kami nang maayos.';
  const base = { framework: 'BLOTTER', riskLevel: null, riskLabel: null, criteria: [], informationSufficient: false, essentialMissing: [],
    classificationStatus: 'FOR_REVIEW', understanding: 'x', missingInformation: [], uncertainty: [], recommendedNextAction: 'x',
    urgentHumanReview: false, affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT' };
  const a = checkAssessment({ ...base, contradictions: [
    { about: 'whether the reporter was hurt', quoteA: 'Sinuntok ako ng kapitbahay ko', quoteB: 'hindi naman niya ako sinaktan' },
    { about: 'invented', quoteA: 'Sinuntok ako', quoteB: 'binaril niya ako' },
  ] }, { sourceText: text, chunks });
  ok('a contradiction quoted from the report is kept; one with words not in it is dropped', a?.contradictions?.length === 1);
  const old = checkAssessment(base, { sourceText: text, chunks });
  ok('an answer from before contradictions were asked for still reads (none)', Array.isArray(old?.contradictions) && old!.contradictions!.length === 0);
}

function nowWords() {
  console.log('\n6a. "now" in the AI reader\'s check');
  ok('"ngayon" alone is now', NOW_WORDS.test('Nandito pa po siya ngayon'));
  ok('"ngayong buwan" (this month) is not now', !NOW_WORDS.test('Ngayong buwan, sinabi niyang sasaktan niya ako'));
  ok('"ngayong gabi" (tonight) is', NOW_WORDS.test('babalik siya ngayong gabi'));
}

function metrics() {
  console.log('\n6. the evaluation metrics');
  const c = confusion([
    { expected: 'A', predicted: 'A' }, { expected: 'A', predicted: 'B' }, { expected: 'B', predicted: 'B' }, { expected: 'C', predicted: 'B' },
  ], ['A', 'B', 'C']);
  const A = c.perClass.find(x => x.label === 'A')!, B = c.perClass.find(x => x.label === 'B')!, C = c.perClass.find(x => x.label === 'C')!;
  ok('accuracy = correct / all', c.accuracy === 0.5);
  ok('precision and recall per class (A: 1.0 / 0.5; B: 0.333 / 1.0)', A.precision === 1 && A.recall === 0.5 && B.precision === 0.333 && B.recall === 1);
  ok('F1 is their harmonic mean (A: 0.667; B: 0.5)', A.f1 === 0.667 && B.f1 === 0.5);
  ok('a class never predicted has no precision (not 0), and F1 none', C.precision === null && C.recall === 0 && C.f1 === null);
  ok('macro-F1 counts an expected-but-never-predicted class as 0', c.macroF1 === Math.round(((0.667 + 0.5 + 0) / 3) * 1000) / 1000);
  ok('level agreement: exact, accepted, adjacent, wrong', levelAgreement(4, [], 4) === 'exact' && levelAgreement(4, [null], null) === 'accepted'
    && levelAgreement(3, [], 4) === 'adjacent' && levelAgreement(null, [], 4) === 'wrong');
}

function safety() {
  console.log('\n7. danger now, fear, and VAWC Level 4');
  const run = (narrative: string) => analyzeIntake({ narrative }).result;
  const light = run('Sira na po ang ilaw sa poste sa kanto, madilim tuwing gabi at delikado sa mga naglalakad.');
  ok('"delikado" about a dark street is not danger now, and not Critical', !light.immediateSafetyConcern && light.riskLevel !== 'Critical');
  const fear = run('May nangyari po sa bahay kagabi. Natatakot po ako.');
  ok('fear alone is not danger now - the safety question is asked first', !fear.immediateSafetyConcern && fear.nextQuestion?.slot === 'safety');
  ok('...and the fear is shown to the officer', fear.reviewReasons.some(x => /afraid/.test(x)));
  const quiet = { immediateSafetyConcern: false, assessmentStatus: 'PRELIMINARY' as const, informationCompleteness: 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' as const };
  ok('an AI urgent flag with no harm or danger behind it does not make a case urgent',
    triageStatusFor(quiet, { urgentHumanReview: true, urgentSupported: false }) !== 'URGENT_REVIEW');
  ok('...one backed by its facts does', triageStatusFor(quiet, { urgentHumanReview: true, urgentSupported: true }) === 'URGENT_REVIEW');
  const killNow = run('Pinagbantaan po niya akong papatayin ngayon, natatakot po ako.');
  ok('a threat to kill "ngayon" is danger now, with or without fear', killNow.immediateSafetyConcern);
  const killMonth = run('Ngayong buwan, sinabi niyang papatayin niya ako kapag umalis ako.');
  ok('...but a threat made "ngayong buwan" (this month) is not', !killMonth.immediateSafetyConcern);
  const unsafe = run('Hindi po ako ligtas ngayon, nandito pa siya.');
  ok('"hindi ako ligtas" is still danger now', unsafe.immediateSafetyConcern);
  const choke = run('Sinakal ako ng asawa ko kagabi habang nag-aaway kami.');
  ok('a VAWC Level 4 criterion that has ended (strangulation) is flagged urgent - "Treat as an emergency"', choke.matrixLevel === 4 && choke.immediateSafetyConcern);
  const push = run('Tinulak ako ng asawa ko.');
  ok('a single push with no timing is still not Level 4, and not urgent', push.matrixLevel === null && !push.immediateSafetyConcern);
  const theft = run('Nanakaw ang bisikleta ko sa harap ng bahay kahapon.');
  ok('a Blotter Level 4 theft that has ended is not flagged urgent', theft.matrixLevel === 4 ? !theft.immediateSafetyConcern : true, `level ${theft.matrixLevel}`);
}

async function main() {
  splitting();
  sectionChecks();
  await staged();
  await providerFailures();
  await contradictions();
  nowWords();
  metrics();
  safety();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
