'use client';

import type { ReactNode } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';

/**
 * The Reporting charts' marks, in plain HTML so every segment and bar is a
 * real button (keyboard, screen reader, click-through to its case list).
 *
 * Colour: the three categorical hues below pass the palette validator (light
 * surface; adjacent CVD ΔE ≥ 9.2, normal-vision ΔE ≥ 27.6). "Not assessed" /
 * "not recorded" is not a series: a neutral grey with a hatch, so missing
 * data never reads as a category. Every mark carries its label and count as
 * text, never colour alone; text stays in ink colours.
 */

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
export const NEUTRAL = '#94a3b8';
export const HATCH = `repeating-linear-gradient(135deg, ${NEUTRAL} 0 3px, #cbd5e1 3px 6px)`;
export const INK = { primary: '#0c1e46', secondary: '#475569', muted: '#64748b' } as const;

/** A count that may be withheld (null): shown as "fewer than 3". */
export function CountText({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return (
      <Tooltip title="Fewer than 3 - withheld so that no one can be identified">
        <Box component="span" sx={{ borderBottom: '1px dotted', cursor: 'help' }}>&lt;3</Box>
      </Tooltip>
    );
  }
  return <>{value.toLocaleString('en-PH')}{suffix}</>;
}

export const pct = (n: number | null, of: number | null) => (n === null || !of ? null : Math.round((n / of) * 1000) / 10);
const pctText = (p: number | null) => (p === null ? '' : `${p}%`);

export interface Part { key: string; label: string; value: number | null; color?: string; neutral?: boolean; hint?: string }

/**
 * One whole split into parts: a single bar with a 2px gap between segments,
 * and beneath it a legend row per part with its count and share. Each row and
 * segment opens the cases behind it.
 */
export function SegmentBar({ parts, total, unit, onPick, label }: {
  parts: Part[]; total: number; unit: string; onPick?: (key: string) => void; label: string;
}) {
  const known = parts.filter(p => p.value !== null && p.value > 0);
  return (
    <Box>
      <Box role="img" aria-label={`${label}: ${parts.map(p => `${p.label} ${p.value ?? 'fewer than 3'}`).join(', ')}`}
        sx={{ display: 'flex', gap: '2px', height: 18, borderRadius: '4px', overflow: 'hidden', bgcolor: '#f1f5f9', mb: 1.25 }}>
        {known.map(p => (
          <Tooltip key={p.key} title={`${p.label}: ${p.value} ${unit} (${pctText(pct(p.value, total))})`}>
            <Box onClick={onPick ? () => onPick(p.key) : undefined}
              sx={{ flex: `${p.value} 0 0`, minWidth: 6, bgcolor: p.neutral ? undefined : p.color, backgroundImage: p.neutral ? HATCH : undefined,
                cursor: onPick ? 'pointer' : 'default', '&:hover': onPick ? { filter: 'brightness(0.92)' } : undefined }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 0.25 }}>
        {parts.map(p => <LegendRow key={p.key} part={p} total={total} unit={unit} onPick={onPick} />)}
      </Box>
    </Box>
  );
}

function LegendRow({ part: p, total, unit, onPick }: { part: Part; total: number; unit: string; onPick?: (key: string) => void }) {
  const share = pct(p.value, total);
  const body = (
    <>
      <Box sx={{ width: 12, height: 12, borderRadius: '3px', flexShrink: 0, bgcolor: p.neutral ? undefined : p.color, backgroundImage: p.neutral ? HATCH : undefined }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="span" sx={{ fontSize: '0.84rem', color: INK.primary, fontWeight: 600 }}>{p.label}</Typography>
        {p.hint && <Typography component="span" sx={{ fontSize: '0.74rem', color: INK.muted, ml: 0.75 }}>{p.hint}</Typography>}
      </Box>
      <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 800, color: INK.primary, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
        <CountText value={p.value} />
      </Typography>
      <Typography component="span" sx={{ fontSize: '0.78rem', color: INK.muted, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>{pctText(share)}</Typography>
    </>
  );
  return <Row onPick={onPick && p.value !== 0 ? () => onPick(p.key) : undefined} label={`${p.label}: ${p.value ?? 'fewer than 3'} ${unit}${share !== null ? `, ${share}%` : ''}`}>{body}</Row>;
}

/** A clickable row when there is something to open, plain otherwise. */
function Row({ onPick, label, children }: { onPick?: () => void; label: string; children: ReactNode }) {
  const sx = { display: 'flex', alignItems: 'center', gap: 1, px: 0.75, py: 0.6, borderRadius: 1.5, width: '100%', textAlign: 'left' as const, font: 'inherit', border: 0, bgcolor: 'transparent' };
  return onPick ? (
    <Box component="button" type="button" onClick={onPick} aria-label={`${label}. Open the list.`}
      sx={{ ...sx, cursor: 'pointer', '&:hover': { bgcolor: '#f1f5f9' }, '&:focus-visible': { outline: '2px solid #0f766e', outlineOffset: 1 } }}>{children}</Box>
  ) : <Box sx={sx}>{children}</Box>;
}

export interface Bar { key: string; label: string; value: number | null; hint?: string; neutral?: boolean }

/**
 * Horizontal bars on one baseline - for comparing parts. One hue; the length
 * is the count, the share is printed beside it with its denominator named.
 */
export function BarList({ bars, denominator, unit, color = SERIES[0], onPick, empty }: {
  bars: Bar[]; denominator: number | null; unit: string; color?: string; onPick?: (key: string) => void; empty?: string;
}) {
  const max = Math.max(1, ...bars.map(b => b.value ?? 0));
  if (!bars.length) return <Typography sx={{ fontSize: '0.84rem', color: INK.muted, py: 1 }}>{empty ?? 'Nothing to show.'}</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      {bars.map(b => {
        const share = pct(b.value, denominator);
        return (
          <Row key={b.key} onPick={onPick && b.value !== 0 ? () => onPick(b.key) : undefined}
            label={`${b.label}: ${b.value ?? 'fewer than 3'} ${unit}${share !== null ? `, ${share}%` : ''}`}>
            <Box sx={{ width: { xs: 120, sm: 190 }, flexShrink: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', color: INK.primary, fontWeight: 600, lineHeight: 1.25 }}>{b.label}</Typography>
              {b.hint && <Typography sx={{ fontSize: '0.72rem', color: INK.muted, lineHeight: 1.25 }}>{b.hint}</Typography>}
            </Box>
            <Box sx={{ flex: 1, minWidth: 40, height: 14, bgcolor: '#f1f5f9', borderRadius: '0 4px 4px 0' }}>
              <Box sx={{ height: '100%', width: `${((b.value ?? 0) / max) * 100}%`, minWidth: b.value ? 4 : 0, borderRadius: '0 4px 4px 0',
                bgcolor: b.neutral ? undefined : color, backgroundImage: b.neutral ? HATCH : undefined }} />
            </Box>
            <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 800, color: INK.primary, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>
              <CountText value={b.value} />
            </Typography>
            <Typography component="span" sx={{ fontSize: '0.78rem', color: INK.muted, fontVariantNumeric: 'tabular-nums', minWidth: 46, textAlign: 'right' }}>{pctText(share)}</Typography>
          </Row>
        );
      })}
    </Box>
  );
}

/** A headline number. Clickable when it opens a list. */
export function Stat({ label, value, hint, onPick, accent = INK.primary }: { label: string; value: number | null; hint?: string; onPick?: () => void; accent?: string }) {
  const inner = (
    <>
      <Typography sx={{ fontSize: '1.65rem', fontWeight: 800, color: INK.primary, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}><CountText value={value} /></Typography>
      <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155', mt: 0.25 }}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: '0.74rem', color: INK.muted, mt: 0.25 }}>{hint}</Typography>}
    </>
  );
  // A column from the top, so a button's card lines up with a plain one (a button centres its content by default).
  const sx = { border: '1px solid #e2e8f0', borderTop: `3px solid ${accent}`, borderRadius: 2, p: 1.5, height: '100%', bgcolor: '#fff', textAlign: 'left' as const, width: '100%', font: 'inherit',
    display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-start', alignItems: 'stretch' };
  return onPick && value !== 0 ? (
    <Box component="button" type="button" onClick={onPick} aria-label={`${label}: ${value ?? 'fewer than 3'}. Open the list.`}
      sx={{ ...sx, cursor: 'pointer', '&:hover': { boxShadow: '0 6px 18px rgba(12,30,70,0.08)' }, '&:focus-visible': { outline: '2px solid #0f766e', outlineOffset: 2 } }}>{inner}</Box>
  ) : <Box sx={sx}>{inner}</Box>;
}
