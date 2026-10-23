/**
 * Reads a risk-matrix PDF into searchable chunks.
 *
 * Both SafeComm matrices are a table - Level, Risk Classification, Examples /
 * Indicators, Possible Escalation, Suggested Action, and (VAWC) Philippine
 * Basis / Links - with notes above and below it. Plain text extraction runs
 * the columns of a row into each other, so this reads text POSITIONS instead:
 * the header row gives the column boundaries, the numbers 1-5 in the first
 * column give the row boundaries, and each cell is rebuilt from the text that
 * falls inside it. One level row = one chunk, with its criteria and guidance
 * kept together. Everything outside the table becomes paragraph chunks.
 *
 * Nothing is invented: a document whose table cannot be found, or whose
 * levels are not 1-5 in order, is reported as a failure, not imported.
 *
 * Used only by scripts and tests - never in the request path.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedChunk {
  chunkIndex: number;
  sectionTitle: string;
  content: string;
  pageNumber: number;
  riskLevel: number | null;
  riskLabel: string | null;
  fields: Record<string, string | string[]> | null;
}

export interface Extraction {
  documentName: string;
  frameworkStatus: string;
  pages: number;
  skippedPages: { page: number; reason: string }[];
  chunks: ExtractedChunk[];
  errors: string[];
}

interface Item { str: string; x: number; y: number; w: number; page: number }
interface Link { url: string; x: number; y: number; page: number }

const SAME_LINE = 2.5;

/**
 * Joins text pieces the way they read on the page.
 *
 * PDFs often split one word into pieces with no space between them ("l" +
 * "ife", "399" + "–" + "422"), and break words across lines at a hyphen or a
 * slash. Pieces that touch on the same line close up; a line ending in "-"
 * or "/" runs straight into the next.
 */
function joinPieces(pieces: Item[]): string {
  let out = '';
  let prev: Item | null = null;
  for (const p of pieces) {
    if (!prev) { out = p.str; prev = p; continue; }
    const sameLine = Math.abs(p.y - prev.y) <= SAME_LINE;
    const touching = sameLine && p.x - (prev.x + prev.w) < 0.9;
    // "ambulance/" + "hospital" closes up; "Threatening /" + "Catastrophic"
    // keeps its space, as the slash was spaced in the document.
    const brokenWord = !sameLine && /(?:-|\S\/)$/.test(out);
    out += touching || brokenWord || p.str === '-' ? p.str : ' ' + p.str;
    prev = p;
  }
  return out.replace(/\s+/g, ' ').replace(/ ([;,.:])/g, '$1').trim();
}

function linesOf(items: Item[]): Item[][] {
  // Page first, then top to bottom: notes on two pages must not interleave.
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines.find(l => l[0].page === it.page && Math.abs(l[0].y - it.y) <= SAME_LINE);
    if (line) line.push(it); else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a[0].page - b[0].page || b[0].y - a[0].y);
}

/** A line that starts one of these begins a new note, even with no gap above it. */
const NOTE_STARTS = /^(?:\d+\.\s|Republic Act No\.|Act No\.|Barangay VAW Desk Handbook|DILG Memorandum Circular|DILG Regional Office|Use limitation:|Limitation:|NOTE:|Important note:|Reference Notes)/;

/** Paragraphs from free text: a break wherever the line gap opens up. */
function paragraphs(items: Item[]): { text: string; page: number }[] {
  const lines = linesOf(items);
  if (!lines.length) return [];
  const gaps = lines.slice(1).map((l, i) => lines[i][0].y - l[0].y).filter(g => g > 0);
  const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;
  const out: { text: string; page: number }[] = [];
  let cur: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].map(it => it.str).join(' ');
    const gap = i > 0 && (lines[i - 1][0].page !== lines[i][0].page || lines[i - 1][0].y - lines[i][0].y > typical * 1.45);
    if (i > 0 && cur.length && (gap || NOTE_STARTS.test(lineText))) {
      out.push({ text: joinPieces(cur), page: cur[0].page });
      cur = [];
    }
    cur.push(...lines[i]);
  }
  if (cur.length) out.push({ text: joinPieces(cur), page: cur[0].page });
  return out.filter(p => p.text.length > 0);
}

export async function extractMatrix(data: Uint8Array): Promise<Extraction> {
  const errors: string[] = [];
  const skippedPages: Extraction['skippedPages'] = [];
  const pdf = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  const items: Item[] = [];
  const links: Link[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageItems = tc.items
      .filter((it): it is typeof it & { str: string; transform: number[] } => 'str' in it)
      .filter(it => it.str.trim().length > 0)
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: 'width' in it ? Number(it.width) : 0, page: p }));
    if (!pageItems.length) {
      // A scanned page. OCR of PDF pages needs a renderer this project does
      // not have; the page is reported rather than imported empty.
      skippedPages.push({ page: p, reason: 'no text layer (scanned page — OCR would be needed)' });
      continue;
    }
    items.push(...pageItems);
    for (const a of await page.getAnnotations()) {
      if (a.subtype === 'Link' && typeof a.url === 'string' && Array.isArray(a.rect)) {
        links.push({ url: a.url, x: (a.rect[0] + a.rect[2]) / 2, y: (a.rect[1] + a.rect[3]) / 2, page: p });
      }
    }
  }

  // ── The header row: the line carrying both "Level" and "Suggested Action" ──
  const headerAnchor = items.find(it => it.str === 'Level'
    && items.some(o => o.page === it.page && Math.abs(o.y - it.y) <= SAME_LINE && o.str.startsWith('Suggested Action')));
  if (!headerAnchor) {
    errors.push('No risk table found (no header row with "Level" and "Suggested Action")');
    return { documentName: '', frameworkStatus: 'UNSPECIFIED', pages: pdf.numPages, skippedPages, chunks: [], errors };
  }
  const tablePage = headerAnchor.page;
  const headerY = headerAnchor.y;
  const headerItems = items.filter(it => it.page === tablePage && Math.abs(it.y - headerY) <= SAME_LINE)
    .sort((a, b) => a.x - b.x);
  // Pieces of one heading sit close together ("Examples / Indi" + "cators").
  const headers: { title: string; x: number; end: number }[] = [];
  for (const it of headerItems) {
    const last = headers[headers.length - 1];
    if (last && it.x - last.end < 1.5) { last.title += it.str; last.end = it.x + it.w; }
    else headers.push({ title: it.str, x: it.x, end: it.x + it.w });
  }
  const colStart = (i: number) => headers[i].x - 4;
  const colEnd = (i: number) => (i + 1 < headers.length ? headers[i + 1].x - 4 : Infinity);

  // ── Rows: the level numbers down the first column ──
  const markers = items
    .filter(it => it.page === tablePage && it.y < headerY - SAME_LINE
      && it.x >= colStart(0) && it.x < colEnd(0) && /^[1-9]$/.test(it.str))
    .sort((a, b) => b.y - a.y);
  const levels = markers.map(m => Number(m.str));
  if (levels.join(',') !== '1,2,3,4,5') {
    errors.push(`Expected levels 1-5 in order, found [${levels.join(', ')}]`);
  }

  // Where the table ends: the first line below the last row that starts left
  // of the table's first column.
  const lastMarker = markers[markers.length - 1];
  const below = items.filter(it => it.page === tablePage && lastMarker && it.y < lastMarker.y - SAME_LINE
    && it.x < colStart(0) - 1);
  const tableBottom = below.length ? Math.max(...below.map(b => b.y)) + SAME_LINE : -Infinity;

  const chunks: ExtractedChunk[] = [];
  const inTable = new Set<Item>();
  markers.forEach((m, r) => {
    const top = m.y + 8;
    const bottom = r + 1 < markers.length ? markers[r + 1].y + 8 : tableBottom;
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      const cellItems = items.filter(it => it.page === tablePage && it.y <= top && it.y > bottom
        && it.x >= colStart(i) && it.x < colEnd(i));
      cellItems.forEach(it => inTable.add(it));
      cells[h.title] = joinPieces(linesOf(cellItems).flat());
    });
    const headingFor = (re: RegExp) => headers.find(h => re.test(h.title))?.title;
    const labelKey = headingFor(/Risk Classification/i);
    const riskLabel = labelKey ? cells[labelKey] : '';
    const rowLinks = links.filter(l => l.page === tablePage && l.y <= top && l.y > bottom).map(l => l.url);

    const body = headers.slice(2)
      .map(h => `${h.title}: ${cells[h.title]}`)
      .join('\n');
    chunks.push({
      chunkIndex: 0,
      sectionTitle: `Level ${m.str} — ${riskLabel}`,
      content: `Level ${m.str}: ${riskLabel}\n${body}`,
      pageNumber: tablePage,
      riskLevel: Number(m.str),
      riskLabel: riskLabel || null,
      fields: { ...cells, ...(rowLinks.length ? { links: [...new Set(rowLinks)] } : {}) },
    });
    if (!riskLabel) errors.push(`Level ${m.str} has no Risk Classification text`);
  });
  headerItems.forEach(it => inTable.add(it));

  // ── Everything else, as paragraphs ──
  const rest = items.filter(it => !inTable.has(it) && !(it.page === tablePage && markers.includes(it)));
  const before = rest.filter(it => it.page < tablePage || (it.page === tablePage && it.y > headerY));
  const after = rest.filter(it => it.page > tablePage || (it.page === tablePage && it.y < headerY));
  const notes: { text: string; page: number }[] = [];
  for (const para of [...paragraphs(before), ...paragraphs(after)]) {
    if (/^https?:\/\/\S+$/.test(para.text) && notes.length) { notes[notes.length - 1].text += ` ${para.text}`; continue; }
    notes.push(para);
  }

  const documentName = notes[0]?.text.split(/(?<=Matrix)\b/)[0].trim() || 'Risk matrix';
  // The title lines and bare headings are not guidance; they are kept as the
  // document's name, not as chunks to be retrieved.
  const guidance = notes.filter(n => n.text.split(/\s+/).length >= 6);
  const allText = items.map(i => i.str).join(' ').toLowerCase();
  const frameworkStatus = allText.includes('proposed operational')
    ? 'PROPOSED_OPERATIONAL_FRAMEWORK — not an official classification prescribed by Philippine law'
    : allText.includes('operational intake and triage framework')
      ? 'OPERATIONAL_TRIAGE_FRAMEWORK — does not establish legal guilt'
      : 'UNSPECIFIED';

  for (const n of guidance) {
    // "1. Republic Act No. 7160 — Local Government Code of 1991 (Official
    // Gazette)" -> "Republic Act No. 7160 — Local Government Code of 1991".
    const head = n.text.replace(/^\d+\.\s+/, '').split(/:\s|\s\(/)[0].trim();
    chunks.push({
      chunkIndex: 0,
      sectionTitle: head.length > 90 ? head.slice(0, 87) + '…' : head,
      content: n.text,
      pageNumber: n.page,
      riskLevel: null,
      riskLabel: null,
      fields: null,
    });
  }

  chunks.forEach((c, i) => { c.chunkIndex = i; });
  return { documentName, frameworkStatus, pages: pdf.numPages, skippedPages, chunks, errors };
}
