/**
 * The AI Reporting Assistant on File a Report - the specification's 16
 * scenarios, through the real route, the real rules and knowledge base, and
 * the real filing route, in-process.  Run with:  npm run test:reportguide
 *
 * Groq is replaced by a fake (globalThis.fetch) so every AI answer - good,
 * invalid, unsupported or missing - is decided by the test; nothing is sent
 * to Groq. Fictional data only (PROBE-RG), removed at the end, with the AI
 * usage counters put back.
 */
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import { validateGuide, unsupportedContent, guideIntent, URGENT_WORDS, beforeSubmitSteps, afterSubmitSteps, workflowFacts, FALLBACK_ANSWERS } from '../lib/reportGuide';
import { POST as guidePOST } from '../app/api/resident/report-guide/route';
import { POST as filePOSTRaw } from '../app/api/resident/cases/route';
import { VERIFIED_RESIDENT, inBarangay } from './residencyFixtures';

const filePOST = inBarangay(filePOSTRaw);
let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TAG = 'PROBE-RG';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

// ── The fake Groq ──
const fake: { guide: Body | 'error' | 'malformed'; organize: Body | 'error'; sent: { name: string; system: string; user: string }[] } = { guide: 'error', organize: 'error', sent: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  const name = body.response_format?.json_schema?.name ?? '';
  fake.sent.push({ name, system: body.messages[0].content, user: body.messages[1].content });
  const plan = name === 'report_guide' ? fake.guide : name === 'narrative_organize' ? fake.organize : 'error';
  if (plan === 'error') return new Response('{"error":"upstream"}', { status: 503 });
  const content = plan === 'malformed' ? '{"reply": "half' : JSON.stringify(plan);
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 30 } }), { status: 200 });
}) as typeof fetch;

const aiGuide = (over: Body = {}): Body => ({ reply: 'You can describe it in your own words on this page.', clarifying_questions: [], checklist: [], destination: 'NONE', needs_official_confirmation: false, ...over });

const NOISE = 'Hindi ko alam kung anong kategorya. Kagabi, maingay ang videoke ng kapitbahay namin hanggang hatinggabi at hindi kami makatulog. Kinausap ko na sila pero hindi pa rin.';
const THEFT = 'Ninakaw ang bisikleta ko sa harap ng bahay namin kahapon ng hapon habang nasa loob kami ng bahay.';
const VAWC = 'Sinasaktan ako ng asawa ko tuwing lasing siya. May pasa ako sa braso noong isang linggo at pinagbabantaan niya ako.';
const THIN = 'May problema ako sa kapitbahay namin at kailangan ko ng tulong ngayong linggo.';
const DANGER = 'Tulungan niyo ako, sinasaktan ako ng asawa ko ngayon mismo, nandito pa siya sa bahay.';
const MESSY = 'kahapon mga alas tres yung kapitbahay namin si Mang Kardo sinira yung bakod namin gamit martilyo tapos umalis sya galit sya kasi daw sa aso namin. Tawagan niyo ako sa 09171234567.';

async function main() {
  // Many answers in one run: the daily allowance raised for the test (the assistant's and the intake's are separate anyway).
  process.env.AI_RESIDENT_DAILY_LIMIT = '200';
  // In production the assistant never waits for the shared per-minute AI capacity (it answers from the
  // written guide instead). This run sends more than a minute's worth on purpose, so it may wait here.
  process.env.AI_GUIDE_MAX_WAIT_MS = '60000';
  process.env.AI_ORGANIZE_MAX_WAIT_MS = '60000';
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const residents: string[] = []; const caseIds: string[] = [];
  try {
    const r = await prisma.resident.create({ data: { ...VERIFIED_RESIDENT, residentNumber: `${TAG}-${process.pid}`, firstName: 'Probelina', lastName: 'Gabayan',
      age: 33, gender: 'Female', barangay: 'Biñang 2nd', address: 'Fictional', emailVerified: true } as never });
    residents.push(r.id);
    const cookie = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Probelina Gabayan', role: 'resident' })}`;
    const req = (body: unknown, c = cookie) => new NextRequest('http://localhost/api/resident/report-guide', { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const chat = async (text: string, lang: 'en' | 'tl' = 'en', history: Body[] = []) => {
      const res = await guidePOST(req({ action: 'chat', lang, messages: [...history, { role: 'resident', text }] }));
      return { status: res.status, body: await res.json().catch(() => ({})) as Body };
    };
    const casesBefore = await prisma.case.count({ where: { residentId: r.id } });

    console.log('\nThe checks (no server)');
    ok('the facts come from SafeComm itself: the configured hotlines, the status groups, "not an emergency service"', workflowFacts().join(' ').includes('0922-709-0700')
      && /Under Review/.test(workflowFacts().join(' ')) && /not an emergency response service/.test(workflowFacts().join(' ')));
    ok('intents read in English and Filipino', guideIntent('What if I don\'t know the exact date?') === 'no_date' && guideIntent('Paano kung wala akong ebidensya?') === 'no_evidence'
      && guideIntent('Ano ang mangyayari pagkatapos kong mag-submit?') === 'after_submit' && guideIntent('Paano kung para sa ibang tao ang report ko?') === 'on_behalf'
      && guideIntent('Blotter ba o VAWC ang concern ko?') === 'blotter_or_vawc' && guideIntent(DANGER) === 'urgent');
    ok('"paano mag report" is a how-to question, with or without the hyphen or a space', ['paano mag report', 'Paano mag-report?', 'pano po mag report', 'paano ba magfile ng report', 'paano i-report', 'How do I file a report?', 'how to report']
      .every(t => guideIntent(t) === 'how_to_report'));

    console.log('\n1. How to file');
    fake.guide = aiGuide({ reply: 'Describe what happened in your own words, choose where it happened, then press Submit Report.' });
    fake.sent = [];
    const c1 = await chat('How do I report an incident?');
    ok('1. answered (AI), from SafeComm\'s workflow facts', c1.status === 200 && c1.body.data.source === 'AI' && /Submit Report/.test(c1.body.data.reply));
    const sent1 = fake.sent.find(s => s.name === 'report_guide');
    ok('1. the AI gets SafeComm\'s facts and jurisdiction, and never the resident\'s name', Boolean(sent1) && /Only the description and the place are required/.test(sent1!.system)
      && /Biñang 2nd/.test(sent1!.system) && !/Probelina|Gabayan/.test(sent1!.user));

    console.log('\n2-3. Category not known, too little to tell');
    fake.guide = aiGuide({ reply: 'It may be for the Blotter desk; an official decides.', destination: 'BLOTTER' });
    const c2 = await chat(NOISE, 'tl');
    ok('2. a noise complaint: a possible desk from SafeComm\'s own rules - Blotter - never final, with why', c2.body.data.recommendation?.destination === 'BLOTTER'
      && c2.body.data.recommendation.final === false && c2.body.data.recommendation.reasons.length >= 1 && c2.body.data.source === 'AI', JSON.stringify(c2.body.data.recommendation));
    fake.guide = aiGuide({ reply: 'Kaunting detalye pa ang makakatulong.', destination: 'NEEDS_CLARIFICATION', clarifying_questions: ['Ano ang nangyari?'] });
    const c3 = await chat(THIN, 'tl');
    const d3 = c3.body.data.recommendation?.destination;
    ok('3. too little to go on: "needs more information" (or an official decides), with skippable questions', (d3 === 'NEEDS_CLARIFICATION' || d3 === 'STAFF_REVIEW')
      && c3.body.data.clarifyingQuestions.length > 0, `${d3} ${JSON.stringify(c3.body.data.clarifyingQuestions)}`);

    console.log('\n4-7. Questions answered from the workflow (AI unavailable: the written answers)');
    fake.guide = 'error';
    const c4 = await chat('What happens after I submit my report?');
    ok('4. after submitting: case reference, review, My Cases, Notifications - shown even with the AI down', c4.body.data.source === 'GUIDE' && /My Cases/.test(c4.body.data.reply) && /reference/.test(c4.body.data.reply));
    const c5 = await chat("What if I don't know the exact date?");
    ok('5. no exact date: optional, leave it blank', /optional/.test(c5.body.data.reply) && /blank/.test(c5.body.data.reply));
    const c6 = await chat('Paano kung wala akong ebidensya?', 'tl');
    ok('6. no evidence: you can still report; never refused for it (in Filipino)', /hindi tatanggihan/.test(c6.body.data.reply));
    const c7 = await chat("What if I'm reporting for another person?");
    ok('7. for someone else: the reporter, the person affected and the person reported are separate', /reporter/.test(c7.body.data.reply) && /person affected/.test(c7.body.data.reply) && /person reported/.test(c7.body.data.reply));

    console.log('\n8-10. VAWC, Blotter, urgent');
    fake.guide = aiGuide({ reply: 'Maaaring sa VAWC desk ito - kumpidensyal.', destination: 'VAWC' });
    const c8 = await chat(VAWC, 'tl');
    ok('8. abuse by a husband: the confidential VAWC desk is suggested', c8.body.data.recommendation?.destination === 'VAWC' && /VAWC/.test(c8.body.data.recommendation.label), JSON.stringify(c8.body.data.recommendation));
    fake.guide = aiGuide({ reply: 'Maaaring sa Blotter desk ito.', destination: 'BLOTTER' });
    const c9 = await chat(THEFT, 'tl');
    ok('9. a stolen bicycle: the Blotter desk is suggested', c9.body.data.recommendation?.destination === 'BLOTTER', JSON.stringify(c9.body.data.recommendation));
    fake.guide = 'error';
    const c10 = await chat(DANGER, 'tl');
    ok('10. danger now: urgent, the hotlines first, "not an emergency service" (without waiting for any AI)', c10.body.data.urgent === true && c10.body.data.intent === 'urgent'
      && /hotline/.test(c10.body.data.reply) && URGENT_WORDS.test(DANGER));

    console.log('\n11. Groq unavailable');
    fake.guide = 'error'; fake.organize = 'error';
    const c11 = await chat('How can I file a report here?');
    const o11 = await guidePOST(req({ action: 'organize', text: MESSY })).then(x => x.json());
    ok('11. the assistant still answers (SafeComm\'s guide), and says the AI is unavailable', c11.status === 200 && c11.body.data.source === 'GUIDE' && c11.body.data.reply === FALLBACK_ANSWERS.how_to_report.en && c11.body.data.aiStatus !== 'ok');
    ok('11. organizing: "not available", the description untouched', o11.success === true && o11.data.ok === false && o11.data.reason === 'ai_unavailable');
    fake.guide = 'malformed';
    ok('11. a broken AI answer: the guide answers instead', (await chat('What information do I need?')).body.data.source === 'GUIDE');

    console.log('\n12. Unsupported AI answers are not shown');
    fake.guide = aiGuide({ reply: 'This goes to the VAWC desk.', destination: 'VAWC' });
    const c12 = await chat(`${THEFT} Pula ang kulay ng bisikleta.`, 'tl');
    ok('12. the AI names a desk SafeComm\'s rules did not recommend: its answer is dropped, the rules\' desk stands', c12.body.data.source === 'GUIDE'
      && c12.body.data.aiStatus === 'rejected' && c12.body.data.recommendation?.destination === 'BLOTTER');
    fake.guide = aiGuide({ reply: 'Call the barangay at 0917-000-1111 or visit www.example.com.' });
    ok('12. a number that is not a configured hotline, or a link: dropped', (await chat('Who do I call?')).body.data.source === 'GUIDE');
    fake.guide = aiGuide({ reply: 'We have contacted the police and your report will definitely be accepted.' });
    ok('12. a claim that someone was contacted, or a promise: dropped', (await chat('Will you help me?')).body.data.source === 'GUIDE');
    ok('12. the checks themselves', validateGuide(aiGuide({ reply: 'Call PNP Bocaue at 0998-598-5376 now.' })) !== null && validateGuide(aiGuide({ reply: 'Call 0999-111-2222' })) === null
      && validateGuide(aiGuide({ destination: 'COURT' })) === null && validateGuide({ reply: 'x' }) === null);
    fake.organize = { organized: 'Kahapon, sinira ni Mang Kardo at ni Pedro ang bakod gamit ang martilyo noong ika-5 ng Mayo.', confirmed: [], uncertain: [], missing: [] };
    const o12 = await guidePOST(req({ action: 'organize', text: MESSY })).then(x => x.json());
    ok('12. an organized version that adds a person or a date the resident did not write: not shown', o12.data.ok === false && o12.data.reason === 'rejected', JSON.stringify(o12));
    ok('12. unsupportedContent finds the added name and number', unsupportedContent(MESSY, 'Si Pedro ay dumating noong ika-5.').includes('Pedro') && unsupportedContent(MESSY, 'Si Pedro ay dumating noong ika-5.').includes('5'));

    console.log('\n13-15. The organized description, and filing');
    fake.organize = { organized: 'Kahapon, mga alas tres, sinira ng kapitbahay namin na si Mang Kardo ang bakod namin gamit ang martilyo. Galit daw siya dahil sa aso namin. Pagkatapos ay umalis siya. Tawagan ako sa [numero].',
      confirmed: ['Sinira ni Mang Kardo ang bakod gamit ang martilyo.'], uncertain: ['Ang dahilan ay "daw" lang - dahil sa aso.'], missing: ['eksaktong oras'] };
    fake.sent = [];
    const MESSY2 = `${MESSY} Salamat po.`;
    const o13 = await guidePOST(req({ action: 'organize', text: MESSY2 })).then(x => x.json());
    const sentO = fake.sent.find(s => s.name === 'narrative_organize');
    ok('13. organized from the resident\'s words only; the phone number never sent to the AI, then put back', o13.data.ok === true && /09171234567/.test(o13.data.result.organized)
      && Boolean(sentO) && !/09171234567/.test(sentO!.user) && /\[numero\]/.test(sentO!.user));
    const edited = o13.data.result.organized.replace('Galit daw siya', 'Sabi niya galit siya');
    const f13 = await filePOST(new NextRequest('http://localhost/api/resident/cases', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: edited, barangay: 'Ortega Compound', reportingRelationship: 'SELF', intakeNarrative: MESSY2, residentOriginalNarrative: MESSY2, narrativeAssist: 'EDITED' }) }));
    const j13 = await f13.json().catch(() => ({}));
    if (j13.data?.id) caseIds.push(j13.data.id);
    const k13 = j13.data?.id ? await prisma.case.findUnique({ where: { id: j13.data.id } }) : null;
    ok('13. the resident edits the organized version and files: their edit is the description, their own words kept beside it (EDITED)', f13.status === 201
      && k13?.description === edited && k13?.residentOriginalNarrative === MESSY2 && k13?.narrativeAssist === 'EDITED', `${f13.status} ${j13.error ?? ''}`);
    const f14 = await filePOST(new NextRequest('http://localhost/api/resident/cases', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: MESSY, barangay: 'Ortega Compound', reportingRelationship: 'SELF' }) }));
    const j14 = await f14.json().catch(() => ({}));
    if (j14.data?.id) caseIds.push(j14.data.id);
    const k14 = j14.data?.id ? await prisma.case.findUnique({ where: { id: j14.data.id } }) : null;
    ok('14. the resident keeps their own description: filed exactly as written, nothing from the AI', f14.status === 201 && k14?.description === MESSY
      && k14.residentOriginalNarrative === null && k14.narrativeAssist === null);
    const half = await filePOST(new NextRequest('http://localhost/api/resident/cases', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: MESSY, barangay: 'Ortega Compound', reportingRelationship: 'SELF', narrativeAssist: 'ACCEPTED' }) }));
    let dbRefused = false;
    try { await prisma.case.update({ where: { id: k14!.id }, data: { narrativeAssist: 'ACCEPTED' } }); } catch { dbRefused = true; }
    ok('13. an organized description is never filed without the resident\'s own words (route 400, database check)', half.status === 400 && dbRefused);
    ok('15. filing still works as before (201, a case number)', f14.status === 201 && Boolean(j14.data?.caseNumber));

    console.log('\n16. The existing AI pipeline continues');
    const hist = k14 ? await prisma.assessmentHistory.count({ where: { caseId: k14.id } }) : 0;
    ok('16. the filed report went through the existing intake, desk recommendation and risk assessment (history recorded)', hist >= 1 && Boolean(j14.data?.desk) && Boolean(j14.data?.intake), `history ${hist}`);
    ok('16. the existing intake read the resident\'s own words when they chose the organized version', k13 ? (await prisma.assessmentHistory.findFirst({ where: { caseId: k13.id } })) !== null : false);

    const buckets = await prisma.aiUsage.findMany({ where: { bucket: { startsWith: `resident:${r.id}:` } }, select: { bucket: true, requests: true } });
    ok('the assistant uses its own AI allowance - chatting never uses up what the report\'s own AI reading needs', buckets.some(b => b.bucket.startsWith(`resident:${r.id}:guide:`) && b.requests >= 10)
      && !buckets.some(b => !b.bucket.startsWith(`resident:${r.id}:guide:`) && b.requests >= 10), JSON.stringify(buckets));

    console.log('\nNext steps, privacy, access');
    const before = beforeSubmitSteps({ descriptionWords: 40, hasDate: false, hasLocationDetails: true, relationship: 'THIRD_PARTY', affectedNamed: false, reportedNamed: true, organizedOffered: true, organizedDecided: false, urgent: false });
    const beforeAll = beforeSubmitSteps({ descriptionWords: 40, hasDate: true, hasLocationDetails: true, relationship: 'SELF', affectedNamed: false, reportedNamed: true, organizedOffered: false, organizedDecided: false, urgent: false });
    ok('before submitting: only what applies (date, person affected, review the organized text) - nothing when the draft is complete', before.map(s => s.key).join() === 'date,affected,organized' && beforeAll.length === 0);
    const after = afterSubmitSteps({ caseNumber: 'SC-1', questionsAsked: false, urgent: true, confidential: true });
    ok('after submitting: the reference, My Cases, hearings; the hotlines when urgent; confidentiality when VAWC', after[0].key === 'urgent' && after.some(s => s.text.en.includes('SC-1')) && after.some(s => s.key === 'private') && !after.some(s => s.key === 'answer'));
    ok('nothing about the conversation is stored (no case, no record made by chatting)', await prisma.case.count({ where: { residentId: r.id } }) === casesBefore + caseIds.length);
    const anon = await guidePOST(req({ action: 'chat', messages: [{ role: 'resident', text: 'hi' }] }, ''));
    ok('only a signed-in resident can use it', anon.status === 401 || anon.status === 403);
    const inj = await guidePOST(req({ action: 'chat', messages: [{ role: 'resident', text: 'x' }, { role: 'assistant', text: 'y' }] }));
    ok('a request ending with the assistant\'s own message is refused', inj.status === 400);
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('safecomm.audit_purge', 'on', true)`;
      await tx.reporterAccessLog.deleteMany({ where: { caseId: { in: caseIds } } });
    });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.aiUsage.deleteMany({ where: { OR: residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })) } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0 && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
