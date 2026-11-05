/**
 * The +63 contact number: what the form keeps from what is typed or pasted,
 * and what the server accepts and stores. Pure - no database.
 *   npm run test:phone
 */
import { phMobileLocal, isPhMobileLocal, groupPhMobile, normalizePhMobile, displayPhMobile } from '../lib/phoneNumber';
import { affectedPartySchema } from '../lib/caseRecords';
import { peoplePayload, peopleProblem, EMPTY_PEOPLE, type PeopleState } from '../components/forms/ReportPeopleFields';

let passed = 0, failed = 0;
const fails: string[] = [];
const ok = (name: string, v: boolean, extra = '') => {
  if (v) passed++; else { failed++; fails.push(name); }
  console.log(`  ${v ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

console.log('Typing and pasting into the field (the digits after +63)');
ok('letters and symbols are dropped', phMobileLocal('asdas131231') === '131231', phMobileLocal('asdas131231'));
ok('typing digits keeps them', phMobileLocal('917') === '917');
ok('capped at 10 digits', phMobileLocal('91712345678999') === '9171234567');
ok('a habitual leading 0 is dropped (0917...)', phMobileLocal('09171234567') === '9171234567');
ok('a pasted +63 number loses the country code', phMobileLocal('+63 917 123 4567') === '9171234567');
ok('a pasted 63... number loses the country code', phMobileLocal('639171234567') === '9171234567');
ok('dashes and brackets are dropped', phMobileLocal('(0917) 123-4567') === '9171234567');
ok('the grouped display value reads back the same', phMobileLocal(groupPhMobile('9171234567')) === '9171234567');
ok('grouped as 917 123 4567', groupPhMobile('9171234567') === '917 123 4567');
ok('partial input groups as far as it goes', groupPhMobile('91712') === '917 12');
ok('empty stays empty', phMobileLocal('') === '' && groupPhMobile('') === '');

console.log('\nWhat counts as a mobile number');
ok('10 digits starting with 9', isPhMobileLocal('9171234567'));
ok('too short is refused', !isPhMobileLocal('917123456'));
ok('not starting with 9 is refused', !isPhMobileLocal('8171234567'));
ok('normalized to +639XXXXXXXXX', normalizePhMobile('0917 123 4567') === '+639171234567');
ok('garbage normalizes to null', normalizePhMobile('asdas131231') === null);
ok('shown as +63 917 123 4567', displayPhMobile('+639171234567') === '+63 917 123 4567');
ok('an old stored value is shown as it was', displayPhMobile('asdas131231') === 'asdas131231');

console.log('\nThe server (the same schema the resident and officer routes use)');
const s = (v: unknown) => affectedPartySchema.safeParse({ contactNumber: v });
ok('a +63 number is stored as +639171234567', s('+63 917 123 4567').data?.contactNumber === '+639171234567');
ok('a 09 number is stored the same way', s('09171234567').data?.contactNumber === '+639171234567');
ok('letters are refused', !s('asdas131231').success);
ok('a short number is refused', !s('+63917123').success);
ok('a landline-looking number is refused', !s('(044) 309-3314').success);
ok('the refusal says what to enter', (s('abc').error?.issues[0]?.message ?? '').includes('10 digits after +63'));
ok('empty is fine and stores nothing', s('').success && s('').data?.contactNumber === undefined);
ok('missing is fine', affectedPartySchema.safeParse({}).success);

console.log('\nThe resident form');
const withNumber = (n: string): PeopleState => ({ ...EMPTY_PEOPLE, affected: { ...EMPTY_PEOPLE.affected, fullName: 'Probe', contactNumber: n } });
ok('a full number is sent as +639171234567', peoplePayload(withNumber('9171234567'), null, 'THIRD_PARTY').affectedParty?.contactNumber === '+639171234567');
ok('an incomplete number stops the report with a message', (peopleProblem(withNumber('91712'), null, 'THIRD_PARTY') ?? '').includes('incomplete'));
ok('a full number passes', peopleProblem(withNumber('9171234567'), null, 'THIRD_PARTY') === null);
ok('an empty number passes', peopleProblem(withNumber(''), null, 'THIRD_PARTY') === null);
ok('reporting for yourself: the affected number is not asked or checked', peopleProblem(withNumber('91712'), null, 'SELF') === null
  && peoplePayload(withNumber('9171234567'), null, 'SELF').affectedParty?.contactNumber === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
