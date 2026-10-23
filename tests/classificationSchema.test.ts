/**
 * Every case type a desk can file has a category to be counted under.
 * Run with:  npm run test:schema
 *
 * The Case Classification page lists the office's categories and counts the
 * barangay's filings against them. A case type that exists in the app but has
 * no category still appears - it falls through to metaFor() - but it appears
 * unexplained and grey, so this keeps the two lists together deliberately
 * rather than by accident.
 */
import {
  BLOTTER_CATEGORIES, VAWC_CATEGORIES, metaFor, type CategoryMeta,
  ALL_CATEGORIES, categoryByName, needsReviewCategory, ruleMatches, matchCategories,
  MATRIX_REVIEW_STATUS, type Signal,
} from '../lib/classificationSchema';
import { VAWC_TYPES } from '../lib/vawcTypes';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

console.log('1. every VAWC case type has a category on the VAWC desk');
const missing = VAWC_TYPES.filter(t => !VAWC_CATEGORIES.some(c => c.category === t));
ok('none are missing', missing.length === 0, missing.join(', '));
ok(`all ${VAWC_TYPES.length} are covered`, VAWC_CATEGORIES.length === VAWC_TYPES.length,
  `${VAWC_CATEGORIES.length} categories for ${VAWC_TYPES.length} types`);

console.log('\n2. and no VAWC category invents a type the office does not use');
const invented = VAWC_CATEGORIES.filter(c => !(VAWC_TYPES as readonly string[]).includes(c.category));
ok('none invented', invented.length === 0, invented.map(c => c.category).join(', '));

console.log('\n3. the two desks do not claim the same category');
const overlap = BLOTTER_CATEGORIES.filter(b => VAWC_CATEGORIES.some(v => v.category === b.category));
ok('no category belongs to both desks', overlap.length === 0, overlap.map(c => c.category).join(', '));

console.log('\n4. no desk lists a category twice');
for (const [name, set] of [['blotter', BLOTTER_CATEGORIES], ['VAWC', VAWC_CATEGORIES]] as [string, CategoryMeta[]][]) {
  const seen = new Set<string>();
  const dupes = set.filter(c => (seen.has(c.category) ? true : (seen.add(c.category), false)));
  ok(`${name}: each category once`, dupes.length === 0, dupes.map(c => c.category).join(', '));
  const codes = new Set<string>();
  const dupeCodes = set.filter(c => (codes.has(c.code) ? true : (codes.add(c.code), false)));
  ok(`${name}: each code once`, dupeCodes.length === 0, dupeCodes.map(c => c.code).join(', '));
}

console.log('\n5. every category is usable on the page');
for (const [name, set] of [['blotter', BLOTTER_CATEGORIES], ['VAWC', VAWC_CATEGORIES]] as [string, CategoryMeta[]][]) {
  for (const c of set) {
    ok(`${name}/${c.category}: has a colour`, /^#[0-9a-f]{6}$/i.test(c.color), c.color);
    ok(`${name}/${c.category}: explains itself`, c.description.trim().length > 15);
    ok(`${name}/${c.category}: has a starting risk`,
      ['Critical', 'High', 'Medium', 'Low'].includes(c.riskBias), c.riskBias);
  }
}

console.log('\n6. the VAWC desk never opens a case below High');
// Under-reacting is the costly mistake here, so the floor is deliberate.
const soft = VAWC_CATEGORIES.filter(c => c.riskBias !== 'High' && c.riskBias !== 'Critical');
ok('no VAWC category starts Low or Medium', soft.length === 0,
  soft.map(c => `${c.category}=${c.riskBias}`).join(', '));

console.log('\n7. an unknown type still gets something to show');
const unknown = metaFor('Something Nobody Listed', VAWC_CATEGORIES);
ok('it is handed back, not dropped', unknown.category === 'Something Nobody Listed');
ok('with a colour', /^#[0-9a-f]{6}$/i.test(unknown.color));
ok('and it says to read the report', /read the report/i.test(unknown.description));
ok('a known type is found instead',
  metaFor('Child Abuse', VAWC_CATEGORIES).code === 'CA');

console.log('\n8. the matrix keeps every category the resident dropdown offered');
// The list the resident form's Case Type dropdown showed before it was
// replaced by the assisted intake. Each must still be a destination.
const FORMER_DROPDOWN = [
  'Theft & Robbery', 'Public Nuisance', 'Domestic Dispute', 'Assault', 'Cybercrime', 'Vandalism',
  'Drug-Related', 'Traffic Violation', 'Noise Complaint', 'Utility Problem', 'Infrastructure Issue',
  'Sanitation Concern', 'Illegal Construction', 'Animal Bite/Concern', 'Other', ...VAWC_TYPES,
];
for (const c of FORMER_DROPDOWN) ok(`"${c}" is in the matrix`, Boolean(categoryByName(c)));

console.log('\n9. every entry is complete enough to route and review');
for (const c of ALL_CATEGORIES) {
  const fallback = c.category === 'Other' || c.category === 'VAWC - Other';
  ok(`${c.category}: has a definition`, c.definition.trim().length > 20);
  ok(`${c.category}: ${fallback ? 'is never suggested by a rule' : 'has a rule that can recognise it'}`,
    fallback ? c.rules.length === 0 : c.rules.some(r => (r.all?.length ?? 0) + (r.any?.length ?? 0) > 0));
  ok(`${c.category}: desk matches its list`,
    c.desk === ((VAWC_TYPES as readonly string[]).includes(c.category) ? 'VAWC' : 'Blotter'));
  if (!fallback && c.desk === 'VAWC') {
    ok(`${c.category}: cites where an officer should look`, c.legalBasis.length > 0);
    ok(`${c.category}: is not sent to barangay conciliation`, c.conciliation === 'not_allowed');
  }
}
const prios = ALL_CATEGORIES.filter(c => c.priority > 0).map(c => c.priority);
ok('no two categories tie on priority', new Set(prios).size === prios.length);
ok('the matrix says it is a draft until approved', /pending review/i.test(MATRIX_REVIEW_STATUS));

console.log('\n10. the fallback keeps sensitive reports confidential');
ok('nothing matched, nothing sensitive -> Other', needsReviewCategory(new Set()).category === 'Other');
for (const s of ['partner', 'family', 'minor', 'sexualViolence', 'harassment', 'stalking'] as Signal[]) {
  ok(`nothing matched but "${s}" -> VAWC - Other`, needsReviewCategory(new Set([s])).category === 'VAWC - Other');
}
ok('a rule with no facts never matches', !ruleMatches({}, new Set(['force'])));
ok('"none" vetoes a match', !ruleMatches({ any: ['force'], none: ['partner'] }, new Set<Signal>(['force', 'partner'])));
ok('highest priority wins', matchCategories(new Set<Signal>(['partner', 'force', 'minor']))[0].meta.category === 'Domestic Violence');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exit(1); }
