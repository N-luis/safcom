/**
 * The case classifier against the specification's own worked examples, the
 * seven hard rules, and the grounding rules.
 *
 * Run with:  npm run test:classify
 */
import { classifyCase, enforceHardRules, type Classification } from '../lib/caseClassification';
import { SCORE_BANDS, levelForScore } from '../lib/riskLevel';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const run = (report: string, extra: Partial<Parameters<typeof classifyCase>[0]> = {}) =>
  classifyCase({ report, ...extra });

const quoteFor = (c: Classification, p: string) =>
  c.evidence_from_report.find(q => q.parameter === p)?.quote ?? '';

console.log('1. the specification’s videoke example');
const videoke = run('sobrang ingay ng videoke nila ayaw nilang hinaan alas dose na ganun pa rin silang kaingay pakibigyan na sila ng action');
ok('category is a neighbour dispute', videoke.case_category === 'neighbor_community_dispute', videoke.case_category);
ok('level is LOW', videoke.risk_level === 'LOW', videoke.risk_level);
ok('score is in the LOW band', videoke.score <= SCORE_BANDS.Low.max, String(videoke.score));
ok('H6 was applied', videoke.hard_rules_applied.includes('H6'), videoke.hard_rules_applied.join(','));
ok('no injury asserted', videoke.parameters.injury === 'unknown' || videoke.parameters.injury === 'none', videoke.parameters.injury);
ok('no weapon asserted', videoke.parameters.weapon === 'unknown' || videoke.parameters.weapon === 'none', videoke.parameters.weapon);
ok('asks how often it happened', videoke.missing_information.some(m => /how often/i.test(m)));
ok('explanation names no level', !/\b(low|medium|high|critical)\b/i.test(videoke.explanation), videoke.explanation);

console.log('\n2. hard rules raise the level');
const danger = run('Nandito pa siya ngayon sa labas at may dala siyang kutsilyo.');
ok('H1 immediate danger -> CRITICAL', danger.risk_level === 'CRITICAL', danger.risk_level);
ok('H1 recorded', danger.hard_rules_applied.includes('H1'));
ok('urgent review', danger.recommended_review === 'Urgent Human Review');

const minor = run('Sinaktan ng kapitbahay ang anak ko kahapon.');
ok('H2 minor + abuse -> at least HIGH', ['HIGH', 'CRITICAL'].includes(minor.risk_level), minor.risk_level);
ok('H2 recorded', minor.hard_rules_applied.includes('H2'));
ok('child_involved routing hint', minor.routing_hints.child_involved === 'yes');

const partner = run('Sinuntok ako ng asawa ko kagabi sa loob ng bahay namin.');
ok('H3 household violence -> at least HIGH', ['HIGH', 'CRITICAL'].includes(partner.risk_level), partner.risk_level);
ok('H3 recorded', partner.hard_rules_applied.includes('H3'));
ok('routing hint set', partner.routing_hints.partner_or_household_violence === 'yes');

const armed = run('May dala siyang kutsilyo at pinagbantaan niya ako.');
ok('H4 weapon + threat -> at least HIGH', ['HIGH', 'CRITICAL'].includes(armed.risk_level), armed.risk_level);
ok('H4 recorded', armed.hard_rules_applied.includes('H4'));

const serious = run('Malubha ang tama ng kapatid ko, nawalan siya ng malay.');
ok('H5 serious injury -> HIGH or CRITICAL', ['HIGH', 'CRITICAL'].includes(serious.risk_level), serious.risk_level);
ok('H5 recorded', serious.hard_rules_applied.includes('H5'));

const repeated = run('Paulit-ulit ang ingay ng videoke nila tuwing gabi.');
ok('H6 repeated dispute -> MEDIUM', repeated.risk_level === 'MEDIUM', repeated.risk_level);
ok('frequency is repeated', repeated.parameters.frequency === 'repeated');

console.log('\n3. level and score always agree');
const corpus = [videoke, danger, minor, partner, armed, serious, repeated];
corpus.forEach((c, i) => ok(`case ${i} score sits in its band`,
  levelForScore(c.score).toUpperCase() === c.risk_level, `${c.score} is ${levelForScore(c.score)}, level ${c.risk_level}`));

console.log('\n4. nothing is asserted without a quote');
corpus.forEach((c, i) => {
  const asserted = Object.entries(c.parameters).filter(([k, v]) =>
    k !== 'evidence' && k !== 'prior_cases'
    && (Array.isArray(v) ? !v.includes('unknown') && v.length > 0 : v !== 'unknown'));
  const missingQuote = asserted.filter(([k]) => !quoteFor(c, k));
  ok(`case ${i} every asserted parameter is quoted`, missingQuote.length === 0,
    missingQuote.map(([k]) => k).join(','));
});

console.log('\n5. an unclear word cannot support a parameter');
const unclear = run('May dala siyang kutsilyo daw.', { unclearWords: ['kutsilyo'] });
ok('weapon not asserted from unclear text', unclear.parameters.weapon === 'unknown', unclear.parameters.weapon);
ok('flagged for human review', unclear.needs_human_review === true);
ok('says which word was unclear', unclear.needs_human_review_reason.includes('kutsilyo'));

console.log('\n6. unknowns never lower the level');
const vague = run('May nangyari po kagabi sa amin.');
ok('stays at least LOW with unknowns listed', vague.missing_information.length > 0);
ok('no reassuring parameters invented',
  vague.parameters.injury === 'unknown' && vague.parameters.weapon === 'unknown');

console.log('\n7. no fault, no legal advice, no claim of police contact');
const BANNED = ['guilty', 'at fault', 'should sue', 'police were contacted', 'we contacted the pnp', 'has been reported to the police'];
corpus.concat([unclear, vague]).forEach((c, i) => {
  const all = (c.explanation + ' ' + c.needs_human_review_reason).toLowerCase();
  BANNED.forEach(b => ok(`case ${i} avoids "${b}"`, !all.includes(b)));
});

console.log('\n8. the specification’s traffic-docket example');
const docket = run(
  'Traffic Accident Investigation Report. Two vehicles collided along the national road. '
  + 'One driver reportedly drank alcohol before driving. Plate No. ABC 1234.',
  { confirmedDocument: { type: 'Police traffic report', text: 'Plate No. ABC 1234' } },
);
ok('category is a traffic accident', docket.case_category === 'traffic_accident', docket.case_category);
ok('intoxication is yes', docket.parameters.intoxication === 'yes', docket.parameters.intoxication);
ok('the document phrase is quoted', /drank alcohol/i.test(quoteFor(docket, 'intoxication')), quoteFor(docket, 'intoxication'));
ok('injury stays unknown', docket.parameters.injury === 'unknown', docket.parameters.injury);
ok('level is MEDIUM or LOW', ['MEDIUM', 'LOW'].includes(docket.risk_level), docket.risk_level);
ok('a confirmed document counts as evidence', docket.parameters.evidence.includes('document'));
ok('flagged for human review', docket.needs_human_review === true);
ok('the reason names alcohol and the unstated injury',
  /alcohol/i.test(docket.needs_human_review_reason) && /injury is not stated/i.test(docket.needs_human_review_reason),
  docket.needs_human_review_reason);

console.log('\n9. a quote never runs past its own sentence');
ok('the plate number is not dragged in', !/ABC 1234/.test(quoteFor(docket, 'intoxication')), quoteFor(docket, 'intoxication'));
corpus.concat([docket]).forEach((c, i) => c.evidence_from_report.forEach(q => {
  const inner = q.quote.replace(/[.!?]+["')\]]*\s*$/, '');
  ok(`case ${i} quote for ${q.parameter} holds one sentence`,
    !/[.!?]\s/.test(inner), JSON.stringify(q.quote));
  ok(`case ${i} quote for ${q.parameter} is at most 12 words`,
    q.quote.trim().split(/\s+/).length <= 12, JSON.stringify(q.quote));
}));

console.log('\n10. the hard rules raise, and never lower');
const childHurt = { report: 'Sinaktan ng kapitbahay ang anak ko kahapon.' };
ok('a Low engine is raised off Low',
  enforceHardRules('Low', childHurt).level !== 'Low', enforceHardRules('Low', childHurt).level);
ok('a Critical engine is left alone',
  enforceHardRules('Critical', childHurt).level === 'Critical');
ok('danger reaches Critical from Low',
  enforceHardRules('Low', { report: 'Nandito pa siya ngayon sa labas at may dala siyang kutsilyo.' }).level === 'Critical');

// H6 is the one rule that names a low level, so it must not pull an engine
// that read the same words as worse back down to its own answer.
const noisy = { report: 'sobrang ingay ng videoke nila alas dose na' };
ok('a quiet dispute does not lower a High engine',
  enforceHardRules('High', noisy).level === 'High', enforceHardRules('High', noisy).level);
ok('a quiet dispute leaves a Low engine Low',
  enforceHardRules('Low', noisy).level === 'Low');
ok('the classification comes back with the level',
  enforceHardRules('Low', childHurt).classification.hard_rules_applied.includes('H2'));

console.log('\n11. a term is a word, not letters inside one');
// Both of these came from real reports in the barangay's own records.
const shoplift = run('nagnakaw ng manok sa alfamart at nag wala sa oisave at 7/11 sya hindi namin alam dahilan nabaliw na');
ok('"ama" inside "alfamart" is not a family relationship',
  shoplift.parameters.relationship === 'unknown', shoplift.parameters.relationship);
ok('"nabali" inside "nabaliw" is not a broken bone',
  shoplift.parameters.injury === 'unknown', shoplift.parameters.injury);
ok('no rule raises a shoplifting report',
  shoplift.hard_rules_applied.every(r => r === 'H6' || r === 'H7'), shoplift.hard_rules_applied.join(','));
ok('it is still read as a property case',
  shoplift.case_category === 'property', shoplift.case_category);

ok('an affixed root is still found: batang', run('may batang sinaktan dito').parameters.vulnerable_person.includes('minor'));
ok('an affixed root is still found: nasugatan', run('nasugatan ang kapitbahay ko').parameters.injury !== 'unknown');
ok('an affixed root is still found: nagnakaw', run('nagnakaw siya sa tindahan').case_category === 'property');

console.log('\n12. the explanation never contradicts the level');
const spouse = run('ang aking asawa ay hinampas ako ng dospordos');
ok('a spouse assault reaches at least HIGH', ['HIGH', 'CRITICAL'].includes(spouse.risk_level), spouse.risk_level);
ok('physical force is quoted', !!quoteFor(spouse, 'physical_force'), JSON.stringify(spouse.evidence_from_report));
ok('the explanation says force was described', /physical force/i.test(spouse.explanation), spouse.explanation);
ok('a raised case is never called a nuisance', !/nuisance/i.test(spouse.explanation), spouse.explanation);

// The reassuring sentence belongs to H6 and to nothing else.
[danger, minor, partner, armed, serious, spouse].forEach((c, i) =>
  ok(`raised case ${i} is not described as a nuisance`,
    !/nuisance/i.test(c.explanation), c.explanation));
ok('an H6 case may still be called a nuisance', /nuisance/i.test(videoke.explanation), videoke.explanation);

console.log('\n13. the words the barangay actually uses');
// Every string below is from a real report in the records. Each one was
// landing in "other_unclear" at LOW before the vocabulary was checked
// against the data instead of against invented examples.
const real: [string, string, string[]][] = [
  ['nagahasa si mias sa gilid ng damuhan sa oras na 11:58 pm ng kagabihan',
    'gender_based_harassment', ['HIGH', 'CRITICAL']],
  ['may pulubing pagala gala at hinipuan ako sa ilalim ng fly over',
    'gender_based_harassment', ['MEDIUM', 'HIGH']],
  ['hinipuan ako sa pwet', 'gender_based_harassment', ['MEDIUM', 'HIGH']],
  ['someone na sumusunod sakin kahit nakailang lipat nako ng pwesto',
    'gender_based_harassment', ['MEDIUM', 'HIGH']],
  ['nagka initan sa kalsada at nauwi sa suntukan', 'physical_harm', ['MEDIUM', 'HIGH']],
  ['may nanloob samin kagabi ata nawala mga gamit namin', 'property', ['LOW', 'MEDIUM']],
  ['maraming kabataan ang pasaway kung saan saan nag pipintura', 'property', ['LOW', 'MEDIUM']],
  ['binutas gulong ng kotse ko na ford', 'property', ['LOW', 'MEDIUM']],
];
real.forEach(([text, category, levels]) => {
  const c = run(text);
  const label = text.slice(0, 34);
  ok(`"${label}" is ${category}`, c.case_category === category, c.case_category);
  ok(`"${label}" is ${levels.join(' or ')}`, levels.includes(c.risk_level), `${c.risk_level} ${c.score}`);
});

// Keyboard noise has every unknown there is. It must not ride those unknowns
// into the queue ahead of the reports above.
['asdasdadsasdshfsaADSSDF', 'hahahahhahhahahhahahasosa', 'N/A'].forEach(junk => {
  const c = run(junk);
  ok(`"${junk.slice(0, 16)}" stays LOW`, c.risk_level === 'LOW', `${c.risk_level} ${c.score}`);
});

console.log('\n14. a reported rape does not depend on an injury being described');
const assault = run('nagahasa si mias kagabi');
ok('it reaches at least HIGH with no injury stated',
  ['HIGH', 'CRITICAL'].includes(assault.risk_level) && assault.parameters.injury === 'unknown',
  `${assault.risk_level}, injury ${assault.parameters.injury}`);
ok('the words are quoted', !!quoteFor(assault, 'sexual_violence'), JSON.stringify(assault.evidence_from_report));
ok('a police referral is suggested', assault.routing_hints.police_referral_suggested === 'yes'
  || assault.recommended_review !== 'Standard Review', assault.recommended_review);
ok('no injury is invented to get there',
  !/injury/i.test(assault.explanation) || /not state/i.test(assault.explanation), assault.explanation);

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
