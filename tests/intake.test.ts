/**
 * The assisted intake.  Run with:  npm run test:intake
 *
 * Each block is one of the acceptance criteria in the intake specification,
 * tested against lib/intake.ts directly. The live counterparts - submission,
 * notifications, access, officer override - are exercised against the
 * running app in the commit that added this.
 */
import {
  analyzeIntake, CONTEXT_MIN_WORDS, MAX_QUESTIONS, SLOT_ORDER,
  type IntakeAnswer, type IntakeResult,
} from '../lib/intake';
import { classifyCase, mentions } from '../lib/caseClassification';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const run = (narrative: string, answers: IntakeAnswer[] = [], selectedCategory: string | null = null): IntakeResult =>
  analyzeIntake({ narrative, answers, selectedCategory }).result;

const SHORT = 'Tinulak ako ng asawa ko.';
const DETAILED = 'Tinulak ako ng asawa ko kagabi sa kusina habang nagtatalo kami tungkol sa pera. '
  + 'Walang nasaktan sa amin. Ito ang unang beses na nangyari. Wala siyang hawak na kahit ano at '
  + 'hindi niya ako binantaan. Ligtas na ako ngayon, nasa bahay ako ng nanay ko. Walang bata sa bahay '
  + 'noon. Hindi pa ito naiulat kahit saan.';

console.log('1. a short report is not levelled by the category it was filed under');
const byCategory = ['Domestic Violence', 'Theft & Robbery', 'Noise Complaint', 'Other', null]
  .map(c => run(SHORT, [], c));
ok('the same level whatever was selected',
  new Set(byCategory.map(r => r.riskLevel)).size === 1, byCategory.map(r => r.riskLevel).join(','));
ok('it is not the old default "Medium"', byCategory[0].riskLevel !== 'Medium', byCategory[0].riskLevel);
ok('the level is explained by a named rule, not a category',
  byCategory[0].rulesApplied.includes('H3') && byCategory[0].riskRationale.some(r => /H3/.test(r)));
ok('completeness is reported separately, as INSUFFICIENT',
  byCategory[0].informationCompleteness === 'INSUFFICIENT');
ok('and it is sent for officer review', byCategory[0].requiresOfficerReview);
const vague = run('May problema ako at gusto kong humingi ng tulong sa barangay.', [], 'Domestic Violence');
ok('a report with no facts is not given a manufactured basis',
  vague.riskBasis === 'insufficient_information' && vague.rulesApplied.length === 0);
ok('and says plainly that unknown is not safe and not dangerous',
  vague.riskRationale.some(r => /nangangahulugang ligtas o mapanganib/.test(r)), vague.riskRationale.join(' | '));

console.log('\n2. it asks what is missing when information is insufficient');
const first = run(SHORT);
ok('a question is offered', Boolean(first.nextQuestion));
ok('safety is asked first', first.nextQuestion?.slot === 'safety', first.nextQuestion?.slot);
ok('in the resident’s language (Tagalog)', /Ligtas ka ba ngayon/.test(first.nextQuestion?.text ?? ''));
ok('with an introduction that says questions can be skipped', /laktawan/.test(first.intro));
ok('english reports get english questions',
  /Are you safe/.test(run('My husband pushed me.').nextQuestion?.text ?? ''));
ok('the safety question does not presume harm for a noise complaint',
  !/pananakit/.test(run('Sobrang ingay ng videoke ng kapitbahay namin gabi-gabi.').nextQuestion?.text ?? 'pananakit'));
ok('a question about the alleged person’s motive is never asked',
  SLOT_ORDER.every(s => !/bakit niya|why did (he|she)|motive/i.test(String(s))));

console.log('\n3. later questions follow the answers');
const safe = run(SHORT, [{ slot: 'safety', kind: 'option', value: 'no' }]);
ok('after safety is answered, it moves on', safe.nextQuestion?.slot !== 'safety', safe.nextQuestion?.slot);
const hurt = run(SHORT, [
  { slot: 'safety', kind: 'option', value: 'no' },
  { slot: 'context', kind: 'text', text: 'Nagtatalo kami tungkol sa pera kagabi tapos tinulak niya ako sa pader.' },
  { slot: 'injury', kind: 'option', value: 'yes' },
]);
ok('"someone was hurt" brings the medical question', hurt.nextQuestion?.slot === 'injuryCare', hurt.nextQuestion?.slot);
const notHurt = run(SHORT, [
  { slot: 'safety', kind: 'option', value: 'no' },
  { slot: 'context', kind: 'text', text: 'Nagtatalo kami tungkol sa pera kagabi tapos tinulak niya ako sa pader.' },
  { slot: 'injury', kind: 'option', value: 'no' },
]);
ok('"no one was hurt" does not', notHurt.nextQuestion?.slot !== 'injuryCare'
  && !notHurt.slots.find(s => s.id === 'injuryCare')!.relevant);
ok('a typed answer that settles a later question is not asked again',
  run(SHORT, [{ slot: 'context', kind: 'text', text: 'Paulit-ulit na niya itong ginagawa tuwing lasing siya.' }])
    .slots.find(s => s.id === 'recurrence')!.value === 'yes');

console.log('\n4. a detailed report goes through without needless questions');
const detailed = run(DETAILED);
ok('it is SUFFICIENT straight away', detailed.informationCompleteness === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT',
  detailed.informationCompleteness);
ok('no question is asked', detailed.nextQuestion === null, detailed.nextQuestion?.slot);
ok(`a narrative of ${CONTEXT_MIN_WORDS}+ words counts as describing the circumstances`,
  detailed.slots.find(s => s.id === 'context')!.status === 'known');

console.log('\n5. unknown stays unknown');
const skipped = run(SHORT, [
  { slot: 'safety', kind: 'declined' },
  { slot: 'context', kind: 'skipped' },
  { slot: 'injury', kind: 'option', value: 'unsure' },
]);
for (const id of ['safety', 'context', 'injury'] as const) {
  const s = skipped.slots.find(x => x.id === id)!;
  ok(`${id}: left unknown, not assumed`, s.value === 'unknown', s.value);
}
ok('declined and skipped questions are not asked again',
  !['safety', 'context', 'injury'].includes(skipped.nextQuestion?.slot ?? ''));
ok('they are listed as not answered', skipped.notAnswered.length === 3, skipped.notAnswered.join('; '));
ok('and the report is still INSUFFICIENT', skipped.informationCompleteness === 'INSUFFICIENT');
ok('an unanswered safety question raises no concern and no all-clear',
  !skipped.immediateSafetyConcern && skipped.slots.find(s => s.id === 'safety')!.value === 'unknown');

console.log('\n6. danger reaches the emergency path without finishing the questions');
const danger = run(SHORT, [{ slot: 'safety', kind: 'option', value: 'yes' }]);
ok('the concern is raised after one answer', danger.immediateSafetyConcern);
ok('the level is Critical (rule H1)', danger.riskLevel === 'Critical' && danger.rulesApplied.includes('H1'));
ok('the first next step says not to wait', /Huwag nang hintayin/.test(danger.recommendedNextSteps[0] ?? ''));
ok('danger stated in the narrative itself is caught too',
  run('Sinasaktan ako ng asawa ko at nandito pa siya ngayon sa labas ng bahay.').riskLevel === 'Critical');
ok('a medical need is a concern as well',
  run(SHORT, [{ slot: 'injury', kind: 'option', value: 'yes' }, { slot: 'injuryCare', kind: 'option', value: 'yes' }])
    .immediateSafetyConcern);

console.log('\n7. nothing is invented');
const neg = classifyCase({ report: DETAILED, unclearWords: [], attachments: {} });
ok('"hindi niya ako binantaan" is not a threat', neg.parameters.threats === 'none', neg.parameters.threats);
ok('"walang bata sa bahay" is not a child', !neg.parameters.vulnerable_person.includes('minor'),
  JSON.stringify(neg.parameters.vulnerable_person));
ok('so rule H2 (child + harm) does not fire', !neg.hard_rules_applied.includes('H2'), neg.hard_rules_applied.join(','));
ok('"wala siyang hawak" is no weapon', neg.parameters.weapon === 'none', neg.parameters.weapon);
ok('"ligtas na ako ngayon" is read as safe', neg.parameters.reporter_safety === 'safe');
ok('a denial does not reach across a different verb ("hindi tumigil sa pananakit")',
  Boolean(mentions('Hindi tumigil sa pananakit ang asawa ko.', 'physical')));
ok('nor across "not only" ("hindi lang ako sinaktan")',
  Boolean(mentions('Hindi lang ako sinaktan, pati ang anak ko.', 'physical')));
ok('nor past a "pero"', Boolean(mentions('Hindi ko alam pero sinaktan niya ako.', 'physical')));
ok('english denials work', mentions('He did not threaten me.', 'threatVerbal') === null);
const bare = run(SHORT);
ok('the bare report names no injury', bare.slots.find(s => s.id === 'injury')!.value === 'unknown');
ok('no witness, no weapon, no child is claimed',
  ['weapon', 'children'].every(id => bare.slots.find(s => s.id === id)!.value === 'unknown'));
ok('every indicator is a quote from the resident',
  bare.supportingIndicators.every(i => SHORT.toLowerCase().includes(i.quote.toLowerCase().replace(/[.]$/, ''))));
ok('and every indicator is marked as reported, never verified',
  [bare, detailed, hurt].every(r => r.supportingIndicators.every(i => i.source === 'report' || i.source === 'answer')));

console.log('\n8. the category comes from the words, not the dropdown');
const asTheft = run(SHORT, [], 'Theft & Robbery');
ok('a push by a spouse filed as Theft is suggested as Domestic Violence',
  asTheft.suggestedCaseCategory === 'Domestic Violence', asTheft.suggestedCaseCategory ?? 'null');
ok('the selection is kept, not overwritten', asTheft.selectedCategory === 'Theft & Robbery');
ok('the disagreement is recorded', asTheft.conflicts.length === 1);
ok('and it is routed to the VAWC desk for review', asTheft.route === 'VAWC'
  && asTheft.reviewReasons.some(r => /VAWC/.test(r)));
const noise = run('Sobrang ingay ng videoke ng kapitbahay namin gabi-gabi hanggang madaling araw.', [], 'Domestic Violence');
ok('a noise complaint filed as DV is suggested as a Noise Complaint',
  noise.suggestedCaseCategory === 'Noise Complaint', noise.suggestedCaseCategory ?? 'null');
ok('and routed to the blotter', noise.route === 'Blotter');
ok('a report with nothing to go on gets no forced category',
  vague.suggestedCaseCategory === null && vague.categoryConfidence === 'low');
ok('a five-word report is not given high category confidence',
  run(SHORT).categoryConfidence !== 'high', run(SHORT).categoryConfidence);
ok('the reasons for the suggestion quote the report',
  asTheft.categoryRationale.some(r => /tinulak/i.test(r)), asTheft.categoryRationale.join(' | '));

console.log('\n9. limits');
const flood: IntakeAnswer[] = SLOT_ORDER.flatMap(slot => [
  { slot, kind: 'skipped' as const }, { slot, kind: 'skipped' as const },
]);
const capped = run(SHORT, flood);
ok(`never more than ${MAX_QUESTIONS} questions`, capped.questionsAsked <= MAX_QUESTIONS, String(capped.questionsAsked));
ok('a repeated answer to one question counts once', capped.questionsAsked === SLOT_ORDER.length);
ok('an over-long typed answer is bounded',
  analyzeIntake({ narrative: SHORT, answers: [{ slot: 'context', kind: 'text', text: 'x'.repeat(5000) }] })
    .result.slots.find(s => s.id === 'context')!.quote!.length <= 1000);
ok('the same input always gives the same result',
  JSON.stringify(run(SHORT, [{ slot: 'safety', kind: 'option', value: 'no' }]))
    === JSON.stringify(run(SHORT, [{ slot: 'safety', kind: 'option', value: 'no' }])));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exit(1); }
