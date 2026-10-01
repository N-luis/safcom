/**
 * The guard that stops a misread photo inventing a risk factor.
 * Run with:  npm run test:evidence
 */
import { buildEvidence } from '../lib/reportEvidence';
import { unreadable, extractUnclearWords, type Transcription } from '../lib/transcription';

let pass = 0; const fails: string[] = [];
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
};
const t = (text: string, confidence: Transcription['confidence'] = 'high'): Transcription => ({
  text, confidence, fields: [], unclearWords: extractUnclearWords(text), failed: false,
});
const hasFactor = (r: ReturnType<typeof buildEvidence>, id: string) =>
  r.analysis.detectedFactors.some(f => f.id === id);

console.log('1. a clear docket that never mentions a minor');
const clean = buildEvidence(
  'Nagreklamo ako tungkol sa ingay ng kapitbahay.',
  t('Blotter Entry Blg. 114. Reklamo tungkol sa ingay tuwing gabi. Walang nasaktan.'),
);
ok('no minor factor invented', !hasFactor(clean, 'vulnerable-person'));
ok('not flagged for review', clean.needsHumanReview === false, clean.reviewReasons.join(' '));

console.log('2. a blurry read must not create factors');
const blurry = buildEvidence(
  'May nangyari sa bahay namin kagabi.',
  t('May [?] na bata[?] at [?] siya ng kutsilyo[?]', 'low'),
);
ok('needs human review', blurry.needsHumanReview === true);
ok('no minor factor from unclear text', !hasFactor(blurry, 'vulnerable-person'));
ok('no weapon factor from unclear text', !hasFactor(blurry, 'weapon'));
ok('says why', blurry.reviewReasons.some(r => r.toLowerCase().includes('hard to read')), blurry.reviewReasons.join(' '));

console.log('3. an unreadable image falls back without an error');
const failedRead = buildEvidence('Ninakaw ang bisikleta ko.', unreadable());
ok('needs human review', failedRead.needsHumanReview === true);
ok('still classifies the typed text', failedRead.classifiedText.includes('bisikleta'));
ok('fallback message surfaced', failedRead.reviewReasons[0].toLowerCase().includes('could not be read')
  || failedRead.reviewReasons[0].toLowerCase().includes('not enabled'), failedRead.reviewReasons[0]);

console.log('4. a clearly written minor IS counted');
const realMinor = buildEvidence(
  'Nag-aalala ako sa nangyari.',
  t('May bata na naiwan mag-isa sa kalsada kagabi.'),
);
ok('minor factor kept', hasFactor(realMinor, 'vulnerable-person'));
ok('not withheld', realMinor.withheldFactors.length === 0);

console.log('5. an unclear minor is NOT counted, and is reported');
const doubtfulMinor = buildEvidence(
  'Nag-aalala ako sa nangyari.',
  t('May ba[?]ta na naiwan mag-isa sa kalsada kagabi.', 'medium'),
);
ok('minor factor withheld', !hasFactor(doubtfulMinor, 'vulnerable-person'));
ok('withholding is reported', doubtfulMinor.withheldFactors.length > 0 || doubtfulMinor.needsHumanReview);

console.log('6. the typed description is always trusted');
const typedMinor = buildEvidence(
  'May bata na naiwan mag-isa sa kalsada malapit sa highway.',
  t('[?] [?] [?]', 'low'),
);
ok('typed minor still counts', hasFactor(typedMinor, 'vulnerable-person'));
ok('still flagged for review', typedMinor.needsHumanReview === true);

console.log('7. marker extraction');
ok('pulls the words', extractUnclearWords('May ba[?]ta at Ruiz [?] dito').length === 2,
  extractUnclearWords('May ba[?]ta at Ruiz [?] dito').join(','));
ok('empty text is safe', extractUnclearWords('').length === 0);

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
