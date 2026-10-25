/**
 * Regression: "Tinulak ako ng asawa ko." was classified Critical.
 * Run with:  npm run test:push
 *
 * Expected levels are worked out from the matrix definitions in
 * lib/riskMatrices.ts (which are checked word for word against the PDFs by
 * test:matrices) - not hardcoded labels. Groq is replaced by a deliberately
 * aggressive fake that claims "Level 4: Physical assault" and "happening now"
 * for every report, to show that neither can put a report at Critical without
 * the reported facts to support it.
 */
import { prisma } from '../lib/prisma';
import { analyzeIntake, triageStatusFor, type IntakeAnswer, type SlotId } from '../lib/intake';
import { runIntake } from '../lib/intakeServer';
import { MATRICES, PHYSICAL_ASSAULT_NOTE } from '../lib/riskMatrices';
import { dayKey } from '../lib/aiClassifier';

process.env.AI_REQUESTS_PER_MINUTE = '30';
process.env.AI_MAX_WAIT_MS = '30000';
process.env.AI_RESIDENT_DAILY_LIMIT = '200';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

/** The level at which the VAWC matrix lists an indicator - from the definition, not a constant. */
const levelOf = (indicator: string) => MATRICES.VAWC.levels.find(l => l.indicators.some(i => i.text === indicator))!.level;
const labelOf = (level: number) => MATRICES.VAWC.levels.find(l => l.level === level)!.label;

const PUSH = 'Tinulak ako ng asawa ko.';
const PUSH_HURT = 'Tinulak ako ng asawa ko at nasugatan ako.';
const PUSH_NOW = 'Tinulak ako ng asawa ko at patuloy niya akong sinasaktan ngayon.';
const PUSH_OUT = 'Tinulak ako ng asawa ko at nawalan ako ng malay.';

// ─── The aggressive fake ─────────────────────────────────────────────────────
let sentUser = '';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).includes('api.groq.com')) return realFetch(url, init);
  sentUser = JSON.parse(String(init?.body)).messages[1].content;
  const sid = /\[(S\d+)\] VAWC [^\n]*Level 4 /.exec(sentUser)?.[1] ?? 'S0';
  const reply = {
    // "imminent" quoted from words that do not say "now".
    facts: [{ key: 'force', quote: 'Tinulak ako ng asawa ko' }, { key: 'partner', quote: 'asawa ko' }, { key: 'imminent', quote: 'Tinulak ako ng asawa ko' }],
    slots: [], category: 'Domestic Violence', categoryConfidence: 'high', alternativeCategories: [], reasons: [],
    assessment: {
      framework: 'VAWC', riskLevel: 4, riskLabel: 'CRITICAL',
      criteria: [{ level: 4, criterion: 'Physical assault', source: sid, reportQuote: 'Tinulak ako ng asawa ko' }],
      informationSufficient: true, essentialMissing: [], classificationStatus: 'PRELIMINARY',
      understanding: 'The reporter states their spouse pushed them.', missingInformation: [], uncertainty: [],
      recommendedNextAction: 'Treat as an emergency.', urgentHumanReview: false, affectedPerson: 'REPORTER', reporterKnowledge: 'DIRECT',
    },
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { total_tokens: 40 } }), { status: 200 });
}) as typeof fetch;

/** Every question the rules would ask, in order, if the resident skipped each. */
function questionsAsked(narrative: string): SlotId[] {
  const asked: SlotId[] = []; const answers: IntakeAnswer[] = [];
  for (let i = 0; i < 15; i++) {
    const q = analyzeIntake({ narrative, answers }).result.nextQuestion;
    if (!q) break;
    asked.push(q.slot); answers.push({ slot: q.slot, kind: 'skipped' });
  }
  return asked;
}

async function main() {
  // Today's app-wide usage row is put back as it was: the fake's calls are not real use.
  const day = `day:${dayKey(Date.now())}`;
  const usageBefore = await prisma.aiUsage.findUnique({ where: { bucket: day } });
  try {
    console.log('0. what the matrix says');
    const pa = MATRICES.VAWC.levels.flatMap(l => l.indicators).find(i => i.text === 'Physical assault')!;
    ok('"Physical assault" is listed under the level headed "Violence Occurring / Imminent"', /Violence Occurring \/ Imminent/.test(labelOf(levelOf('Physical assault'))));
    ok('...and SafeComm applies it only when the violence is occurring or imminent', JSON.stringify(pa.when) === JSON.stringify({ all: ['force', 'imminent'] }));
    ok('...with the open question recorded for the matrix owners, not silently decided', pa.note === PHYSICAL_ASSAULT_NOTE && /Clarification requested/.test(pa.note ?? ''));

    console.log('\n1. "Tinulak ako ng asawa ko."');
    const r1 = analyzeIntake({ narrative: PUSH }).result;
    ok('possible physical domestic violence is recognised: VAWC desk, physical force noted', r1.framework === 'VAWC'
      && r1.supportingIndicators.some(s => /Tinulak/.test(s.quote)));
    ok('not Critical - no criterion is met, so the level is undetermined', r1.matrixLevel === null && r1.riskLevel === null, `${r1.riskLevel}`);
    ok('not Low either', r1.riskLevel !== 'Low');
    ok('not classified: needs more information, and sent to an officer', r1.assessmentStatus === 'NEEDS_MORE_INFORMATION'
      && r1.requiresOfficerReview && triageStatusFor(r1) === 'NEEDS_FOLLOW_UP');
    ok('nothing assumed: injury, danger now, timing and repetition all stay unknown',
      (['injury', 'safety', 'timing', 'recurrence'] as SlotId[]).every(id => r1.slots.find(s => s.id === id)?.value === 'unknown'));
    ok('the officer is told why, and what would decide it', r1.reviewReasons.some(x => /Violence Occurring \/ Imminent/.test(x))
      && r1.levelCaveats.some(x => /Level 4/.test(x)));
    const asked1 = questionsAsked(PUSH);
    ok('it asks whether they are safe, when it happened / whether it is still happening, and whether anyone was hurt',
      ['safety', 'timing', 'injury'].every(s => asked1.includes(s as SlotId)), asked1.join(','));
    ok('...danger now first', asked1[0] === 'safety');
    ok('...and only relevant questions', asked1.every(s => r1.slots.find(x => x.id === s)?.relevant));

    console.log('\n2. "Tinulak ako ng asawa ko at nasugatan ako."');
    const r2 = analyzeIntake({ narrative: PUSH_HURT }).result;
    ok('the stated injury is recorded as known, from the words', r2.slots.find(s => s.id === 'injury')?.value === 'yes');
    ok('still no criterion met while the timing is unknown - undetermined, not Critical', r2.matrixLevel === null && r2.riskLevel === null);
    ok('it is distinguished from the first report: the injury question is not asked again, medical help is',
      !questionsAsked(PUSH_HURT).includes('injury') && questionsAsked(PUSH_HURT).includes('injuryCare'));
    const now2 = analyzeIntake({ narrative: PUSH_HURT, answers: [{ slot: 'timing', kind: 'option', value: 'yes' }] }).result;
    ok('answered "still happening" -> the level the matrix gives "Physical assault", and danger now',
      now2.matrixLevel === levelOf('Physical assault') && now2.immediateSafetyConcern, `L${now2.matrixLevel}`);
    const over2 = analyzeIntake({ narrative: PUSH_HURT, answers: [{ slot: 'timing', kind: 'option', value: 'no' }] }).result;
    ok('answered "it has ended" -> still undetermined, and the officer decides (the matrix is silent)', over2.matrixLevel === null
      && over2.riskLevel === null && over2.levelCaveats.some(x => /ended|tapos na/.test(x)));
    const care2 = analyzeIntake({ narrative: PUSH_HURT, answers: [{ slot: 'injuryCare', kind: 'option', value: 'yes' }] }).result;
    ok('answered "needs medical help" -> the safety rule sets a level and flags it urgent, the matrix still unmet', care2.riskLevel === 'High'
      && care2.immediateSafetyConcern && care2.matrixLevel === null, `${care2.riskLevel}`);

    console.log('\n3. "...at patuloy niya akong sinasaktan ngayon."');
    const r3 = analyzeIntake({ narrative: PUSH_NOW }).result;
    ok('"still happening now" is read from the words', r3.slots.find(s => s.id === 'timing')?.value === 'yes');
    ok('-> the level the matrix gives "Physical assault" when occurring', r3.matrixLevel === levelOf('Physical assault')
      && r3.matchedCriteria.some(m => m.indicator === 'Physical assault'), `L${r3.matrixLevel}`);
    ok('...supported by the resident\'s own words', r3.matchedCriteria.find(m => m.indicator === 'Physical assault')!.evidence.some(e => /ngayon|patuloy/.test(e)));
    ok('...danger now: safety guidance and urgent review, without waiting for answers', r3.immediateSafetyConcern
      && triageStatusFor(r3) === 'URGENT_REVIEW' && /Huwag nang hintayin|Do not wait/.test(r3.recommendedNextSteps[0] ?? ''));

    console.log('\n4. "...at nawalan ako ng malay."');
    const r4 = analyzeIntake({ narrative: PUSH_OUT }).result;
    ok('-> the level the matrix gives "severe violence causing unconsciousness"', r4.matrixLevel === levelOf('severe violence causing unconsciousness')
      && r4.matchedCriteria[0]?.evidence.some(e => /nawalan ako ng malay/.test(e)), `L${r4.matrixLevel}`);
    ok('...urgent, whatever else is unknown', r4.immediateSafetyConcern && triageStatusFor(r4) === 'URGENT_REVIEW');

    console.log('\n5. the four are told apart');
    const levels = [r1, r2, r3, r4].map(r => `${r.matrixLevel}|${r.immediateSafetyConcern}|${r.slots.find(s => s.id === 'injury')?.value}`);
    ok('four different readings from four different reports', new Set(levels).size === 4, levels.join(' / '));
    ok('the same holds in English', analyzeIntake({ narrative: 'My husband pushed me.' }).result.riskLevel === null
      && analyzeIntake({ narrative: 'My husband pushed me and he is hitting me right now.' }).result.matrixLevel === levelOf('Physical assault'));

    console.log('\n6. with Groq: the AI cannot put it back at Critical');
    const g1 = await runIntake({ residentId: 'push-regression', narrative: PUSH, useAi: true, relationship: 'SELF' });
    ok('the VAWC matrix is the one retrieved', /\] VAWC /.test(sentUser) && !/\] BLOTTER /.test(sentUser));
    ok('an AI "imminent" quoted from words that do not say "now" is discarded', !g1.grounding.ai?.hints?.facts.some(f => f.key === 'imminent'));
    ok('the AI\'s "Level 4: Physical assault" is not applied - still undetermined', g1.result.riskLevel === null && g1.result.matrixLevel === null,
      `${g1.result.riskLevel}`);
    ok('...it is shown to the officer as a disagreement instead', g1.result.reviewReasons.some(x => /AI assessment: Level 4/.test(x))
      && g1.result.assessmentStatus !== 'PRELIMINARY');
    const g3 = await runIntake({ residentId: 'push-regression', narrative: PUSH_NOW, useAi: true, relationship: 'SELF' });
    ok('where the facts do support it, the AI and the matrix agree', g3.result.matrixLevel === levelOf('Physical assault')
      && g3.grounding.ai?.assessment?.level === levelOf('Physical assault'));
  } finally {
    globalThis.fetch = realFetch;
    await prisma.aiUsage.deleteMany({ where: { bucket: { startsWith: 'resident:push-regression:' } } });
    if (usageBefore) await prisma.aiUsage.update({ where: { bucket: day }, data: { requests: usageBefore.requests, tokens: usageBefore.tokens } });
    else await prisma.aiUsage.deleteMany({ where: { bucket: day } });
  }
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main().finally(() => prisma.$disconnect());
