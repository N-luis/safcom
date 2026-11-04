'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { ChevronLeft, ChevronRight, Visibility } from '@mui/icons-material';
import { keyframes } from '@emotion/react';
import {
  MARKER_LABEL, optionsOf, type Answer, type Item, type Option, type Responses,
} from '@/lib/officialIntakeForm';
import type { FormDef } from '@/lib/intakeForms';
import { documentPages, annexSection, isShownOnDocument, DIGITAL_COPY_NOTICE, type DocPage } from '@/lib/intakeDocument';

/**
 * The intake as a document, beside the form: the same pages, section bars,
 * item numbers, labels and choices as the source form, drawn from the
 * answers being typed on the left - the one copy of them, held by the form.
 * Nothing here is editable; clicking a row only takes the official to that
 * item in the form.
 *
 * Shows what the PDF export prints (lib/intakeDocument.ts is the shared
 * layout). Nothing is stored in the browser and nothing is logged.
 */

export interface IntakeDocumentPreviewProps {
  form: FormDef;
  responses: Responses;
  caseNumber: string;
  status: 'DRAFT' | 'COMPLETED' | null;
  version: number | null;
  /** Answers on screen that are not saved yet - said on the copy. */
  unsaved?: boolean;
  /** The item just changed on the form: its row is brought into view and briefly marked. */
  changed?: { key: string; n: number } | null;
  /** The section being edited: the preview turns to the page it starts on. */
  focusKey?: string | null;
  onJump?: (key: string) => void;
  /** panel: beside the form, scrolling on its own. print: every page, for printing. */
  variant?: 'panel' | 'print';
}

const INK = '#111827';
const GRID = '#1f2937';
const SHADE = '#ececec';
const BAR = '#d6d6d6';
const FAINT = '#9ca3af';
const FONT = 'Arial, Helvetica, "Liberation Sans", sans-serif';

const flashA = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;
const flashB = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;

export default function IntakeDocumentPreview(props: IntakeDocumentPreviewProps) {
  const { form, responses, variant = 'panel', changed, focusKey } = props;
  const pages = useMemo(() => documentPages(form), [form]);
  const annex = annexSection(form);
  const showAnnex = Boolean(annex && annex.items.some(i => responses[i.key]));
  const total = pages.length + (showAnnex ? 1 : 0);
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(1);

  const goTo = useCallback((n: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    const box = scroller.current;
    if (!el || !box) return;
    box.scrollTo({ top: el.offsetTop - box.offsetTop - 8, behavior: 'smooth' });
    setCurrent(n);
  }, []);

  // The page in view, as the official scrolls.
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    let n = 1;
    box.querySelectorAll<HTMLElement>('[data-page]').forEach(p => { if (p.getBoundingClientRect().top - top <= 60) n = Number(p.dataset.page); });
    setCurrent(n);
  };

  // Turn to the section being edited.
  useEffect(() => {
    if (variant !== 'panel' || !focusKey) return;
    const p = pages.find(pg => pg.blocks.some(b => b.kind === 'item' && b.item.key === focusKey));
    if (p) goTo(p.number);
  }, [focusKey, pages, goTo, variant]);

  // Keep the row being typed into in view - inside the preview only, never moving the page.
  useEffect(() => {
    const box = scroller.current;
    if (variant !== 'panel' || !changed || !box) return;
    const row = box.querySelector<HTMLElement>(`[data-key="${changed.key}"]`);
    if (!row) return;
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < b.top + 40 || r.bottom > b.bottom - 20) box.scrollTop += r.top - b.top - b.height / 3;
  }, [changed, variant]);

  const pagesView = (
    <>
      {pages.map(p => <Page key={p.number} page={p} total={total} {...props} />)}
      {showAnnex && annex && <AnnexPage number={total} total={total} items={annex.items} {...props} />}
    </>
  );

  if (variant === 'print') return <Box className="intake-print-copy" sx={{ fontFamily: FONT }}>{pagesView}</Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}
      role="region" aria-label="Live document preview (read-only)">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Visibility sx={{ fontSize: 18, color: '#0f766e' }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>Live preview</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: '#64748b', display: { xs: 'none', sm: 'block' } }}>read-only - updates as you type</Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
          <Tooltip title="Previous page"><span><IconButton size="small" disabled={current <= 1} onClick={() => goTo(current - 1)} aria-label="Previous page"><ChevronLeft /></IconButton></span></Tooltip>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#0c1e46', minWidth: 78, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
            Page {current} of {total}
          </Typography>
          <Tooltip title="Next page"><span><IconButton size="small" disabled={current >= total} onClick={() => goTo(current + 1)} aria-label="Next page"><ChevronRight /></IconButton></span></Tooltip>
        </Box>
      </Box>
      <Box ref={scroller} onScroll={onScroll} data-testid="intake-preview-scroll"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: { xs: 1, sm: 2 }, display: 'block', fontFamily: FONT, '& > section + section': { mt: 2 } }}>
        {pagesView}
      </Box>
    </Box>
  );
}

// ── A page ──────────────────────────────────────────────────────────────────

function Sheet({ number, total, props, children }: { number: number; total: number; props: IntakeDocumentPreviewProps; children: React.ReactNode }) {
  const { form, responses, caseNumber, status, version, unsaved } = props;
  const [boxA, boxAKey, boxB, boxBKey] = form.pdf.box;
  const str = (k: string) => (typeof responses[k]?.value === 'string' ? (responses[k].value as string) : '');
  // As the PDF: the case number stands in for an empty reference box.
  const boxAValue = str(boxAKey) || (boxAKey === 'blotterReferenceNo' ? caseNumber : '');
  const boxBValue = str(boxBKey) || (boxBKey === 'incidentNo' ? caseNumber : '');
  return (
    <Box component="section" data-page={number} aria-label={`Page ${number} of ${total}`} className="intake-doc-page"
      sx={{ position: 'relative', bgcolor: '#fff', color: INK, width: '100%', maxWidth: 780, mx: 'auto', minHeight: { md: 1000 }, flexShrink: 0, boxSizing: 'border-box',
        p: { xs: '14px', sm: '28px 32px' }, boxShadow: '0 1px 4px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontSize: 11, lineHeight: 1.35, '@media print': { boxShadow: 'none', maxWidth: 'none', minHeight: 0, p: 0, breakAfter: 'page', pageBreakAfter: 'always' } }}>
      {status !== 'COMPLETED' && (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: 900, fontSize: { xs: 72, sm: 140 }, color: 'rgba(0,0,0,0.05)', transform: 'rotate(-35deg)', userSelect: 'none' }}>DRAFT</Typography>
        </Box>
      )}
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: number === 1 ? 0.75 : 1.25 }}>
          <Typography component="h3" sx={{ fontFamily: FONT, fontWeight: 800, fontSize: 15, color: INK, mt: 0.5 }}>{form.pdf.title}</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }}>
            <Box sx={{ bgcolor: '#fde047', px: 1.25, py: 0.25, fontWeight: 900, fontSize: 15, letterSpacing: '0.02em' }}>CONFIDENTIAL</Box>
            {number > 1 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: `1px solid ${GRID}`, fontSize: 9.5, fontWeight: 700, minWidth: { xs: 0, sm: 250 } }}>
                <Box sx={{ px: 0.75, py: 0.5, borderRight: `1px solid ${GRID}` }}>{boxA}: <Box component="span" sx={{ fontWeight: 400 }}>{boxAValue || '______'}</Box></Box>
                <Box sx={{ px: 0.75, py: 0.5 }}>{boxB}: <Box component="span" sx={{ fontWeight: 400 }}>{boxBValue || '______'}</Box></Box>
              </Box>
            )}
          </Box>
        </Box>
        {number === 1 && <Box sx={{ borderTop: `2px solid ${INK}`, mb: 1 }} />}
        {number === 1 && status === 'DRAFT' && (
          <Typography sx={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: '#b91c1c', mb: 0.75 }}>
            DRAFT - not completed. Some items may still be unanswered.
          </Typography>
        )}
        <Box sx={{ flex: 1 }}>{children}</Box>
        <Box component="footer" sx={{ mt: 2, pt: 1, borderTop: '1px solid #e5e7eb', display: 'grid', gap: 0.25 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <Typography sx={{ fontFamily: FONT, fontSize: 8.5, fontWeight: 700, color: '#b91c1c', flex: 1 }}>
              Reminder: Unauthorized use of the forms may be subject to penalties as provided for by the provisions of the Data Privacy Act of 2012
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Page {number} of {total}</Typography>
          </Box>
          <Typography sx={{ fontFamily: FONT, fontSize: 8, color: '#6b7280' }}>
            {DIGITAL_COPY_NOTICE} Case #{caseNumber}{version ? ` - version ${version}` : ''}{status ? ` - ${status === 'COMPLETED' ? 'completed' : 'draft'}` : ''}{unsaved ? ' - includes changes not yet saved' : ''}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function Page({ page, total, ...props }: { page: DocPage; total: number } & IntakeDocumentPreviewProps) {
  const { form, responses } = props;
  return (
    <Sheet number={page.number} total={total} props={props}>
      {page.blocks.map((b, i) => {
        if (b.kind === 'instructions') return <Instructions key={i} lines={form.pdf.instructions} />;
        if (b.kind === 'section') return <SectionBar key={i} title={b.title} />;
        if (b.kind === 'signatures') return <Signatures key={i} form={form} responses={responses} />;
        if (!isShownOnDocument(b.item, responses)) return null;
        return <Row key={b.item.key} item={b.item} answer={responses[b.item.key]} {...props} />;
      })}
    </Sheet>
  );
}

function AnnexPage({ number, total, items, ...props }: { number: number; total: number; items: Item[] } & IntakeDocumentPreviewProps) {
  return (
    <Sheet number={number} total={total} props={props}>
      <SectionBar title="ANNEX - SAFETY AND CONSENT CHECK (SafeComm addition, not part of the official form)" />
      {items.map(it => <Row key={it.key} item={it} answer={props.responses[it.key]} {...props} />)}
    </Sheet>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Instructions({ lines }: { lines: string[] }) {
  return (
    <Box sx={{ border: '1px solid #6b7280', bgcolor: '#f5f5f5', p: 1, mb: 1.25 }}>
      <Typography sx={{ fontFamily: FONT, fontWeight: 800, fontSize: 11, mb: 0.25 }}>INSTRUCTIONS</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
        {lines.map((l, i) => (
          <Typography component="li" key={i} sx={{ fontFamily: FONT, fontSize: 9.5, color: i === 0 ? '#b91c1c' : INK, fontWeight: i === 0 ? 700 : 400 }}>{l}</Typography>
        ))}
      </Box>
    </Box>
  );
}

function SectionBar({ title }: { title: string }) {
  return (
    <Box sx={{ bgcolor: BAR, border: `1px solid ${GRID}`, textAlign: 'center', fontWeight: 800, fontSize: 11, py: 0.4, mt: 1.25, textTransform: 'uppercase' }}>
      {title}
    </Box>
  );
}

function Row({ item, answer, changed, onJump, variant }: { item: Item; answer?: Answer } & IntakeDocumentPreviewProps) {
  const label = `${item.no ? `${item.no}. ` : ''}${item.label}`;
  const flash = changed?.key === item.key;
  const interactive = Boolean(onJump) && variant !== 'print';
  return (
    <Box data-key={item.key}
      {...(interactive && { role: 'button', tabIndex: 0, 'aria-label': `${label} - go to this item in the form`,
        onClick: () => onJump!(item.key), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump!(item.key); } } })}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '38% 62%', sm: '30% 70%' }, border: `1px solid ${GRID}`, borderTop: 0, breakInside: 'avoid',
        cursor: interactive ? 'pointer' : 'default',
        '&:focus-visible': { outline: '2px solid #0f766e', outlineOffset: -2 },
        ...(interactive && { '&:hover .val': { bgcolor: '#f0fdfa' } }),
        ...(flash && { '& .val': { animation: `${changed!.n % 2 ? flashA : flashB} 1.4s ease-out` } }),
        '@media (prefers-reduced-motion: reduce)': { '& .val': { animation: 'none' } } }}>
      <Box sx={{ bgcolor: SHADE, borderRight: `1px solid ${GRID}`, px: 0.75, py: 0.5, fontWeight: 700, fontSize: 10.5, overflowWrap: 'anywhere' }}>{label}</Box>
      <Box className="val" sx={{ px: 0.75, py: 0.5, minWidth: 0, overflowWrap: 'anywhere' }}><AnswerView item={item} a={answer} /></Box>
    </Box>
  );
}

const Empty = ({ text = 'Not answered' }: { text?: string }) => (
  <Box component="span" sx={{ color: FAINT, fontStyle: 'italic', fontSize: 10 }}>{text}</Box>
);

/** A box or circle, filled when chosen - as the paper form's choices. */
function Mark({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 10, height: 10, flexShrink: 0,
      border: `1px solid ${INK}`, borderRadius: round ? '50%' : '1px', mr: 0.5, mt: '2px', fontSize: 9, lineHeight: 1, fontWeight: 900,
      bgcolor: on && round ? INK : 'transparent', color: INK }}>
      {on && !round ? '✓' : ''}
    </Box>
  );
}

function Choices({ options, chosen, a, round }: { options: Option[]; chosen: Set<string>; a?: Answer; round?: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
      {options.map(op => {
        const on = chosen.has(op.value);
        const spec = op.specify ? a?.specify?.[op.value] : undefined;
        return (
          <Box key={op.value} sx={{ display: 'flex', alignItems: 'flex-start', fontWeight: on ? 700 : 400 }}
            aria-label={`${op.label}${on ? ' (selected)' : ''}`} data-selected={on ? 'true' : undefined}>
            <Mark on={on} round={round} />
            <span>{op.label}{op.specify && on ? <>: <Box component="span" sx={{ textDecoration: 'underline', fontWeight: 400 }}>{spec || '______'}</Box></> : null}</span>
          </Box>
        );
      })}
    </Box>
  );
}

const mmddyyyy = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[2]}/${m[3]}/${m[1]}` : s; };

function AnswerView({ item, a }: { item: Item; a?: Answer }) {
  if (a?.marker) return <Box component="span" sx={{ fontStyle: 'italic', fontWeight: 700 }}>{MARKER_LABEL[a.marker]}</Box>;
  const v = a?.value;
  const nothing = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  switch (item.type) {
    case 'single':
      return <><Choices options={optionsOf(item)} chosen={new Set(typeof v === 'string' ? [v] : [])} a={a} round />{nothing && <Empty />}</>;
    case 'multi':
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: (item.groups?.length ?? 0) > 2 ? '1fr 1fr' : '1fr' }, gap: 0.75 }}>
          {(item.groups ?? []).map(g => (
            <Box key={g.title}>
              <Box sx={{ fontWeight: 800, mb: 0.25 }}>{g.title}</Box>
              <Choices options={g.options} chosen={new Set(Array.isArray(v) ? v : [])} a={a} />
            </Box>
          ))}
          {nothing && <Empty text="Nothing selected" />}
        </Box>
      );
    case 'yesNoSpecify':
      return (
        <>
          <Choices options={[{ value: 'no', label: 'No' }, { value: 'yes', label: item.yesLabel ?? 'Yes, specify' }]} chosen={new Set(typeof v === 'string' ? [v] : [])} />
          {v === 'yes' && <Box sx={{ mt: 0.25, whiteSpace: 'pre-wrap' }}>{a?.specify?.yes || <Empty text="Not specified" />}</Box>}
          {nothing && <Empty />}
        </>
      );
    case 'yesNoDetail':
      return (
        <>
          <Choices options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} chosen={new Set(typeof v === 'string' ? [v] : [])} />
          <Box sx={{ fontStyle: 'italic', mt: 0.25 }}>If yes:</Box>
          <Choices options={item.detailOptions ?? []} chosen={new Set(v === 'yes' && a?.detail ? [a.detail] : [])} a={a} />
          {nothing && <Empty />}
        </>
      );
    case 'confirm':
      return <Choices options={[{ value: 'yes', label: 'Confirmed' }]} chosen={new Set(v === 'yes' ? ['yes'] : [])} />;
    case 'name': case 'address': case 'place': case 'location': {
      const obj = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, string>;
      const parts = item.parts ?? [];
      return (
        <>
          {item.homeless && <Box sx={{ mb: 0.25 }}><Choices options={[{ value: 'h', label: 'Homeless' }]} chosen={new Set(a?.homeless ? ['h'] : [])} /></Box>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: `repeat(${parts.length}, minmax(0, 1fr))` }, gap: 0.5 }}>
            {parts.map(p => (
              <Box key={p.key} sx={{ minWidth: 0 }}>
                <Box sx={{ fontSize: 8.5, fontStyle: 'italic', color: '#6b7280' }}>{p.label}</Box>
                <Box sx={{ minHeight: 15, borderBottom: '1px dotted #d1d5db' }}>{obj[p.key]?.trim() ? obj[p.key] : <Empty text="-" />}</Box>
              </Box>
            ))}
          </Box>
        </>
      );
    }
    case 'date':
      return typeof v === 'string' && v ? <span>{mmddyyyy(v)}</span> : <Empty />;
    case 'textarea':
      return (
        <Box sx={{ whiteSpace: 'pre-wrap', minHeight: item.key === 'description' ? 220 : 28, overflowWrap: 'anywhere' }}>
          {typeof v === 'string' && v ? v : <Empty />}
        </Box>
      );
    default:
      return typeof v === 'string' && v ? <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span> : <Empty />;
  }
}

function Signatures({ form, responses }: { form: FormDef; responses: Responses }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: { xs: 2, sm: 6 }, mt: 5 }}>
      {form.pdf.signatures.map(s => (
        <Box key={s.key} sx={{ textAlign: 'center' }}>
          <Box sx={{ minHeight: 18, fontSize: 9, fontStyle: 'italic', color: '#6b7280' }}>{responses[s.key]?.value === 'yes' ? '(signed on the paper form)' : ''}</Box>
          <Box sx={{ borderTop: `1px solid ${INK}`, pt: 0.5, fontWeight: 700, fontSize: 10 }}>{s.caption}</Box>
        </Box>
      ))}
    </Box>
  );
}
