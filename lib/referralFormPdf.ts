import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ReferralFormKey } from './referralForm';

/**
 * Annex B - Referral Form, laid out as the paper form: the same headings,
 * labels, order and lines. What was recorded is printed on its line; a blank
 * stays a line to fill in by hand. The signature is left for a hand.
 */

export interface ReferralPdfInput {
  caseNumber: string;
  referredAt: Date;
  /** "To:" - the office referred to. */
  to: string;
  reason: string | null;
  form: Record<ReferralFormKey, string>;
  generatedAt: Date;
}

const W = 612, H = 792, ML = 56, MR = W - 56;
const RED = rgb(0.78, 0.13, 0.13), INK = rgb(0, 0, 0), VALUE = rgb(0.05, 0.12, 0.35), GRAY = rgb(0.45, 0.45, 0.45);
const SIZE = 10.5, VSIZE = 10.5, ROW = 22.5;
const fmtDate = (d: Date) => d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });

export async function buildReferralFormPdf(input: ReferralPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Referral Form - ${input.caseNumber}`);
  pdf.setSubject('Annex B - Referral Form');
  pdf.setProducer('SafeComm');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([W, H]);
  const f = input.form;

  // Only characters the standard font can print; anything else becomes "?".
  const clean = (s: string) => [...s.replace(/\s+/g, ' ')].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');

  let y = H - 58;
  const centered = (s: string, fnt: PDFFont, size: number, color = INK) => {
    page.drawText(s, { x: (W - fnt.widthOfTextAtSize(s, size)) / 2, y, size, font: fnt, color });
  };
  centered('ANNEX B', font, 11, RED);
  y -= 20;
  centered('REFERRAL FORM', font, 11);
  y -= 42;

  /**
   * One "Label ______" on the current row, from x to end: the value printed
   * on the line, shrunk to fit and cut with "..." if it still does not.
   */
  const field = (pg: PDFPage, x: number, label: string, value: string, end: number) => {
    pg.drawText(label, { x, y, size: SIZE, font, color: INK });
    const start = x + font.widthOfTextAtSize(label, SIZE) + 4;
    pg.drawLine({ start: { x: start, y: y - 2.5 }, end: { x: end, y: y - 2.5 }, thickness: 0.6, color: INK });
    let v = clean(value.trim());
    if (!v) return;
    const room = end - start - 6;
    let size = VSIZE;
    while (size > 7 && font.widthOfTextAtSize(v, size) > room) size -= 0.5;
    if (font.widthOfTextAtSize(v, size) > room) {
      while (v.length > 1 && font.widthOfTextAtSize(`${v}...`, size) > room) v = v.slice(0, -1);
      v = `${v.trimEnd()}...`;
    }
    pg.drawText(v, { x: start + 3, y: y + 0.5, size, font, color: VALUE });
  };
  /** A label whose value may run to more lines: each continuation on its own full-width line. */
  const longField = (label: string, value: string, minLines = 1, maxLines = 4) => {
    const start = ML + font.widthOfTextAtSize(label, SIZE) + 4;
    const lines: string[] = [];
    let line = '';
    let width = MR - start - 6;
    for (const word of clean(value.trim()).split(' ').filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, VSIZE) <= width) { line = t; continue; }
      if (line) lines.push(line);
      line = word;
      width = MR - ML - 6;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}...`; }
    while (lines.length < minLines) lines.push('');
    lines.forEach((l, i) => {
      if (i === 0) {
        page.drawText(label, { x: ML, y, size: SIZE, font, color: INK });
        page.drawLine({ start: { x: start, y: y - 2.5 }, end: { x: MR, y: y - 2.5 }, thickness: 0.6, color: INK });
        if (l) page.drawText(l, { x: start + 3, y: y + 0.5, size: VSIZE, font, color: VALUE });
      } else {
        page.drawLine({ start: { x: ML, y: y - 2.5 }, end: { x: MR, y: y - 2.5 }, thickness: 0.6, color: INK });
        if (l) page.drawText(l, { x: ML + 3, y: y + 0.5, size: VSIZE, font, color: VALUE });
      }
      y -= ROW;
    });
  };
  const text = (s: string) => { page.drawText(s, { x: ML, y, size: SIZE, font, color: INK }); y -= ROW; };
  const mid = ML + (MR - ML) * 0.55;

  // The receiving office
  field(page, ML, 'Case No.', input.caseNumber, ML + 150);
  field(page, mid - 20, 'Date of Referral', fmtDate(input.referredAt), MR);
  y -= ROW;
  field(page, ML, 'To:', input.to, MR); y -= ROW;
  field(page, ML, 'Address', f.toAddress, MR); y -= ROW;
  field(page, ML, 'Contact Person', f.toContactPerson, MR); y -= ROW;

  // The client
  field(page, ML, 'Name of Client', f.clientName, MR); y -= ROW;
  field(page, ML, 'Age', f.clientAge, ML + 70);
  field(page, ML + 78, 'Sex', f.clientSex, ML + 160);
  field(page, ML + 168, 'Address', f.clientAddress, MR); y -= ROW;
  field(page, ML, 'Name of Family/Guardian', f.guardianName, mid + 40);
  field(page, mid + 48, 'Contact No.', f.guardianContact, MR); y -= ROW;
  y -= ROW * 0.6;
  field(page, ML, 'Address', f.guardianAddress, MR); y -= ROW;

  // Why, and what is asked
  longField('Reason/s for Referral', input.reason ?? '', 1, 3);
  longField('Specific Service/s Requested', f.servicesRequested, 1, 3);
  text('Please refer to attached report/ intake form/case summary for more information.');

  // The referring party, for the feedback
  text('Feedback requested and send to Referring Party/Agency:');
  // The party's name on its own full line, as on the form.
  if (f.feedbackTo.trim()) page.drawText(clean(f.feedbackTo.trim()).slice(0, 110), { x: ML + 3, y: y + 0.5, size: VSIZE, font, color: VALUE });
  page.drawLine({ start: { x: ML, y: y - 2.5 }, end: { x: MR, y: y - 2.5 }, thickness: 0.6, color: INK });
  y -= ROW * 1.6;
  field(page, ML, 'Address', f.feedbackAddress, MR); y -= ROW;
  field(page, ML, 'Cell Phone No.', f.feedbackCellPhone, mid - 10);
  field(page, mid, 'Landline No.', f.feedbackLandline, MR); y -= ROW;
  field(page, ML, 'Email address:', f.feedbackEmail, mid - 10);
  field(page, mid, 'Fax No.', f.feedbackFax, MR); y -= ROW;
  field(page, ML, 'Contact Person', f.feedbackContact, MR); y -= ROW;

  // Referred by - signed by hand over the printed name
  text('Referred by:');
  y -= ROW * 0.8;
  const sigEnd = ML + 200, desStart = sigEnd + 30, desEnd = desStart + 150;
  const printed = clean(f.referredByName.trim()), designation = clean(f.referredByDesignation.trim());
  const fit = (s: string, room: number) => { let size = VSIZE; while (size > 7 && font.widthOfTextAtSize(s, size) > room) size -= 0.5; return size; };
  if (printed) { const sz = fit(printed, sigEnd - ML); page.drawText(printed, { x: ML + (sigEnd - ML - font.widthOfTextAtSize(printed, sz)) / 2, y: y + 1, size: sz, font, color: VALUE }); }
  if (designation) { const sz = fit(designation, desEnd - desStart); page.drawText(designation, { x: desStart + (desEnd - desStart - font.widthOfTextAtSize(designation, sz)) / 2, y: y + 1, size: sz, font, color: VALUE }); }
  page.drawLine({ start: { x: ML, y: y - 3 }, end: { x: sigEnd, y: y - 3 }, thickness: 0.6, color: INK });
  page.drawLine({ start: { x: desStart, y: y - 3 }, end: { x: desEnd, y: y - 3 }, thickness: 0.6, color: INK });
  y -= ROW;
  const cap1 = 'Signature over Printed Name', cap2 = 'Designation';
  page.drawText(cap1, { x: ML + (sigEnd - ML - font.widthOfTextAtSize(cap1, SIZE)) / 2, y: y + 4, size: SIZE, font, color: INK });
  page.drawText(cap2, { x: desStart + (desEnd - desStart - font.widthOfTextAtSize(cap2, SIZE)) / 2, y: y + 4, size: SIZE, font, color: INK });

  // A small reference line, so a printed copy can be traced back to the case.
  const foot = clean(`Prepared in SafeComm for case ${input.caseNumber} on ${fmtDate(input.generatedAt)}. Confidential - for the receiving office only.`);
  page.drawText(foot, { x: (W - font.widthOfTextAtSize(foot, 7.5)) / 2, y: 30, size: 7.5, font, color: GRAY });
  return pdf.save();
}
