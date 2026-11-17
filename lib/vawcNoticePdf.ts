import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from 'pdf-lib';
import { clockOf, dayText } from './kpNoticesPdf';
import { VAWC_HEARING_TYPES, isVawcHearingType, type NoticeRecipient } from './hearings';

/**
 * The VAWC Notice of Hearing, for a hearing on a VAWC case (RA 9262). It is
 * not a Katarungang Pambarangay form - a VAWC case is never mediated or
 * conciliated (sec. 33) - so it carries no KP form number, no summons
 * warning and no "contempt" line. Same page, fonts, header, SafeComm strip
 * and watermark as the KP notices (lib/kpNoticesPdf.ts), so it downloads,
 * opens and prints the same way.
 *
 * What it prints: the barangay and the VAWC Desk, the case number, the
 * parties' names, the date, time and venue, the purpose (the hearing type),
 * and the issuing official. Never the complainant's address, contact number,
 * narrative or attachments - the respondent's copy is safe to hand over.
 */

export interface VawcNoticeInput {
  noticeNumber: string | null;
  caseNumber: string;
  /** VAWC_DESK_HEARING | CASE_CONFERENCE | VICTIM_INTERVIEW | FOLLOW_UP */
  hearingType: string;
  complainant: string;
  /** Only when the respondent is a party to this hearing. */
  respondent: string | null;
  recipient: string;
  recipientRole: Exclude<NoticeRecipient, 'PANGKAT_MEMBER'>;
  hearingReference: string;
  scheduledAt: Date;
  venue: string | null;
  datedAt: Date | null;
  /** The official who issues it, printed above the signature line. */
  issuedBy: string | null;
  barangay: string;
  municipality: string;
  province: string;
  state: 'PREVIEW' | 'GENERATED' | 'ISSUED' | 'SUPERSEDED';
}

const W = 612, H = 792, M = 64;
const CW = W - 2 * M;
const BLACK = rgb(0, 0, 0), GRAY = rgb(0.4, 0.4, 0.4);

/** What the notice says, its blanks filled. */
export function vawcNoticeBody(n: Pick<VawcNoticeInput, 'hearingType' | 'scheduledAt' | 'venue' | 'recipientRole'>): string[] {
  const purpose = isVawcHearingType(n.hearingType) ? VAWC_HEARING_TYPES[n.hearingType].label : 'Hearing';
  const where = n.venue || 'the Barangay Hall';
  return [
    `You are hereby requested to appear before the Barangay VAWC Desk on ${dayText(n.scheduledAt)} at ${clockOf(n.scheduledAt)}, at ${where}, for a ${purpose} on the above case.`,
    n.recipientRole === 'RESPONDENT'
      ? 'Please bring a valid ID. If you cannot attend on this date, inform the Barangay VAWC Desk before the date so that a new one may be set.'
      : 'Please bring a valid ID and any documents related to your report. You may bring a support person you trust. If you cannot attend, or it is not safe for you to come, inform the Barangay VAWC Desk so that a new date may be set.',
    'This hearing is not a mediation or conciliation proceeding (RA 9262 sec. 33). This notice and the matters it concerns are confidential (RA 9262 sec. 44).',
  ];
}

export const VAWC_NOTICE_FOOTER = 'Prepared in SafeComm for a hearing on a VAWC case (RA 9262). Not a Katarungang Pambarangay form. It takes effect when signed by the issuing official. It carries no seal. Confidential.';

export async function buildVawcNoticePdf(n: VawcNoticeInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const purpose = isVawcHearingType(n.hearingType) ? VAWC_HEARING_TYPES[n.hearingType].label : 'Hearing';
  pdf.setTitle(`Notice of Hearing - ${n.noticeNumber ?? n.hearingReference}`);
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

  const page = pdf.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, f: PDFFont = font, size = 11.5) => page.drawText(clean(s), { x, y, size, font: f, color: BLACK });
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

  center('Republic of the Philippines', font, 11);
  center(`Province of ${n.province}`, font, 11);
  center(`CITY/MUNICIPALITY OF ${n.municipality.toUpperCase()}`, font, 11);
  center(`Barangay ${n.barangay}`, font, 11);
  y -= 6;
  center('BARANGAY VAWC DESK', bold, 12);
  y -= 14;

  // The case caption: the parties, the case number and the purpose.
  const leftW = CW * 0.5, rightX = M + CW * 0.56, rightW = CW * 0.44;
  const top = y;
  for (const l of wrap(n.complainant, font, 11, leftW)) { text(l, M, font, 11); y -= 15; }
  text('Complainant', M, italic, 11); y -= 20;
  if (n.respondent) {
    text('- and -', M + 40, font, 11); y -= 20;
    for (const l of wrap(n.respondent, font, 11, leftW)) { text(l, M, font, 11); y -= 15; }
    text('Respondent', M, italic, 11); y -= 20;
  }
  let ry = top;
  page.drawText(clean(`VAWC Case No. ${n.caseNumber}`), { x: rightX, y: ry, size: 11, font }); ry -= 17;
  wrap(`Purpose: ${purpose}`, font, 11, rightW).forEach(l => { page.drawText(l, { x: rightX, y: ry, size: 11, font }); ry -= 15; });
  y = Math.min(y, ry) - 10;

  center('NOTICE OF HEARING', bold, 13);
  y -= 12;
  text('TO:', M, bold);
  for (const l of wrap(n.recipient, font, 11.5, CW - 40)) { text(l, M + 34); y -= 15; }
  text(n.recipientRole === 'RESPONDENT' ? 'Respondent' : 'Complainant', M + 34, italic, 10.5); y -= 27;

  for (const p of vawcNoticeBody(n)) para(p);
  para(`Issued this ${n.datedAt ? dayText(n.datedAt).replace(/^the /, '') : '________ day of ______________, 20____'}.`);
  y -= 24;
  signLine(W - M - 230, 230, 'Issuing official, Barangay VAWC Desk', n.issuedBy);
  y -= 34;
  para('Notified this ________ day of ______________, 20____.', 0); y -= 22;
  signLine(M, 200, n.recipientRole === 'RESPONDENT' ? 'Respondent' : 'Complainant');

  const strip = [
    `SafeComm notice no.: ${n.noticeNumber ?? 'assigned when generated'}   Case: ${n.caseNumber}   Hearing: ${n.hearingReference}`,
    `Venue: ${n.venue || 'Barangay Hall'}${n.issuedBy ? `   Issued by: ${n.issuedBy}` : ''}`,
  ];
  page.drawText('Notice of Hearing - VAWC Desk (RA 9262) - Confidential', { x: M, y: H - 34, size: 8, font: italic, color: GRAY });
  page.drawLine({ start: { x: M, y: 92 }, end: { x: W - M, y: 92 }, thickness: 0.4, color: GRAY });
  strip.forEach((s, j) => page.drawText(clean(s), { x: M, y: 80 - j * 11, size: 8.5, font, color: BLACK }));
  wrap(VAWC_NOTICE_FOOTER, font, 7.5, CW - 60).forEach((l, j) => page.drawText(l, { x: M, y: 52 - j * 9, size: 7.5, font, color: GRAY }));
  page.drawText('Page 1 of 1', { x: W - M - 50, y: 52, size: 8, font });
  if (n.state !== 'ISSUED') {
    const mark = n.state === 'SUPERSEDED' ? 'REPLACED - NEW DATE SET' : 'PREVIEW - NOT ISSUED';
    page.drawText(mark, { x: 110, y: 250, size: 44, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
  }
  return pdf.save();
}
