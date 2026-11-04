import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { dayOf, KP_FORM7_NOTICE, type KpForm7Content } from './kpForm7';

/**
 * KP Form No. 7 as a PDF, laid out as in the Katarungang Pambarangay
 * Handbook: the Lupon heading, the parties, the case number and subject, the
 * complaint, the relief prayed for, and the signature and filing lines. A
 * long complaint continues onto the next page.
 */

const W = 612, H = 792, M = 64;
const CW = W - 2 * M;
const BLACK = rgb(0, 0, 0), GRAY = rgb(0.4, 0.4, 0.4);

export async function buildKpForm7Pdf(k: KpForm7Content, opts: { draft: boolean }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`KP Form No. 7 - Complainant's Form - ${k.caseNo}`);
  pdf.setProducer('SafeComm');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const clean = (s: string) => [...s.replace(/\t/g, '  ').replace(/\r/g, '')].map(ch => { if (ch === '\n') return ch; try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const wrap = (s: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const t = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(t, size) <= width) { line = t; continue; }
        if (line) out.push(line);
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut)); w = w.slice(cut);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };

  let page: PDFPage = pdf.addPage([W, H]);
  const pages = [page];
  let y = H - M;
  const mark = (p: PDFPage) => {
    if (!opts.draft) return;
    p.drawText('DRAFT', { x: 150, y: 300, size: 110, font: bold, color: rgb(0.92, 0.92, 0.92), rotate: degrees(35) });
  };
  mark(page);
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); mark(page); y = H - M; };
  const ensure = (h: number) => { if (y - h < 90) newPage(); };
  const center = (s: string, f: PDFFont, size: number) => {
    const t = clean(s); page.drawText(t, { x: (W - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color: BLACK }); y -= size + 5;
  };
  const blank = (s: string, width = 150) => s || '_'.repeat(Math.round(width / 5));

  center('Republic of the Philippines', font, 11);
  center(`Province of ${blank(k.province, 110)}`, font, 11);
  center(`CITY/MUNICIPALITY OF ${blank(k.municipality.toUpperCase(), 120)}`, font, 11);
  center(`Barangay ${blank(k.barangay, 110)}`, font, 11);
  y -= 6;
  center('OFFICE OF THE LUPONG TAGAPAMAYAPA', bold, 12);
  y -= 16;

  // The parties on the left; the case number and subject on the right, as on the form.
  const leftW = CW * 0.48, rightX = M + CW * 0.55, rightW = CW * 0.45;
  const top = y;
  const partyBlock = (names: string[], caption: string) => {
    for (const n of names.length ? names : ['']) {
      for (const l of wrap(n || '_'.repeat(28), font, 11, leftW)) { ensure(16); page.drawText(l, { x: M, y, size: 11, font }); y -= 15; }
    }
    page.drawText(caption, { x: M, y, size: 11, font: italic }); y -= 22;
  };
  partyBlock(k.complainants, 'Complainant/s');
  page.drawText('- against -', { x: M + 40, y, size: 11, font }); y -= 22;
  partyBlock(k.respondents, 'Respondent/s');
  let ry = top;
  page.drawText(clean(`Barangay Case No. ${blank(k.caseNo, 100)}`), { x: rightX, y: ry, size: 11, font }); ry -= 18;
  wrap(`For: ${blank(k.nature, 120)}`, font, 11, rightW).forEach(l => { page.drawText(l, { x: rightX, y: ry, size: 11, font }); ry -= 15; });
  y = Math.min(y, ry) - 12;

  ensure(40);
  center('C O M P L A I N T', bold, 13);
  y -= 8;
  const para = (s: string, indent = 0) => {
    for (const l of wrap(s, font, 11.5, CW - indent)) { ensure(16); page.drawText(l, { x: M + indent, y, size: 11.5, font }); y -= 16; }
  };
  const answer = (s: string) => {
    if (!s) { for (let i = 0; i < 4; i++) { ensure(18); page.drawLine({ start: { x: M, y: y - 2 }, end: { x: W - M, y: y - 2 }, thickness: 0.5, color: GRAY }); y -= 18; } return; }
    for (const l of wrap(s, font, 11.5, CW - 20)) { ensure(16); page.drawText(l, { x: M + 20, y, size: 11.5, font }); y -= 16; }
  };
  para('I/WE hereby complain against above named respondent/s for violating my/our rights and interests in the following manner:', 30);
  y -= 4; answer(k.complaint); y -= 10;
  para('THEREFORE, I/WE pray that the following relief/s be granted to me/us in accordance with law and/or equity:', 30);
  y -= 4; answer(k.relief); y -= 18;

  ensure(150);
  const made = k.madeOn ? dayOf(k.madeOn) : null;
  para(`Made this ${made?.day ?? '________'} day of ${made?.monthYear ?? '______________, 20____'}.`, 30);
  y -= 26;
  page.drawLine({ start: { x: W - M - 200, y }, end: { x: W - M, y }, thickness: 0.7, color: BLACK }); y -= 13;
  page.drawText('Complainant/s', { x: W - M - 140, y, size: 10.5, font: italic }); y -= 30;
  para('Received and filed this ________ day of ______________, 20____.', 30);
  y -= 26;
  page.drawLine({ start: { x: W - M - 200, y }, end: { x: W - M, y }, thickness: 0.7, color: BLACK }); y -= 13;
  page.drawText('Punong Barangay/Lupon Chairman', { x: W - M - 175, y, size: 10.5, font: italic });

  pages.forEach((p, i) => {
    p.drawText('KP Form No. 7 - Complainant\'s Form', { x: M, y: H - 34, size: 8, font: italic, color: GRAY });
    wrap(KP_FORM7_NOTICE, font, 7.5, CW - 60).forEach((l, j) => p.drawText(l, { x: M, y: 46 - j * 9, size: 7.5, font, color: GRAY }));
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 50, y: 46, size: 8, font });
  });
  return pdf.save();
}
