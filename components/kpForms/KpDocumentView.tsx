'use client';

import { PAGE_H, PAGE_W, PageView, paginate, type KpDoc } from './layout';

/**
 * A KP form's pages, stacked. `scale` shrinks them to the panel on screen
 * (a CSS transform on pages of fixed size, so their proportions never change);
 * at scale 1 they are the pages printed and captured for the PDF.
 */
export default function KpDocumentView({ doc, scale = 1, gap = 24, shadow = false }: { doc: KpDoc; scale?: number; gap?: number; shadow?: boolean }) {
  const pages = paginate(doc);
  const height = pages.length * PAGE_H + (pages.length - 1) * gap;
  return (
    <div style={{ width: PAGE_W * scale, height: height * scale }}>
      <div style={{ width: PAGE_W, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: 'top left', display: 'flex', flexDirection: 'column', gap }}>
        {pages.map((p, i) => (
          <div key={i} style={shadow ? { boxShadow: '0 2px 10px rgba(15,23,42,0.25)' } : undefined}>
            <PageView page={p} doc={doc} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** How many pages a document takes. */
export const pageCount = (doc: KpDoc) => paginate(doc).length;
