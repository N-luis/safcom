import 'server-only';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  INTAKE_SECTIONS, MARKER_LABEL, appliesTo, optionsOf, type Answer, type Item, type Option, type Responses,
} from './officialIntakeForm';

/**
 * The intake as a PDF laid out like the source form ("INTAKE FORM -
 * CONFIDENTIAL"): the instructions, sections A-D with their item numbers, a
 * box for every option with the chosen ones ticked, the client code and
 * incident number on every page after the first, the Data Privacy Act
 * reminder, and the signature lines. The safety check SafeComm adds is
 * printed as an annex, marked as not part of the form. A draft carries a
 * DRAFT watermark.
 *
 * Built on the server from the saved intake only, so it can be served only
 * after the same access check as the intake itself, and logged.
 */

const W = 612, H = 792, M = 40;
const CW = W - 2 * M;
const LABEL_W = 150;
const BOTTOM = 70;
const BLACK = rgb(0, 0, 0), GRAY = rgb(0.35, 0.35, 0.35), LIGHT = rgb(0.93, 0.93, 0.93), BAR = rgb(0.84, 0.84, 0.84);
const RED = rgb(0.8, 0.1, 0.1), YELLOW = rgb(1, 0.95, 0.45);

const INSTRUCTIONS = [
  'Authorized personnel must fill out this form. Do not leave any fields blank. Write N/A for items that are not applicable.',
  'Please check the option "Others" and use the space provided for answers that are not found in the selection.',
  'Unless otherwise specified, always mark only one response field for each question.',
  'Before beginning the interview, please be sure to remind your client that all information given will be kept confidential, and that they may choose to decline to answer any of the following questions.',
  'Please feel free to add as many questions to this form as needed in your context but do not remove any.',
  'For more information on how to fill out this form, please refer to the attached instructions in the user guide.',
];
const PRIVACY = 'Reminder: Unauthorized use of the forms may be subject to penalties as provided for by the provisions of the Data Privacy Act of 2012';

export interface PdfInput {
  caseNumber: string;
  status: 'DRAFT' | 'COMPLETED';
  version: number;
  responses: Responses;
  exportedBy: string;
  exportedAt: Date;
  completedBy: string | null;
  completedAt: Date | null;
}

export async function buildIntakePdf(input: PdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Intake Form - ${input.caseNumber}`);
  pdf.setSubject('CONFIDENTIAL');
  pdf.setProducer('SafeComm');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const r = input.responses;
  const clientCode = text(r.clientCode) || '';
  const incidentNo = text(r.incidentNo) || input.caseNumber;

  // Only characters the standard fonts can print; anything else becomes "?".
  const okChar = new Map<string, boolean>();
  const clean = (s: string) => [...s.replace(/\t/g, '  ').replace(/\r/g, '')].map(ch => {
    if (ch === '\n') return ch;
    if (!okChar.has(ch)) { try { font.encodeText(ch); okChar.set(ch, true); } catch { okChar.set(ch, false); } }
    return okChar.get(ch) ? ch : '?';
  }).join('');

  const wrap = (s: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
        if (line) out.push(line);
        // A single word longer than the line is broken where it must be.
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

  // ── Pages ──
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];
  const header = (first: boolean) => {
    page.drawText('INTAKE FORM', { x: M, y: H - M - 14, size: 14, font: bold, color: BLACK });
    const cw = bold.widthOfTextAtSize('CONFIDENTIAL', 13) + 16;
    page.drawRectangle({ x: W - M - cw, y: H - M - 20, width: cw, height: 22, color: YELLOW });
    page.drawText('CONFIDENTIAL', { x: W - M - cw + 8, y: H - M - 14, size: 13, font: bold, color: BLACK });
    if (first) {
      page.drawLine({ start: { x: M, y: H - M - 28 }, end: { x: W - M, y: H - M - 28 }, thickness: 1.5, color: BLACK });
      y = H - M - 40;
    } else {
      // "1. Client Code / 2. Incident No" box, as on pages 2-5 of the form.
      const bw = 250, bx = W - M - bw, by = H - M - 50;
      page.drawRectangle({ x: bx, y: by, width: bw, height: 22, borderColor: BLACK, borderWidth: 0.7 });
      page.drawLine({ start: { x: bx + bw / 2, y: by }, end: { x: bx + bw / 2, y: by + 22 }, thickness: 0.7, color: BLACK });
      page.drawText(clean(`1. Client Code: ${clientCode}`).slice(0, 40), { x: bx + 4, y: by + 8, size: 7.5, font: bold });
      page.drawText(clean(`2. Incident No: ${incidentNo}`).slice(0, 40), { x: bx + bw / 2 + 4, y: by + 8, size: 7.5, font: bold });
      y = by - 12;
    }
  };
  /**
   * A draft's watermark goes on each page FIRST, so everything after it is
   * drawn on top: it can never grey out an answer. (It used to be added
   * last, over the form, and covered words such as "Filipino".) A completed
   * intake has none.
   */
  const watermark = (p: PDFPage) => {
    if (input.status !== 'DRAFT') return;
    const size = 120;
    const tw = bold.widthOfTextAtSize('DRAFT', size);
    const angle = 35 * Math.PI / 180;
    // Centred on the page along its diagonal.
    p.drawText('DRAFT', {
      x: W / 2 - (tw / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle),
      y: H / 2 - (tw / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle),
      size, font: bold, color: rgb(0.93, 0.93, 0.93), rotate: degrees(35),
    });
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    watermark(page);
    header(false);
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  watermark(page);
  header(true);
  // A draft says so at the top, in words, not only in the watermark.
  if (input.status === 'DRAFT') {
    page.drawText('DRAFT - this intake has not been completed. Some items may still be unanswered.', { x: M, y: y + 2, size: 8, font: bold, color: RED });
    y -= 12;
  }

  // ── Instructions box ──
  {
    const lines = INSTRUCTIONS.flatMap((t, i) => wrap(t, font, 7.5, CW - 30).map((l, j) => ({ l, bullet: j === 0, red: i === 0 && j === 0 })));
    const h = 18 + lines.length * 9.5 + 6;
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: rgb(0.96, 0.96, 0.96), borderColor: GRAY, borderWidth: 0.7 });
    page.drawText('INSTRUCTIONS', { x: M + 8, y: y - 13, size: 8.5, font: bold });
    let ly = y - 25;
    for (const { l, bullet, red } of lines) {
      if (bullet) page.drawText('-', { x: M + 12, y: ly, size: 7.5, font: bold });
      page.drawText(l, { x: M + 22, y: ly, size: 7.5, font: red ? bold : font, color: red ? RED : BLACK });
      ly -= 9.5;
    }
    y -= h + 12;
  }

  // ── Drawing pieces ──
  const sectionBar = (title: string) => {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 16, color: BAR, borderColor: BLACK, borderWidth: 0.7 });
    const tw = bold.widthOfTextAtSize(clean(title), 9);
    page.drawText(clean(title), { x: M + (CW - tw) / 2, y: y - 11.5, size: 9, font: bold });
    y -= 16;
  };

  /** A boxed option, ticked when chosen. Returns the width it took. */
  const box = (x: number, by: number, checked: boolean) => {
    page.drawRectangle({ x, y: by, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.6 });
    if (checked) {
      page.drawLine({ start: { x: x + 1, y: by + 1 }, end: { x: x + 6, y: by + 6 }, thickness: 1, color: BLACK });
      page.drawLine({ start: { x: x + 1, y: by + 6 }, end: { x: x + 6, y: by + 1 }, thickness: 1, color: BLACK });
    }
  };

  type Line = { tokens: { text: string; f: PDFFont; size: number; box?: boolean; checked?: boolean; color?: ReturnType<typeof rgb> }[] };
  const LH = 10.5;

  /** The value cell's content as lines of tokens, laid out to `width`. */
  const contentFor = (item: Item, a: Answer | undefined, width: number): Line[] => {
    const lines: Line[] = [];
    const plain = (s: string, f = font, size = 8.5, color?: ReturnType<typeof rgb>) =>
      wrap(s, f, size, width).forEach(l => lines.push({ tokens: [{ text: l, f, size, color }] }));
    if (a?.marker) { plain(MARKER_LABEL[a.marker], italic); return lines; }
    const options = (opts: Option[], chosen: Set<string>) => {
      let line: Line = { tokens: [] }; let used = 0;
      for (const op of opts) {
        const spec = op.specify ? a?.specify?.[op.value] : undefined;
        const label = clean(`${op.label}${spec ? `: ${spec}` : ''}`);
        const lw = font.widthOfTextAtSize(label, 8) + 12;
        if (lw > width) {
          // A long option gets its own lines.
          if (line.tokens.length) { lines.push(line); line = { tokens: [] }; used = 0; }
          const parts = wrap(label, font, 8, width - 12);
          parts.forEach((p, i) => lines.push({ tokens: [{ text: p, f: font, size: 8, box: i === 0, checked: chosen.has(op.value) }] }));
          continue;
        }
        if (used + lw > width && line.tokens.length) { lines.push(line); line = { tokens: [] }; used = 0; }
        line.tokens.push({ text: label, f: font, size: 8, box: true, checked: chosen.has(op.value) });
        used += lw + 8;
      }
      if (line.tokens.length) lines.push(line);
    };
    const v = a?.value;
    switch (item.type) {
      case 'single': options(optionsOf(item), new Set(typeof v === 'string' ? [v] : [])); break;
      case 'multi':
        for (const g of item.groups ?? []) {
          lines.push({ tokens: [{ text: clean(g.title), f: bold, size: 8 }] });
          options(g.options, new Set(Array.isArray(v) ? v : []));
        }
        break;
      case 'yesNoSpecify':
        options([{ value: 'no', label: 'No' }, { value: 'yes', label: item.yesLabel ?? 'Yes, specify' }],
          new Set(typeof v === 'string' ? [v] : []));
        if (v === 'yes' && a?.specify?.yes) plain(a.specify.yes);
        break;
      case 'yesNoDetail':
        options([{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], new Set(typeof v === 'string' ? [v] : []));
        lines.push({ tokens: [{ text: 'If yes:', f: italic, size: 8 }] });
        options(item.detailOptions ?? [], new Set(v === 'yes' && a?.detail ? [a.detail] : []));
        break;
      case 'confirm':
        options([{ value: 'yes', label: 'Confirmed' }], new Set(v === 'yes' ? ['yes'] : []));
        break;
      case 'name': case 'address': case 'place': case 'location': {
        const parts = item.parts ?? [];
        const obj = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, string>;
        if (a?.homeless) lines.push({ tokens: [{ text: 'Homeless', f: font, size: 8, box: true, checked: true }] });
        // Sub-field captions, then the values under them, in columns.
        const colW = width / parts.length;
        const vals = parts.map(p => wrap(obj[p.key] ?? '', font, 8.5, colW - 4));
        // Captions shrink to fit their column ("Others (alias, nickname, etc)").
        const caption = (s: string) => {
          let size = 6.5;
          while (size > 5 && italic.widthOfTextAtSize(clean(s), size) > colW - 4) size -= 0.25;
          return { text: wrap(s, italic, size, colW - 4)[0], f: italic, size, color: GRAY };
        };
        lines.push({ tokens: parts.map(p => caption(p.label)) });
        const n = Math.max(1, ...vals.map(x => x.length));
        for (let i = 0; i < n; i++) lines.push({ tokens: parts.map((_, j) => ({ text: vals[j][i] ?? '', f: font, size: 8.5 })) });
        (lines as (Line & { columns?: number })[]).slice(-n - 1).forEach(l => { (l as Line & { columns?: number }).columns = parts.length; });
        break;
      }
      case 'date': {
        const s = typeof v === 'string' ? v : '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        plain(m ? `${m[2]}/${m[3]}/${m[1]}` : s); // mm/dd/yyyy, as the form asks
        break;
      }
      default: plain(typeof v === 'string' ? v : '');
    }
    return lines.length ? lines : [{ tokens: [{ text: '', f: font, size: 8.5 }] }];
  };

  /** One numbered row: label cell on the left, the answer on the right. Splits across pages if it must. */
  const row = (label: string, item: Item, a: Answer | undefined) => {
    const labelLines = wrap(label, bold, 8, LABEL_W - 8);
    let content = contentFor(item, a, CW - LABEL_W - 10) as (Line & { columns?: number })[];
    let first = true;
    while (content.length || first) {
      const room = Math.floor((y - BOTTOM - 8) / LH);
      if (room < Math.min(3, Math.max(labelLines.length, content.length))) { newPage(); continue; }
      const take = content.slice(0, room);
      const rows = Math.max(first ? labelLines.length : 1, take.length);
      const h = rows * LH + 7;
      page.drawRectangle({ x: M, y: y - h, width: LABEL_W, height: h, color: LIGHT, borderColor: BLACK, borderWidth: 0.6 });
      page.drawRectangle({ x: M + LABEL_W, y: y - h, width: CW - LABEL_W, height: h, borderColor: BLACK, borderWidth: 0.6 });
      (first ? labelLines : ['(continued)']).forEach((l, i) =>
        page.drawText(l, { x: M + 4, y: y - 10 - i * LH, size: 8, font: first ? bold : italic }));
      take.forEach((ln, i) => {
        let x = M + LABEL_W + 5;
        const ty = y - 10 - i * LH;
        const colW = ln.columns ? (CW - LABEL_W - 10) / ln.columns : 0;
        ln.tokens.forEach((t, j) => {
          if (ln.columns) x = M + LABEL_W + 5 + j * colW;
          if (t.box) { box(x, ty - 1, Boolean(t.checked)); x += 11; }
          if (t.text) page.drawText(t.text, { x, y: ty, size: t.size, font: t.f, color: t.color ?? BLACK });
          if (!ln.columns) x += t.f.widthOfTextAtSize(t.text, t.size) + 9;
        });
      });
      y -= h;
      content = content.slice(take.length);
      first = false;
    }
  };

  // ── Sections A-D ──
  const official = INTAKE_SECTIONS.filter(s => !s.proposed);
  for (const s of official) {
    y -= 8;
    sectionBar(s.title.toUpperCase());
    for (const it of s.items) {
      if (it.key.startsWith('signature')) continue;
      if (appliesTo(it, r) === 'hidden' && !r[it.key]) continue;
      row(`${it.no ? `${it.no}. ` : ''}${it.label}`, it, r[it.key]);
    }
  }

  // ── Signatures, as at the end of the form ──
  ensure(70);
  y -= 40;
  const sig = (x: number, caption: string, signed: boolean) => {
    page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: BLACK });
    wrap(caption, bold, 7.5, 220).forEach((l, i) => {
      const tw = bold.widthOfTextAtSize(l, 7.5);
      page.drawText(l, { x: x + (220 - tw) / 2, y: y - 10 - i * 9, size: 7.5, font: bold });
    });
    if (signed) page.drawText('(signed on the paper form)', { x: x + 50, y: y + 4, size: 7, font: italic, color: GRAY });
  };
  sig(M + 10, '(Signature over printed name of the victim, parent, or guardian)', r.signatureClient?.value === 'yes');
  sig(W - M - 230, '(Signature over printed name of the intake officer)', r.signatureOfficer?.value === 'yes');
  y -= 30;

  // ── Annex: SafeComm's safety check (not part of the form) ──
  const annex = INTAKE_SECTIONS.find(s => s.proposed);
  if (annex && annex.items.some(i => r[i.key])) {
    y -= 10;
    sectionBar('ANNEX - SAFETY AND CONSENT CHECK (SafeComm addition, not part of the official form)');
    for (const it of annex.items) row(it.label, it, r[it.key]);
  }

  // ── Every page: watermark, footer, page numbers ──
  const stamp = `SafeComm export - Case #${input.caseNumber} - ${input.status === 'COMPLETED' ? `completed${input.completedBy ? ` by ${input.completedBy}` : ''}` : 'DRAFT, not completed'} - version ${input.version} - exported by ${input.exportedBy} on ${input.exportedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}`;
  pages.forEach((p, i) => {
    wrap(PRIVACY, bold, 6.5, CW - 70).forEach((l, j) => p.drawText(l, { x: M, y: 40 - j * 8, size: 6.5, font: bold, color: RED }));
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 50, y: 40, size: 8, font });
    wrap(stamp, font, 6, CW).forEach((l, j) => p.drawText(l, { x: M, y: 22 - j * 7, size: 6, font, color: GRAY }));
  });

  return pdf.save();
}

function text(a: Answer | undefined): string {
  return typeof a?.value === 'string' ? a.value : '';
}
