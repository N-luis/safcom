/**
 * The intake form as a document: which page each section and item falls on.
 *
 * One layout, used by the live preview beside the form and by the PDF
 * export, so what the official checks on screen is what is printed. The
 * page breaks follow the source document (lib/intakeForms.ts, pdf.pageBreaks);
 * a form without them flows as one sheet. Long answers still continue onto
 * further pages where they must - in the PDF by height, on screen by the page
 * growing - but each page starts where the source document's does.
 *
 * Client-safe: no data, no keys.
 */
import type { FormDef } from './intakeForms';
import { appliesTo, type Item, type Responses, type Section } from './officialIntakeForm';

export type DocBlock =
  | { kind: 'instructions' }
  | { kind: 'section'; title: string; continued: boolean }
  | { kind: 'item'; item: Item }
  | { kind: 'signatures' };

export interface DocPage { number: number; blocks: DocBlock[] }

/** Items the document shows as signature lines, not as rows. */
export const isSignature = (i: Item) => i.key.startsWith('signature');

/** The form's own sections, in order - the SafeComm safety check is an annex, not part of them. */
export const documentSections = (def: FormDef): Section[] => def.sections.filter(s => !s.proposed);
/** SafeComm's own additions, shown after the form and labelled as such. */
export const annexSection = (def: FormDef): Section | null => def.sections.find(s => s.proposed) ?? null;

export function documentPages(def: FormDef): DocPage[] {
  const breaks = new Map((def.pdf.pageBreaks ?? []).map(b => [b.before, b]));
  const pages: DocPage[] = [{ number: 1, blocks: [{ kind: 'instructions' }] }];
  let page = pages[0];
  const hasItems = () => page.blocks.some(b => b.kind === 'item');
  for (const s of documentSections(def)) {
    let sectionShown = false;
    for (const item of s.items) {
      if (isSignature(item)) continue;
      const br = breaks.get(item.key);
      if (br && hasItems()) {
        page = { number: pages.length + 1, blocks: [] };
        pages.push(page);
        // A page that continues a section repeats its bar, as the source does.
        if (sectionShown && br.bar) page.blocks.push({ kind: 'section', title: br.bar, continued: true });
      }
      if (!sectionShown) { page.blocks.push({ kind: 'section', title: s.title, continued: false }); sectionShown = true; }
      page.blocks.push({ kind: 'item', item });
    }
  }
  page.blocks.push({ kind: 'signatures' });
  return pages;
}

/**
 * Whether a row appears on the document: always, unless the answers so far
 * make it not apply (informant items for a self-report, the guardian of an
 * adult) and nothing was recorded in it. No empty decorative rows.
 */
export const isShownOnDocument = (i: Item, r: Responses) => appliesTo(i, r) !== 'hidden' || Boolean(r[i.key]);

/** The page an item is on (1-based), or null for an item not on the document. */
export function pageOfItem(pages: DocPage[], key: string): number | null {
  const p = pages.find(pg => pg.blocks.some(b => b.kind === 'item' && b.item.key === key));
  return p?.number ?? null;
}

/** The notice every copy carries: SafeComm made it; it is not an issued government form. */
export const DIGITAL_COPY_NOTICE = 'SafeComm-generated digital copy. It is not an official government-issued form and carries no seal or approval.';
