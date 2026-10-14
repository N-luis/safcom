/**
 * Who may read a VAWC case.  Run with:  npm run test:access
 *
 * The live counterpart of this - logging three officers in and asking the real
 * endpoints - is in the commit that added the gate. These are the rules it
 * rests on, so a role added later cannot quietly inherit access.
 */
import { canSeeVawc, vawcFilter, isVawcCaseHidden } from '../lib/caseAccess';
import { VAWC_TYPES } from '../lib/vawcTypes';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

console.log('1. the VAWC desk, the captain and the administrator may read them');
(['vawc_officer', 'vawc', 'vawc_lead', 'admin', 'system_admin'] as const)
  .forEach(r => ok(`"${r}" may`, canSeeVawc(r)));

console.log('\n2. the blotter desk may not');
(['officer', 'blotter_officer'] as const).forEach(r => ok(`"${r}" may not`, !canSeeVawc(r)));

console.log('\n3. nor may anything unrecognised');
([undefined, null, '', ' ', 'resident', 'guest', 'Admin', 'ADMIN', 'vawcofficer'] as unknown[])
  .forEach(r => ok(`${JSON.stringify(r)} may not`, !canSeeVawc(r as string)));
// Case is significant - "Admin" is not "admin" - but stray whitespace on a
// value read out of the database is not a different role.
ok('"vawc_officer " with a stray space still may', canSeeVawc('vawc_officer '));

console.log('\n4. the filter hides every VAWC type, and only those');
const blotter = vawcFilter('blotter_officer') as { caseType?: { notIn: string[] } };
ok('the blotter filter excludes by case type', !!blotter.caseType?.notIn);
ok('it names every VAWC type',
  VAWC_TYPES.every(t => blotter.caseType!.notIn.includes(t)),
  JSON.stringify(blotter.caseType?.notIn));
ok('it names no others', blotter.caseType!.notIn.length === VAWC_TYPES.length);
ok('the VAWC desk gets no filter at all',
  Object.keys(vawcFilter('vawc_officer')).length === 0);
ok('the captain gets no filter at all',
  Object.keys(vawcFilter('admin')).length === 0);

console.log('\n5. one case at a time');
VAWC_TYPES.forEach(t => {
  ok(`"${t}" is hidden from the blotter`, isVawcCaseHidden('blotter_officer', t));
  ok(`"${t}" is visible to the VAWC desk`, !isVawcCaseHidden('vawc_officer', t));
});
(['Theft & Robbery', 'Noise Complaint', 'Infrastructure Issue', 'Other'] as const).forEach(t => {
  ok(`"${t}" is visible to the blotter`, !isVawcCaseHidden('blotter_officer', t));
});
ok('an unknown case type is not hidden', !isVawcCaseHidden('blotter_officer', 'Something Else'));

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES'}  (${pass} passed, ${fails.length} failed)`);
fails.forEach(f => console.log('  - ' + f));
process.exit(fails.length === 0 ? 0 : 1);
