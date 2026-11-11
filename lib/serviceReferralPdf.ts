import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  SERVICE_REFERRAL_TITLE, SERVICE_REFERRAL_INSTRUCTIONS, SERVICE_REFERRAL_DIGITAL_NOTICE, FIELD_LABELS,
  SERVICES, servicesFor, mmddyyyy, ACK_STATUS, CLIENT_SIGNATORY,
  type ServiceReferralForm, type SectionC, type Destination,
} from './serviceReferralForm';

/**
 * The Service Referral Form as a PDF, laid out as the reference document:
 * CONFIDENTIAL, the Client Code / Incident No. box, the instructions, Section
 * A, Section B with both blocks and every service box (ticked when chosen),
 * then - on its own page, as the reference's continuation - Section C and the
 * signature lines. The reference's second page repeats its first; it is not
 * repeated here.
 *
 * Signatures are never drawn: every signature line is left for a hand. Section
 * C is blank on the issued copy - the receiving organization completes it. The
 * record copy prints Section C as SafeComm recorded it, and says so.
 *
 * Deterministic: the same input gives the same bytes (fixed metadata dates),
 * so an issued document can be rebuilt and checked against its stored hash.
 */

export interface ServiceReferralPdfInput {
  reference: string;
  form: ServiceReferralForm;
  /** DRAFT and CANCELLED carry a watermark; ISSUED does not. */
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  /** Section C as recorded, for the record copy. Null prints it blank. */
  sectionC: SectionC | null;
  /** Fixed into the PDF's metadata: the issue time for an issued referral. */
  documentDate: Date;
}

const W = 612, H = 792, M = 46;
const CW = W - 2 * M;
const INK = rgb(0, 0, 0), VALUE = rgb(0.05, 0.12, 0.38), GRAY = rgb(0.4, 0.4, 0.4);
const SHADE = rgb(0.86, 0.86, 0.86), BAR = rgb(0.79, 0.79, 0.79), PANEL = rgb(0.93, 0.93, 0.93), YELLOW = rgb(0.96, 0.92, 0.42);

export async function buildServiceReferralPdf(input: ServiceReferralPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(`Service Referral Form - ${input.reference}`);
  pdf.setSubject('CONFIDENTIAL');
  pdf.setProducer('SafeComm');
  pdf.setCreator('SafeComm');
  pdf.setCreationDate(input.documentDate);
  pdf.setModificationDate(input.documentDate);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const f = input.form;
  const c = input.sectionC;

  // Only characters the standard fonts can print; anything else becomes "?".
  const okChar = new Map<string, boolean>();
  const clean = (s: string) => [...(s ?? '').replace(/\t/g, ' ').replace(/\r/g, '')].map(ch => {
    if (ch === '\n') return ch;
    if (!okChar.has(ch)) { try { font.encodeText(ch); okChar.set(ch, true); } catch { okChar.set(ch, false); } }
    return okChar.get(ch) ? ch : '?';
  }).join('');
  const wrap = (s: string, fnt: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const t = line ? `${line} ${word}` : word;
        if (fnt.widthOfTextAtSize(t, size) <= width) { line = t; continue; }
        if (line) out.push(line);
        let w = word;
        while (fnt.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && fnt.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut)); w = w.slice(cut);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };
  const txt = (p: PDFPage, s: string, x: number, y: number, size: number, fnt: PDFFont = font, color: RGB = INK) =>
    p.drawText(clean(s), { x, y, size, font: fnt, color });
  const box = (p: PDFPage, x: number, top: number, w: number, h: number, fill?: RGB) =>
    p.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: INK, borderWidth: 0.6, ...(fill && { color: fill }) });
  const checkbox = (p: PDFPage, x: number, y: number, on: boolean) => {
    p.drawRectangle({ x, y: y - 1, width: 7.5, height: 7.5, borderColor: INK, borderWidth: 0.6, color: rgb(1, 1, 1) });
    if (on) {
      p.drawLine({ start: { x: x + 1.3, y: y + 2.6 }, end: { x: x + 3.2, y: y + 0.4 }, thickness: 1.1, color: INK });
      p.drawLine({ start: { x: x + 3.2, y: y + 0.4 }, end: { x: x + 6.6, y: y + 5.8 }, thickness: 1.1, color: INK });
    }
  };

  const pages: PDFPage[] = [];
  const watermark = (p: PDFPage) => {
    if (input.status === 'ISSUED') return;
    const word = input.status === 'DRAFT' ? 'DRAFT' : 'CANCELLED';
    const size = word === 'DRAFT' ? 120 : 84;
    // Drawn first, so everything on the page sits on top of it.
    p.drawText(word, { x: W / 2 - bold.widthOfTextAtSize(word, size) / 2 * 0.82, y: H / 2 - 160, size, font: bold,
      color: rgb(0.88, 0.88, 0.88), rotate: degrees(35), opacity: 0.6 });
  };

  /** The header on every page: title, CONFIDENTIAL, and the Client Code / Incident No. box. */
  const header = (p: PDFPage): number => {
    const cw = bold.widthOfTextAtSize('CONFIDENTIAL', 15) + 18;
    p.drawRectangle({ x: W - M - cw, y: H - 62, width: cw, height: 26, color: YELLOW });
    txt(p, 'CONFIDENTIAL', W - M - cw + 9, H - 54, 15, bold);
    txt(p, SERVICE_REFERRAL_TITLE.split(' ').slice(0, 2).join(' '), M, H - 90, 12.5, bold);
    txt(p, SERVICE_REFERRAL_TITLE.split(' ').slice(2).join(' '), M, H - 104, 12.5, bold);
    const bw = 196, bx = W - M - bw, bt = H - 74, bh = 32;
    box(p, bx, bt, bw, bh);
    p.drawLine({ start: { x: bx + bw / 2, y: bt }, end: { x: bx + bw / 2, y: bt - bh }, thickness: 0.6, color: INK });
    txt(p, '1. Client Code:', bx + 4, bt - 10, 8, bold);
    txt(p, '2. Incident No.:', bx + bw / 2 + 4, bt - 10, 8, bold);
    const fit = (s: string, room: number) => { let size = 8.5; while (size > 5.5 && font.widthOfTextAtSize(clean(s), size) > room) size -= 0.5; return size; };
    const cc = f.clientCode.trim(), inc = f.incidentNo.trim();
    if (cc) txt(p, cc, bx + 4, bt - 24, fit(cc, bw / 2 - 8), font, VALUE);
    else p.drawLine({ start: { x: bx + 4, y: bt - 25 }, end: { x: bx + bw / 2 - 8, y: bt - 25 }, thickness: 0.5, color: INK });
    if (inc) txt(p, inc, bx + bw / 2 + 4, bt - 24, fit(inc, bw / 2 - 8), font, VALUE);
    else p.drawLine({ start: { x: bx + bw / 2 + 4, y: bt - 25 }, end: { x: bx + bw - 8, y: bt - 25 }, thickness: 0.5, color: INK });
    p.drawLine({ start: { x: M - 4, y: H - 116 }, end: { x: W - M + 4, y: H - 116 }, thickness: 1.8, color: INK });
    // Said in words as well as the watermark, which the shaded cells partly cover.
    if (input.status !== 'ISSUED') {
      txt(p, input.status === 'DRAFT' ? 'DRAFT - NOT ISSUED. Do not give this copy to the receiving organization.' : 'CANCELLED - this referral was withdrawn and is not valid.',
        M, H - 126, 7.5, bold, rgb(0.75, 0.1, 0.1));
      return H - 134;
    }
    return H - 128;
  };
  const newPage = () => {
    const p = pdf.addPage([W, H]);
    pages.push(p);
    watermark(p);
    return { p, y: header(p) };
  };

  const bar = (p: PDFPage, y: number, title: string) => {
    box(p, M, y, CW, 15, BAR);
    txt(p, title, M + (CW - bold.widthOfTextAtSize(title, 9)) / 2, y - 11, 9, bold);
    return y - 15;
  };
  /** A label cell (shaded) - its text wrapped. */
  const labelCell = (p: PDFPage, x: number, top: number, w: number, h: number, s: string, sub?: string) => {
    box(p, x, top, w, h, SHADE);
    let ly = top - 11;
    for (const l of wrap(s, bold, 8.5, w - 6)) { txt(p, l, x + 3, ly, 8.5, bold); ly -= 10; }
    if (sub) for (const l of wrap(sub, italic, 7.5, w - 6)) { txt(p, l, x + 3, ly, 7.5, italic); ly -= 9; }
  };
  const valueLines = (s: string, w: number, size = 8.5) => (s.trim() ? wrap(s.trim(), font, size, w - 6) : []);
  const valueCell = (p: PDFPage, x: number, top: number, w: number, h: number, lines: string[], size = 8.5, offset = 11) => {
    box(p, x, top, w, h);
    let vy = top - offset;
    for (const l of lines) { txt(p, l, x + 3, vy, size, font, VALUE); vy -= size + 1.5; }
  };
  /** Sub-labelled parts in one cell: No. / Street Name / Barangay / City/Mun, Last / First / Middle / Extension. */
  const partsCell = (p: PDFPage, x: number, top: number, w: number, h: number, parts: [string, string][]) => {
    box(p, x, top, w, h);
    const pw = w / parts.length;
    parts.forEach(([label, v], i) => {
      txt(p, label, x + 3 + i * pw, top - 8, 6, font, GRAY);
      let vy = top - 19;
      for (const l of valueLines(v, pw, 8.5).slice(0, 2)) { txt(p, l, x + 3 + i * pw, vy, 8.5, font, VALUE); vy -= 10; }
    });
  };
  const rowH = (...counts: number[]) => Math.max(28, ...counts.map(n => n * 10 + 10));

  // ── Page 1: instructions, Section A, Section B ──
  let { p, y } = newPage();

  // Instructions
  const instr = SERVICE_REFERRAL_INSTRUCTIONS.map((s, i) => wrap(`${i + 1}.  ${s}`, font, 8.5, CW - 34));
  const ih = 16 + instr.reduce((n, l) => n + l.length * 10.5, 0) + 4;
  box(p, M, y, CW, ih, PANEL);
  txt(p, 'INSTRUCTIONS', M + 5, y - 11, 9, bold);
  let iy = y - 22;
  for (const lines of instr) for (const l of lines) { txt(p, l, M + 22, iy, 8.5); iy -= 10.5; }
  y -= ih + 14;

  // Section A
  y = bar(p, y, 'A.  REFERRING ORGANIZATION INFORMATION');
  const L = 82, V1 = 150, L2 = 64, V2 = CW - L - V1 - L2;
  {
    const org = valueLines(f.referringOrganization, V1), act = valueLines(f.actionTaken, V2);
    const h = rowH(org.length, act.length);
    labelCell(p, M, y, L, h, '1. Referring Organization'); valueCell(p, M + L, y, V1, h, org);
    labelCell(p, M + L + V1, y, L2, h, '2. Action Taken'); valueCell(p, M + L + V1 + L2, y, V2, h, act);
    y -= h;
  }
  {
    const NW = V1 + L2 + 26, LW2 = 62, PV = CW - L - NW - LW2;
    const pos = valueLines(f.position, PV);
    const h = Math.max(36, pos.length * 10 + 10);
    labelCell(p, M, y, L, h, '3. Referred by');
    partsCell(p, M + L, y, NW, h, [['Last Name', f.referredByLast], ['First Name', f.referredByFirst], ['Middle Name', f.referredByMiddle], ['Extension', f.referredByExt]]);
    labelCell(p, M + L + NW, y, LW2, h, '4. Position / Job Title'); valueCell(p, M + L + NW + LW2, y, PV, h, pos);
    y -= h;
  }
  {
    const cn = valueLines(f.contactNo, V1), em = valueLines(f.email, V2);
    const h = rowH(cn.length, em.length);
    labelCell(p, M, y, L, h, '5. Contact No.'); valueCell(p, M + L, y, V1, h, cn);
    labelCell(p, M + L + V1, y, L2, h, '6. Email Address'); valueCell(p, M + L + V1 + L2, y, V2, h, em);
    y -= h;
  }
  {
    const h = 34;
    labelCell(p, M, y, L, h, '7. Address');
    partsCell(p, M + L, y, CW - L, h, [['No.', f.addressNo], ['Street Name', f.addressStreet], ['Barangay', f.addressBarangay], ['City/Mun', f.addressCity]]);
    y -= h;
  }

  // Section B
  y = bar(p, y, 'B.  SERVICE REFERRAL INFORMATION');
  box(p, M, y, CW, 15, SHADE);
  txt(p, '8. REFERRAL SERVICE', M + 4, y - 11, 8.5, bold);
  y -= 15;
  const LB = Math.round(CW * 0.49), RB = CW - LB;

  const block = (dest: Destination, heading: string) => {
    const chosen = f.destination === dest;
    const val = (k: keyof typeof FIELD_LABELS) => (chosen ? f[k].trim() : '');
    // Right: the receiving organization's details, each on its line.
    const rightFields: [string, string][] = dest === 'BARANGAY'
      ? [['Barangay / Office', val('receivingAgency')], ['Address', val('receivingAddress')], ['Name of Contact Person', val('receivingContactPerson')],
        ['Contact No.', val('receivingContactNo')], ['Email Address', val('receivingEmail')]]
      : [['Agency/Organization', val('receivingAgency')], ['Address', val('receivingAddress')], ['Name of Contact Person', val('receivingContactPerson')],
        ['Contact No.', val('receivingContactNo')], ['Email Address', val('receivingEmail')]];
    const fieldLines = rightFields.map(([label, v]) => {
      const lw = bold.widthOfTextAtSize(`${label}:`, 8) + 4;
      const first = v ? wrap(v, font, 8.5, RB - 12 - lw) : [''];
      const rest = first.length > 1 ? wrap(first.slice(1).join(' '), font, 8.5, RB - 12) : [];
      return { label, lw, lines: [first[0], ...rest].slice(0, label === 'Address' ? 3 : 2), address: label === 'Address' };
    });
    const rh = 8 + fieldLines.reduce((n, fl) => n + Math.max(fl.lines.length, fl.address ? 2 : 1) * 13 + 5, 0);
    // Left: the heading and the service boxes.
    const svc = servicesFor(dest);
    const leftLines = svc.reduce((n, k) => n + wrap(SERVICES[k].label, font, 8.5, LB - 30).length, 2) + (dest === 'SWDO' ? 1 : 1);
    const h = Math.max(rh, 18 + leftLines * 12 + 10);
    box(p, M, y, LB, h, PANEL);
    box(p, M + LB, y, RB, h);
    let ly = y - 13;
    for (const l of wrap(heading, boldItalic, 9, LB - 10)) { txt(p, l, M + 5, ly, 9, boldItalic); ly -= 11; }
    ly -= 2;
    for (const k of svc) {
      const on = chosen && f.services.includes(k);
      checkbox(p, M + 6, ly, on);
      const lines = wrap(SERVICES[k].label, on ? bold : font, 8.5, LB - 30);
      lines.forEach((l, i) => txt(p, l, M + 18, ly - i * 10.5, 8.5, on ? bold : font));
      if ('other' in SERVICES[k]) {
        const after = M + 18 + (on ? bold : font).widthOfTextAtSize(clean(lines[lines.length - 1]), 8.5) + 4;
        const yy = ly - (lines.length - 1) * 10.5;
        const spec = on ? f.serviceOther.trim() : '';
        const room = M + LB - 8 - after;
        if (spec && font.widthOfTextAtSize(clean(spec), 8.5) <= room) txt(p, `: ${spec}`, after - 4, yy, 8.5, font, VALUE);
        else {
          txt(p, ':', after - 3, yy, 8.5);
          p.drawLine({ start: { x: after + 2, y: yy - 2 }, end: { x: M + LB - 8, y: yy - 2 }, thickness: 0.5, color: INK });
          if (spec) {
            const sl = wrap(spec, font, 8.5, LB - 30).slice(0, 2);
            sl.forEach((l, i) => txt(p, l, M + 18, yy - 11 - i * 10.5, 8.5, font, VALUE));
            ly -= sl.length * 10.5;
          }
        }
      }
      ly -= lines.length * 10.5 + 3;
    }
    // Right fields
    let ry = y - 13;
    for (const fl of fieldLines) {
      txt(p, `${fl.label}:`, M + LB + 5, ry, 8, bold);
      const n = Math.max(fl.lines.length, fl.address ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const x0 = i === 0 ? M + LB + 5 + fl.lw : M + LB + 5;
        p.drawLine({ start: { x: x0, y: ry - 2 }, end: { x: M + CW - 6, y: ry - 2 }, thickness: 0.5, color: INK });
        if (fl.lines[i]) txt(p, fl.lines[i], x0 + 2, ry, 8.5, font, VALUE);
        ry -= 13;
      }
      ry -= 5;
    }
    y -= h;
  };
  block('BARANGAY', 'Referred to Barangay');
  block('SWDO', 'Referred to Social Welfare and Development Office');

  // ── Page 2: Section C and the signatures (the reference's continuation) ──
  ({ p, y } = newPage());
  y -= 8;
  txt(p, 'C. To be accomplished by the Receiving Organization', M, y, 9.5, boldItalic);
  y -= 14;
  const recorded = Boolean(c?.status && c.status !== 'AWAITING');
  const cv = (s: string | null | undefined) => (recorded && s ? s : '');
  const CL = 128, CV1 = 170, CL2 = 96, CV2 = CW - CL - CV1 - CL2;
  {
    const name = cv(c?.receivedByName);
    const lines = name ? valueLines(`${name} (printed name as recorded in SafeComm)`, CV1) : [];
    const pos = valueLines(cv(c?.position), CV2);
    const h = Math.max(40, lines.length * 10 + 12, pos.length * 10 + 12);
    labelCell(p, M, y, CL, h, '9. Received by', '(signature over printed name)');
    valueCell(p, M + CL, y, CV1, h, lines);
    labelCell(p, M + CL + CV1, y, CL2, h, '10. Position / Job Title'); valueCell(p, M + CL + CV1 + CL2, y, CV2, h, pos);
    y -= h;
  }
  {
    const h = 30;
    labelCell(p, M, y, CL, h, '11. Client Code'); valueCell(p, M + CL, y, CV1, h, valueLines(cv(c?.clientCode), CV1));
    labelCell(p, M + CL + CV1, y, CL2, h, '12. Date of Received');
    box(p, M + CL + CV1 + CL2, y, CV2, h);
    txt(p, '(mm/dd/yyyy)', M + CL + CV1 + CL2 + 3, y - 8, 6, font, GRAY);
    const d = cv(c?.dateReceived);
    if (d) txt(p, mmddyyyy(d), M + CL + CV1 + CL2 + 3, y - 21, 8.5, font, VALUE);
    y -= h;
  }
  {
    const rm = valueLines(cv(c?.remarks), CW - CL).slice(0, 8);
    const h = Math.max(30, rm.length * 10 + 12);
    labelCell(p, M, y, CL, h, '13. Remarks'); valueCell(p, M + CL, y, CW - CL, h, rm);
    y -= h;
  }
  if (recorded && c?.status) {
    y -= 12;
    for (const l of wrap(`Section C as recorded in SafeComm: ${ACK_STATUS[c.status]}. The signature is on the receiving organization's copy, not reproduced here.`, italic, 7.5, CW)) {
      txt(p, l, M, y, 7.5, italic, GRAY); y -= 9;
    }
  }

  // Signatures - lines only, for a hand. Nothing is drawn as a signature.
  y -= 36;
  const colW = (CW - 40) / 2, x2 = M + colW + 40;
  txt(p, 'Signature/thumbprint of', M, y, 9, bold);
  txt(p, 'client:', M, y - 11, 9, bold);
  p.drawLine({ start: { x: M + bold.widthOfTextAtSize('client:', 9) + 4, y: y - 13 }, end: { x: M + colW, y: y - 13 }, thickness: 0.6, color: INK });
  let sy = y - 23;
  for (const l of wrap('(or parent/guardian if client is a child below 18 or as defined by RA7610)', italic, 8.5, colW)) { txt(p, l, M, sy, 8.5, italic); sy -= 10; }
  if (f.clientSignatory) {
    for (const l of wrap(`To be signed by: ${CLIENT_SIGNATORY[f.clientSignatory]}`, font, 7.5, colW)) { txt(p, l, M, sy, 7.5, font, GRAY); sy -= 9; }
  }
  sy -= 10;
  txt(p, 'Date:', M, sy, 9, bold);
  p.drawLine({ start: { x: M + 28, y: sy - 2 }, end: { x: M + 110, y: sy - 2 }, thickness: 0.6, color: INK });

  // The service provider: the printed name may be typed; the signature never is.
  const printed = [f.referredByFirst, f.referredByMiddle, f.referredByLast, f.referredByExt].map(s => s.trim()).filter(Boolean).join(' ');
  if (printed) {
    let size = 9; while (size > 6.5 && font.widthOfTextAtSize(clean(printed), size) > colW) size -= 0.5;
    txt(p, printed, x2 + (colW - font.widthOfTextAtSize(clean(printed), size)) / 2, y - 10, size, font, VALUE);
  }
  p.drawLine({ start: { x: x2, y: y - 13 }, end: { x: x2 + colW, y: y - 13 }, thickness: 0.6, color: INK });
  let py = y - 23;
  for (const l of wrap('Printed name and signature of the service provider of the referring organization', boldItalic, 8.5, colW)) { txt(p, l, x2, py, 8.5, boldItalic); py -= 10; }
  for (const l of wrap('(sign by hand on the printed copy)', font, 7.5, colW)) { txt(p, l, x2, py, 7.5, font, GRAY); py -= 9; }
  sy = Math.min(sy, py - 10);
  txt(p, 'Date:', x2, sy, 9, bold);
  p.drawLine({ start: { x: x2 + 28, y: sy - 2 }, end: { x: x2 + 110, y: sy - 2 }, thickness: 0.6, color: INK });

  // ── Footers ──
  pages.forEach((pg, i) => {
    const status = input.status === 'DRAFT' ? 'DRAFT - not issued' : input.status === 'CANCELLED' ? 'CANCELLED - not valid for referral' : 'Issued';
    const left = clean(`${SERVICE_REFERRAL_DIGITAL_NOTICE}`);
    const right = `Page ${i + 1} of ${pages.length}`;
    pg.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.4, color: GRAY });
    txt(pg, left, M, 36, 6.8, font, GRAY);
    txt(pg, `Referral No. ${input.reference} - ${status}. Confidential: for the receiving organization only.`, M, 27, 6.8, font, GRAY);
    txt(pg, right, W - M - bold.widthOfTextAtSize(right, 8), 31, 8, bold);
  });
  return pdf.save({ useObjectStreams: false });
}
