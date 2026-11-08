/**
 * Record Interview - every field an answer may fill, and every option, comes
 * from the official forms; answers are checked in the shape of their item.
 * Pure (no database). Run with:  npm run test:interviewanswers
 */
import { ITEM_BY_KEY, INTAKE_SECTIONS } from '../lib/officialIntakeForm';
import { BLOTTER_INTAKE_SECTIONS } from '../lib/blotterIntakeForm';
import { TEMPLATES } from '../lib/reportTemplates';
import { interviewFields, interviewFieldOf, checkAnswer, optionText, readMulti, readSingle, writeChoice, allOptions } from '../lib/interviewAnswers';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const TODAY = '2026-11-08';
const blotterItem = Object.fromEntries(BLOTTER_INTAKE_SECTIONS.flatMap(s => s.items.map(i => [i.key, { item: i, section: s.title }])));
const vawcSection = Object.fromEntries(INTAKE_SECTIONS.flatMap(s => s.items.map(i => [i.key, s.title])));

console.log('\nEvery field has a basis on its form');
const V = interviewFields('VAWC'), B = interviewFields('BLOTTER');
ok('VAWC: each field is an item of the Intake Form, with its own number, wording and section', V.length > 0 && V.every(f => ITEM_BY_KEY[f.key] && ITEM_BY_KEY[f.key].no === f.no
  && ITEM_BY_KEY[f.key].label === f.label && vawcSection[f.key] === f.section && f.basis.startsWith(`VAWC Intake Form, item ${f.no}, `)), V.map(f => f.key).join());
ok('Blotter: each field is an item of the Blotter Intake Form, in its section', B.length > 0 && B.every(f => blotterItem[f.key] && blotterItem[f.key].section === f.section
  && f.basis.startsWith('Barangay Blotter Intake Form, ')));
ok('only fields an answer may fill (never the category, the type of violence or the safety assessment)', ['incidentCategory', 'typeOfViolence', 'safetyAssessment', 'sexAtBirth', 'immediateDanger']
  .every(k => !interviewFieldOf('VAWC', k) && !interviewFieldOf('BLOTTER', k)));
ok('every AI-fillable template field is offered, nothing more', V.length === TEMPLATES.VAWC.fields.filter(f => f.from.includes('ai')).length
  && B.length === TEMPLATES.BLOTTER.fields.filter(f => f.from.includes('ai')).length, `${V.length} ${B.length}`);
const shown = (fs: typeof V) => fs.map(f => `${f.no ?? ''} ${f.label} ${f.section}`);
ok('no two entries read the same - "Age" appears once per section, with its item number', new Set(shown(V)).size === V.length && new Set(shown(B)).size === B.length
  && V.filter(f => f.label === 'Age').map(f => `${f.no} ${f.section}`).join(' | ') === '16 B. Victim-Survivor Information | 45 D. Alleged Perpetrator Information');
ok('in the form\'s order', V.map(f => Number(f.no)).every((n, i, a) => i === 0 || n > a[i - 1]));

console.log('\nThe answer takes the shape of its item');
const kind = (k: string) => interviewFieldOf('VAWC', k)!.input.kind;
ok('dates (item 33), times (34), ages (16, 45), yes/no (37)', kind('incidentDate') === 'date' && kind('incidentTime') === 'time' && kind('age') === 'age' && kind('perpAge') === 'age' && kind('electronicMeans') === 'yesno');
const place = interviewFieldOf('VAWC', 'typeOfPlace')!;
ok('Type of Place (item 36): exactly the form\'s options', place.input.kind === 'single' && JSON.stringify(place.input.options) === JSON.stringify(ITEM_BY_KEY.typeOfPlace.options));
const rel = interviewFieldOf('VAWC', 'perpRelationship')!;
ok('Relationship of perpetrator (item 51): the form\'s groups and options, several allowed', rel.input.kind === 'multi' && JSON.stringify(rel.input.groups) === JSON.stringify(ITEM_BY_KEY.perpRelationship.groups));
ok('the blotter form takes the time as given ("around 9 PM"), so it stays text there', interviewFieldOf('BLOTTER', 'incidentTime')!.input.kind === 'text');

console.log('\nChecking answers');
const chk = (k: string, v: string, t: 'VAWC' | 'BLOTTER' = 'VAWC') => checkAnswer((t === 'VAWC' ? interviewFieldOf('VAWC', k) : interviewFieldOf('BLOTTER', k))!, v, TODAY);
ok('an empty answer fills nothing and is allowed', chk('incidentDate', '') === null && chk('typeOfPlace', '  ') === null);
ok('date: a real date, not in the future, never "kahapon"', chk('incidentDate', '2026-11-05') === null && chk('incidentDate', '2026-11-09') !== null && chk('incidentDate', 'kahapon') !== null && chk('incidentDate', '2026-02-30') !== null);
ok('time: as the time field gives it', chk('incidentTime', '9:30 PM') === null && chk('incidentTime', 'gabi') !== null);
ok('age: 0-120, "about" allowed', chk('age', '37') === null && chk('perpAge', 'about 50') === null && chk('age', '121') !== null && chk('age', 'mga 50') !== null);
ok('a choice must be one of the form\'s options', chk('typeOfPlace', 'Workplace') === null && chk('typeOfPlace', 'Basketball court') !== null);
ok('"Other public spaces, specify" needs what was specified', chk('typeOfPlace', 'Other public spaces:') !== null && chk('typeOfPlace', 'Other public spaces: covered court') === null);
ok('several relationships, each from the form; "specify" ones need the detail', chk('perpRelationship', 'Current spouse/ partner; Neighbors/ peers/ coworkers/ classmates') === null
  && chk('perpRelationship', 'Immediate family members: brother') === null && chk('perpRelationship', 'Immediate family members:') !== null
  && chk('perpRelationship', 'Boyfriend') !== null && chk('perpRelationship', 'Stranger; Stranger') !== null);
ok('yes/no: "No", or "Yes - " with the medium the form asks for', chk('electronicMeans', 'No') === null && chk('electronicMeans', 'Yes - Facebook Messenger') === null
  && /medium used/i.test(chk('electronicMeans', 'Yes - ') ?? '') && chk('electronicMeans', 'maybe') !== null);
ok('blotter text fields take the answer as said', chk('respondentRelationship', 'kapitbahay', 'BLOTTER') === null && chk('requestedRelief', 'Ipatawag po siya', 'BLOTTER') === null);

console.log('\nWriting and reading back');
const opts = allOptions(rel.input);
const imm = opts.find(o => o.value === 'immediate_family')!;
ok('"Immediate family members, specify" is shown as "Immediate family members"', optionText(imm) === 'Immediate family members' && optionText(opts.find(o => o.value === 'others')!) === 'Other');
const written = [writeChoice({ option: opts[0], specify: '' }), writeChoice({ option: imm, specify: 'kuya; bunso' })].join('; ');
ok('a written answer reads back to the same choices (a ";" typed in a detail cannot split it)', readMulti(rel.input, written).map(p => `${p.option.value}=${p.specify}`).join('|') === 'current_spouse=|immediate_family=kuya, bunso', written);
ok('a single choice reads back', readSingle(place.input, 'Other public spaces: covered court')?.specify === 'covered court');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
