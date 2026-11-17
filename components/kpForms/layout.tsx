/**
 * The page layout for the KP Forms: a US Letter page (8.5 x 11 in at 96 px
 * per inch, 1 in margins) built from blocks of known height.
 *
 * Every line break is decided here, with the font's own measurements, not by
 * the browser: a paragraph is broken into lines, and each line is laid out
 * justified on its own. So the height of each block is known before it is
 * drawn, the pages are filled block by block (text that runs past a page
 * continues on the next, with the same margins), and the screen, the print
 * and the PDF - all drawn from these same blocks - break in the same places.
 */
import type { CSSProperties, ReactNode } from 'react';

export const PAGE_W = 816;
export const PAGE_H = 1056;
export const MARGIN = 96;
export const BODY_W = PAGE_W - 2 * MARGIN;   // 624
export const BODY_H = PAGE_H - 2 * MARGIN;   // 864

/** The typeface a document is set in, and its size. */
export interface Typo {
  family: string; size: number;
  /** Body line height (about 1.5). */
  lh: number;
  /** Single-spaced lines: the header, the caption, labels and signature lines. */
  cl: number;
}

// ── Measuring text ───────────────────────────────────────────────────────────

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();
/** Text width in px, with the browser's own font metrics (an estimate where there is no canvas, as in tests). */
export function textWidth(text: string, typo: Typo, opts: { bold?: boolean; italic?: boolean; size?: number } = {}): number {
  const size = opts.size ?? typo.size;
  const font = `${opts.italic ? 'italic ' : ''}${opts.bold ? 'bold ' : ''}${size}px ${typo.family}`;
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let w: number;
  if (ctx) { ctx.font = font; w = ctx.measureText(text).width; }
  else w = text.length * size * (opts.bold ? 0.55 : 0.5);
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
}
/** Fonts finished loading: measurements taken before are stale. */
export const resetMeasureCache = () => cache.clear();

// ── Runs: what a paragraph is made of ────────────────────────────────────────

export type Run =
  | { t: 'text'; s: string; b?: boolean; i?: boolean; sup?: string }
  /** An underlined slot: the value on the line, at least `min` px wide. `field` ties it to its input (highlight). */
  | { t: 'blank'; v: string; min: number; field?: string; b?: boolean; upper?: boolean }
  /** "umaga/hapon", "Punong Barangay/Tagapangulo ng Pangkat": the one that does not apply is struck through. */
  | { t: 'choice'; opts: string[]; pick: number | null; sep?: string };

export const txt = (s: string, o: { b?: boolean; i?: boolean } = {}): Run => ({ t: 'text', s, ...o });
export const blank = (v: string | null | undefined, min: number, field?: string, o: { b?: boolean; upper?: boolean } = {}): Run =>
  ({ t: 'blank', v: (v ?? '').trim(), min, field, ...o });
export const choice = (opts: string[], pick: number | null, sep = '/'): Run => ({ t: 'choice', opts, pick, sep });

const BLANK_PAD = 4;
/** The width a blank takes on the line. */
const blankWidth = (r: Extract<Run, { t: 'blank' }>, typo: Typo) =>
  Math.max(r.min, r.v ? textWidth(r.upper ? r.v.toUpperCase() : r.v, typo, { bold: r.b }) + 2 * BLANK_PAD : 0);

/** A word: pieces with no space between them ("ika-" + a blank + ","). */
interface Piece { run: Run; text?: string }
interface Word { pieces: Piece[]; w: number }

function words(runs: Run[], typo: Typo): Word[] {
  const out: Word[] = [];
  let cur: Word | null = null;
  const push = (p: Piece, w: number) => { if (!cur) { cur = { pieces: [], w: 0 }; out.push(cur); } cur.pieces.push(p); cur.w += w; };
  for (const r of runs) {
    if (r.t === 'text') {
      for (const part of r.s.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { cur = null; continue; }
        push({ run: r, text: part }, textWidth(part, typo, { bold: r.b, italic: r.i }) + (r.sup ? textWidth(r.sup, typo, { size: typo.size * 0.65 }) : 0));
      }
    } else if (r.t === 'blank') push({ run: r }, blankWidth(r, typo));
    else push({ run: r }, textWidth(r.opts.join(r.sep ?? '/'), typo));
  }
  return out;
}

/** Lines of words, each no wider than its line (the first one less its indent). */
export function wrapRuns(runs: Run[], width: number, typo: Typo, firstIndent = 0): Word[][] {
  const ws = words(runs, typo);
  const space = textWidth(' ', typo);
  const lines: Word[][] = [];
  let line: Word[] = []; let used = 0; let avail = width - firstIndent;
  for (const w of ws) {
    const need = line.length ? used + space + w.w : w.w;
    if (line.length && need > avail - 1) { lines.push(line); line = [w]; used = w.w; avail = width; }
    else { line.push(w); used = need; }
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

/** Plain text in lines of a given width (for text written on ruled lines). Keeps the line breaks the official typed. */
export function wrapPlain(text: string, width: number, typo: Typo): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const lines = wrapRuns([txt(para)], width, typo);
    for (const l of lines) out.push(l.map(w => w.pieces.map(p => p.text ?? '').join('')).join(' '));
  }
  return out;
}

// ── Drawing runs ─────────────────────────────────────────────────────────────

export const HIGHLIGHT = '#fde68a';

function PieceView({ p, highlight }: { p: Piece; highlight?: string | null }) {
  const r = p.run;
  if (r.t === 'text') {
    return (
      <span style={{ fontWeight: r.b ? 700 : undefined, fontStyle: r.i ? 'italic' : undefined }}>
        {p.text}{r.sup && <sup style={{ fontSize: '0.65em', lineHeight: 0 }}>{r.sup}</sup>}
      </span>
    );
  }
  if (r.t === 'blank') {
    return (
      <span data-field={r.field} style={{
        display: 'inline-block', minWidth: r.min, padding: `0 ${BLANK_PAD}px`, borderBottom: '1px solid #000', lineHeight: 1.15,
        textAlign: 'center', boxSizing: 'border-box', fontWeight: r.b ? 700 : undefined, whiteSpace: 'nowrap',
        background: highlight && r.field === highlight ? HIGHLIGHT : undefined,
      }}>{r.v ? (r.upper ? r.v.toUpperCase() : r.v) : ' '}</span>
    );
  }
  return <ChoiceView opts={r.opts} pick={r.pick} sep={r.sep ?? '/'} />;
}

/** Both options, the one that does not apply struck through ("Ekisan ang hindi angkop"). */
export function ChoiceView({ opts, pick, sep = '/' }: { opts: string[]; pick: number | null; sep?: string }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {opts.map((o, i) => (
        <span key={o}>
          {i > 0 && sep}
          <span style={pick !== null && pick !== i ? { textDecoration: 'line-through', textDecorationThickness: 1 } : undefined}>{o}</span>
        </span>
      ))}
    </span>
  );
}

function LineView({ line, justify, indent, typo, highlight, align }: {
  line: Word[]; justify: boolean; indent: number; typo: Typo; highlight?: string | null; align?: 'left' | 'center' | 'right';
}) {
  return (
    <div style={{
      height: typo.lh, lineHeight: `${typo.lh}px`, whiteSpace: 'nowrap', paddingLeft: indent,
      textAlign: align ?? (justify ? 'justify' : 'left'), textAlignLast: align ?? (justify ? 'justify' : 'left'),
    }}>
      {line.map((w, i) => (
        <span key={i}>{i > 0 && ' '}{w.pieces.map((p, j) => <PieceView key={j} p={p} highlight={highlight} />)}</span>
      ))}
    </div>
  );
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export interface Block { h: number; node: ReactNode; keepWithNext?: boolean; key: string }

let seq = 0;
const k = (p: string) => `${p}-${seq++}`;

export const spacer = (h: number): Block => ({ h, key: k('sp'), node: <div style={{ height: h }} /> });

/**
 * A paragraph: justified, first-line indent, its last line left-aligned. Split
 * into one block per line so a long paragraph continues on the next page.
 */
export function paragraph(runs: Run[], typo: Typo, o: { indent?: number; align?: 'left' | 'center' | 'right'; highlight?: string | null; justify?: boolean } = {}): Block[] {
  const indent = o.indent ?? 48;
  const justify = o.justify ?? !o.align;
  const lines = wrapRuns(runs, BODY_W, typo, indent);
  return lines.map((line, i) => ({
    h: typo.lh, key: k('p'),
    node: <LineView line={line} indent={i === 0 ? indent : 0} typo={typo} highlight={o.highlight} align={o.align}
      justify={justify && i < lines.length - 1} />,
  }));
}

/** Text written on full-width ruled lines - at least `minLines`, more as the text grows. */
export function ruled(text: string, typo: Typo, minLines: number, field: string, highlight?: string | null): Block[] {
  const lines = text.trim() ? wrapPlain(text.trim(), BODY_W - 8, typo) : [];
  while (lines.length < minLines) lines.push('');
  const hl = highlight === field;
  return lines.map(l => ({
    h: typo.lh, key: k('r'),
    node: <div data-field={field} style={{ height: typo.lh, lineHeight: `${typo.lh - 3}px`, borderBottom: '1px solid #000', boxSizing: 'border-box',
      whiteSpace: 'pre', paddingLeft: 4, background: hl ? HIGHLIGHT : undefined }}>{l || ' '}</div>,
  }));
}

/** The form's label, top left ("KP Form 7"), and on most forms the common header. */
export function header(label: string, typo: Typo, withHeader: boolean): Block[] {
  const lab: Block = { h: 22, key: k('lab'), node: <div style={{ height: 22, fontSize: 13, lineHeight: '22px' }}>{label}</div> };
  if (!withHeader) return [lab];
  const center: CSSProperties = { textAlign: 'center', height: typo.cl, lineHeight: `${typo.cl}px` };
  return [lab, {
    h: typo.cl * 6, key: k('hdr'),
    node: (
      <div>
        <div style={center}>Republika ng Pilipinas</div>
        <div style={center}>Lalawigan ng Bulacan</div>
        <div style={center}>Bayan ng Bocaue</div>
        <div style={center}>Barangay Biñang 2<sup style={{ fontSize: '0.65em', lineHeight: 0 }}>nd</sup></div>
        <div style={{ height: typo.cl }} />
        <div style={{ ...center, fontWeight: 700 }}>TANGGAPAN NG LUPONG TAGAPAMAYAPA</div>
      </div>
    ),
  }];
}

/** The document title: bold, italic, underlined, centered; and its subtitle. */
export function title(text: string, typo: Typo, subtitle?: string, o: { italic?: boolean } = {}): Block[] {
  const italic = o.italic ?? true;
  const size = Math.round(typo.size * 1.15);
  const out: Block[] = [{
    h: typo.lh + 6, key: k('t'), keepWithNext: true,
    node: <div style={{ textAlign: 'center', height: typo.lh + 6, lineHeight: `${typo.lh + 6}px`, fontSize: size, fontWeight: 700,
      fontStyle: italic ? 'italic' : undefined, textDecoration: italic ? 'underline' : undefined }}>{text}</div>,
  }];
  if (subtitle) out.push({ h: typo.lh, key: k('st'), keepWithNext: true,
    node: <div style={{ textAlign: 'center', height: typo.lh, lineHeight: `${typo.lh}px`, fontSize: Math.round(typo.size * 0.9) }}>{subtitle}</div> });
  return out;
}

/** Names one per underlined line - at least two lines; more than four join with commas and wrap. */
export function nameLines(names: string[], width: number, typo: Typo): string[] {
  if (names.length > 4) return wrapPlain(names.join(', '), width - 8, typo);
  const out = names.flatMap(n => wrapPlain(n, width - 8, typo));
  while (out.length < 2) out.push('');
  return out;
}

const Underline = ({ text, typo, field, highlight, align = 'left', bold }: { text: string; typo: Typo; field?: string; highlight?: string | null; align?: 'left' | 'center'; bold?: boolean }) => (
  <div data-field={field} style={{ height: typo.cl, lineHeight: `${typo.cl - 3}px`, borderBottom: '1px solid #000', boxSizing: 'border-box', whiteSpace: 'pre',
    paddingLeft: align === 'left' ? 4 : 0, textAlign: align, fontWeight: bold ? 700 : undefined, overflow: 'hidden',
    background: highlight && field === highlight ? HIGHLIGHT : undefined }}>{text || ' '}</div>
);
const Label = ({ children, typo, align = 'left' }: { children: ReactNode; typo: Typo; align?: 'left' | 'center' }) => (
  <div style={{ height: typo.cl, lineHeight: `${typo.cl}px`, textAlign: align, whiteSpace: 'nowrap' }}>{children}</div>
);

/**
 * The caption: the parties on the left, the case number and "Para sa" on the right.
 */
export function caption(o: {
  complainants: string[]; respondents: string[]; caseNo: string; paraSa: string; typo: Typo; highlight?: string | null;
  complainantLabel: string; respondentLabel: string; paraLabel: string;
}): Block {
  const { typo } = o;
  const LEFT = 330; const GAP = 30; const RIGHT = BODY_W - LEFT - GAP;
  const comp = nameLines(o.complainants, LEFT, typo);
  const resp = nameLines(o.respondents, LEFT, typo);
  const leftLines = comp.length + 1 + 1 + resp.length + 1;
  // "Para sa:" then the rest of its line, then a second full line (more if it is long).
  const labelW = textWidth(`${o.paraLabel} `, typo);
  const first = wrapRuns([txt(o.paraSa)], RIGHT - labelW - 8, typo)[0].map(w => w.pieces.map(p => p.text ?? '').join('')).join(' ');
  const rest = o.paraSa.trim().slice(first.length).trim();
  const more = rest ? wrapPlain(rest, RIGHT - 8, typo) : [''];
  const rightLines = 2 + more.length;
  const h = Math.max(leftLines, rightLines) * typo.cl;
  const row: CSSProperties = { display: 'flex', alignItems: 'flex-end', height: typo.cl, lineHeight: `${typo.cl - 3}px` };
  const fill = (field: string): CSSProperties => ({ flex: 1, borderBottom: '1px solid #000', marginLeft: 4, paddingLeft: 4, whiteSpace: 'pre', overflow: 'hidden',
    background: o.highlight === field ? HIGHLIGHT : undefined });
  return {
    h, key: k('cap'),
    node: (
      <div style={{ display: 'flex', gap: GAP, height: h }}>
        <div style={{ width: LEFT }}>
          {comp.map((n, i) => <Underline key={`c${i}`} text={n} typo={typo} field="complainants" highlight={o.highlight} />)}
          <Label typo={typo}>{o.complainantLabel}</Label>
          <Label typo={typo} align="center">- laban -</Label>
          {resp.map((n, i) => <Underline key={`r${i}`} text={n} typo={typo} field="respondents" highlight={o.highlight} />)}
          <Label typo={typo}>{o.respondentLabel}</Label>
        </div>
        <div style={{ width: RIGHT }}>
          <div style={row}><span style={{ whiteSpace: 'nowrap' }}>Usaping Barangay Blg.</span><span data-field="caseNo" style={fill('caseNo')}>{o.caseNo || ' '}</span></div>
          <div style={row}><span style={{ whiteSpace: 'nowrap' }}>{o.paraLabel}</span><span data-field="paraSa" style={fill('paraSa')}>{first || ' '}</span></div>
          {more.map((l, i) => <Underline key={`p${i}`} text={l} typo={typo} field="paraSa" highlight={o.highlight} />)}
        </div>
      </div>
    ),
  };
}

/** A single name on an underline at the left, with its label (above or below). */
export function partyLine(name: string, label: string, typo: Typo, o: { field?: string; highlight?: string | null; width?: number; labelAbove?: boolean } = {}): Block {
  const w = o.width ?? 330;
  const lines = nameLines(name ? [name] : [], w, typo).filter((l, i) => i === 0 || l);
  const h = (lines.length + 1) * typo.cl;
  return {
    h, key: k('party'),
    node: (
      <div style={{ width: w }}>
        {o.labelAbove && <Label typo={typo}>{label}</Label>}
        {lines.map((l, i) => <Underline key={i} text={l} typo={typo} field={o.field} highlight={o.highlight} />)}
        {!o.labelAbove && <Label typo={typo}>{label}</Label>}
      </div>
    ),
  };
}

/** A signature line at the right: the name on the line, the label under it. */
export function signature(name: string, label: ReactNode, typo: Typo, o: { field?: string; highlight?: string | null; bold?: boolean; upper?: boolean; note?: string; width?: number } = {}): Block {
  const w = o.width ?? 300;
  const h = typo.cl * (2 + (o.note ? 1 : 0)) + 8;
  return {
    h, key: k('sig'),
    node: (
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
        <div style={{ width: w }}>
          <Underline text={o.upper ? name.toUpperCase() : name} typo={typo} field={o.field} highlight={o.highlight} align="center" bold={o.bold} />
          <Label typo={typo} align="center">{label}</Label>
          {o.note && <div style={{ textAlign: 'center', fontSize: Math.round(typo.size * 0.8), height: typo.cl, lineHeight: `${typo.cl}px` }}>{o.note}</div>}
        </div>
      </div>
    ),
  };
}

/** Two columns of underlines (complainants left, respondents right), labels above or below. */
export function twoColumns(left: string[], right: string[], leftLabel: string, rightLabel: string, typo: Typo,
  o: { labelsAbove?: boolean; lines?: number; highlight?: string | null; leftField?: string; rightField?: string } = {}): Block {
  const COL = 280;
  // As many lines as the names need, at least `lines` (2 unless a row asks for 1).
  const pad = (names: string[]) => {
    const ns = names.map(n => n.trim()).filter(Boolean);
    const out = ns.length > 4 ? wrapPlain(ns.join(', '), COL - 8, typo) : ns.flatMap(n => wrapPlain(n, COL - 8, typo));
    while (out.length < (o.lines ?? 2)) out.push('');
    return out;
  };
  const L = pad(left); const R = pad(right);
  const n = Math.max(L.length, R.length);
  while (L.length < n) L.push(''); while (R.length < n) R.push('');
  const h = (n + 1) * typo.cl + 8;
  const col = (lines: string[], label: string, field?: string) => (
    <div style={{ width: COL }}>
      {o.labelsAbove && <Label typo={typo}>{label}</Label>}
      {lines.map((l, i) => <Underline key={i} text={l} typo={typo} field={field} highlight={o.highlight} />)}
      {!o.labelsAbove && <Label typo={typo}>{label}</Label>}
    </div>
  );
  return { h, key: k('two'), node: <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>{col(L, leftLabel, o.leftField)}{col(R, rightLabel, o.rightField)}</div> };
}

/** Runs wrapped to a given width, drawn as lines (for a column beside something else). */
export function flow(runs: Run[], width: number, typo: Typo, o: { highlight?: string | null; justify?: boolean } = {}): { lines: number; node: ReactNode } {
  const lines = wrapRuns(runs, width, typo);
  return {
    lines: lines.length,
    node: <div style={{ width }}>{lines.map((l, i) => (
      <LineView key={i} line={l} indent={0} typo={typo} highlight={o.highlight} justify={Boolean(o.justify) && i < lines.length - 1} />
    ))}</div>,
  };
}

/** A name written on an underline, wrapped to its width (for a column). */
export function underlinedLines(text: string, width: number, typo: Typo, field?: string, highlight?: string | null): { lines: number; node: ReactNode } {
  const ls = text.trim() ? wrapPlain(text.trim(), width - 8, typo) : [''];
  return { lines: ls.length, node: <div style={{ width }}>{ls.map((l, i) => <Underline key={i} text={l} typo={typo} field={field} highlight={highlight} />)}</div> };
}

/** A centered line of plain text (bold optional). */
export const centered = (text: ReactNode, typo: Typo, o: { bold?: boolean; size?: number } = {}): Block => ({
  h: typo.lh, key: k('c'),
  node: <div style={{ textAlign: 'center', height: typo.lh, lineHeight: `${typo.lh}px`, fontWeight: o.bold ? 700 : undefined, fontSize: o.size }}>{text}</div>,
});

/** Anything else that knows its own height. */
export const custom = (h: number, node: ReactNode, keepWithNext = false): Block => ({ h, node, key: k('x'), keepWithNext });

// ── Pages ────────────────────────────────────────────────────────────────────

export interface KpDoc { typo: Typo; font: 'serif' | 'sans'; groups: Block[][] }
export interface KpPageData { blocks: Block[] }

/** Fill pages block by block; each group (an official page) starts a new page. A heading stays with what follows it. */
export function paginate(doc: KpDoc): KpPageData[] {
  const pages: KpPageData[] = [];
  for (const group of doc.groups) {
    let cur: Block[] = []; let used = 0;
    for (let i = 0; i < group.length; i++) {
      const b = group[i];
      const next = b.keepWithNext ? group[i + 1] : undefined;
      const need = b.h + (next ? next.h : 0);
      if (cur.length && used + need > BODY_H) {
        // A spacer at the top of a new page is dropped.
        pages.push({ blocks: cur }); cur = []; used = 0;
        if (b.key.startsWith('sp-')) continue;
      }
      cur.push(b); used += b.h;
    }
    pages.push({ blocks: cur });
  }
  return pages;
}

/** One page, at its true size. `className` marks it for print and for the PDF. */
export function PageView({ page, doc }: { page: KpPageData; doc: KpDoc }) {
  return (
    <div className="kp-page" style={{
      width: PAGE_W, height: PAGE_H, padding: MARGIN, boxSizing: 'border-box', background: '#fff', color: '#000', overflow: 'hidden',
      fontFamily: doc.typo.family, fontSize: doc.typo.size, lineHeight: `${doc.typo.lh}px`, position: 'relative',
    }}>
      {page.blocks.map(b => <div key={b.key}>{b.node}</div>)}
    </div>
  );
}
