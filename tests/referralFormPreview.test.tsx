/**
 * The blotter Referral Form's live preview and PDF - no database: both carry
 * exactly the paper form's title, labels and order, show what is typed, and
 * add nothing else. Run with:  npm run test:referralpreview
 * Fictional data only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import ReferralFormPreview from '../components/referrals/ReferralFormPreview';
import { buildReferralFormPdf } from '../lib/referralFormPdf';
import { EMPTY_REFERRAL_FORM } from '../lib/referralForm';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}

/** The paper form's printed words, top to bottom. */
const LABELS = ['REFERRAL FORM', 'Case No.', 'Date of Referral', 'To:', 'Address', 'Contact Person', 'Name of Client', 'Age', 'Sex', 'Address',
  'Name of Family/Guardian', 'Contact No.', 'Address', 'Reason/s for Referral', 'Specific Service/s Requested',
  'Please refer to attached report/ intake form/case summary for more information.', 'Feedback requested and send to Referring Party/Agency:',
  'Address', 'Cell Phone No.', 'Landline No.', 'Email address:', 'Fax No.', 'Contact Person', 'Referred by:', 'Signature over Printed Name', 'Designation'];
const inOrder = (text: string, words: string[]) => {
  let at = 0;
  for (const w of words) { const i = text.indexOf(w, at); if (i < 0) return w; at = i + w.length; }
  return null;
};
const filled = {
  ...EMPTY_REFERRAL_FORM, toAddress: 'Sample Police Station, MacArthur Hwy', toContactPerson: 'PCpl. Ana Halimbawa', clientName: 'Juan Dela Prueba', clientAge: '41', clientSex: 'Male',
  clientAddress: '12 Sampaguita St', guardianName: 'Maria Dela Prueba', guardianContact: '0917 000 0032', guardianAddress: 'Same address', servicesRequested: 'Patrol visit',
  feedbackTo: 'Barangay Testville - Blotter Desk', feedbackAddress: 'Barangay Hall', feedbackCellPhone: '0922 709 0700', feedbackLandline: '(044) 309-3314',
  feedbackEmail: 'blotter@example.test', feedbackContact: 'Pedro Probe', referredByName: 'Pedro Probe', referredByDesignation: 'Blotter Officer',
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

async function main() {
  console.log('\nThe live preview');
  const html = (form = filled, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
    <ReferralFormPreview caseNumber="BL-PROBE-1" referredAt="2026-11-10" to="PNP police station" reason="Repeated threats at night" form={form} {...extra} />);
  const blank = text(html(EMPTY_REFERRAL_FORM));
  ok('every label of the paper form, in its order', inOrder(blank, LABELS) === null, `missing or out of order: ${inOrder(blank, LABELS)}`);
  ok('the title on its green highlight', html().includes('REFERRAL FORM') && /background-color:#99cc00/i.test(html()));
  ok('nothing the paper form does not have (no Annex B, no notices)', !/ANNEX|Confidential|SafeComm|Not a certified|Page \d/i.test(text(html(EMPTY_REFERRAL_FORM)).replace('Live preview', '').replace('updates as you type', '')));
  const h = text(html());
  ok('typed values are on their lines', ['BL-PROBE-1', 'November 10, 2026', 'PNP police station', 'Sample Police Station, MacArthur Hwy', 'PCpl. Ana Halimbawa', 'Juan Dela Prueba', '41', 'Male',
    'Maria Dela Prueba', '0917 000 0032', 'Repeated threats at night', 'Patrol visit', 'Barangay Testville - Blotter Desk', '(044) 309-3314', 'blotter@example.test', 'Pedro Probe', 'Blotter Officer']
    .every(v => h.includes(v)));
  ok('each value sits after its own label', h.indexOf('Name of Client') < h.indexOf('Juan Dela Prueba') && h.indexOf('Juan Dela Prueba') < h.indexOf('Age')
    && h.indexOf('Contact No.') < h.indexOf('0917 000 0032') && h.indexOf('Fax No.') > h.indexOf('blotter@example.test'));
  ok('a change to the values is in the next render (one copy of the values)', text(html({ ...filled, clientName: 'Pedro Changed' })).includes('Pedro Changed') && !h.includes('Pedro Changed'));
  ok('a blank form shows only the lines - nothing is made up', !/Juan|PNP|Pedro/.test(text(html(EMPTY_REFERRAL_FORM, { to: '', reason: '' }))));
  ok('lines can be clicked to reach their field when editing', html(filled, { onJump: () => undefined }).includes('role="button"') && !html().includes('role="button"'));

  console.log('\nThe PDF');
  const pdf = async (form: typeof filled, to: string, reason: string | null) => {
    const bytes = await buildReferralFormPdf({ caseNumber: 'BL-PROBE-1', referredAt: new Date('2026-11-10T00:00:00+08:00'), to, reason, form, generatedAt: new Date() });
    const doc = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
    let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += ' ' + (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ');
    return { pages: doc.numPages, t: t.replace(/\s+/g, ' ') };
  };
  const b = await pdf(EMPTY_REFERRAL_FORM, '', null);
  ok('one page', b.pages === 1);
  ok('every label of the paper form, in its order', inOrder(b.t, LABELS) === null, `missing or out of order: ${inOrder(b.t, LABELS)}`);
  const leftover = LABELS.reduce((t, l) => t.replace(l, ''), b.t).replace('BL-PROBE-1', '').replace('November 10, 2026', '').trim();
  ok('nothing else is printed - no Annex B, no footer', leftover === '', leftover);
  const f = await pdf(filled, 'PNP police station', 'Repeated threats at night');
  ok('what was typed is printed', ['PNP police station', 'Juan Dela Prueba', 'Repeated threats at night', 'Patrol visit', 'Pedro Probe', 'Blotter Officer'].every(v => f.t.includes(v)));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log('\nFailures:'); fails.forEach(x => console.log('  - ' + x)); process.exitCode = 1; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
