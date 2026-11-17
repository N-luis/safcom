/**
 * The six KP Forms as documents: the official text, word for word, with each
 * blank filled from the intake. A pure function of the intake - the same
 * blocks are drawn for the preview, the print and the PDF.
 */
import {
  KP_FORMS, effectiveRecipient, effectiveSignatory, effectiveKp16Name, type KpFormId, type KpFormSpec, type KpIntakeState, type SignatoryRole,
} from '@/lib/kpForms/forms';
import { cleanNames, dateParts, monthDay, timeParts } from '@/lib/kpForms/format';
import {
  BODY_W, blank, caption, centered, choice, custom, flow, header, paragraph, partyLine, ruled, signature, spacer, title, twoColumns, txt,
  underlinedLines, ChoiceView, type Block, type KpDoc, type Run, type Typo,
} from './layout';

export interface KpFonts { serif: string; sans: string }

/** 12 pt serif (KP 7, 8, 16, 18, 19); 11 pt sans-serif (KP 9). */
export const typoFor = (font: 'serif' | 'sans', fonts: KpFonts): Typo => font === 'serif'
  ? { family: fonts.serif, size: 16, lh: 24, cl: 21 }
  : { family: fonts.sans, size: 14.6667, lh: 22, cl: 19 };

// ── Blanks for dates and times ───────────────────────────────────────────────

const D = (iso: string) => dateParts(iso) ?? { day: '', month: '', yy: '', yyyy: '' };
const dayB = (iso: string, f: string) => blank(D(iso).day, 34, f);
const monB = (iso: string, f: string) => blank(D(iso).month, 104, f);
const yyB = (iso: string, f: string) => blank(D(iso).yy, 28, f);
const yyyyB = (iso: string, f: string) => blank(D(iso).yyyy, 52, f);
const timeB = (hhmm: string, f: string) => blank(timeParts(hhmm)?.time ?? '', 56, f);
/** umaga/hapon - the one that does not apply struck through (both plain while no time is given). */
const ampm = (hhmm: string): Run => { const t = timeParts(hhmm); return choice(['umaga', 'hapon'], t ? (t.period === 'umaga' ? 0 : 1) : null); };
const rolePick = (r: SignatoryRole) => (r === 'pb' ? 0 : 1);
/** "ika {day} ng {Month}, 20{YY}" - the "20" is printed; only the last two digits go in the blank. */
const ikaDate = (iso: string, f: string, ika = 'ika '): Run[] => [txt(ika), dayB(iso, f), txt(' ng '), monB(iso, f), txt(', 20'), yyB(iso, f)];

const ROLE_OPTS = ['Punong Barangay', 'Tagapangulo ng Pangkat'];

interface Ctx { s: KpIntakeState; typo: Typo; hl: string | null }

// ── KP Form 7 - Sumbong ──────────────────────────────────────────────────────

function kp7({ s, typo, hl }: Ctx): Block[][] {
  const f = s.forms.KP7; const sh = s.shared;
  return [[
    ...header('KP Form 7', typo, true), spacer(10),
    caption({ complainants: cleanNames(sh.complainants), respondents: cleanNames(sh.respondents), caseNo: sh.caseNo, paraSa: sh.paraSa, typo, highlight: hl,
      complainantLabel: 'Nagsusumbong,', respondentLabel: 'Ipinagsusumbong.', paraLabel: 'Para:' }),
    spacer(12), ...title('SUMBONG', typo), spacer(8),
    ...paragraph([txt('Ako/Kami ay nagsusumbong laban sa mga taong binabanggit sa itaas dahil sa paglabag sa akin/aming karapatan at kapakanan ayon sa mga sumusunod na paraan:')], typo),
    ...ruled(f.violationDetails, typo, 3, 'violationDetails', hl), spacer(10),
    ...paragraph([txt('Dahil dito, ako/kami ay magalang na humihiling na inyong ipagkaloob sa akin/amin ang nararapat ayon sa batas o katwiran katulad ng mga sumusunod:')], typo),
    ...ruled(f.reliefSought, typo, 3, 'reliefSought', hl), spacer(10),
    ...paragraph([txt('Ginawa ngayong ika-'), dayB(f.dateMade, 'dateMade'), txt(' araw ng '), monB(f.dateMade, 'dateMade'), txt(', 20'), yyB(f.dateMade, 'dateMade'), txt('.')], typo, { highlight: hl }),
    signature(cleanNames(sh.complainants)[0] ?? '', 'Nagsusumbong', typo, { field: 'complainants', highlight: hl }), spacer(6),
    ...paragraph([txt('Inihain at tinanggap ngayong '), ...ikaDate(f.dateFiled, 'dateFiled', 'ika-'), txt('.')], typo, { highlight: hl }),
    signature(sh.punongBarangay, 'Punong Barangay/Tagapangulong Lupon', typo, { field: 'punongBarangay', highlight: hl, bold: true, upper: true }),
  ]];
}

// ── KP Form 8 - Patalastas ng Pagdinig ───────────────────────────────────────

function kp8({ s, typo, hl }: Ctx): Block[][] {
  const f = s.forms.KP8; const sh = s.shared;
  const who = f.recipientType === 'respondent' ? 'Ipinagsusumbong' : 'Nagsusumbong';
  const name = effectiveRecipient('KP8', sh, s.forms);
  return [[
    ...header('KP Form 8', typo, true), spacer(16), ...title('PATALASTAS NG PAGDINIG', typo), spacer(16),
    partyLine(name, `(${who})`, typo, { field: 'recipientName', highlight: hl }), spacer(14),
    ...paragraph([txt('Ikaw ay inaatasan na humarap sa akin sa '), ...ikaDate(f.hearingDate, 'hearingDate'), txt(', ganap na '), timeB(f.hearingTime, 'hearingTime'),
      txt(' ng '), ampm(f.hearingTime), txt(' para sa pagdinig ng iyong sumbong.')], typo, { highlight: hl }),
    spacer(14), ...paragraph([txt('Ngayong '), ...ikaDate(f.dateIssued, 'dateIssued'), txt('.')], typo, { highlight: hl }),
    signature(sh.punongBarangay, 'Punong Barangay', typo, { field: 'punongBarangay', highlight: hl, bold: true, upper: true }), spacer(14),
    ...paragraph([txt('Ipinabatid ngayong '), ...ikaDate(f.dateNotified, 'dateNotified'), txt('.')], typo, { highlight: hl }),
    signature(name, who, typo, { field: 'recipientName', highlight: hl }),
  ]];
}

// ── KP Form 9 - Patawag, and the server's return (page 2) ───────────────────

function kp9({ s, typo, hl }: Ctx): Block[][] {
  const f = s.forms.KP9; const sh = s.shared;
  const comp = cleanNames(sh.complainants); const resp = cleanNames(sh.respondents);
  const page1: Block[] = [
    ...header('KP Form 9', typo, true), spacer(10),
    caption({ complainants: comp, respondents: resp, caseNo: sh.caseNo, paraSa: sh.paraSa, typo, highlight: hl,
      complainantLabel: '(Mga) Nagsusumbong', respondentLabel: '(Mga) Ipinagsusumbong.', paraLabel: 'Para sa:' }),
    spacer(10), ...title('PATAWAG', typo), spacer(4),
    twoColumns(comp, resp, 'Nagsusumbong', 'Ipinagsusumbong', typo, { highlight: hl, leftField: 'complainants', rightField: 'respondents' }), spacer(10),
    ...paragraph([txt('Ikaw/kayo ay tinatawagan upang humarap sa akin ng personal kasama ang iyong mga saksi sa ika '), dayB(f.appearanceDate, 'appearanceDate'), txt(' ng '),
      monB(f.appearanceDate, 'appearanceDate'), txt(',20 '), yyB(f.appearanceDate, 'appearanceDate'), txt(', sa ganap na ika '), timeB(f.appearanceTime, 'appearanceTime'),
      txt(' ng '), ampm(f.appearanceTime), txt(' upang doon ay sumagot sa sumbong na inihain sa akin, kalakip nito ang sipi ng sumbong, para ito ay maayos o magkaroon kayo ng kasunduan ng nagsusumbong.')],
    typo, { highlight: hl }),
    spacer(8),
    ...paragraph([txt('Binibigyan ka ng babala na kung hindi mo ito bibigyan ng pansin o tahasang baliwalain na humarap bilang pagtupad sa patawag na ito, ikaw ay mawawalan ng karapatan para ihain ang iyong kontra reklamo kung mayroon man sa hukuman o alin mang tanggapan sa pamahalaan, o kaya ikaw ay mapaparusahan katulad ng mga taong nagkasala ng di-tuwirang paghamak ng hukuman.')], typo),
    spacer(8), ...paragraph([txt('Ngayong '), ...ikaDate(f.dateIssued, 'dateIssued'), txt('.')], typo, { highlight: hl }),
    signature(effectiveSignatory(sh, f.signatoryName), <ChoiceView opts={ROLE_OPTS} pick={rolePick(f.signatoryRole)} sep=" / " />, typo,
      { field: 'signatoryName', highlight: hl, bold: true, upper: true, width: 330 }),
  ];

  // Page 2: whose name goes before which way it was served.
  const byMethod = (m: string) => resp.filter((_, i) => f.serviceMethods[i] === m).join(', ');
  const NAME_W = 170; const GAP = 14; const TEXT_W = BODY_W - NAME_W - GAP;
  const item = (n: string, runs: Run[]): Block => {
    const left = underlinedLines(byMethod(n), NAME_W, typo, 'serviceMethods', hl);
    const right = flow([txt(`${n}. `), ...runs], TEXT_W, typo, { highlight: hl });
    const h = Math.max(left.lines * typo.cl, right.lines * typo.lh) + 8;
    return custom(h, <div style={{ display: 'flex', gap: GAP, alignItems: 'flex-start', paddingTop: 8 }}>{left.node}{right.node}</div>);
  };
  const rows: Block[] = [];
  for (let i = 0; i < 4; i++) {
    const r = f.receivedBy[i];
    const p = r?.date ? dateParts(r.date) : null;
    rows.push(twoColumns([r?.name ?? ''], [p ? `${p.month} ${p.day}, ${p.yyyy}` : ''], '(lagda)', '(petsa)', typo, { lines: 1, highlight: hl, leftField: 'receivedBy', rightField: 'receivedBy' }));
  }
  const page2: Block[] = [
    ...header('KP Form 9', typo, false), spacer(10), ...title('OPISYAL NA NAGDALA NG PATAWAG', typo, undefined, { italic: false }), spacer(10),
    ...paragraph([txt('Ipinatanggap ko ang Patawag na ito sa Ipinagsusumbong noong ika- '), dayB(f.servedDate, 'servedDate'), txt(' ng '), monB(f.servedDate, 'servedDate'),
      txt(', 20 '), yyB(f.servedDate, 'servedDate'), txt(' sa pamamagitan ng:')], typo, { highlight: hl }),
    ...paragraph([txt('(Pakisulat ang (mga) pangalan ng ipinagsusumbong bago ang paraan ng pagkakata')], typo, { indent: 0 }),
    item('1', [txt('Personal na pagbibigay sa kanya; o')]),
    item('2', [txt('Ibinigay sa kanya subalit tumanggi siya; o')]),
    item('3', [txt('Iniwan ang Patawag kay '), blank(f.leftWithPerson3, 120, 'leftWithPerson3'),
      txt(', isang taong may sapat na gulang at pagpapasiya na nakatira sa kanyang bahay; o')]),
    item('4', [txt('Iniwan ang Patawag kay '), blank(f.leftWithPerson4, 120, 'leftWithPerson4'),
      txt(', isang taong namamahala sa kanyang tanggapan/lugar ng hanap buhay.')]),
    spacer(10), signature(f.serverName, 'Nagdala ng Patawag', typo, { field: 'serverName', highlight: hl }), spacer(14),
    ...paragraph([txt('Tinanggap ng (mga) kinatawan ng (mga) inerereklamo (Respondent/s representative/s)')], typo, { align: 'center', indent: 0 }),
    ...rows,
  ];
  return [page1, page2];
}

// ── KP Form 16 - Kasunduan ───────────────────────────────────────────────────

function kp16({ s, typo, hl }: Ctx): Block[][] {
  const f = s.forms.KP16; const sh = s.shared;
  const comp = cleanNames(sh.complainants); const resp = cleanNames(sh.respondents);
  return [[
    ...header('KP Form 16', typo, true), spacer(10),
    caption({ complainants: comp, respondents: resp, caseNo: sh.caseNo, paraSa: sh.paraSa, typo, highlight: hl,
      complainantLabel: '(Mga) Nagsusumbong', respondentLabel: '(Mga) Ipinagsusumbong', paraLabel: 'Para sa:' }),
    spacer(10), ...title('KASUNDUAN', typo, '(Amicable Settlement)'), spacer(8),
    ...paragraph([txt('Kami, nagsusumbong at ipinagsusumbong, ng dahil sa nabanggit na usapin ay nagkasundo tungkol sa mga sumusunod:')], typo),
    ...ruled(f.settlementTerms, typo, 4, 'settlementTerms', hl),
    ...paragraph([txt('at kami ay buong tapat na pasasaklaw sa mga kondisyong aming napagkasunduan.')], typo, { indent: 0 }), spacer(6),
    ...paragraph([txt('Itinala ngayong ika '), dayB(f.dateRecorded, 'dateRecorded'), txt(' ng '), monB(f.dateRecorded, 'dateRecorded'), txt(', '), yyyyB(f.dateRecorded, 'dateRecorded'), txt('.')],
      typo, { highlight: hl }),
    twoColumns(comp, resp, '(Mga) Nagsusumbong', '(Mga) Ipinagsusumbong', typo, { highlight: hl, leftField: 'complainants', rightField: 'respondents' }),
    spacer(10), centered('PAGPAPATUNAY', typo, { bold: true }), spacer(4),
    ...paragraph([txt('Na aking pinatutunayan na ang mga nakasaad sa kasunduang ito ay kusang loob na ginawa at napagkasunduan ng magkabilang panig matapos kong ipaliwanag sa kanila ang katangian at kalalabasan nito.')], typo),
    signature(effectiveKp16Name(sh, f.punongBarangay), <ChoiceView opts={ROLE_OPTS} pick={rolePick(f.signatoryRole)} sep=" / " />, typo,
      { field: 'punongBarangay', highlight: hl, bold: true, upper: true, width: 340 }),
  ]];
}

// ── KP Forms 18 and 19 - for not appearing ───────────────────────────────────

function absence(id: 'KP18' | 'KP19', { s, typo, hl }: Ctx): Block[][] {
  const f = s.forms[id]; const sh = s.shared;
  const comp = cleanNames(sh.complainants); const resp = cleanNames(sh.respondents);
  const is18 = id === 'KP18';
  const missed = D(f.missedHearingDate);
  const body: Run[] = is18
    ? [txt('Ipinag-uutos ng tanggapang ito na ikaw ay humarap sa akin/Pangkat sa '), ...ikaDate(f.appearanceDate, 'appearanceDate'), txt(', ganap na ka-'),
      timeB(f.appearanceTime, 'appearanceTime'), txt(' ng '), ampm(f.appearanceTime),
      txt(' upang magpaliwanag kung bakit hindi ka nakadalo sa pagdinig na nakatakda noong '), blank(monthDay(f.missedHearingDate), 120, 'missedHearingDate'),
      txt(', 20'), blank(missed.yy, 28, 'missedHearingDate'),
      txt(', at kung bakit ang iyong sumbong ay hindi mapawalang-saysay, ang katibayan para hindi maidulog ang iyong sumbong sa hukuman o alin mang tanggapan ng pamahalaan ay hindi ipagkaloob, at hindi ka ipagsakdal sa salang di-tuwirang paghamak ng hukuman dahil sa hindi mo pagdalo sa pagdinig na ginanap ng Punong Barangay/Pangkat ng Tagapagkasundo.')]
    : [txt('Ipinag-uutos ng tanggapang ito na ikaw ay humarap sa Punong Barangay/Pangkat sa '), ...ikaDate(f.appearanceDate, 'appearanceDate'), txt(', ganap na '),
      timeB(f.appearanceTime, 'appearanceTime'), txt(' ng '), ampm(f.appearanceTime),
      txt(' upang magpaliwanag kung bakit hindi ka dumalo sa pagdinig na nakatakda noong '), blank(monthDay(f.missedHearingDate), 120, 'missedHearingDate'),
      txt(', 20'), blank(missed.yy, 28, 'missedHearingDate'),
      txt(', at kung bakit ang iyong kontra reklamo (kung mayroon man) na may kaugnayan sa kasalukuyang sumbong ay hindi mapawalang-saysay, ang katibayan para hindi maidulog sa hukuman ang iyong kontra reklamo ay hindi ipagkaloob, at hindi ka ipagsakdal sa salang di-tuwirang paghamak ng hukuman dahil sa tahasang hindi pagharap sa Punong Barangay/Pangkat ng Tagapagkasundo.')];
  const notified: Run[] = is18
    ? [txt('Ipinabatid ngayong '), ...ikaDate(f.dateNotified, 'dateNotified'), txt('.')]
    // The official text: "ngayon", not "ngayong ika".
    : [txt('Ipinabatid ngayon '), dayB(f.dateNotified, 'dateNotified'), txt(' ng '), monB(f.dateNotified, 'dateNotified'), txt(', 20'), yyB(f.dateNotified, 'dateNotified'), txt('.')];
  return [[
    ...header(is18 ? 'KP Form No. 18' : 'KP Form 19', typo, true), spacer(10),
    caption({ complainants: comp, respondents: resp, caseNo: sh.caseNo, paraSa: sh.paraSa, typo, highlight: hl,
      complainantLabel: is18 ? '(Mga) Nagsusumbong' : '(Mga) Nagsusumbong,', respondentLabel: '(Mga) Ipinagsusumbong.', paraLabel: is18 ? 'Para:' : 'Para sa:' }),
    spacer(10),
    ...title('PATALASTAS NG PAGDINIG', typo, is18 ? '(Para sa hindi Pagdalo ng nagsusumbong)' : '(Para sa hindi pagdalo ng ipinagsusumbong)'), spacer(8),
    partyLine(effectiveRecipient(id, sh, s.forms), is18 ? '(Mga) Nagsusumbong' : '(Ipinagsusumbong)', typo, { field: 'recipientName', highlight: hl }), spacer(8),
    ...paragraph(body, typo, { highlight: hl }),
    spacer(8), ...paragraph([txt('Ngayong '), ...ikaDate(f.dateIssued, 'dateIssued'), txt('.')], typo, { highlight: hl }),
    signature(effectiveSignatory(sh, f.signatoryName), <ChoiceView opts={ROLE_OPTS} pick={rolePick(f.signatoryRole)} />, typo,
      { field: 'signatoryName', highlight: hl, bold: true, upper: true, note: '(Ekisan ang hindi angkop)', width: 330 }),
    spacer(6), ...paragraph(notified, typo, { highlight: hl }),
    twoColumns([], [], '(Mga) Nagsusumbong', '(Mga) Ipinagsusumbong', typo, { labelsAbove: true }),
  ]];
}

// ── The registry: the specs with their renderers ─────────────────────────────

const RENDER: Record<KpFormId, (c: Ctx) => Block[][]> = {
  KP7: kp7, KP8: kp8, KP9: kp9, KP16: kp16, KP18: c => absence('KP18', c), KP19: c => absence('KP19', c),
};

export interface KpFormEntry extends KpFormSpec { render: (s: KpIntakeState, fonts: KpFonts, highlight?: string | null) => KpDoc }

/** kpForms: the buttons, the inputs and the documents are all generated from these entries. */
export const kpForms: KpFormEntry[] = KP_FORMS.map(spec => ({
  ...spec,
  render: (s, fonts, highlight = null) => {
    const typo = typoFor(spec.font, fonts);
    return { typo, font: spec.font, groups: RENDER[spec.id]({ s, typo, hl: highlight }) };
  },
}));
export const kpFormEntry = (id: KpFormId) => kpForms.find(f => f.id === id)!;
