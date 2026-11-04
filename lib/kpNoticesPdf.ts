import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { dayOf } from './kpForm7';
import { phDay, phTime, KP_FORMS, type KpFormNo, type NoticeRecipient } from './hearings';

/**
 * KP Forms No. 8 to 12 as PDFs, worded and laid out as in the annexes of the
 * DILG Katarungang Pambarangay Handbook:
 *
 *    8  Notice of Hearing (Mediation Proceedings)   - to the complainant
 *    9  Summons, with the Officer's Return overleaf  - to the respondent
 *   10  Notice for Constitution of Pangkat          - to both parties
 *   11  Notice to Chosen Pangkat Member             - to each member
 *   12  Notice of Hearing (Conciliation Proceedings) - to both parties
 *
 * The blanks are filled from the proceeding (its date and time) and the case
 * (its number, nature and parties). The signature and "notified" lines are
 * left for the Punong Barangay, Pangkat Chairman and recipients to sign; the
 * one thing the handbook form does not have - the venue, the SafeComm notice
 * number and who prepared it - sits in a separate strip under the form.
 * A notice not yet issued, or replaced by a new date, says so across the page.
 */

export interface KpNoticeInput {
  formNo: KpFormNo;
  noticeNumber: string | null;
  caseNumber: string;
  /** "For: ..." - the nature of the dispute. */
  nature: string;
  complainants: string[];
  respondents: string[];
  /** Who this copy is for (KP 11: the Pangkat member). */
  recipient: string;
  recipientRole: NoticeRecipient;
  hearingReference: string;
  scheduledAt: Date;
  venue: string | null;
  /** "This ... day of ...": when the notice was made. */
  datedAt: Date | null;
  /** Printed above the signature line, when known (KP 12: the Pangkat chairman). */
  signatoryName: string | null;
  preparedBy: string | null;
  barangay: string;
  municipality: string;
  province: string;
  /** PREVIEW (nothing stored) | GENERATED (stored, not issued) | ISSUED | SUPERSEDED */
  state: 'PREVIEW' | 'GENERATED' | 'ISSUED' | 'SUPERSEDED';
}

const W = 612, H = 792, M = 64;
const CW = W - 2 * M;
const BLACK = rgb(0, 0, 0), GRAY = rgb(0.4, 0.4, 0.4);

/** "9:30 o'clock in the morning". */
export function clockOf(d: Date) {
  const [h, m] = phTime(d).split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} o'clock in the ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}`;
}
/** "the 4th day of November, 2026". */
export const dayText = (d: Date) => { const x = dayOf(phDay(d)); return `the ${x.day} day of ${x.monthYear}`; };

/** What the form says, in the handbook's words, with its blanks filled. */
export function kpNoticeBody(n: Pick<KpNoticeInput, 'formNo' | 'scheduledAt'>): string[] {
  const when = `on ${dayText(n.scheduledAt)} at ${clockOf(n.scheduledAt)}`;
  switch (n.formNo) {
    case 8: return [`You are hereby required to appear before me ${when} for the hearing of your complaint.`];
    case 9: return [
      `You are hereby summoned to appear before me in person, together with your witnesses, ${when}, then and there to answer to a complaint made before me, copy of which is attached hereto, for mediation/conciliation of your dispute with complainant/s.`,
      'You are hereby warned that if you refuse or willfully fail to appear in obedience to this summons, you may be barred from filing any counterclaim arising from said complaint.',
      'FAIL NOT or else face punishment as for contempt of court.',
    ];
    case 10: return [`You are hereby required to appear before me ${when} for the constitution of the Pangkat ng Tagapagkasundo which shall conciliate your dispute. Should you fail to agree on the Pangkat membership or to appear on the aforesaid date for the constitution of the Pangkat, I shall determine the membership thereof by drawing lots.`];
    case 11: return ['Notice is hereby given that you have been chosen member of the Pangkat ng Tagapagkasundo to amicably conciliate the dispute between the parties in the above-entitled case.'];
    case 12: return [`You are hereby required to appear before the Pangkat ${when} for a hearing of the above-entitled case.`];
  }
}

const SIGNATORY: Record<KpFormNo, string> = {
  8: 'Punong Barangay/Lupon Chairman', 9: 'Punong Barangay/Pangkat Chairman', 10: 'Punong Barangay',
  11: 'Punong Barangay/Lupon Secretary', 12: 'Pangkat Chairman',
};
const OFFICE: Record<KpFormNo, string> = {
  8: 'OFFICE OF THE LUPONG TAGAPAMAYAPA', 9: 'OFFICE OF THE LUPONG TAGAPAMAYAPA', 10: 'OFFICE OF THE PUNONG BARANGAY',
  11: 'OFFICE OF THE LUPONG TAGAPAMAYAPA', 12: 'OFFICE OF THE PUNONG BARANGAY',
};

export const kpNoticeFooter = (formNo: KpFormNo) =>
  `Prepared in SafeComm following KP Form No. ${formNo}, ${KP_FORMS[formNo].title}, of the Katarungang Pambarangay Handbook. It takes effect when signed by the ${SIGNATORY[formNo]}. It carries no seal.`;

export async function buildKpNoticePdf(n: KpNoticeInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`KP Form No. ${n.formNo} - ${KP_FORMS[n.formNo].title} - ${n.noticeNumber ?? n.hearingReference}`);
  pdf.setProducer('SafeComm');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const clean = (s: string) => [...s.replace(/\r/g, '')].map(ch => { if (ch === '\n') return ch; try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const wrap = (s: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const t = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(t, size) <= width) { line = t; continue; }
        if (line) out.push(line);
        line = word;
      }
      out.push(line);
    }
    return out;
  };

  let page: PDFPage = pdf.addPage([W, H]);
  const pages = [page];
  let y = H - M;
  const text = (s: string, x: number, f: PDFFont = font, size = 11.5, color = BLACK) => page.drawText(clean(s), { x, y, size, font: f, color });
  const center = (s: string, f: PDFFont, size: number) => {
    const t = clean(s); page.drawText(t, { x: (W - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color: BLACK }); y -= size + 5;
  };
  const para = (s: string, indent = 36) => {
    wrap(s, font, 11.5, CW - indent).forEach((l, i) => { page.drawText(l, { x: M + (i === 0 ? indent : 0), y, size: 11.5, font }); y -= 17; });
    y -= 6;
  };
  const signLine = (x: number, width: number, caption: string, name?: string | null) => {
    if (name) page.drawText(clean(name), { x: x + (width - bold.widthOfTextAtSize(clean(name), 11)) / 2, y: y + 4, size: 11, font: bold });
    page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.7, color: BLACK });
    y -= 13;
    page.drawText(caption, { x: x + (width - italic.widthOfTextAtSize(caption, 10.5)) / 2, y, size: 10.5, font: italic });
  };
  const names = (list: string[], fallback: string) => (list.length ? list : [fallback]);

  center('Republic of the Philippines', font, 11);
  center(`Province of ${n.province}`, font, 11);
  center(`CITY/MUNICIPALITY OF ${n.municipality.toUpperCase()}`, font, 11);
  center(`Barangay ${n.barangay}`, font, 11);
  y -= 6;
  center(OFFICE[n.formNo], bold, 12);
  y -= 14;

  // KP 9 and 11 carry the case caption: the parties, the case number and what it is for.
  if (n.formNo === 9 || n.formNo === 11) {
    const leftW = CW * 0.48, rightX = M + CW * 0.55, rightW = CW * 0.45;
    const top = y;
    const block = (list: string[], caption: string) => {
      for (const p of list) for (const l of wrap(p, font, 11, leftW)) { text(l, M, font, 11); y -= 15; }
      text(caption, M, italic, 11); y -= 20;
    };
    block(names(n.complainants, 'The Complainant'), 'Complainant/s');
    text('- against -', M + 40, font, 11); y -= 20;
    block(names(n.respondents, 'The Respondent'), 'Respondent/s');
    let ry = top;
    page.drawText(clean(`Barangay Case No. ${n.caseNumber}`), { x: rightX, y: ry, size: 11, font }); ry -= 17;
    wrap(`For: ${n.nature}`, font, 11, rightW).forEach(l => { page.drawText(l, { x: rightX, y: ry, size: 11, font }); ry -= 15; });
    y = Math.min(y, ry) - 10;
  }

  const title: Record<KpFormNo, string[]> = {
    8: ['NOTICE OF HEARING', '(MEDIATION PROCEEDINGS)'], 9: ['S U M M O N S'], 10: ['NOTICE FOR CONSTITUTION OF PANGKAT'],
    11: ['NOTICE TO CHOSEN PANGKAT MEMBER'], 12: ['NOTICE OF HEARING', '(CONCILIATION PROCEEDINGS)'],
  };
  const addressee = () => {
    if (n.formNo === 10 || n.formNo === 12) {
      // Addressed to both parties, side by side, as on the form.
      const top = y;
      text('TO:', M, bold);
      let ly = top;
      for (const p of names(n.complainants, 'The Complainant')) for (const l of wrap(p, font, 11.5, CW * 0.42)) { page.drawText(l, { x: M + 34, y: ly, size: 11.5, font }); ly -= 15; }
      page.drawText('Complainant/s', { x: M + 34, y: ly, size: 10.5, font: italic }); ly -= 15;
      let ry = top;
      for (const p of names(n.respondents, 'The Respondent')) for (const l of wrap(p, font, 11.5, CW * 0.42)) { page.drawText(l, { x: M + CW * 0.55, y: ry, size: 11.5, font }); ry -= 15; }
      page.drawText('Respondent/s', { x: M + CW * 0.55, y: ry, size: 10.5, font: italic }); ry -= 15;
      y = Math.min(ly, ry) - 12;
    } else {
      text('TO:', M, bold);
      const list = n.formNo === 8 ? names(n.complainants, 'The Complainant') : n.formNo === 9 ? names(n.respondents, 'The Respondent') : [n.recipient];
      for (const p of list) for (const l of wrap(p, font, 11.5, CW - 40)) { text(l, M + 34); y -= 15; }
      if (n.formNo !== 11) { text(n.formNo === 8 ? 'Complainant/s' : 'Respondent/s', M + 34, italic, 10.5); y -= 15; }
      y -= 12;
    }
  };

  if (n.formNo === 12) { addressee(); title[12].forEach(t => center(t, bold, 13)); y -= 12; }
  else {
    title[n.formNo].forEach(t => center(t, bold, 13));
    if (n.formNo === 11) center(n.datedAt ? n.datedAt.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }) : '(Date)', font, 11);
    y -= 12;
    addressee();
  }

  for (const p of kpNoticeBody(n)) para(p);
  if (n.formNo !== 11) para(`This ${n.datedAt ? dayText(n.datedAt).replace(/^the /, '') : '________ day of ______________, 20____'}.`);
  y -= 24;
  signLine(W - M - 230, 230, SIGNATORY[n.formNo], n.signatoryName);
  y -= 34;

  // The recipients sign that they were notified.
  if (n.formNo === 11) {
    para('Received this ________ day of ______________, 20____.', 0); y -= 22;
    signLine(M, 200, 'Pangkat Member', n.recipient);
  } else if (n.formNo !== 9) {
    para('Notified this ________ day of ______________, 20____.', 0); y -= 22;
    if (n.formNo === 8) signLine(M, 200, 'Complainant/s');
    else { const top = y; signLine(M, 200, 'Complainant/s'); y = top; signLine(W - M - 200, 200, 'Respondent/s'); }
  }

  // KP 9: the officer's return, on the back page.
  if (n.formNo === 9) {
    page = pdf.addPage([W, H]); pages.push(page); y = H - M;
    center('Back page', italic, 10);
    y -= 6;
    center("OFFICER'S RETURN", bold, 13);
    y -= 10;
    para('I served this summons upon respondent ______________________ on the ______ day of ______________, 20____, and upon respondent ______________________ on the ______ day of ______________, 20____, by:', 0);
    para('(Write name/s of respondent/s before mode by which he/they was/were served.)', 0);
    const modes = [
      '1. handing to him/them said summons in person, or',
      '2. handing to him/them said summons and he/they refused to receive it, or',
      '3. leaving said summons at his/their dwelling with ______________ (name) a person of suitable age and discretion residing therein, or',
      '4. leaving said summons at his/their office/place of business with ______________ (name) a competent person in charge thereof.',
    ];
    text('Respondent/s', M, italic, 10.5); y -= 18;
    for (const m of modes) {
      page.drawLine({ start: { x: M, y: y - 2 }, end: { x: M + 170, y: y - 2 }, thickness: 0.5, color: BLACK });
      const ls = wrap(m, font, 11, CW - 190);
      ls.forEach((l, i) => page.drawText(l, { x: M + 190, y: y - i * 15, size: 11, font }));
      y -= 15 * ls.length + 10;
    }
    y -= 20;
    signLine(W - M - 200, 200, 'Officer');
    y -= 36;
    text('Received by Respondent/s representative/s:', M); y -= 34;
    for (let i = 0; i < 2; i++) { const top = y; signLine(M, 190, 'Signature'); y = top; signLine(M + 230, 140, 'Date'); y -= 34; }
  }

  // What SafeComm adds, kept apart from the form.
  const strip = [
    `SafeComm notice no.: ${n.noticeNumber ?? 'assigned when generated'}   Case: ${n.caseNumber}   Proceeding: ${n.hearingReference}`,
    `Venue: ${n.venue || 'Barangay Hall'}${n.preparedBy ? `   Prepared by: ${n.preparedBy}` : ''}`,
  ];
  pages.forEach((p, i) => {
    p.drawText(clean(`KP Form No. ${n.formNo} - ${KP_FORMS[n.formNo].title}`), { x: M, y: H - 34, size: 8, font: italic, color: GRAY });
    p.drawLine({ start: { x: M, y: 92 }, end: { x: W - M, y: 92 }, thickness: 0.4, color: GRAY });
    strip.forEach((s, j) => p.drawText(clean(s), { x: M, y: 80 - j * 11, size: 8.5, font, color: BLACK }));
    wrap(kpNoticeFooter(n.formNo), font, 7.5, CW - 60).forEach((l, j) => p.drawText(l, { x: M, y: 52 - j * 9, size: 7.5, font, color: GRAY }));
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 50, y: 52, size: 8, font });
    if (n.state !== 'ISSUED') {
      const mark = n.state === 'SUPERSEDED' ? 'REPLACED - NEW DATE SET' : 'PREVIEW - NOT ISSUED';
      p.drawText(mark, { x: 110, y: 250, size: 44, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
    }
  });
  return pdf.save();
}
