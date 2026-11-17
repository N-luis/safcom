/**
 * KP Forms - the formatters and each form's document, without a browser or a
 * database. Run with:  npm run test:kpforms
 * (Saving and loading through the routes: npm run test:kpforms:api.)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { dateParts, monthDay, timeParts, pdfFileName, FIL_MONTHS } from '../lib/kpForms/format';
import {
  KP_FORMS, KP_FORM_IDS, prefilledIntake, missingRequired, dateOrderWarnings, applyRecord, recordData, emptyIntake, DEFAULT_PUNONG_BARANGAY,
  type KpIntakeState,
} from '../lib/kpForms/forms';
import { kpForms, kpFormEntry } from '../components/kpForms/documents';
import KpDocumentView, { pageCount } from '../components/kpForms/KpDocumentView';

let pass = 0; const fails: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  if (cond) pass++; else fails.push(`${label}${extra ? '  ->  ' + extra : ''}`);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
}
const FONTS = { serif: 'serif', sans: 'sans-serif' };
/** The document as text: tags out, spaces collapsed. */
const text = (s: KpIntakeState) => {
  const html = renderToStaticMarkup(<KpDocumentView doc={kpFormEntry(s.activeForm).render(s, FONTS)} />);
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};
/** Words of the official text, in order, allowing a blank (filled or not) between any two. */
const hasText = (doc: string, official: string) => {
  const flat = doc.replace(/\s+/g, ' ');
  return official.split(/\{[^}]*\}/).map(p => p.trim()).filter(Boolean).every(part => flat.replace(/\s+/g, '').includes(part.replace(/\s+/g, '')));
};
const html = (s: KpIntakeState) => renderToStaticMarkup(<KpDocumentView doc={kpFormEntry(s.activeForm).render(s, FONTS)} />);

console.log('1. Dates, in the official Filipino pattern');
ok('12 Filipino months, Enero to Disyembre', FIL_MONTHS.length === 12 && FIL_MONTHS[0] === 'Enero' && FIL_MONTHS[10] === 'Nobyembre' && FIL_MONTHS[11] === 'Disyembre');
const d = dateParts('2026-11-07');
ok('day without a leading zero, month in Filipino, two-digit year after the printed "20"', d?.day === '7' && d.month === 'Nobyembre' && d.yy === '26' && d.yyyy === '2026', JSON.stringify(d));
ok('2005 gives "05", never "2005" after the "20"', dateParts('2005-01-31')?.yy === '05');
ok('no date, no parts; a date that does not exist is refused', dateParts('') === null && dateParts('2026-02-30') === null && dateParts('nope') === null);
ok('"nakatakda noong": month then day', monthDay('2026-11-10') === 'Nobyembre 10');

console.log('\n2. Times: h:mm and umaga / hapon');
ok('9:00 in the morning', JSON.stringify(timeParts('09:00')) === JSON.stringify({ time: '9:00', period: 'umaga' }));
ok('2:30 in the afternoon', JSON.stringify(timeParts('14:30')) === JSON.stringify({ time: '2:30', period: 'hapon' }));
ok('noon is 12:00 hapon, midnight 12:00 umaga', timeParts('12:00')?.time === '12:00' && timeParts('12:00')?.period === 'hapon' && timeParts('00:15')?.time === '12:15' && timeParts('00:15')?.period === 'umaga');
ok('no time, nothing', timeParts('') === null && timeParts('25:00') === null);

console.log('\n3. File names');
ok('KP-Form-{number}_{caseNo}_{date}.pdf', pdfFileName('7', 'BLT-123456', new Date('2026-11-17T03:00:00Z')) === 'KP-Form-7_BLT-123456_2026-11-17.pdf');
ok('no case number: "draft"; unsafe characters dropped', pdfFileName('18', '', new Date('2026-11-17T03:00:00Z')) === 'KP-Form-18_draft_2026-11-17.pdf'
  && pdfFileName('9', 'a/b c', new Date('2026-11-17T03:00:00Z')) === 'KP-Form-9_a-b-c_2026-11-17.pdf');

console.log('\n4. The registry');
ok('six forms, in order: 7, 8, 9, 16, 18, 19', KP_FORMS.map(f => f.number).join() === '7,8,9,16,18,19' && kpForms.length === 6);
ok('labels as printed top left', KP_FORMS.map(f => f.label).join('|') === 'KP Form 7|KP Form 8|KP Form 9|KP Form 16|KP Form No. 18|KP Form 19');
ok('KP 9 is two pages in a sans-serif; the rest one page in a serif', KP_FORMS.every(f => (f.id === 'KP9' ? f.pages === 2 && f.font === 'sans' : f.pages === 1 && f.font === 'serif')));
ok('the Punong Barangay\'s name is set once', DEFAULT_PUNONG_BARANGAY === 'YBOYH N. DEL ROSARIO, JR.');

// A fully filled intake.
const s = prefilledIntake('case-1', { caseNumber: 'BLT-000123', caseType: 'Assault', complainant: 'Juana Dela Cruz', respondents: ['Pedro Santos'], narrative: 'Sinaktan ako sa braso.' }, '2026-11-17');
s.shared.respondents.push('Maria Santos');
Object.assign(s.forms.KP7, { reliefSought: 'Humingi ng tawad at bayaran ang gamot.', dateMade: '2026-11-17', dateFiled: '2026-11-18' });
Object.assign(s.forms.KP8, { hearingDate: '2026-11-24', hearingTime: '14:30', dateIssued: '2026-11-17', dateNotified: '2026-11-18' });
Object.assign(s.forms.KP9, { appearanceDate: '2026-11-25', appearanceTime: '09:00', signatoryRole: 'pangkat', servedDate: '2026-11-19', serviceMethods: ['1', '3'],
  leftWithPerson3: 'Jose Santos', serverName: 'Kgd. Ramon Cruz', receivedBy: [{ name: 'Jose Santos', date: '2026-11-19' }] });
Object.assign(s.forms.KP16, { settlementTerms: 'Babayaran ni Pedro ang gamot sa loob ng isang linggo.', dateRecorded: '2026-12-01' });
Object.assign(s.forms.KP18, { appearanceDate: '2026-11-30', appearanceTime: '10:00', missedHearingDate: '2026-11-24', dateIssued: '2026-11-25', dateNotified: '2026-11-26' });
Object.assign(s.forms.KP19, { appearanceDate: '2026-11-30', appearanceTime: '15:00', missedHearingDate: '2026-11-24', dateIssued: '2026-11-25', dateNotified: '2026-11-26' });
const as = (id: typeof KP_FORM_IDS[number]): KpIntakeState => ({ ...s, activeForm: id });

const HEADER = 'Republika ng Pilipinas Lalawigan ng Bulacan Bayan ng Bocaue Barangay Biñang 2 nd TANGGAPAN NG LUPONG TAGAPAMAYAPA';

console.log('\n5. KP Form 7 - Sumbong');
const t7 = text(as('KP7'));
ok('label, header, "nd" as superscript', t7.startsWith('KP Form 7') && t7.includes(HEADER) && html(as('KP7')).includes('<sup'));
ok('caption: Nagsusumbong, / Ipinagsusumbong. / Usaping Barangay Blg. / Para:', ['Juana Dela Cruz Nagsusumbong,', '- laban -', 'Pedro Santos Maria Santos Ipinagsusumbong.', 'Usaping Barangay Blg. BLT-000123', 'Para: Assault'].every(x => t7.includes(x)), t7.slice(0, 400));
ok('title and the two paragraphs, word for word', t7.includes('SUMBONG') && hasText(t7, 'Ako/Kami ay nagsusumbong laban sa mga taong binabanggit sa itaas dahil sa paglabag sa akin/aming karapatan at kapakanan ayon sa mga sumusunod na paraan:')
  && hasText(t7, 'Dahil dito, ako/kami ay magalang na humihiling na inyong ipagkaloob sa akin/amin ang nararapat ayon sa batas o katwiran katulad ng mga sumusunod:'));
ok('the narrative and the relief on the ruled lines', t7.includes('Sinaktan ako sa braso.') && t7.includes('Humingi ng tawad at bayaran ang gamot.'));
ok('"Ginawa ngayong ika-17 araw ng Nobyembre, 2026." - 20 printed, 26 in the blank', t7.includes('Ginawa ngayong ika- 17 araw ng Nobyembre , 20 26 .'), t7.match(/Ginawa[^.]*\./)?.[0]);
ok('"Inihain at tinanggap ngayong ika-18 ng Nobyembre, 2026."', t7.includes('Inihain at tinanggap ngayong ika- 18 ng Nobyembre , 20 26 .'));
ok('the Punong Barangay in capitals over "Punong Barangay/Tagapangulong Lupon"', t7.includes('YBOYH N. DEL ROSARIO, JR. Punong Barangay/Tagapangulong Lupon'));

console.log('\n6. KP Form 8 - Patalastas ng Pagdinig');
const t8 = text(as('KP8'));
ok('no caption, no case number', t8.startsWith('KP Form 8') && !t8.includes('Usaping Barangay'));
ok('to the first respondent, "(Ipinagsusumbong)"', t8.includes('Pedro Santos (Ipinagsusumbong)'));
ok('the body, word for word, with 2:30 and hapon', hasText(t8, 'Ikaw ay inaatasan na humarap sa akin sa ika {d} ng {m}, 20{y}, ganap na {t} ng umaga/hapon para sa pagdinig ng iyong sumbong.')
  && t8.includes('ika 24 ng Nobyembre , 20 26 , ganap na 2:30 ng umaga / hapon'));
ok('umaga is struck through (2:30 is in the afternoon)', /line-through[^>]*>umaga</.test(html(as('KP8'))) && !/line-through[^>]*>hapon</.test(html(as('KP8'))));
ok('Ngayong / Punong Barangay / Ipinabatid ngayong / Ipinagsusumbong', ['Ngayong ika 17 ng Nobyembre , 20 26 .', 'YBOYH N. DEL ROSARIO, JR. Punong Barangay', 'Ipinabatid ngayong ika 18 ng Nobyembre , 20 26 .', 'Pedro Santos Ipinagsusumbong'].every(x => t8.includes(x)));
const s8 = as('KP8'); s8.forms = { ...s8.forms, KP8: { ...s8.forms.KP8, recipientType: 'complainant' } };
ok('the toggle: to the complainant, "(Nagsusumbong)"', text(s8).includes('Juana Dela Cruz (Nagsusumbong)') && text(s8).includes('Juana Dela Cruz Nagsusumbong'));

console.log('\n7. KP Form 9 - Patawag, and its page 2');
const d9 = kpFormEntry('KP9').render(as('KP9'), FONTS);
const t9 = text(as('KP9'));
ok('two pages', pageCount(d9) === 2, String(pageCount(d9)));
const pages9 = html(as('KP9')).split('class="kp-page"').slice(1);
ok('page 1 has the header; page 2 does not, but has the label', pages9[0].includes('Republika ng Pilipinas') && !pages9[1].includes('Republika ng Pilipinas') && pages9[1].includes('KP Form 9'));
ok('the summons body, ",20 {YY}" as on the form, 9:00 umaga', hasText(t9, 'Ikaw/kayo ay tinatawagan upang humarap sa akin ng personal kasama ang iyong mga saksi sa ika {d} ng {m},20 {y}, sa ganap na ika {t} ng umaga/hapon upang doon ay sumagot sa sumbong na inihain sa akin, kalakip nito ang sipi ng sumbong, para ito ay maayos o magkaroon kayo ng kasunduan ng nagsusumbong.')
  && t9.includes('ika 25 ng Nobyembre ,20 26 , sa ganap na ika 9:00 ng umaga / hapon'));
ok('the warning, word for word', hasText(t9, 'Binibigyan ka ng babala na kung hindi mo ito bibigyan ng pansin o tahasang baliwalain na humarap bilang pagtupad sa patawag na ito, ikaw ay mawawalan ng karapatan para ihain ang iyong kontra reklamo kung mayroon man sa hukuman o alin mang tanggapan sa pamahalaan, o kaya ikaw ay mapaparusahan katulad ng mga taong nagkasala ng di-tuwirang paghamak ng hukuman.'));
ok('signed as Tagapangulo ng Pangkat: Punong Barangay struck through', /line-through[^>]*>Punong Barangay</.test(pages9[0]));
ok('page 2: the return, word for word', hasText(t9, 'OPISYAL NA NAGDALA NG PATAWAG') && hasText(t9, 'Ipinatanggap ko ang Patawag na ito sa Ipinagsusumbong noong ika- {d} ng {m}, 20 {y} sa pamamagitan ng:')
  && t9.includes('(Pakisulat ang (mga) pangalan ng ipinagsusumbong bago ang paraan ng pagkakata'));
ok('each respondent before the way they were served (1: Pedro, 3: Maria, left with Jose Santos)', t9.includes('Pedro Santos 1. Personal na pagbibigay sa kanya; o')
  && t9.includes('Maria Santos 3. Iniwan ang Patawag kay Jose Santos , isang taong may sapat na gulang at pagpapasiya na nakatira sa kanyang bahay; o')
  && t9.includes('4. Iniwan ang Patawag kay') && t9.includes('isang taong namamahala sa kanyang tanggapan/lugar ng hanap buhay.'));
ok('Nagdala ng Patawag; received by, (lagda) and (petsa)', t9.includes('Kgd. Ramon Cruz Nagdala ng Patawag') && t9.includes('Tinanggap ng (mga) kinatawan ng (mga) inerereklamo (Respondent/s representative/s)')
  && t9.includes('Jose Santos (lagda)') && t9.includes('Nobyembre 19, 2026 (petsa)'));

console.log('\n8. KP Form 16 - Kasunduan');
const t16 = text(as('KP16'));
ok('title and subtitle', t16.includes('KASUNDUAN (Amicable Settlement)'));
ok('the agreement, word for word', hasText(t16, 'Kami, nagsusumbong at ipinagsusumbong, ng dahil sa nabanggit na usapin ay nagkasundo tungkol sa mga sumusunod:') && t16.includes('Babayaran ni Pedro ang gamot')
  && t16.includes('at kami ay buong tapat na pasasaklaw sa mga kondisyong aming napagkasunduan.'));
ok('"Itinala ngayong ika 1 ng Disyembre, 2026." - the full year', t16.includes('Itinala ngayong ika 1 ng Disyembre , 2026 .'));
ok('PAGPAPATUNAY and "IGG." before the name', t16.includes('PAGPAPATUNAY') && t16.includes('IGG. YBOYH N. DEL ROSARIO, JR.') && hasText(t16, 'Na aking pinatutunayan na ang mga nakasaad sa kasunduang ito ay kusang loob na ginawa at napagkasunduan ng magkabilang panig matapos kong ipaliwanag sa kanila ang katangian at kalalabasan nito.'));

console.log('\n9. KP Forms 18 and 19 - for not appearing');
const t18 = text(as('KP18')); const t19 = text(as('KP19'));
ok('KP 18: "KP Form No. 18", PAGDINIG (not the misprinted PANDINIG), its subtitle', t18.startsWith('KP Form No. 18') && t18.includes('PATALASTAS NG PAGDINIG (Para sa hindi Pagdalo ng nagsusumbong)') && !t18.includes('PANDINIG'));
ok('KP 18: to the complainants; "Para:"', t18.includes('Juana Dela Cruz (Mga) Nagsusumbong') && t18.includes('Para: Assault'));
ok('KP 18 body, word for word: "ka-10:00", "nakatakda noong Nobyembre 24, 2026"', hasText(t18, 'Ipinag-uutos ng tanggapang ito na ikaw ay humarap sa akin/Pangkat sa ika {d} ng {m}, 20{y}, ganap na ka-{t} ng umaga/hapon upang magpaliwanag kung bakit hindi ka nakadalo sa pagdinig na nakatakda noong {md}, 20{y}, at kung bakit ang iyong sumbong ay hindi mapawalang-saysay, ang katibayan para hindi maidulog ang iyong sumbong sa hukuman o alin mang tanggapan ng pamahalaan ay hindi ipagkaloob, at hindi ka ipagsakdal sa salang di-tuwirang paghamak ng hukuman dahil sa hindi mo pagdalo sa pagdinig na ginanap ng Punong Barangay/Pangkat ng Tagapagkasundo.')
  && t18.includes('ganap na ka- 10:00') && t18.includes('nakatakda noong Nobyembre 24 , 20 26'));
ok('KP 18: "(Ekisan ang hindi angkop)" and "Ipinabatid ngayong ika"', t18.includes('(Ekisan ang hindi angkop)') && t18.includes('Ipinabatid ngayong ika 26 ng Nobyembre , 20 26 .'));
ok('KP 19: "(Mga) Nagsusumbong," and "Para sa:", to the respondents', t19.startsWith('KP Form 19') && t19.includes('(Mga) Nagsusumbong,') && t19.includes('Para sa: Assault') && t19.includes('Pedro Santos, Maria Santos (Ipinagsusumbong)'));
ok('KP 19 body, word for word', hasText(t19, 'Ipinag-uutos ng tanggapang ito na ikaw ay humarap sa Punong Barangay/Pangkat sa ika {d} ng {m}, 20{y}, ganap na {t} ng umaga/hapon upang magpaliwanag kung bakit hindi ka dumalo sa pagdinig na nakatakda noong {md}, 20{y}, at kung bakit ang iyong kontra reklamo (kung mayroon man) na may kaugnayan sa kasalukuyang sumbong ay hindi mapawalang-saysay, ang katibayan para hindi maidulog sa hukuman ang iyong kontra reklamo ay hindi ipagkaloob, at hindi ka ipagsakdal sa salang di-tuwirang paghamak ng hukuman dahil sa tahasang hindi pagharap sa Punong Barangay/Pangkat ng Tagapagkasundo.')
  && t19.includes('ganap na 3:00 ng umaga / hapon'));
ok('KP 19: "Ipinabatid ngayon 26" - "ngayon", not "ngayong ika"', t19.includes('Ipinabatid ngayon 26 ng Nobyembre , 20 26 .') && !t19.includes('Ipinabatid ngayong'));

console.log('\n10. Blank forms, long text, validation, saving');
const blank = emptyIntake('case-2');
blank.shared.punongBarangay = '';
for (const id of KP_FORM_IDS) {
  const b = { ...blank, activeForm: id } as KpIntakeState;
  const dd = kpFormEntry(id).render(b, FONTS);
  ok(`${id} blank: ${kpFormEntry(id).pages} page(s), underlines where the values go`, pageCount(dd) === kpFormEntry(id).pages && html(b).includes('border-bottom:1px solid #000'), String(pageCount(dd)));
}
const long = as('KP7'); long.forms = { ...long.forms, KP7: { ...long.forms.KP7, violationDetails: 'Mahabang salaysay. '.repeat(300) } };
const longDoc = kpFormEntry('KP7').render(long, FONTS);
ok('a long narrative flows onto more pages instead of being cut', pageCount(longDoc) >= 2 && text(long).includes('Inihain at tinanggap'), String(pageCount(longDoc)));
ok('missing required fields are listed', missingRequired('KP7', blank).includes('Usaping Barangay Blg.') && missingRequired('KP7', s).length === 0, missingRequired('KP7', s).join());
const early = as('KP7'); early.forms = { ...early.forms, KP7: { ...early.forms.KP7, dateMade: '2026-11-18', dateFiled: '2026-11-17' } };
ok('"Inihain" before "Ginawa" is warned', dateOrderWarnings('KP7', early).length === 1 && dateOrderWarnings('KP7', s).length === 0);
const restored = applyRecord(emptyIntake('case-1'), 'KP9', JSON.parse(JSON.stringify(recordData('KP9', s))));
ok('a saved record reopens with every value', JSON.stringify(restored.forms.KP9) === JSON.stringify(s.forms.KP9) && JSON.stringify(restored.shared) === JSON.stringify(s.shared) && restored.activeForm === 'KP9');
ok('unknown keys in a saved record are dropped', !('evil' in (applyRecord(emptyIntake('x'), 'KP7', { shared: {}, form: { evil: 1 } }).forms.KP7 as object)));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  FAILED: ' + f)); process.exitCode = 1; }
