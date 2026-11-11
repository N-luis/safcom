'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { ContentCopy, LocalPhone } from '@mui/icons-material';
import { copyText } from '@/lib/clipboard';
import { EMERGENCY_HOTLINES } from '@/lib/emergencyHotlines';

/**
 * The landing page's Emergency Hotlines: each number is one button that
 * copies that number only. Deliberately not a tel: link.
 */

const COPIED_MS = 2000;
/** A failure stays longer: the message says to copy the number by hand. */
const FAILED_MS = 6000;
const LINE = 'rgba(255,255,255,0.1)';

interface Result { name: string; number: string; ok: boolean }

export default function EmergencyHotlines() {
  const [result, setResult] = useState<Result | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest click may report: an earlier one can finish after it.
  const latest = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (e: MouseEvent<HTMLElement>, name: string, number: string) => {
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
    setResult({ name, number, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), ok ? COPIED_MS : FAILED_MS);
  };

  const failed = result && !result.ok ? result : null;

  return (
    <Box component="section" aria-labelledby="emergency-hotlines-title" data-testid="emergency-hotlines"
      sx={{
        width: '100%', maxWidth: { xs: 560, md: 420 }, ml: { md: 'auto' }, boxSizing: 'border-box',
        p: { xs: 2, lg: 2.5 }, borderRadius: 2,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
      }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1.25 }}>
        <LocalPhone sx={{ fontSize: 20, color: '#60a5fa' }} />
        <Typography id="emergency-hotlines-title" component="h2" sx={{ fontWeight: 700, color: 'white', fontSize: '1.05rem' }}>
          Emergency Hotlines
        </Typography>
      </Box>

      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {EMERGENCY_HOTLINES.map(h => (
          <Box component="li" key={h.name}
            sx={{
              display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
              columnGap: 1.5, alignItems: 'start', borderTop: `1px solid ${LINE}`, py: 0.5,
            }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.72)', fontSize: '0.74rem', fontWeight: 600, letterSpacing: '0.03em', lineHeight: 1.3, pt: { sm: 0.9 }, pb: { xs: 0.25, sm: 0 } }}>
              {h.name}
            </Typography>
            <Box>
              {h.numbers.map(number => {
                const state = result?.number === number ? result : null;
                return (
                  <ButtonBase key={number} type="button" title="Copy Number" aria-label={`Copy ${h.name} number ${number}`}
                    onClick={e => void copy(e, h.name, number)}
                    sx={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5,
                      width: '100%', minHeight: { xs: 40, sm: 32 }, px: 0.75, borderRadius: 1, color: 'white',
                      '&:hover': { background: 'rgba(255,255,255,0.08)' },
                      '&:hover .copy-icon': { opacity: 1 },
                      '&.Mui-focusVisible': { outline: '2px solid #60a5fa', outlineOffset: -2 },
                    }}>
                    <Box component="span" data-number sx={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', userSelect: 'text' }}>
                      {number}
                    </Box>
                    {/* A fixed width, so "Copied!" does not move the number. */}
                    <Box component="span" sx={{ display: 'inline-flex', justifyContent: 'flex-end', width: 62, flexShrink: 0, fontSize: '0.72rem', fontWeight: 700 }}>
                      {state?.ok ? <Box component="span" sx={{ color: '#4ade80' }}>Copied!</Box>
                        : state ? <Box component="span" sx={{ color: '#fbbf24' }}>Not copied</Box>
                          : <ContentCopy className="copy-icon" sx={{ fontSize: 15, color: '#93c5fd', opacity: 0.75 }} />}
                    </Box>
                  </ButtonBase>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Read aloud on every copy; shown only when a copy failed. */}
      <Typography role="status" aria-live="polite"
        sx={failed
          ? { mt: 1, color: '#fbbf24', fontSize: '0.78rem', lineHeight: 1.4 }
          : { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
        {failed ? `Could not copy automatically. ${failed.number} is selected - copy it with Ctrl+C or a long press.`
          : result ? `${result.name} number ${result.number} copied` : ''}
      </Typography>
    </Box>
  );
}
