/**
 * People Involved - the resident form's buttons and payload, and the intake
 * forms' display, without a database. Run with:  npm run test:peopleinvolved:ui
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportPeopleFields, { EMPTY_PEOPLE, peoplePayload, peopleProblem, type PeopleState } from '../components/forms/ReportPeopleFields';
import IntakePeopleInvolved, { reportHint, type PeopleContext, type PersonRecord } from '../components/cases/IntakePeopleInvolved';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, ' ');
const src = fs.readFileSync('components/forms/ReportPeopleFields.tsx', 'utf8');

console.log('\nThe resident form');
const closed = text(renderToStaticMarkup(<ReportPeopleFields path={null} relationship="THIRD_PARTY" value={EMPTY_PEOPLE} onChange={() => {}} />));
ok('the title and the explanation', closed.includes('People Involved (optional)') && closed.includes('Share only what you already know. You do not need names, and you should not put yourself at risk to find anything out.'));
ok('two buttons: Add Person Affected and Add Person Reported', closed.includes('Add Person Affected') && closed.includes('Add Person Reported'));
ok('no fields until a button is pressed', !closed.includes('Full name, if known'));
ok('the old dropdowns are gone: no "Add details about", no Collapse, no expand icons', !src.includes('Add details about') && !/\bCollapse\b/.test(src) && !/ExpandMore|ExpandLess/.test(src));
const filled: PeopleState = { affected: { ...EMPTY_PEOPLE.affected, fullName: 'Ana' }, reported: { ...EMPTY_PEOPLE.reported, relationship: 'Neighbour' } };
const open = text(renderToStaticMarkup(<ReportPeopleFields path={null} relationship="THIRD_PARTY" value={filled} onChange={() => {}} />));
ok('a section already holding details starts open, with Remove on its button', open.includes('Remove Person Affected') && open.includes('Remove Person Reported')
  && open.includes('Full name, if known'));
ok('the person affected: every field kept', ['Full name, if known', 'Age, if known', 'Address, if needed', 'Contact number - only if it is safe to provide',
  'Relationship to you', 'Are any children or dependents affected?', 'Not sure', 'Anything else that may help (optional)'].every(l => open.includes(l)));
const onlyReported = text(renderToStaticMarkup(<ReportPeopleFields path={null} relationship="THIRD_PARTY" value={{ ...EMPTY_PEOPLE, reported: filled.reported }} onChange={() => {}} />));
ok('the two are independent: one open, the other still offers Add', onlyReported.includes('Add Person Affected') && onlyReported.includes('Remove Person Reported'));
const self = text(renderToStaticMarkup(<ReportPeopleFields path={null} relationship="SELF" value={{ ...EMPTY_PEOPLE, affected: { ...EMPTY_PEOPLE.affected, dependentsAffected: 'yes' } }} onChange={() => {}} />));
ok('reporting for yourself: you are the person affected; only the children question', self.includes('you are the person affected') && self.includes('Are any children or dependents affected?') && !self.includes('Full name, if known Age'));
ok('removing a section with details asks first; removing clears it so it is not sent', src.includes('Remove the details you entered for the') && src.includes('onChange({ ...value, [which]: EMPTY_PEOPLE[which] })'));

console.log('\nWhat the server receives (unchanged rules)');
ok('nothing filled: nothing sent', JSON.stringify(peoplePayload(EMPTY_PEOPLE, null, 'THIRD_PARTY')) === '{}');
const p = peoplePayload({ affected: { ...EMPTY_PEOPLE.affected, fullName: ' Ana ', age: '29', contactNumber: '9171234567' }, reported: { ...EMPTY_PEOPLE.reported, fullName: 'Ben' } }, null, 'THIRD_PARTY');
ok('only what was filled, trimmed; age a number; the number as +63', p.affectedParty?.fullName === 'Ana' && p.affectedParty?.age === 29 && p.affectedParty?.contactNumber === '+639171234567' && p.reportedParty?.fullName === 'Ben' && !('address' in (p.affectedParty ?? {})));
ok('reporting for yourself: only the children answer about the person affected', JSON.stringify(peoplePayload({ affected: { ...EMPTY_PEOPLE.affected, fullName: 'x', dependentsAffected: 'no' }, reported: EMPTY_PEOPLE.reported }, null, 'SELF').affectedParty) === '{"dependentsAffected":"no"}');
ok('a half-typed number stops the report with a reason; an empty one does not', peopleProblem({ ...EMPTY_PEOPLE, affected: { ...EMPTY_PEOPLE.affected, contactNumber: '917' } }, null, 'THIRD_PARTY') !== null
  && peopleProblem(EMPTY_PEOPLE, null, 'THIRD_PARTY') === null);

console.log('\nThe intake forms (Blotter and VAWC share it)');
const rec = (o: Partial<PersonRecord>): PersonRecord => ({ source: 'reporter', fullName: null, age: null, address: null, contactNumber: null, relationship: null, dependentsAffected: null, details: null, updatedAt: '2026-11-17T00:00:00Z', ...o });
const ctx: PeopleContext = { reporterIsAffected: false, anonymous: false, affectedNote: 'my neighbour',
  affected: [rec({ fullName: 'Maria', age: 29, contactNumber: '+639171234567', dependentsAffected: 'unknown' })],
  reported: [rec({ fullName: 'Pedro' }), rec({ source: 'official', fullName: 'Pedro Santos', age: 36 })] };
const view = text(renderToStaticMarkup(<IntakePeopleInvolved people={ctx} />));
ok('a section for each: Person affected and Person reported', view.includes('Person affected') && view.includes('Person reported'));
ok('what was given is shown; what was not says "Not provided"', view.includes('Maria') && view.includes('+639171234567') && view.includes('Not sure') && view.includes('Not provided'));
ok('the resident\'s record and the official\'s are both shown, each labelled', view.includes("From the resident's report") && view.includes('Added or verified by an official')
  && view.indexOf('Pedro ') < view.indexOf('Pedro Santos'));
ok('the reporter\'s own note is kept', view.includes("The reporter's note: my neighbour"));
const selfView = text(renderToStaticMarkup(<IntakePeopleInvolved people={{ reporterIsAffected: true, anonymous: false, affectedNote: null, affected: [], reported: [] }} />));
ok('a self-report: the reporter is the person affected; nobody reported is "Not provided on the report"', selfView.includes('The reporter - they reported this about themselves.') && selfView.includes('Not provided on the report.'));
ok('the VAWC questions show what the report says - official first', reportHint('perpName', ctx)?.text === 'Pedro Santos' && reportHint('perpName', ctx)?.source === 'official'
  && reportHint('victimName', ctx)?.text === 'Maria' && reportHint('perpAddress', ctx) === null);
ok('never the reporter as the victim-survivor on a self-report', reportHint('victimName', { ...ctx, reporterIsAffected: true }) === null);
const form = fs.readFileSync('components/cases/OfficialIntakeForm.tsx', 'utf8');
ok('both intake pages use the one form, which shows People involved in Section 1', form.includes('<IntakePeopleInvolved people={ctx.people} />')
  && fs.readFileSync('app/vawc/cases/[id]/intake/page.tsx', 'utf8').includes('<OfficialIntakeForm') && fs.readFileSync('app/blotter-officer/case-management/[id]/intake/page.tsx', 'utf8').includes('<OfficialIntakeForm'));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
