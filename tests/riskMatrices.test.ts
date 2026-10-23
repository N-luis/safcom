/**
 * The risk matrices, against their source documents and against reports.
 * Run with:  npm run test:matrices
 *
 * Part 1 reads the two PDFs and checks that every level label and every
 * indicator in lib/riskMatrices.ts appears in them exactly - so the rules
 * cannot quietly drift from the documents. Part 2 runs the scenarios the
 * specification names through the intake. No database is needed.
 */
import fs from 'fs';
import { extractMatrix } from '../lib/matrixExtraction';
import { MATRICES, queueLevelFor, evaluateMatrix, type Framework } from '../lib/riskMatrices';
import { analyzeIntake, type IntakeAnswer } from '../lib/intake';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const run = (narrative: string, answers: IntakeAnswer[] = []) => analyzeIntake({ narrative, answers }).result;

async function main() {
  console.log('1. the rules are the documents’ own words');
  for (const fw of ['BLOTTER', 'VAWC'] as Framework[]) {
    const def = MATRICES[fw];
    const ex = await extractMatrix(new Uint8Array(fs.readFileSync(def.sourceFile)));
    ok(`${fw}: the PDF reads without errors`, ex.errors.length === 0, ex.errors.join('; '));
    ok(`${fw}: document name matches`, ex.documentName === def.documentName, ex.documentName);
    for (const lv of def.levels) {
      const row = ex.chunks.find(c => c.riskLevel === lv.level);
      ok(`${fw} L${lv.level}: label is exactly "${lv.label}"`, row?.riskLabel === lv.label, row?.riskLabel ?? 'missing');
      const indicators = String(row?.fields?.['Examples / Indicators'] ?? '').toLowerCase();
      for (const ind of lv.indicators) {
        ok(`${fw} L${lv.level}: "${ind.text}" is in the document`, indicators.includes(ind.text.toLowerCase()));
      }
    }
  }

  console.log('\n2. scenarios from the specification');
  const s1 = run('Kagabi, maingay ang videoke ng kapitbahay namin hanggang hatinggabi. Kinausap ko sila nang maayos at hininaan naman nila. Walang nasaktan at walang nagbanta. Unang beses itong nangyari. Ligtas kami.');
  ok('1 detailed low-concern dispute -> Blotter L1 "Curfew noise violations"',
    s1.framework === 'BLOTTER' && s1.matrixLevel === 1 && s1.matchedCriteria[0]?.indicator === 'Curfew noise violations',
    `${s1.framework} L${s1.matrixLevel}`);
  ok('  ...needs no questions', s1.nextQuestion === null && s1.informationCompleteness === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT');

  const s2 = run('May problema ako at gusto kong humingi ng tulong sa barangay.');
  ok('2 insufficient -> no level, NEEDS_MORE_INFORMATION', s2.matrixLevel === null && s2.assessmentStatus === 'NEEDS_MORE_INFORMATION');
  ok('  ...and asks a question rather than forcing one', Boolean(s2.nextQuestion));

  const s3 = run('Text nang text sa akin ang dati kong kasintahan at sinusundan ako pauwi gabi-gabi.');
  ok('3 repeated messages / stalking -> VAWC L2 MODERATE',
    s3.framework === 'VAWC' && s3.matrixLevel === 2
    && ['Repeated unwanted messages', 'stalking-like conduct'].every(i => s3.matchedCriteria.some(m => m.indicator === i)),
    `${s3.framework} L${s3.matrixLevel} ${s3.matchedCriteria.map(m => m.indicator)}`);

  const s4 = run('Sinabi ng kapitbahay namin na sasaktan niya ako kapag dumaan pa ako sa tapat ng bahay nila.');
  ok('4 a threat by a neighbour -> Blotter L3 "Credible verbal threats"',
    s4.framework === 'BLOTTER' && s4.matrixLevel === 3 && s4.matchedCriteria.some(m => m.indicator === 'Credible verbal threats'),
    `${s4.framework} L${s4.matrixLevel}`);

  const s5 = run('Sinuntok ako ng kapitbahay namin kagabi sa tapat ng tindahan.');
  ok('5 physical violence -> Blotter L3, minor altercation', s5.matrixLevel === 3
    && s5.matchedCriteria.some(m => /without severe injury/.test(m.indicator)), `L${s5.matrixLevel}`);
  ok('  ...and says the unknown injury could raise it', s5.levelCaveats.some(c => /Serious physical assault/.test(c)));
  const s5b = run('Sinuntok ako ng kapitbahay namin kagabi sa tapat ng tindahan.', [
    { slot: 'injury', kind: 'option', value: 'yes' }, { slot: 'injuryCare', kind: 'option', value: 'yes' },
  ]);
  ok('  ...which an answer then does: L4 "Serious physical assault"', s5b.matrixLevel === 4
    && s5b.matchedCriteria.some(m => m.indicator === 'Serious physical assault'), `L${s5b.matrixLevel}`);

  const s6 = run('Sinasaktan ako ng asawa ko ngayon mismo, nandito pa siya sa bahay, tulungan niyo ako.');
  ok('6 immediate danger -> emergency path, VAWC L4', s6.immediateSafetyConcern && s6.matrixLevel === 4);
  ok('  ...the first step is to call, not to answer questions', /Huwag nang hintayin/.test(s6.recommendedNextSteps[0] ?? ''));

  const s7 = run('Nag-away kami ng tito ko tungkol sa lupa at sinabi niyang pagsisisihan ko ito.');
  ok('7 ambiguous -> FOR_REVIEW with alternatives', s7.assessmentStatus === 'FOR_REVIEW' && s7.requiresOfficerReview
    && s7.reviewReasons.some(r => /more than one category/.test(r)), s7.assessmentStatus);

  const s8 = run('My husband choked me last night and said he would kill me.');
  const s9 = run('Sinakal ako ng asawa ko kagabi at sinabi niyang papatayin niya ako.');
  ok('8 English -> VAWC L4 with "strangulation/choking"', s8.matrixLevel === 4
    && s8.matchedCriteria.some(m => m.indicator === 'strangulation/choking'));
  ok('9 the same report in Tagalog -> the same level and criteria', s9.matrixLevel === s8.matrixLevel
    && s9.matchedCriteria.map(m => m.indicator).join() === s8.matchedCriteria.map(m => m.indicator).join(),
    `${s9.matchedCriteria.map(m => m.indicator)} vs ${s8.matchedCriteria.map(m => m.indicator)}`);
  ok('  ...an English report answers in English', s8.language === 'english' && /Under the/.test(s8.riskRationale[0]));

  console.log('\n3. the category does not decide the level');
  ok('a matrix is chosen by desk; the level by criteria', run('Ninakaw ang cellphone ko.').matchedCriteria
    .every(m => m.indicator === 'theft or robbery'));
  ok('"Domestic Violence" with only an argument is not raised by the category',
    (run('Nag-away kami ng asawa ko tungkol sa pera.').matrixLevel ?? 0) <= 2);
  ok('no criterion -> no level, even with a serious-sounding category',
    run('Hindi nagbibigay ng sustento ang asawa ko.').matrixLevel === null);

  console.log('\n4. unknowns stay unknown');
  const thr = run('Sinabi ng asawa ko na sasaktan niya ako.');
  ok('a threat with danger-now unknown is not assumed "non-imminent" silently',
    thr.levelCaveats.length > 0 || thr.matrixLevel !== 2, `${thr.matrixLevel} ${thr.levelCaveats}`);
  ok('no level is ever invented from nothing', evaluateMatrix('VAWC', new Map()).level === null
    && evaluateMatrix('BLOTTER', new Map()).level === null);
  ok('indicators with no testable fact never fire',
    !run('Minor policy violation and severe criminal violations.').matchedCriteria
      .some(m => /policy violation|severe criminal/.test(m.indicator)));

  console.log('\n5. Extreme events and the queue');
  const stab = run('Sinaksak ang kapitbahay namin sa kanto kanina.');
  ok('a stabbing -> Blotter L5 and the emergency path', stab.matrixLevel === 5 && stab.immediateSafetyConcern);
  ok('L5 and L4 both queue as Critical; L3 High; L2 Medium; L1 Low',
    [5, 4, 3, 2, 1].map(queueLevelFor).join() === 'Critical,Critical,High,Medium,Low');
  ok('the framework status says it is not law',
    /not an official/.test(MATRICES.VAWC.status) && /do not establish legal guilt/.test(MATRICES.BLOTTER.status));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exit(1); }
}
main();
