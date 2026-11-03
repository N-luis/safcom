import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from 'pdf-lib';
import { formatHearingDate, formatHearingTime, HEARING_TITLES } from './hearings';

/**
 * A notice of hearing: who is asked to appear, for which hearing on which
 * case, when and where, and who issued it.
 *
 * It carries no narrative, no finding and nothing about the other party - a
 * notice is handed to (or served on) one person and may be read by others in
 * their household. A notice not yet issued, or replaced by a new date, says
 * so across the page.
 */

export interface NoticeInput {
  noticeNumber: string | null;
  caseNumber: string;
  hearingReference: string;
  hearingNumber: number;
  scheduledAt: Date;
  venue: string | null;
  recipient: string;
  recipientRole: 'COMPLAINANT' | 'RESPONDENT';
  issuingOfficer: string | null;
  issuedAt: Date | null;
  barangay: string;
  municipality: string;
  province: string;
  /** The barangay hall's number, from the deployment settings. */
  officeContact: string | null;
  /** PREVIEW (nothing stored) | GENERATED (stored, not issued) | ISSUED | SUPERSEDED */
  state: 'PREVIEW' | 'GENERATED' | 'ISSUED' | 'SUPERSEDED';
}

const W = 612, H = 792, M = 64;
const CW = W - 2 * M;
const NAVY = rgb(0.05, 0.12, 0.27), GRAY = rgb(0.35, 0.35, 0.35);
const fmt = (d: Date) => d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });

export async function buildHearingNoticePdf(input: NoticeInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Notice of Hearing - ${input.noticeNumber ?? input.hearingReference}`);
  pdf.setProducer('SafeComm');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const page = pdf.addPage([W, H]);

  const clean = (s: string) => [...s].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
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
  let y = H - M;
  const center = (s: string, f: PDFFont, size: number, color = NAVY) => {
    const t = clean(s);
    page.drawText(t, { x: (W - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color });
    y -= size + 4;
  };
  const para = (s: string, f: PDFFont = font, size = 11, gap = 10) => {
    for (const l of wrap(s, f, size, CW)) { page.drawText(l, { x: M, y, size, font: f, color: rgb(0, 0, 0) }); y -= size + 5; }
    y -= gap;
  };
  const row = (label: string, value: string) => {
    page.drawText(clean(label), { x: M, y, size: 10.5, font: bold, color: NAVY });
    const lines = wrap(value, font, 10.5, CW - 150);
    lines.forEach((l, i) => page.drawText(l, { x: M + 150, y: y - i * 15, size: 10.5, font, color: rgb(0, 0, 0) }));
    y -= 15 * Math.max(1, lines.length) + 3;
  };

  center('Republic of the Philippines', font, 10, GRAY);
  center(`Province of ${input.province}`, font, 10, GRAY);
  center(`Municipality of ${input.municipality}`, font, 10, GRAY);
  center(`BARANGAY ${input.barangay.toUpperCase()}`, bold, 13);
  center('Office of the Punong Barangay - Lupong Tagapamayapa', font, 9.5, GRAY);
  if (input.officeContact) center(`Barangay Hall: ${input.officeContact}`, font, 9, GRAY);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: NAVY });
  y -= 30;
  center('NOTICE OF HEARING', bold, 15);
  center(`Hearing ${input.hearingNumber} - ${HEARING_TITLES[input.hearingNumber] ?? 'Hearing'}`, font, 10.5, GRAY);
  y -= 16;

  row('Notice No.:', input.noticeNumber ?? 'Assigned when generated');
  row('Case Reference No.:', input.caseNumber);
  row('Hearing Reference:', input.hearingReference);
  row('Date issued:', input.issuedAt ? fmt(input.issuedAt) : 'Not yet issued');
  y -= 10;
  row('To:', `${input.recipient} (${input.recipientRole === 'COMPLAINANT' ? 'Complainant' : 'Respondent'})`);
  row('Date of hearing:', formatHearingDate(input.scheduledAt));
  row('Time:', formatHearingTime(input.scheduledAt));
  row('Venue:', input.venue || 'Barangay Hall');
  y -= 14;

  para(`You are requested to appear in person at the date, time and venue above for Hearing ${input.hearingNumber} of the barangay mediation or conciliation proceedings under the Katarungang Pambarangay, in connection with the matter recorded under the case reference number above.`);
  para('Please bring a valid ID and any documents related to the matter. If you cannot attend, inform the barangay office as early as possible, before the date of the hearing.');
  para('This notice concerns attendance at the hearing only. It is not a finding on the matter and does not decide anyone\'s responsibility.', italic, 10.5, 24);

  y -= 20;
  page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 0.8, color: rgb(0, 0, 0) });
  y -= 14;
  page.drawText(clean(input.issuingOfficer ? `Issuing officer: ${input.issuingOfficer}` : 'Issuing officer'), { x: M, y, size: 10, font, color: rgb(0, 0, 0) });
  y -= 13;
  page.drawText('Signature over printed name', { x: M, y, size: 8.5, font: italic, color: GRAY });
  y -= 40;
  page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 0.8, color: rgb(0, 0, 0) });
  y -= 14;
  page.drawText('Received by (signature and date)', { x: M, y, size: 8.5, font: italic, color: GRAY });

  if (input.state !== 'ISSUED') {
    const mark = input.state === 'SUPERSEDED' ? 'REPLACED - NEW DATE SET' : 'PREVIEW - NOT ISSUED';
    page.drawText(mark, { x: 120, y: 260, size: 44, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(35) });
  }
  const stamp = input.state === 'ISSUED' && input.issuedAt ? `Issued ${fmt(input.issuedAt)} - generated by SafeComm`
    : input.state === 'SUPERSEDED' ? 'Replaced by a notice for a new date - generated by SafeComm'
      : 'Generated by SafeComm - not yet issued';
  page.drawText(clean(stamp), { x: M, y: 36, size: 7.5, font, color: GRAY });
  return pdf.save();
}
