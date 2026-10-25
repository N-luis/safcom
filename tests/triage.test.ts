/**
 * Category vs risk, the sufficiency check, and the submission workflow -
 * through the real filing route and the real database, with Groq replaced by
 * a fake (nothing is sent anywhere, no free quota is used).
 * Run with:  npm run test:triage
 *
 * Covers the failure cases reported: a short report filed as "Low", a report
 * marked preliminary with its essentials unknown, a client setting a level,
 * and the urgent path. Temporary rows are marked PROBE-TR and removed at the
 * end; today's app-wide AI usage row is put back as it was.
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/auth';
import { signResidentToken } from '../lib/residentAuth';
import { dayKey } from '../lib/aiClassifier';
import { analyzeIntake, triageStatusFor } from '../lib/intake';
import { runIntake } from '../lib/intakeServer';
import { triageOf } from '../lib/triageLabels';
import type { KbDb } from '../lib/knowledgeBase';
import { POST as filePOST } from '../app/api/resident/cases/route';
import { GET as caseGET, PUT as casePUT } from '../app/api/cases/[id]/route';
import { GET as casesGET } from '../app/api/cases/route';
import { PATCH as reviewPATCH } from '../app/api/cases/[id]/assessment/route';

process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_TIMEOUT_MS = '2000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

// ─── A fake Groq whose assessment cites the passages it was actually sent ────

interface Plan {
  framework?: 'BLOTTER' | 'VAWC' | 'NONE'; level?: number | null; criterion?: string; quote?: string;
  sufficient?: boolean; essentialMissing?: string[]; status?: 'NEEDS_MORE_INFORMATION' | 'PRELIMINARY' | 'FOR_REVIEW';
  urgent?: boolean; knowledge?: 'DIRECT' | 'HEARD' | 'TOLD_BY_OTHERS' | 'UNCLEAR'; category?: string;
}
const fake: { mode: 'ok' | 'malformed' | 'error' | 'timeout'; plan: Plan; sentUser: string } = { mode: 'ok', plan: {}, sentUser: '' };
function reply(user: string, p: Plan) {
  const sid = (fw: string, lv: number) => new RegExp(`\\[(S\\d+)\\] ${fw} [^\\n]*Level ${lv} `).exec(user)?.[1] ?? 'S0';
  const fw = p.framework ?? 'BLOTTER';
  return {
    facts: [], slots: [], category: p.category ?? 'UNCLEAR', categoryConfidence: 'medium', alternativeCategories: [], reasons: [],
    assessment: {
      framework: fw, riskLevel: p.level ?? null, riskLabel: 'whatever the model says',
      criteria: p.level && p.criterion ? [{ level: p.level, criterion: p.criterion, source: sid(fw, p.level), reportQuote: p.quote ?? '' }] : [],
      informationSufficient: p.sufficient ?? true, essentialMissing: p.essentialMissing ?? [],
      classificationStatus: p.status ?? 'PRELIMINARY', understanding: 'The reporter states something happened.',
      missingInformation: [], uncertainty: [], recommendedNextAction: 'Review the report.', urgentHumanReview: p.urgent ?? false,
      affectedPerson: 'REPORTER', reporterKnowledge: p.knowledge ?? 'DIRECT',
    },
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  const body = JSON.parse(String(init?.body));
  fake.sentUser = body.messages[1].content;
  if (fake.mode === 'error') return new Response('{"error":"upstream"}', { status: 503 });
  if (fake.mode === 'timeout') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const content = fake.mode === 'malformed' ? '{"assessment": "level five, trust me"' : JSON.stringify(reply(fake.sentUser, fake.plan));
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 40 } }), { status: 200 });
}) as typeof fetch;

// ─── Routes, in-process ──────────────────────────────────────────────────────

const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const DETAILED = 'Kagabi, maingay ang videoke ng kapitbahay namin hanggang hatinggabi. Kinausap ko sila nang maayos at hininaan naman nila. Walang nasaktan at walang nagbanta. Unang beses itong nangyari. Ligtas kami.';
const THIN = 'May problema ako at kailangan ko ng tulong.';
const ECON = 'Hindi nagbibigay ng sustento ang asawa ko sa mga anak namin.';
const ARGUE = 'Nag-away kami ng asawa ko tungkol sa pera kagabi. Walang nasaktan.';
const THEFT = 'Ninakaw ang cellphone ko.';
const THIRD = "I heard my neighbor shouting for help last night. I heard someone threatening her, but I didn't see what happened.";
const DANGER = 'Sinasaktan ako ng asawa ko ngayon mismo, nandito pa siya sa bahay, tulungan niyo ako.';
const TAG = 'PROBE-TR';

async function main() {
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  const residents: string[] = []; const users: string[] = []; const caseIds: string[] = [];
  const pw = await bcrypt.hash(`${TAG}-unused`, 4);
  try {
    const r = await prisma.resident.create({ data: { residentNumber: `${TAG}-${process.pid}`, firstName: 'Probe', lastName: 'Triage',
      age: 30, gender: 'Female', barangay: 'Ayukit', address: 'temporary test row', emailVerified: true } });
    residents.push(r.id);
    const res = `resident_token=${signResidentToken({ residentId: r.id, email: 'x', name: 'Probe', role: 'resident' })}`;
    const u = await prisma.user.create({ data: { email: `probe.tr.${process.pid}@safcom.local`, name: `${TAG} officer`, password: pw, role: 'admin' } });
    users.push(u.id);
    const staff = `safcom_token=${signToken({ userId: u.id, email: u.email, role: 'admin' })}`;
    const file = async (narrative: string, extra: Record<string, unknown> = {}) => {
      const out = await json(await filePOST(req('/api/resident/cases', res, 'POST',
        { description: narrative, intakeNarrative: narrative, reportingRelationship: 'SELF', intakeAnswers: [], ...extra })));
      if (out.body?.data?.id) caseIds.push(out.body.data.id);
      return out;
    };
    const stored = (id: string) => prisma.case.findUnique({ where: { id }, include: { intake: true } });

    console.log('1. the rules on their own: no default level, sufficiency before "preliminary"');
    const thin = analyzeIntake({ narrative: THIN }).result;
    ok('a short report is undetermined - not "Low"', thin.riskLevel === null && thin.matrixLevel === null, String(thin.riskLevel));
    const econ = analyzeIntake({ narrative: ECON }).result;
    ok('a category with no criterion met has no level (Economic Abuse)', econ.suggestedCaseCategory === 'Economic Abuse' && econ.riskLevel === null);
    const argue = analyzeIntake({ narrative: ARGUE }).result;
    ok('the category does not raise the level: a spouse argument, no harm -> Level 1 only', argue.matrixLevel === 1 && argue.riskLevel === 'Low',
      `${argue.suggestedCaseCategory} L${argue.matrixLevel} ${argue.riskLevel}`);
    const theft = analyzeIntake({ narrative: THEFT }).result;
    ok('a criterion met on an incomplete report keeps its level but is not "preliminary"', theft.matrixLevel === 4
      && theft.assessmentStatus === 'NEEDS_MORE_INFORMATION' && triageStatusFor(theft) === 'NEEDS_FOLLOW_UP');
    const detailed = analyzeIntake({ narrative: DETAILED }).result;
    ok('a detailed report with enough information -> PRELIMINARY', detailed.assessmentStatus === 'PRELIMINARY'
      && detailed.informationCompleteness === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT' && triageStatusFor(detailed) === 'PRELIMINARY');
    const safetyUnsure = analyzeIntake({ narrative: ARGUE, answers: [{ slot: 'safety', kind: 'option', value: 'unsure' }] }).result;
    ok('"I don\'t know" is not taken as "no"', safetyUnsure.slots.find(s => s.id === 'safety')?.status === 'unsure'
      && safetyUnsure.slots.find(s => s.id === 'safety')?.value === 'unknown');
    const skipped = analyzeIntake({ narrative: THIN, answers: [{ slot: 'safety', kind: 'skipped' }, { slot: 'act', kind: 'declined' }] }).result;
    ok('skipped and declined questions stay unknown, and the report is not classified', skipped.riskLevel === null
      && skipped.notAnswered.length === 2 && triageStatusFor(skipped) === 'NEEDS_FOLLOW_UP');

    console.log('\n2. filing: what is stored');
    fake.mode = 'ok';
    fake.plan = { framework: 'BLOTTER', level: 1, criterion: 'Curfew noise violations', quote: 'maingay ang videoke', sufficient: true, status: 'PRELIMINARY' };
    const f1 = await file(DETAILED);
    const c1 = await stored(f1.body.data.id);
    ok('[1] detailed report -> PRELIMINARY, Low, from the matrix', f1.status === 201 && c1?.triageStatus === 'PRELIMINARY' && c1.riskLevel === 'Low',
      `${f1.status} ${c1?.triageStatus} ${c1?.riskLevel}`);
    ok('[1] ...assessed against the Blotter matrix, the label from the document',
      (c1?.intake?.aiReading as { assessment?: { framework: string; label: string } })?.assessment?.label === 'LOW — Minor Incident'
      || /LOW/.test((c1?.intake?.aiReading as { assessment?: { label: string } })?.assessment?.label ?? ''));

    fake.plan = { framework: 'NONE', level: null, sufficient: false, essentialMissing: ['What happened', 'Whether anyone is in danger now'], status: 'NEEDS_MORE_INFORMATION' };
    const f2 = await file(THIN);
    const c2 = await stored(f2.body.data.id);
    ok('[2] a short report is still filed', f2.status === 201);
    ok('[2] ...with no level - null, not "Low"', c2?.riskLevel === null, String(c2?.riskLevel));
    ok('[2] ...saved as NEEDS_FOLLOW_UP, not as classified', c2?.triageStatus === 'NEEDS_FOLLOW_UP' && c2.intake?.assessmentStatus !== 'PRELIMINARY'
      && c2.requiresOfficerReview);

    fake.plan = { framework: 'VAWC', level: null, sufficient: true, status: 'FOR_REVIEW', category: 'Economic Abuse' };
    const f3 = await file(ECON);
    const c3 = await stored(f3.body.data.id);
    ok('[3] a possible category but no supported level -> category kept, level undetermined', c3?.caseType === 'Economic Abuse' && c3.riskLevel === null
      && c3.triageStatus !== 'PRELIMINARY', `${c3?.caseType} ${c3?.riskLevel} ${c3?.triageStatus}`);

    fake.plan = { framework: 'VAWC', level: 4, criterion: 'Physical assault', quote: 'he beat me badly', sufficient: true, status: 'PRELIMINARY', category: 'Domestic Violence' };
    const f4 = await file(ARGUE);
    const c4 = await stored(f4.body.data.id);
    const a4 = (c4?.intake?.aiReading as { assessment?: { level: number | null; droppedCriteria: number } })?.assessment;
    ok('[4] category and level differ: a domestic-type report stays at the level its facts support', c4?.riskLevel === 'Low',
      `${c4?.caseType} ${c4?.riskLevel}`);
    ok('[4] ...an AI "Level 4 physical assault" with no such words in the report is discarded', a4?.level === null && a4.droppedCriteria === 1);

    const turns = [
      { id: 'r1q1', round: 1, text: 'Are you in danger right now?', answerType: 'yes_no', slot: 'safety', kind: 'option', value: 'unsure' },
      { id: 'r1q2', round: 1, text: 'What happened, in your own words?', answerType: 'short_text', slot: 'act', kind: 'skipped' },
      { id: 'r1q3', round: 1, text: 'Has this happened before?', answerType: 'yes_no', slot: 'recurrence', kind: 'declined' },
    ];
    fake.plan = { framework: 'NONE', level: null, sufficient: false, essentialMissing: ['What was done'], status: 'NEEDS_MORE_INFORMATION' };
    const f5 = await file(THIN + ' (answers)', { intakeTurns: turns });
    const c5 = await stored(f5.body.data.id);
    ok('[5][6] unanswered ("I don\'t know") and skipped questions -> filed as NEEDS_FOLLOW_UP, nothing read as "no"',
      f5.status === 201 && c5?.triageStatus === 'NEEDS_FOLLOW_UP' && c5.riskLevel === null);
    ok('[5][6] ...every answer kept as given', (c5?.intake?.aiInterview as { turns: { kind: string }[] })?.turns.map(t => t.kind).join() === 'option,skipped,declined');

    fake.plan = { framework: 'BLOTTER', level: 3, criterion: 'Credible verbal threats', quote: 'I heard someone threatening her', sufficient: false,
      essentialMissing: ['Whether the neighbour is safe now', 'Who made the threat'], status: 'NEEDS_MORE_INFORMATION', knowledge: 'HEARD' };
    const f7 = await file(THIRD, { reportingRelationship: 'THIRD_PARTY' });
    const c7 = await stored(f7.body.data.id);
    const a7 = (c7?.intake?.aiReading as { assessment?: { reporterKnowledge: string; informationSufficient: boolean; essentialMissing: string[] } })?.assessment;
    ok('[7] third-party, heard only -> the AI sufficiency check holds it at NEEDS_FOLLOW_UP', c7?.triageStatus === 'NEEDS_FOLLOW_UP'
      && a7?.reporterKnowledge === 'HEARD' && a7.informationSufficient === false && a7.essentialMissing.length === 2, `${c7?.triageStatus}`);
    ok('[7] ...its supported level is kept, not lost', c7?.riskLevel === 'High');

    console.log('\n3. the urgent path, and failures');
    fake.mode = 'error';
    const f8 = await file(DANGER);
    const c8 = await stored(f8.body.data.id);
    ok('[8][10] danger now with Groq down -> filed at once as URGENT_REVIEW', f8.status === 201 && c8?.triageStatus === 'URGENT_REVIEW');
    ok('[8] ...the desks are notified - a real notification row', (await prisma.notification.count({ where: { caseId: c8!.id } })) > 0);
    fake.mode = 'malformed';
    const f9 = await file(THIN + ' (malformed)');
    const c9 = await stored(f9.body.data.id);
    const a9 = (c9?.intake?.aiReading as { status: string; assessment?: { status: string; level: number | null } } | null);
    ok('[9] a malformed AI answer -> rejected; the rules decide; no AI level', f9.status === 201 && a9?.status === 'error'
      && a9.assessment?.level === null && c9?.riskLevel === null && c9.triageStatus === 'NEEDS_FOLLOW_UP');
    fake.mode = 'timeout';
    const f10 = await file(THIN + ' (timeout)');
    ok('[10] a Groq timeout -> still filed', f10.status === 201 && (await stored(f10.body.data.id))?.triageStatus === 'NEEDS_FOLLOW_UP');
    fake.mode = 'ok';
    const brokenDb = {
      $queryRaw: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
      $transaction: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown,
    } as KbDb;
    const kb = await runIntake({ residentId: r.id, narrative: DETAILED + ' (kb)', useAi: true, relationship: 'SELF' }, brokenDb);
    const kbTriage = triageStatusFor(kb.result, kb.grounding.ai?.assessment, kb.grounding.knowledgeBaseStatus === 'unavailable');
    ok('[11] knowledge base down -> ASSESSMENT_UNAVAILABLE, the matrix not claimed as consulted', kbTriage === 'ASSESSMENT_UNAVAILABLE'
      && kb.grounding.ai?.assessment?.status === 'ASSESSMENT_UNAVAILABLE', kbTriage);

    console.log('\n4. the client cannot set the outcome');
    const before = await prisma.case.count({ where: { residentId: r.id } });
    const bad1 = await file(THIN, { riskLevel: 'Low' });
    const bad2 = await file(THIN, { riskLevel: 'Extreme' });
    const bad3 = await file(THIN, { triageStatus: 'PRELIMINARY', informationSufficient: true });
    const bad4 = await file(THIN, { assessmentStatus: 'PRELIMINARY' });
    ok('[12] a client risk level (valid or not) is refused, not stored', bad1.status === 400 && bad2.status === 400 && /set by SafeComm/.test(bad1.body.error ?? ''));
    ok('[13] marking the assessment complete or sufficient from the client is refused', bad3.status === 400 && bad4.status === 400);
    ok('[12][13] ...and nothing was filed by those requests', (await prisma.case.count({ where: { residentId: r.id } })) === before);
    const direct = await file(THIN + ' (no interview)');
    ok('[13] skipping the interview entirely does not skip the check: still NEEDS_FOLLOW_UP',
      (await stored(direct.body.data.id))?.triageStatus === 'NEEDS_FOLLOW_UP');
    const put = await json(await casePUT(req(`/api/cases/${c2!.id}`, staff, 'PUT', { riskLevel: 'High', notes: 'x' }), params(c2!.id)));
    ok('[12] a general case edit cannot set the level either', put.status === 400 && (await stored(c2!.id))?.riskLevel === null);

    console.log('\n5. legacy cases and the officer review');
    const legacy = await prisma.case.create({ data: { caseNumber: `${TAG}-L-${process.pid}`, residentName: 'Probe Legacy', caseType: 'Noise Complaint',
      barangay: 'Ortega Compound', description: 'filed the old way', status: 'Open', riskLevel: 'Low', residentId: r.id } });
    caseIds.push(legacy.id);
    const lv = await json(await caseGET(req(`/api/cases/${legacy.id}`, staff), params(legacy.id)));
    ok('[14] a legacy case still opens, its level and status untouched', lv.status === 200 && lv.body.data.riskLevel === 'Low' && lv.body.data.triageStatus === null);
    ok('[14] ...and reads as "Legacy", not as any new status', triageOf(lv.body.data.triageStatus).label === 'Legacy');
    const legacyList = await json(await casesGET(req(`/api/cases?triage=LEGACY&search=${encodeURIComponent(TAG)}&limit=100`, staff)));
    ok('[14] the LEGACY filter finds it', legacyList.body.data.cases.some((c: { id: string }) => c.id === legacy.id));
    const followList = await json(await casesGET(req(`/api/cases?triage=NEEDS_FOLLOW_UP&limit=100`, staff)));
    ok('the NEEDS_FOLLOW_UP filter finds the incomplete reports, and only those', followList.body.data.cases.some((c: { id: string }) => c.id === c2!.id)
      && followList.body.data.cases.every((c: { triageStatus: string }) => c.triageStatus === 'NEEDS_FOLLOW_UP'));
    const undetList = await json(await casesGET(req(`/api/cases?riskLevel=Undetermined&limit=100`, staff)));
    ok('the "Undetermined" risk filter finds undetermined cases', undetList.body.data.cases.some((c: { id: string }) => c.id === c2!.id)
      && undetList.body.data.cases.every((c: { riskLevel: string | null }) => c.riskLevel === null));
    const rv = await json(await reviewPATCH(req(`/api/cases/${c2!.id}/assessment`, staff, 'PATCH', { priority: 'Priority Attention', reason: 'Called the reporter; details confirmed' }), params(c2!.id)));
    const reviewed = await stored(c2!.id);
    ok('an officer review is the transition out: REVIEWED, with the level the officer set', rv.status === 200 && reviewed?.triageStatus === 'REVIEWED'
      && reviewed.riskLevel === 'Medium' && !reviewed.requiresOfficerReview, `${rv.status} ${reviewed?.triageStatus} ${reviewed?.riskLevel}`);

    console.log('\n6. Filipino, and the right matrix');
    fake.plan = { framework: 'VAWC', level: 4, criterion: 'Physical assault', quote: 'Sinasaktan ako ng asawa ko', sufficient: true, urgent: true, status: 'PRELIMINARY' };
    const tl = await runIntake({ residentId: r.id, narrative: DANGER + ' (tl)', useAi: true, relationship: 'SELF' });
    ok('[15] a Tagalog report is assessed against the VAWC matrix only, with the Tagalog words as evidence',
      /\] VAWC /.test(fake.sentUser) && !/\] BLOTTER /.test(fake.sentUser)
      && tl.grounding.ai?.assessment?.criteria[0]?.reportQuote === 'Sinasaktan ako ng asawa ko' && tl.grounding.ai.assessment.framework === 'VAWC');
    ok('[15] ...and a thin Tagalog report is undetermined, not Low', analyzeIntake({ narrative: 'Tulungan niyo po ako.' }).result.riskLevel === null);
    fake.plan = { framework: 'BLOTTER', level: 1, criterion: 'Curfew noise violations', quote: 'maingay ang videoke', sufficient: true };
    await runIntake({ residentId: r.id, narrative: DETAILED + ' (blotter)', useAi: true, relationship: 'SELF' });
    ok('a blotter report is assessed against the Blotter matrix only', /\] BLOTTER /.test(fake.sentUser) && !/\] VAWC /.test(fake.sentUser));
  } finally {
    globalThis.fetch = realFetch;
    await prisma.notification.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.activity.deleteMany({ where: { OR: [{ caseId: { in: caseIds } }, { userId: { in: users } }] } });
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.resident.deleteMany({ where: { id: { in: residents } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.aiUsage.deleteMany({ where: { OR: residents.map(id => ({ bucket: { startsWith: `resident:${id}:` } })) } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  ok('every test row removed', await prisma.case.count({ where: { id: { in: caseIds } } }) === 0
    && await prisma.resident.count({ where: { residentNumber: { startsWith: TAG } } }) === 0);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
