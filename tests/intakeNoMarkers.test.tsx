/**
 * The intake forms (VAWC and Blotter) no longer offer N/A, Unknown or
 * Declined to answer: an item that cannot be answered is left blank, only the
 * safety and consent check must be answered to complete, and a marker saved
 * before stays on record. Run with:  npm run test:intakemarkers    No database.
 */
import fs from 'fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { FORMS, missingIn, anyAnswered } from '../lib/intakeForms';
import { mustAnswer, type Responses } from '../lib/officialIntakeForm';
import IntakeDocumentPreview from '../components/intake/IntakeDocumentPreview';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const read = (f: string) => fs.readFileSync(f, 'utf8');
const vawc = FORMS.VAWC_INTAKE, blotter = FORMS.BLOTTER_REPORT;

console.log('\nThe form screen (both desks use it)');
const form = read('components/cases/OfficialIntakeForm.tsx');
ok('no N/A, Unknown or Declined buttons on an item', !/Object\.keys\(MARKER_LABEL\)/.test(form) && !/onChange\(\{ marker/.test(form) && !/marker: m\b/.test(form));
ok('no "Mark the rest N/A" shortcut', !/Mark the rest N\/A|markRemainingNA|bulkMarkable/.test(form));
ok('no message tells the official to use them', !/or N\/A, Unknown or Declined/.test(form));
ok('a marker saved before is still shown, and answering replaces it', form.includes('Recorded earlier as: {MARKER_LABEL[a.marker]}') && form.includes('delete next.marker;'));
ok('the VAWC and Blotter intake pages both use this one form', read('app/vawc/cases/[id]/intake/page.tsx').includes('<OfficialIntakeForm') && read('app/blotter-officer/case-management/[id]/intake/page.tsx').includes('<OfficialIntakeForm'));

console.log('\nCompleting');
const vMissing = missingIn(vawc, {});
ok('VAWC: only the safety and consent check must be answered', vMissing.length > 0 && vMissing.every(mustAnswer), vMissing.map(i => i.key).join());
ok('VAWC: with it answered, the rest may be blank', missingIn(vawc, { safeToSpeak: { value: 'yes' }, consentConfirmed: { value: 'yes' }, immediateDanger: { value: 'no' } } as Responses)
  .filter(i => !['safeToSpeak', 'immediateDanger'].includes(i.key)).every(mustAnswer));
ok('Blotter: no item blocks completion', missingIn(blotter, {}).length === 0);
ok('an intake with nothing filled in is not completed', !anyAnswered(vawc, {}) && !anyAnswered(blotter, {})
  && anyAnswered(blotter, { complaintNature: { value: 'Noise at night' } } as Responses));
ok('a marker saved before still counts as an answer', anyAnswered(blotter, { complaintNature: { marker: 'na' } } as Responses));

console.log('\nThe server');
const route = read('app/api/cases/[id]/official-intake/route.ts');
ok('a new N/A, Unknown or Declined is refused; one saved before may stay', route.includes("a.marker && a.marker !== saved[k]?.marker")
  && route.includes('N/A, Unknown and Declined are no longer recorded'));
ok('an empty intake cannot be completed', route.includes('if (!anyAnswered(def, responses))'));
ok('its message no longer mentions them', !/or N\/A, Unknown or Declined/.test(route));

console.log('\nThe document');
const html = renderToStaticMarkup(<IntakeDocumentPreview form={vawc} responses={{ diverseSogie: { marker: 'declined' } } as Responses} caseNumber="VC-PROBE-1" status="DRAFT" version={1} />);
ok('a marker saved before is still printed as it was recorded', html.includes('Declined to answer'));
ok('a blank item shows as not answered, not as N/A', html.includes('Not answered') && !html.includes('>N/A<'));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
