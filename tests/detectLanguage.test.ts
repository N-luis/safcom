/**
 * Language detection against the cases a barangay report actually produces.
 *
 * Run with:  npm run test:language
 */
import {
  detectLanguage, detectLanguageSafe,
  TAGALOG_RATIO_THRESHOLD, ENGLISH_RATIO_THRESHOLD, MIXED_MIN_WORDS,
} from '../lib/detectLanguage';
import { RECOMMENDATION_LANGUAGE_INSTRUCTION } from '../lib/recommendationLanguage';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const say = (text: string) => {
  const d = detectLanguage(text);
  return `${d.language} (tl ${d.tagalogCount} / en ${d.englishCount}, conf ${d.confidence})`;
};

console.log('1. the cases named in the specification');
const cases: [string, string][] = [
  ['Ang ilaw po dito sa kalsada namin ay nasira na po, pakiayos po.', 'tagalog'],
  ['Sir sira po yung street light dito sa Purok 3, delikado na po sa gabi.', 'taglish'],
  ['There is a broken street light near my house. Please fix it.', 'english'],
  ['Binaha po kami kanina and wala pa pong tulong from the barangay.', 'taglish'],
];
cases.forEach(([text, want]) => ok(
  `"${text.slice(0, 44)}…" is ${want}`,
  detectLanguage(text).language === want,
  say(text),
));

console.log('\n2. nothing to read falls back to English, without crashing');
(['', '   ', '123', '1234 5678', 'Juan', 'Juan Dela Cruz', '!!!', '\n\t'] as string[])
  .forEach(t => ok(`${JSON.stringify(t)} -> english`, detectLanguage(t).language === 'english', say(t)));
ok('an unreadable input reports no confidence', detectLanguage('Juan').confidence === 0);
// @ts-expect-error - the request path can hand this anything.
ok('null does not throw', detectLanguageSafe(null).language === 'english');
// @ts-expect-error - same.
ok('a number does not throw', detectLanguageSafe(42).language === 'english');

console.log('\n3. capitals are read as language, not as noise');
ok('all-caps Tagalog is still Tagalog',
  detectLanguage('BINAHA PO KAMI DITO SA KALSADA, WALA PONG TULONG').language === 'tagalog',
  say('BINAHA PO KAMI DITO SA KALSADA, WALA PONG TULONG'));
ok('all-caps English is still English',
  detectLanguage('THERE IS A BROKEN STREET LIGHT NEAR MY HOUSE').language === 'english');

console.log('\n4. long paragraphs');
const longTagalog = `Magandang araw po. Gusto ko pong ireklamo ang kalsada namin dito sa
  amin dahil sobrang lubak na po at tuwing umuulan ay binabaha. Ang mga bata po na
  dumadaan ay nahuhulog sa butas at delikado na po talaga. Ilang beses na po kaming
  nagsumbong sa tanod pero wala pa rin pong nangyayari. Sana po ay maaksyunan ninyo
  ito agad dahil may mga matanda po dito na nahihirapan maglakad tuwing gabi.`;
const longEnglish = `Good day. I would like to report that the drainage canal along our
  street has been clogged for several weeks now. Every time it rains the water rises
  and reaches the front of our house. We have already asked for help twice but nothing
  has happened yet. There are children and old people here and the road becomes very
  dangerous at night because the street lights are broken as well.`;
const longMixed = `Good evening po. I would like to report lang po yung kanal dito sa
  amin kasi barado na po siya for several weeks. Tuwing umuulan po ay binabaha and the
  water reaches our house. Nagsumbong na po kami sa tanod twice pero wala pa rin pong
  action. Delikado na po talaga especially sa gabi kasi sira din yung street light.`;
ok('a long Tagalog paragraph is Tagalog', detectLanguage(longTagalog).language === 'tagalog', say(longTagalog));
ok('a long English paragraph is English', detectLanguage(longEnglish).language === 'english', say(longEnglish));
ok('a long mixed paragraph is Taglish', detectLanguage(longMixed).language === 'taglish', say(longMixed));
ok('a long paragraph is read with confidence', detectLanguage(longTagalog).confidence > 0.5,
  String(detectLanguage(longTagalog).confidence));

console.log('\n5. affixes and reduplication are read as Tagalog');
([
  ['nagnakaw', 'nag + nakaw'], ['binaha', 'the -in- infix'], ['pagbaha', 'pag + baha'],
  ['nasira', 'na + sira'], ['pakiayos', 'paki + ayos'], ['pong', 'po + ng'],
  ['sumigaw', 'the -um- infix'], ['babaha', 'reduplication'], ['nagbabaha', 'prefix + reduplication'],
  ['araw-araw', 'a doubled word'], ['nasugatan', 'na + sugat + an'],
] as [string, string][]).forEach(([w, why]) => ok(
  `"${w}" counts as Tagalog (${why})`, detectLanguage(w).tagalogCount === 1, say(w),
));

console.log('\n6. stripping affixes does not turn English into Tagalog');
// Each of these loses a Tagalog-looking affix and must not be counted as one.
(['pain', 'main', 'rain', 'train', 'began', 'human', 'nation', 'nature', 'machine', 'major'])
  .forEach(w => ok(`"${w}" is not read as Tagalog`, detectLanguage(w).tagalogCount === 0, say(w)));

console.log('\n7. honorifics and place words decide nothing');
ok('"Sir" alone is unreadable', detectLanguage('Sir').language === 'english'
  && detectLanguage('Sir').tagalogCount === 0 && detectLanguage('Sir').englishCount === 0);
ok('"barangay" alone is unreadable', detectLanguage('barangay').confidence === 0);
ok('"at" is not counted for either side',
  detectLanguage('at').tagalogCount === 0 && detectLanguage('at').englishCount === 0);

console.log('\n8. the thresholds are the ones the specification sets');
ok('Tagalog threshold is 0.70', TAGALOG_RATIO_THRESHOLD === 0.70);
ok('English threshold is 0.25', ENGLISH_RATIO_THRESHOLD === 0.25);
ok('two words of the other language make a mixture', MIXED_MIN_WORDS === 2);
// Pure one-language texts still travel the ratio path.
ok('a text with one stray English word stays Tagalog',
  detectLanguage('Ang ilaw po dito sa kalsada namin ay nasira na po, broken po talaga').language === 'tagalog',
  say('Ang ilaw po dito sa kalsada namin ay nasira na po, broken po talaga'));

console.log('\n9. every language has a prompt instruction');
(['tagalog', 'taglish', 'english'] as const).forEach(l => {
  const line = RECOMMENDATION_LANGUAGE_INSTRUCTION[l];
  ok(`${l} has an instruction`, typeof line === 'string' && line.length > 20, line);
});
ok('the English instruction forbids Tagalog words',
  /do not use tagalog/i.test(RECOMMENDATION_LANGUAGE_INSTRUCTION.english));

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
