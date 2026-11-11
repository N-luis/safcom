/**
 * The Service Referral Form ("Referral Form.pdf"), part 1 - no database:
 * the form's rules, the issue checklist, the acknowledgement workflow, the
 * PDF and the live preview, rendered as the browser receives it.
 * Run with:  npm run test:servicereferral   (part 2, through the real routes
 * and database: npm run test:servicereferral:db)
 *
 * Fictional data only.
 */
import { createHash } from 'crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  serviceReferralFormSchema, normalizeForm, issueProblems, ackSchema, ackTransitionAllowed, cancelAllowed, serviceSuggestions, readForm,
  changedKeys, EMPTY_SERVICE_REFERRAL_FORM, SERVICES, SERVICE_KEYS, type ServiceReferralForm,
} from '../lib/serviceReferralForm';
import { buildServiceReferralPdf } from '../lib/serviceReferralPdf';
import { parseReferralScan } from '../lib/serviceReferralScan';
import { RESIDENT_ACTIVITY_TYPES } from '../lib/notifications';
import ServiceReferralPreview from '../components/referrals/ServiceReferralPreview';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const complete = (): ServiceReferralForm => ({
  ...EMPTY_SERVICE_REFERRAL_FORM,
  clientCode: 'CC-PROBE-0042', incidentNo: 'VC-PROBE-0099', referringOrganization: 'Barangay Testville VAWC Desk',
  actionTaken: 'Intake interview done; safety plan discussed.', referredByLast: 'Dela Prueba', referredByFirst: 'Juana', referredByMiddle: 'Santos',
  position: 'VAWC Officer', contactNo: '0917 000 0000', email: 'vawc.desk@example.test',
  addressNo: '1', addressStreet: 'Rizal St', addressBarangay: 'Testville', addressCity: 'Sample City',
  destination: 'SWDO', services: ['PSYCHOSOCIAL', 'SHELTER'], receivingAgency: 'MSWDO Sample City', receivingAddress: 'Municipal Hall, Sample City',
  receivingContactPerson: 'Pedro Halimbawa', receivingContactNo: '(044) 000-0000', receivingEmail: 'mswdo@example.test', clientSignatory: 'GUARDIAN',
});

async function pdfText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '));
  return { pages, text: pages.join(' ') };
}

async function main() {
  // ── 1. The form's rules ──
  console.log('\nThe form\'s rules');
  ok('every field may be blank in a draft', serviceReferralFormSchema.safeParse({}).success);
  ok('Section C cannot be smuggled into the editable form (unknown keys refused)',
    !serviceReferralFormSchema.safeParse({ ackStatus: 'ACKNOWLEDGED' }).success && !serviceReferralFormSchema.safeParse({ receivedByName: 'X' }).success);
  ok('a signature cannot be stored as a form value', !serviceReferralFormSchema.safeParse({ clientSignature: 'Juana' }).success);
  ok('contact numbers: digits and + ( ) - only', !serviceReferralFormSchema.safeParse({ contactNo: 'call me' }).success && serviceReferralFormSchema.safeParse({ contactNo: '(044) 309-3314' }).success);
  ok('email addresses must look like one', !serviceReferralFormSchema.safeParse({ receivingEmail: 'nope' }).success && serviceReferralFormSchema.safeParse({ receivingEmail: 'a@b.ph' }).success);
  ok('only the destinations on the form', !serviceReferralFormSchema.safeParse({ destination: 'PNP' }).success);
  ok('only the services on the form', !serviceReferralFormSchema.safeParse({ services: ['LEGAL'] }).success);
  const mixed = serviceReferralFormSchema.parse({ destination: 'BARANGAY', services: ['PSYCHOSOCIAL', 'BPO', 'BPO'] });
  ok('services of the other destination are dropped, duplicates removed', JSON.stringify(mixed.services) === '["BPO"]', JSON.stringify(mixed.services));
  ok('no services without a destination', serviceReferralFormSchema.parse({ services: ['BPO'] }).services.length === 0);
  ok('"Others, specify" text goes with its tick', normalizeForm({ ...complete(), serviceOther: 'x' }).serviceOther === ''
    && normalizeForm({ ...complete(), services: ['SWDO_OTHER'], serviceOther: 'Legal aid' }).serviceOther === 'Legal aid');
  ok('every service on the reference form is offered, with its words', SERVICE_KEYS.length === 7
    && SERVICES.BPO.label === 'Issuance/enforcement of Barangay Protection Order (BPO)' && SERVICES.SHELTER.label === 'Emergency/ Temporary shelter'
    && SERVICES.PSYCHOSOCIAL.label === 'Psychosocial' && SERVICES.ECONOMIC.label === 'Economic assistance' && SERVICES.RESIDENTIAL.label === 'Residential facility');
  ok('a stored form that no longer validates is read without inventing values', readForm({ referringOrganization: 'X', contactNo: 'bad!' }).referringOrganization === 'X'
    && readForm(null).referringOrganization === '');
  ok('changed keys name fields, never values', JSON.stringify(changedKeys(complete(), { ...complete(), position: 'Lead' })) === '["position"]');

  // ── 2. What issuing needs ──
  console.log('\nBefore issuing');
  const empty = issueProblems(EMPTY_SERVICE_REFERRAL_FORM);
  ok('a blank form cannot be issued: Section A, destination needed', ['referringOrganization', 'actionTaken', 'referredByLast', 'referredByFirst', 'position', 'contactNo', 'destination', 'incidentNo']
    .every(k => empty.required.some(p => p.key === k)), empty.required.map(p => p.key).join());
  ok('a complete form has nothing required', issueProblems(complete()).required.length === 0, JSON.stringify(issueProblems(complete()).required));
  ok('a destination with no service ticked is refused', issueProblems({ ...complete(), services: [] }).required.some(p => p.key === 'services'));
  ok('"Others" without saying which is refused', issueProblems({ ...complete(), services: ['SWDO_OTHER'] }).required.some(p => p.key === 'serviceOther'));
  ok('the receiving organization must be named and reachable', issueProblems({ ...complete(), receivingAgency: '' }).required.some(p => p.key === 'receivingAgency')
    && issueProblems({ ...complete(), receivingContactNo: '', receivingEmail: '' }).required.some(p => p.key === 'receivingContactNo'));
  ok('a missing client code is a warning, not invented and not blocking', issueProblems({ ...complete(), clientCode: '' }).recommended.some(p => p.key === 'clientCode')
    && issueProblems({ ...complete(), clientCode: '' }).required.length === 0);

  // ── 3. Section C and the workflow ──
  console.log('\nSection C and the workflow');
  ok('receipt needs the printed name, the date and what it rests on', !ackSchema.safeParse({ status: 'ACKNOWLEDGED', basis: 'SIGNED_COPY', dateReceived: '2026-11-10' }).success
    && !ackSchema.safeParse({ status: 'ACKNOWLEDGED', receivedByName: 'Rosa T', dateReceived: '2026-11-10' }).success
    && ackSchema.safeParse({ status: 'ACKNOWLEDGED', basis: 'SIGNED_COPY', receivedByName: 'Rosa T', dateReceived: '2026-11-10' }).success);
  ok('returned for follow-up needs the reason', !ackSchema.safeParse({ status: 'RETURNED', basis: 'VERBAL' }).success && ackSchema.safeParse({ status: 'RETURNED', basis: 'VERBAL', remarks: 'Needs the intake form attached' }).success);
  ok('there is no "service provided" state to record', !ackSchema.safeParse({ status: 'PROVIDED', basis: 'VERBAL', remarks: 'done done' }).success);
  ok('awaiting -> received or returned; returned -> received; received is final', ackTransitionAllowed('AWAITING', 'ACKNOWLEDGED') && ackTransitionAllowed('AWAITING', 'RETURNED')
    && ackTransitionAllowed('RETURNED', 'ACKNOWLEDGED') && !ackTransitionAllowed('ACKNOWLEDGED', 'RETURNED') && !ackTransitionAllowed('ACKNOWLEDGED', 'ACKNOWLEDGED') && !ackTransitionAllowed(null, 'ACKNOWLEDGED'));
  ok('a draft or an unacknowledged issued referral may be cancelled; an acknowledged one may not', cancelAllowed('DRAFT', null) && cancelAllowed('ISSUED', 'AWAITING')
    && !cancelAllowed('ISSUED', 'ACKNOWLEDGED') && !cancelAllowed('CANCELLED', null));
  ok('a referral activity never reaches a resident\'s updates', !(RESIDENT_ACTIVITY_TYPES as readonly string[]).includes('service_referral'));

  // ── 4. Suggestions are suggestions ──
  console.log('\nSuggestions');
  const s = serviceSuggestions({ shelterNeeded: 'yes', immediateConcern: 'yes', policeOrReferralNeeded: 'no' });
  ok('shelter needed -> Emergency/Temporary shelter suggested; immediate concern -> BPO to consider', s.some(x => x.service === 'SHELTER') && s.some(x => x.service === 'BPO' && /Punong Barangay decides/.test(x.text)));
  ok('no safety assessment -> nothing suggested', serviceSuggestions(null).every(x => x.service === null));
  ok('nothing recorded -> nothing suggested', serviceSuggestions({ shelterNeeded: 'no', immediateConcern: 'unknown' }).every(x => x.service === null));

  // ── 5. The PDF ──
  console.log('\nThe PDF');
  const at = new Date('2026-11-09T02:00:00.000Z');
  const f = complete();
  const draft = await buildServiceReferralPdf({ reference: 'SR-PROBE-1', form: f, status: 'DRAFT', sectionC: null, documentDate: at });
  const issued = await buildServiceReferralPdf({ reference: 'SR-PROBE-1', form: f, status: 'ISSUED', sectionC: null, documentDate: at });
  const issuedAgain = await buildServiceReferralPdf({ reference: 'SR-PROBE-1', form: f, status: 'ISSUED', sectionC: null, documentDate: at });
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  ok('the same referral gives the same bytes (its hash identifies the document)', sha(issued) === sha(issuedAgain));
  const d = await pdfText(draft), i = await pdfText(issued);
  ok('two pages - the reference\'s repeated page 2 is not duplicated', d.pages.length === 2 && i.pages.length === 2, String(d.pages.length));
  ok('CONFIDENTIAL and the title on each page', d.pages.every(p => p.includes('CONFIDENTIAL') && p.includes('SERVICE REFERRAL')));
  ok('the client code and incident number in the box on each page', i.pages.every(p => p.includes('CC-PROBE-0042') && p.includes('VC-PROBE-0099')));
  ok('the instructions, word for word', i.text.includes('This form must be filled out by the person providing services to the client.')
    && i.text.includes('Kindly send a copy of this form to the receiving organization, accompanied with the intake form.'));
  ok('Section A labels and values', ['A. REFERRING ORGANIZATION INFORMATION', '1. Referring', '2. Action', '3. Referred by', 'Last Name', 'Middle Name', 'Extension', '4. Position', '5. Contact No.', '6. Email', '7. Address', 'City/Mun',
    'Barangay Testville VAWC Desk', 'Dela Prueba', 'VAWC Officer', 'Rizal St'].every(t => i.text.includes(t)));
  ok('Section B: both blocks and every service printed', ['B. SERVICE REFERRAL INFORMATION', '8. REFERRAL SERVICE', 'Referred to Barangay', 'Referred to Social Welfare and Development Office',
    'Issuance/enforcement of Barangay Protection Order (BPO)', 'Psychosocial', 'Emergency/ Temporary shelter', 'Economic assistance', 'Residential facility', 'Agency/Organization:', 'MSWDO Sample City'].every(t => i.text.includes(t)));
  ok('Section C and the signature lines on page 2', ['C. To be accomplished by the Receiving Organization', '9. Received by', '(signature over printed name)', '10. Position / Job Title', '11. Client Code',
    '12. Date of Received', '(mm/dd/yyyy)', '13. Remarks', 'Signature/thumbprint of', 'RA7610', 'Printed name and signature of the service provider'].every(t => i.pages[1].includes(t)));
  ok('the issued copy leaves Section C blank', !i.text.includes('as recorded in SafeComm') && !i.text.includes('Received / Acknowledged'));
  ok('a draft says so; the issued copy does not', d.text.includes('DRAFT - NOT ISSUED') && !i.text.includes('DRAFT'));
  ok('identified as SafeComm\'s implementation, not a certified form', i.text.includes('Not a certified government form'));
  ok('nothing is drawn as a signature - captions say to sign by hand', i.text.includes('sign by hand') && !/\/s\/|signed electronically|e-signature/i.test(i.text));
  const rec = await pdfText(await buildServiceReferralPdf({ reference: 'SR-PROBE-1', form: f, status: 'ISSUED', documentDate: at,
    sectionC: { status: 'ACKNOWLEDGED', receivedByName: 'Rosa Tagatanggap', position: 'Social Worker II', clientCode: 'MSW-7', dateReceived: '2026-11-10', remarks: 'With intake form' } }));
  ok('the record copy prints Section C as recorded, and says it is not a signature', rec.text.includes('Rosa Tagatanggap') && rec.text.includes('11/10/2026') && rec.text.includes('not reproduced here'));
  const cancelled = await pdfText(await buildServiceReferralPdf({ reference: 'SR-PROBE-1', form: f, status: 'CANCELLED', sectionC: null, documentDate: at }));
  ok('a cancelled referral\'s copy says it is not valid', cancelled.text.includes('CANCELLED'));
  const odd = await buildServiceReferralPdf({ reference: 'SR-PROBE-2', form: { ...f, actionTaken: 'Ñoño — “quoted” ✓ 中文 '.repeat(20) }, status: 'DRAFT', sectionC: null, documentDate: at });
  ok('characters the PDF font cannot print do not break it', (await pdfText(odd)).pages.length === 2);

  // ── 6. The live preview: a pure function of the one form state ──
  console.log('\nThe live preview');
  const html = (form: ServiceReferralForm, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
    <ServiceReferralPreview form={form} reference="SR-PROBE-1" status="DRAFT" {...extra} />);
  const h = html(f);
  ok('two pages, numbered, CONFIDENTIAL on each', h.includes('Page 1 of 2') && h.includes('Page 2 of 2') && count(h, '>CONFIDENTIAL<') === 2);
  ok('typed values show', ['Barangay Testville VAWC Desk', 'Dela Prueba', 'Juana', 'Rizal St', 'MSWDO Sample City', 'Pedro Halimbawa', 'CC-PROBE-0042'].every(t => h.includes(t)));
  const sel = (label: string, hh = h) => hh.includes(`aria-label="${label} (selected)"`);
  ok('ticked services are marked, the others are not', sel('Psychosocial') && sel('Emergency/ Temporary shelter') && !sel('Economic assistance') && !sel('Residential facility')
    && !sel('Issuance/enforcement of Barangay Protection Order (BPO)'));
  ok('only the chosen destination\'s block carries the receiving organization', h.includes('data-destination="SWDO" data-chosen="true"') && !h.includes('data-destination="BARANGAY" data-chosen="true"'));
  const typed = html({ ...f, actionTaken: 'Escorted to the MSWDO intake desk' });
  ok('a change to the state is in the next render (no separate preview copy)', typed.includes('Escorted to the MSWDO intake desk') && !h.includes('Escorted to the MSWDO intake desk'));
  const ticked = html({ ...f, services: ['PSYCHOSOCIAL', 'SHELTER', 'ECONOMIC'] });
  ok('ticking a service shows at once', sel('Economic assistance', ticked));
  const toBarangay = html(normalizeForm({ ...f, destination: 'BARANGAY', services: ['BPO'] }));
  ok('switching to the Barangay block moves the tick and the details', sel('Issuance/enforcement of Barangay Protection Order (BPO)', toBarangay) && !sel('Psychosocial', toBarangay)
    && toBarangay.includes('data-destination="BARANGAY" data-chosen="true"'));
  const blank = html(EMPTY_SERVICE_REFERRAL_FORM);
  ok('an empty form shows empty fields and no ticks', !blank.includes('(selected)') && blank.includes('Left blank for the receiving organization'));
  ok('Section C is not shown as received on a draft or an awaiting referral', !h.includes('Received / Acknowledged')
    && html(f, { status: 'ISSUED', sectionC: { status: 'AWAITING', receivedByName: null, position: null, clientCode: null, dateReceived: null, remarks: null } }).includes('Awaiting acknowledgement'));
  ok('the signature lines carry no name or mark - only the printed name under "Referred by"', h.includes('Client signature line - signed by hand')
    && !/Client signature line[^>]*>[^<]+</.test(h) && h.includes('(sign by hand on the printed copy)'));
  ok('a draft is watermarked and says it must not be given out', h.includes('DRAFT - NOT ISSUED'));

  // ── 7. Scans of signed copies ──
  console.log('\nScans of signed copies');
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')}`;
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n%probe').toString('base64')}`;
  ok('a PNG or PDF scan is accepted', !('error' in parseReferralScan(png)) && !('error' in parseReferralScan(pdf)));
  ok('a file that is not what it claims is refused', 'error' in parseReferralScan(`data:application/pdf;base64,${Buffer.from('<html>').toString('base64')}`));
  ok('other types are refused', 'error' in parseReferralScan(`data:text/html;base64,${Buffer.from('<p>').toString('base64')}`));
  ok('a file over 3 MB is refused', 'error' in parseReferralScan(`data:application/pdf;base64,${Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(3 * 1024 * 1024)]).toString('base64')}`));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log('\nFailures:'); fails.forEach(x => console.log('  - ' + x)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
