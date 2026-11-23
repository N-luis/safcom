'use client';

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { Add, ContentCopy, ExpandMore, LocalFireDepartment, LocalPhone, Shield } from '@mui/icons-material';
import { copyText } from '@/lib/clipboard';
import { EMERGENCY_HOTLINES, QUICK_HOTLINES, telHref, type QuickKind } from '@/lib/emergencyHotlines';

/**
 * The landing page's Emergency Hotlines: three big cards for police, fire
 * and rescue, and the full list behind "View all hotlines".
 *
 * Tapping a card or a number calls it: a plain tel: link to that number
 * only (lib/emergencyHotlines.ts telHref), so the phone opens its dialer
 * with the number ready and the person starts the call there. SafeComm
 * never places a call or says one was made. The copy icon beside each
 * number is its own button and copies that number only. A number that
 * cannot be dialled gets no link: tapping it copies, as before.
 *
 * The link is "stretched" over its card or row (a ::after covering it), and
 * the copy button sits above that layer - so the look is unchanged and no
 * button is nested inside a link.
 */

const COPIED_MS = 1500;
/** A failure stays longer: the message says to copy the number by hand. */
const FAILED_MS = 6000;
const LINE = 'rgba(255,255,255,0.1)';
const GREEN = '#4ade80';
const AMBER = '#fbbf24';
const RING = { outline: '2px solid #60a5fa', outlineOffset: 1 };
const focusRing = { '&.Mui-focusVisible': RING };
/** The link (or, for a number that cannot be dialled, the copy button) covers its whole card or row. */
const stretched = { position: 'static', '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' } } as const;
/** Above the stretched layer, so the copy button gets its own taps. */
const above = { position: 'relative', zIndex: 1 } as const;

const QUICK_STYLE: Record<QuickKind, { icon: ReactNode; color: string }> = {
  police: { icon: <Shield sx={{ fontSize: 20 }} />, color: '#60a5fa' },
  fire: { icon: <LocalFireDepartment sx={{ fontSize: 20 }} />, color: '#fb923c' },
  rescue: { icon: <Add sx={{ fontSize: 22 }} />, color: '#f87171' },
};

interface Result { slot: string; name: string; number: string; ok: boolean }

function CopyState({ state }: { state: Result | null }) {
  if (state?.ok) return <Box component="span" sx={{ color: GREEN }}>Copied ✓</Box>;
  if (state) return <Box component="span" sx={{ color: AMBER }}>Not copied</Box>;
  return <ContentCopy className="copy-icon" sx={{ fontSize: 15, color: '#93c5fd', opacity: 0.75 }} />;
}

/** Whether this device has a mouse and no touch screen - it may have no calling app. */
function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: fine) and (hover: hover)');
    const sync = () => setDesktop(Boolean(mq?.matches));
    sync();
    mq?.addEventListener?.('change', sync);
    return () => mq?.removeEventListener?.('change', sync);
  }, []);
  return desktop;
}

export default function EmergencyHotlines() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const desktop = useDesktop();
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest click may report: an earlier one can finish after it.
  const latest = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** `slot` tells the big card and the list row for one number apart. */
  const copy = async (e: MouseEvent<HTMLElement>, slot: string, name: string, number: string) => {
    const button = e.currentTarget;
    const attempt = ++latest.current;
    const ok = await copyText(number);
    if (attempt !== latest.current) return;
    // The older copy route moves focus to a temporary field; give it back.
    button.focus({ preventScroll: true });
    if (!ok) {
      // Nothing reached the clipboard: select the number so it can be copied by hand.
      const text = button.closest('[data-hotline]')?.querySelector('[data-number]');
      const selection = window.getSelection();
      if (text && selection) {
        const range = document.createRange();
        range.selectNodeContents(text);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    setResult({ slot, name, number, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), ok ? COPIED_MS : FAILED_MS);
  };

  const stateOf = (slot: string) => (result?.slot === slot ? result : null);
  const failed = result && !result.ok ? result : null;

  return (
    <Box component="section" aria-labelledby="emergency-hotlines-title" data-testid="emergency-hotlines"
      sx={{
        width: '100%', maxWidth: { xs: 560, md: 420 }, ml: { md: 'auto' }, boxSizing: 'border-box',
        p: { xs: 2, lg: 2.5 }, borderRadius: 2.5,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
      }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
        <LocalPhone sx={{ fontSize: 22, color: '#60a5fa' }} />
        <Box>
          <Typography id="emergency-hotlines-title" component="h2" sx={{ fontWeight: 700, color: 'white', fontSize: '1.05rem', lineHeight: 1.25 }}>
            Emergency Hotlines
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
            {desktop ? 'Click a number to call · copy icon to copy' : 'Tap a number to call · copy icon to copy'}
          </Typography>
        </Box>
      </Box>

      {/* The three big cards: a row, or stacked on a phone. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
        {QUICK_HOTLINES.map(q => {
          const style = QUICK_STYLE[q.kind];
          const slot = `quick:${q.number}`;
          const href = telHref(q.number);
          return (
            <Box key={q.kind} data-hotline data-testid={`quick-${q.kind}`}
              sx={{
                position: 'relative',
                // A row on a phone; a column above it, labels at the top and the number at the bottom,
                // so the three line up even when an agency name wraps.
                display: { xs: 'grid', sm: 'flex' }, flexDirection: 'column', justifyContent: 'flex-start',
                borderRadius: 2, color: 'white', p: { xs: 1.25, sm: 1 }, textAlign: { xs: 'left', sm: 'center' },
                gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1.25, rowGap: 0.4, gap: { sm: 0.4 },
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                transition: 'background 0.15s ease, border-color 0.15s ease',
                '&:hover': { background: 'rgba(255,255,255,0.11)', borderColor: `${style.color}80` },
                '&:hover .copy-icon': { opacity: 1 },
                '&:has(.stretch.Mui-focusVisible)': RING,
              }}>
              <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', color: style.color, background: `${style.color}26` }}>
                {style.icon}
              </Box>
              <Box component="span" sx={{ minWidth: 0 }}>
                <Box component="span" sx={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.25 }}>{q.label}</Box>
                <Box component="span" sx={{ display: 'block', color: 'rgba(255,255,255,0.68)', fontSize: '0.72rem', lineHeight: 1.25 }}>{q.name}</Box>
              </Box>
              <Box component="span" sx={{ display: 'grid', justifyItems: { xs: 'end', sm: 'center' }, rowGap: 0.25, mt: { sm: 'auto' }, pt: { sm: 0.5 } }}>
                {href ? (
                  <ButtonBase component="a" href={href} className="stretch" title={desktop ? "Call - opens your calling app if this computer has one" : "Call"} aria-label={`Call ${q.label}, ${q.name}, ${q.number}`}
                    disableRipple sx={{ ...stretched, color: 'inherit', font: 'inherit', borderRadius: 2 }}>
                    <Box component="span" data-number sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text', fontSize: { xs: '0.92rem', sm: '0.82rem', md: '0.74rem', lg: '0.84rem' } }}>
                      {q.number}
                    </Box>
                  </ButtonBase>
                ) : (
                  <ButtonBase type="button" className="stretch" title="Copy Number" aria-label={`Copy ${q.label}, ${q.name}, number ${q.number}`}
                    onClick={e => void copy(e, slot, q.name, q.number)} disableRipple sx={{ ...stretched, color: 'inherit', font: 'inherit', borderRadius: 2 }}>
                    <Box component="span" data-number sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text', fontSize: { xs: '0.92rem', sm: '0.82rem', md: '0.74rem', lg: '0.84rem' } }}>
                      {q.number}
                    </Box>
                  </ButtonBase>
                )}
                {/* A fixed height, so "Copied ✓" does not move the card. */}
                <ButtonBase type="button" title="Copy Number" aria-label={`Copy ${q.label}, ${q.name}, number ${q.number}`}
                  onClick={e => void copy(e, slot, q.name, q.number)}
                  sx={{ ...above, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 18, minWidth: 28, px: 0.5, borderRadius: 1,
                    fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', ...focusRing,
                    // A bigger tap target than it looks, without moving anything.
                    '&::before': { content: '""', position: 'absolute', inset: '-8px -6px' } }}>
                  <CopyState state={stateOf(slot)} />
                </ButtonBase>
              </Box>
            </Box>
          );
        })}
      </Box>

      <ButtonBase type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(o => !o)}
        sx={{
          width: '100%', mt: 1, minHeight: 40, borderRadius: 2, gap: 0.5, color: '#93c5fd', fontWeight: 600, fontSize: '0.86rem', fontFamily: 'inherit',
          '&:hover': { background: 'rgba(255,255,255,0.06)' },
          ...focusRing,
        }}>
        {open ? 'Hide all hotlines' : 'View all hotlines'}
        <ExpandMore sx={{ fontSize: 20, transition: 'transform 0.25s ease', transform: open ? 'rotate(180deg)' : 'none',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />
      </ButtonBase>

      {/* Hidden from the keyboard and screen readers while collapsed. */}
      <Collapse in={open} timeout={260} id={listId}
        sx={{ '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms !important' } }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.75, p: 0 }}>
          {EMERGENCY_HOTLINES.map(h => (
            <Box component="li" key={h.name}
              sx={{
                display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
                columnGap: 1.5, alignItems: 'start', borderTop: `1px solid ${LINE}`, py: 0.5,
              }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.84rem', fontWeight: 500, lineHeight: 1.3, pt: { sm: 0.75 }, pb: { xs: 0.25, sm: 0 } }}>
                {h.name}
              </Typography>
              <Box>
                {h.numbers.map(number => {
                  const slot = `list:${number}`;
                  const href = telHref(number);
                  const numberText = (
                    <Box component="span" data-number sx={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text' }}>
                      {number}
                    </Box>
                  );
                  return (
                    <Box key={number} data-hotline
                      sx={{
                        position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5,
                        width: '100%', minHeight: { xs: 40, sm: 32 }, px: 0.75, borderRadius: 1, color: 'white', boxSizing: 'border-box',
                        '&:hover': { background: 'rgba(255,255,255,0.08)' },
                        '&:hover .copy-icon': { opacity: 1 },
                        '&:has(.stretch.Mui-focusVisible)': RING,
                      }}>
                      {href ? (
                        <ButtonBase component="a" href={href} className="stretch" title={desktop ? "Call - opens your calling app if this computer has one" : "Call"} aria-label={`Call ${h.name}, ${number}`}
                          disableRipple sx={{ ...stretched, color: 'inherit', font: 'inherit', borderRadius: 1 }}>
                          {numberText}
                        </ButtonBase>
                      ) : (
                        <ButtonBase type="button" className="stretch" title="Copy Number" aria-label={`Copy ${h.name} number ${number}`}
                          onClick={e => void copy(e, slot, h.name, number)} disableRipple sx={{ ...stretched, color: 'inherit', font: 'inherit', borderRadius: 1 }}>
                          {numberText}
                        </ButtonBase>
                      )}
                      {/* A fixed width, so "Copied ✓" does not move the number. */}
                      <ButtonBase type="button" title="Copy Number" aria-label={`Copy ${h.name} number ${number}`}
                        onClick={e => void copy(e, slot, h.name, number)}
                        sx={{ ...above, display: 'inline-flex', justifyContent: 'flex-end', width: 62, flexShrink: 0, minHeight: 28, borderRadius: 1,
                          fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', ...focusRing }}>
                        <CopyState state={stateOf(slot)} />
                      </ButtonBase>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      </Collapse>

      {/* Read aloud on every copy; shown only when a copy failed. */}
      <Typography role="status" aria-live="polite"
        sx={failed
          ? { mt: 1, color: AMBER, fontSize: '0.78rem', lineHeight: 1.4 }
          // Visually hidden. Pixel strings: in sx a bare 1 means 100%, which pushed this off the side of the page.
          : { position: 'absolute', width: '1px', height: '1px', m: '-1px', p: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 }}>
        {failed ? `Could not copy automatically. ${failed.number} is selected - copy it with Ctrl+C or a long press.`
          : result ? `${result.name} number ${result.number} copied` : ''}
      </Typography>
    </Box>
  );
}
