/**
 * The two-panel VAWC intake, part 1: the document layout and the live
 * preview, rendered to HTML exactly as the browser receives it.
 * Run with:  npm run test:intakepreview  (part 2 is intakePreview.test.ts)
 *
 * No database, all data fictional.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { FORMS } from '../lib/intakeForms';
import { documentPages, pageOfItem, DIGITAL_COPY_NOTICE } from '../lib/intakeDocument';
import { ALL_ITEMS, type Responses } from '../lib/officialIntakeForm';
import IntakeDocumentPreview from '../components/intake/IntakeDocumentPreview';
import { fictional, narrative, NARRATIVE_END } from './intakeFixtures';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function main() {
    // ── 1. The document layout follows the source's five pages ──
    console.log('\nThe document layout');
    const pages = documentPages(FORMS.VAWC_INTAKE);
    ok('the intake form is five pages', pages.length === 5, String(pages.length));
    const at = (k: string) => pageOfItem(pages, k);
    ok('page 1: section A and items 11 to 17.a', at('dateOfIntake') === 1 && at('incidentNo') === 1 && at('informantContact') === 1 && at('victimName') === 1 && at('childStatus') === 1);
    ok('page 2: items 18 to 30, under the continued Victim-Survivor bar', at('civilStatus') === 2 && at('victimContact') === 2
      && pages[1].blocks[0].kind === 'section' && (pages[1].blocks[0] as Body).title === 'VICTIM-SURVIVOR INFORMATION');
    ok('page 3: item 31, Type of Violence, under section C', at('typeOfViolence') === 3 && (pages[2].blocks[0] as Body).title === 'C. Details of the Incident');
    ok('page 4: items 32 to 40 under the continued Details bar', at('description') === 4 && at('calamityArea') === 4 && (pages[3].blocks[0] as Body).title === 'DETAILS OF THE INCIDENT');
    ok('page 5: section D and the signatures', at('perpName') === 5 && at('perpRelationship') === 5 && pages[4].blocks.at(-1)?.kind === 'signatures');
    const numbered = pages.flatMap(p => p.blocks.flatMap(b => (b.kind === 'item' && b.item.no ? [b.item.no] : [])));
    const expected = ALL_ITEMS.filter(i => i.no && !i.proposed).map(i => i.no!);
    ok('every numbered item 1-51 (and 17.a) appears once, in order', numbered.join() === expected.join() && numbered.length === 52, `${numbered.length}`);
    ok('the SafeComm safety check is not on the form pages', !pages.some(p => p.blocks.some(b => b.kind === 'item' && b.item.proposed)));
    ok('the Blotter Report flows as one sheet', documentPages(FORMS.BLOTTER_REPORT).length === 1);

    // ── 2. The live preview ──
    console.log('\nThe live preview');
    const r = fictional();
    const html = (resp: Responses, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
      <IntakeDocumentPreview form={FORMS.VAWC_INTAKE} responses={resp} caseNumber="VC-PROBE-1" status="DRAFT" version={3} {...extra} />);
    const h = html(r);
    ok('five pages, numbered', [1, 2, 3, 4, 5].every(n => h.includes(`Page ${n} of 5`)) && !h.includes('Page 6 of'));
    ok('CONFIDENTIAL on every page', count(h, '>CONFIDENTIAL<') === 5, String(count(h, '>CONFIDENTIAL<')));
    // Once in item 6 / 7 on page 1, then in the box at the top of pages 2 to 5.
    ok('the Client Code and Incident No. on pages 2 to 5', count(h, 'CC-PROBE-0042') === 5 && count(h, 'INC-PROBE-0099') === 5);
    ok('section headings and item numbers as on the form', ['A. Administrative Information', 'B. Victim-Survivor Information', 'C. Details of the Incident', 'D. Alleged Perpetrator Information',
      '1. Date of Intake/Interview', '18. Current Civil Status', '31. Type of Violence', '32. Description of the Incident', '51. Relationship of Perpetrator to Victim-Survivor'].every(t => h.includes(t)));
    ok('typed text shows: names, office, address', ['Dela Prueba', 'Maria', 'Mia', 'VAWC Desk Officer', 'Sampaguita St', 'Testville'].every(t => h.includes(t)));
    ok('a date shows as mm/dd/yyyy, as the form asks', h.includes('11/02/2026') && h.includes('10/30/2026'));
    const sel = (label: string) => h.includes(`aria-label="${label} (selected)"`);
    ok('the chosen radio option is marked, the others are not', sel('Female') && !sel('Intersex') && sel('Consensual, common law, or live-in partner') && !sel('Legally married') && !sel('Single'));
    ok('an item that does not apply (17.a for an adult) is left out', !h.includes('17.a.'));
    ok('several checkboxes in a group are marked', sel('Physical') && sel('Psychological') && !sel('Sexual') && !sel('Economic'));
    ok('"Others, specify" shows what was specified', h.includes('Forced to sell goods') && h.includes('Fictional Faith'));
    ok('a yes with its detail shows', h.includes('SMS threats'));
    ok('a declined answer is shown as declined, never as a value', h.includes('Declined to answer'));
    ok('unanswered items say so, nothing is invented', h.includes('Not answered') && !h.includes('Ethnicity: '));
    ok('the narrative is shown whole, in the client\'s words, with its paragraph breaks', h.includes(NARRATIVE_END) && h.includes('white-space:pre-wrap') && h.includes('Paragraph 2: According to the client'));
    ok('the label "Alleged Perpetrator" is kept', h.includes('D. Alleged Perpetrator Information'));
    ok('read-only: no input, textarea or editable element', !/<input|<textarea|contenteditable/i.test(h));
    ok('a draft is marked DRAFT', h.includes('>DRAFT<') && h.includes('DRAFT - not completed'));
    ok('every page says it is a SafeComm digital copy, not an official form', count(h, DIGITAL_COPY_NOTICE) === 5);
    ok('a completed intake has no DRAFT mark', !html(r, { status: 'COMPLETED' }).includes('>DRAFT<'));
    ok('unsaved changes are said on the copy', html(r, { unsaved: true }).includes('includes changes not yet saved'));
    ok('informant items 8-10 are left out for a self-report...', !h.includes('8. Name of Informant'));
    const withInformant = html({ ...r, reportingMode: { value: 'informant_absent' }, informantName: { value: 'Luz Informant' } });
    ok('...and shown, with what was typed, when an informant reported', withInformant.includes('8. Name of Informant') && withInformant.includes('Luz Informant') && withInformant.includes('10. Contact Information'));
    const typed = html({ ...r, occupation: { value: 'Sari-sari store owner' } });
    ok('a change to the answers shows in the next render - the preview has no copy of its own', typed.includes('Sari-sari store owner') && !h.includes('Sari-sari store owner'));
    ok('the safety check appears only as a labelled annex, and only when answered', !h.includes('ANNEX')
      && html({ ...r, safeToSpeak: { value: 'yes' } }).includes('ANNEX - SAFETY AND CONSENT CHECK') && html({ ...r, safeToSpeak: { value: 'yes' } }).includes('Page 6 of 6'));
    const long = html({ ...r, description: { value: narrative(60) } });
    ok('a very long narrative is kept whole and wraps (no cut-off)', long.includes(NARRATIVE_END) && long.includes('Paragraph 60:') && long.includes('overflow-wrap:anywhere'));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(x => console.log('  FAILED: ' + x)); process.exitCode = 1; }
}
main();
