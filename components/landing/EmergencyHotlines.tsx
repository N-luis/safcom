'use client';

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { Add, ContentCopy, ExpandMore, LocalFireDepartment, LocalPhone, Shield } from '@mui/icons-material';
import { copyText } from '@/lib/clipboard';
import { EMERGENCY_HOTLINES, QUICK_HOTLINES, type QuickKind } from '@/lib/emergencyHotlines';

/**
 * The landing page's Emergency Hotlines: three big buttons for police, fire
 * and rescue, and the full list behind "View all hotlines". Every number is
 * one button that copies that number only. Deliberately not a tel: link.
 */

const COPIED_MS = 1500;
/** A failure stays longer: the message says to copy the number by hand. */
const FAILED_MS = 6000;
const LINE = 'rgba(255,255,255,0.1)';
const GREEN = '#4ade80';
const AMBER = '#fbbf24';
const focusRing = { '&.Mui-focusVisible': { outline: '2px solid #60a5fa', outlineOffset: 1 } };

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

export default function EmergencyHotlines() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest click may report: an earlier one can finish after it.
  const latest = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** `slot` tells the big button and the list row for one number apart. */
  const copy = async (e: MouseEvent<HTMLElement>, slot: string, name: string, number: string) => {
    const button = e.currentTarget;
    const attempt = ++latest.current;
    const ok = await copyText(number);
    if (attempt !== latest.current) return;
    // The older copy route moves focus to a temporary field; give it back.
    button.focus({ preventScroll: true });
    if (!ok) {
      // Nothing reached the clipboard: select the number so it can be copied by hand.
      const text = button.querySelector('[data-number]');
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
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>Tap a number to copy</Typography>
        </Box>
      </Box>

      {/* The three big buttons: a row, or stacked on a phone. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
        {QUICK_HOTLINES.map(q => {
          const style = QUICK_STYLE[q.kind];
          const slot = `quick:${q.number}`;
          return (
            <ButtonBase key={q.kind} type="button" title="Copy Number" aria-label={`Copy ${q.label}, ${q.name}, number ${q.number}`}
              onClick={e => void copy(e, slot, q.name, q.number)}
              sx={{
                // A row on a phone; a column above it, labels at the top and the number at the bottom,
                // so the three line up even when an agency name wraps.
                display: { xs: 'grid', sm: 'flex' }, flexDirection: 'column', justifyContent: 'flex-start',
                borderRadius: 2, color: 'white', p: { xs: 1.25, sm: 1 }, textAlign: { xs: 'left', sm: 'center' },
                gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1.25, rowGap: 0.4, gap: { sm: 0.4 },
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                transition: 'background 0.15s ease, border-color 0.15s ease',
                '&:hover': { background: 'rgba(255,255,255,0.11)', borderColor: `${style.color}80` },
                '&:hover .copy-icon': { opacity: 1 },
                ...focusRing,
              }}>
              <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', color: style.color, background: `${style.color}26` }}>
                {style.icon}
              </Box>
              <Box component="span" sx={{ minWidth: 0 }}>
                <Box component="span" sx={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.25 }}>{q.label}</Box>
                <Box component="span" sx={{ display: 'block', color: 'rgba(255,255,255,0.68)', fontSize: '0.72rem', lineHeight: 1.25 }}>{q.name}</Box>
              </Box>
              <Box component="span" sx={{ display: 'grid', justifyItems: { xs: 'end', sm: 'center' }, rowGap: 0.25, mt: { sm: 'auto' }, pt: { sm: 0.5 } }}>
                <Box component="span" data-number sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text', fontSize: { xs: '0.92rem', sm: '0.82rem', md: '0.74rem', lg: '0.84rem' } }}>
                  {q.number}
                </Box>
                {/* A fixed height, so "Copied ✓" does not move the card. */}
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', height: 18, fontSize: '0.72rem', fontWeight: 700 }}>
                  <CopyState state={stateOf(slot)} />
                </Box>
              </Box>
            </ButtonBase>
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
                  return (
                    <ButtonBase key={number} type="button" title="Copy Number" aria-label={`Copy ${h.name} number ${number}`}
                      onClick={e => void copy(e, slot, h.name, number)}
                      sx={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5,
                        width: '100%', minHeight: { xs: 40, sm: 32 }, px: 0.75, borderRadius: 1, color: 'white',
                        '&:hover': { background: 'rgba(255,255,255,0.08)' },
                        '&:hover .copy-icon': { opacity: 1 },
                        ...focusRing,
                      }}>
                      <Box component="span" data-number sx={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text' }}>
                        {number}
                      </Box>
                      {/* A fixed width, so "Copied ✓" does not move the number. */}
                      <Box component="span" sx={{ display: 'inline-flex', justifyContent: 'flex-end', width: 62, flexShrink: 0, fontSize: '0.72rem', fontWeight: 700 }}>
                        <CopyState state={stateOf(slot)} />
                      </Box>
                    </ButtonBase>
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
          : { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
        {failed ? `Could not copy automatically. ${failed.number} is selected - copy it with Ctrl+C or a long press.`
          : result ? `${result.name} number ${result.number} copied` : ''}
      </Typography>
    </Box>
  );
}
