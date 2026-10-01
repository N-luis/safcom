/**
 * Guards the bug where the result card's badge read HIGH while the sentence
 * beneath it still read "Classified Low because ...", and the score agreed
 * with neither.
 *
 * Run with:  npm run test:risk
 */
import { computeRisk } from '../lib/riskEngine';
import { levelForScore, SCORE_BANDS, explainLevel, stripLevelWords } from '../lib/riskLevel';

let pass = 0;
const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
}

const base = {
  barangay: 'Ayukit', filedAt: new Date('2026-10-01T14:00:00'),
  residentId: null, status: 'Open', barangayCaseCount: 1, residentPriorCases: 0,
};
const run = (description: string, caseType = 'Public Nuisance') =>
  computeRisk({ ...base, caseType, description });

console.log('1. a minor is involved and the text analysis alone reads Low');
const minor = run('May bata na naiwan mag-isa sa kalsada malapit sa highway kaninang gabi.');
ok('badge is High', minor.level === 'High', minor.level);
ok('sentence says High', minor.justification.startsWith('Classified High'), minor.justification);
ok('sentence no longer says Low', !/classified low/i.test(minor.justification));
ok('score reaches the High band', minor.score >= SCORE_BANDS.High.min, String(minor.score));
ok('the stored assessment carries the same sentence', minor.assessment.reason === minor.justification);
ok('the stored assessment carries the same level', minor.assessment.level === minor.level);

console.log('2. no risk factors at all');
const calm = run('Nais ko lang magtanong tungkol sa proseso ng barangay clearance.');
ok('badge is Low', calm.level === 'Low', calm.level);
ok('sentence says Low', calm.justification.startsWith('Classified Low'), calm.justification);
ok('score stays in the Low band', calm.score <= SCORE_BANDS.Low.max, String(calm.score));

console.log('3. immediate danger');
const danger = run('Nasa labas siya ng bahay ngayon at may dala siyang kutsilyo. Papatayin daw niya ako.');
ok('level is High or Critical', ['High', 'Critical'].includes(danger.level), danger.level);
ok('review is Urgent Human Review', danger.assessment.recommendedReview === 'Urgent Human Review', danger.assessment.recommendedReview);
ok('sentence matches the badge', danger.justification.startsWith(`Classified ${danger.level}`), danger.justification);

console.log('4. the sentence never names a level other than the badge');
const corpus = [
  'May bata na naiwan mag-isa sa kalsada.',
  'Minura ako niya noong nagtalo kami.',
  'Tinulak niya ako noong nagtatalo kami.',
  'Sinakal niya ako at may hawak siyang kutsilyo.',
  'Nais ko lang magtanong tungkol sa clearance.',
  'Paulit-ulit niya akong sinasaktan at lumalala na ito.',
  'Sinabi niya na sasaktan niya ang anak ko kapag nagsumbong ako.',
  'My bicycle was taken from the front yard yesterday.',
  'Sinusundan niya ako at alam niya kung saan ako nakatira.',
  'Hinarangan niya ang pinto para hindi ako makalabas.',
];
const OTHERS: Record<string, string[]> = {
  Low: ['Medium', 'High', 'Critical'],
  Medium: ['Low', 'High', 'Critical'],
  High: ['Low', 'Medium', 'Critical'],
};
for (const text of corpus) {
  const r = run(text);
  const label = `"${text.slice(0, 30)}…"`;
  // Only the opening "Classified <level>" may name a level.
  const clause = r.justification.replace(/^Classified \w+ because /, '');
  for (const other of OTHERS[r.level]) {
    ok(`${label} clause omits ${other}`, !new RegExp(`\\b${other}\\b(?!-)`, 'i').test(clause), clause);
  }
  ok(`${label} opens with its own level`,
    r.justification.startsWith(`Classified ${r.level} `) || r.justification === `Classified ${r.level}.`,
    r.justification);
  ok(`${label} score sits in the level's band`,
    levelForScore(r.score) === r.level, `${r.score} is ${levelForScore(r.score)}, level is ${r.level}`);
  ok(`${label} assessment reason equals the justification`, r.assessment.reason === r.justification);
}

console.log('5. nothing else on the card changed');
const card = run('Paulit-ulit niya akong sinasaktan at lumalala na ito. Takot ako.');
ok('frequency still present', (card.assessment.frequency ?? '').length > 0);
ok('escalation still present', (card.assessment.escalation ?? '').length > 0);
ok('immediate danger still present', ['Yes', 'No', 'Unclear'].includes(card.assessment.immediateDanger));
ok('recommended review still present', card.assessment.recommendedReview.length > 0);
ok('missing information still present', Array.isArray(card.assessment.missingInformation));
ok('detected factors still present', card.assessment.detectedFactors.length > 0);
ok('recommended actions still present', card.assessment.recommendedActions.length > 0);
ok('confidence still present', typeof card.confidence === 'number');

console.log('6. the shared level helpers');
ok('bands are contiguous',
  SCORE_BANDS.Low.max + 1 === SCORE_BANDS.Medium.min
  && SCORE_BANDS.Medium.max + 1 === SCORE_BANDS.High.min
  && SCORE_BANDS.High.max + 1 === SCORE_BANDS.Critical.min);
([[0, 'Low'], [24, 'Low'], [25, 'Medium'], [49, 'Medium'],
  [50, 'High'], [74, 'High'], [75, 'Critical'], [100, 'Critical']] as const)
  .forEach(([n, want]) => ok(`${n} is ${want}`, levelForScore(n) === want, levelForScore(n)));
ok('a stale level word is stripped', !/\blow\b/i.test(stripLevelWords('Classified Low because verbal abuse')));
ok('a hyphenated compound survives', stripLevelWords('High-Risk Zone: 3 cases').includes('High-Risk Zone'));
ok('explainLevel rewrites a stale level',
  explainLevel('High', 'Classified Low because verbal abuse') === 'Classified High because verbal abuse.');

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
