'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

/**
 * A donut with its legend, linked: pointing at a slice or its legend row -
 * with a mouse, a finger or the keyboard - fades the other slices, highlights
 * the row, and shows that slice's name, share and count in the middle.
 * Leaving shows the total again. The donut scales with its card and the
 * legend moves under it when there is no room beside it.
 */

export interface DonutSlice {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Opens what this slice stands for (e.g. a filtered case list). */
  onSelect?: () => void;
}

/**
 * Each share rounded to one decimal place, on its own. Whole numbers made
 * 17.4 / 4.3 / 78.3 read 17 + 4 + 78 = 99; forcing a total of exactly 100
 * would push some slice off its true value (4 of 23 shown as 18%) or give two
 * equal counts different shares. At one decimal the total is 100, or 99.9 /
 * 100.1 at most - and every slice is its own true share.
 */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  return counts.map(c => Math.round((c / total) * 1000) / 10);
}
/** "25%" for a whole share, "17.4%" otherwise. */
export const pctText = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}%`;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`;

/** In fill mode: the legend's narrowest, the gap beside it, the narrowest and the largest a donut is drawn. */
const LEGEND_MIN = 260, GAP = 24, DONUT_MIN = 170, DONUT_MAX = 230;

export default function DonutBreakdown({ slices, centerValue, centerLabel, unit = ['case', 'cases'], maxSize = 210, footer, ariaLabel, fill = false }: {
  slices: DonutSlice[];
  /** What the middle shows when nothing is pointed at (default: the total). */
  centerValue?: ReactNode;
  centerLabel?: string;
  unit?: [string, string];
  /** The donut's largest size in px; smaller cards get a smaller donut. */
  maxSize?: number;
  footer?: ReactNode;
  ariaLabel: string;
  /**
   * Fill the space it is given (its parent sets the height): the donut grows
   * as large as the width beside the legend allows, and the legend rows share
   * the full height, so a card stretched to match its neighbour has no empty
   * area at the bottom.
   * Where there is no room beside it, the legend goes under the donut as usual.
   */
  fill?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!fill || !el) return;
    const ro = new ResizeObserver(([e]) => setSpace({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  // Side by side when the legend keeps its room. The donut stays modest - at most 60% of the
  // card's height and DONUT_MAX - in a column just wider than itself; the legend takes the rest
  // of the width and the full height, so the card is still filled.
  const side = Boolean(fill && space && space.w - GAP - LEGEND_MIN >= DONUT_MIN && space.h >= DONUT_MIN);
  const size = side && space ? Math.floor(Math.max(DONUT_MIN, Math.min(space.h * 0.6, (space.w - GAP - LEGEND_MIN) * 0.85, space.w * 0.4, DONUT_MAX))) : null;
  const column = side && space && size ? Math.floor(Math.min(space.w - GAP - LEGEND_MIN, size + 48)) : null;
  const total = slices.reduce((n, s) => n + s.count, 0);
  const pct = percentages(slices.map(s => s.count));
  // The ring draws only what has cases; the legend lists everything.
  const ring = slices.map((s, i) => ({ ...s, i })).filter(s => s.count > 0);
  const a = active !== null ? slices[active] : null;

  return (
    <Box ref={box} data-fill={fill ? (side ? 'side' : 'stacked') : undefined}
      sx={{ display: 'flex', flexWrap: side ? 'nowrap' : 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: `${GAP}px`, rowGap: 1.5,
        ...(fill && { height: '100%' }) }}>
      <Box sx={column ? { flex: `0 0 ${column}px`, display: 'flex', justifyContent: 'center' } : { display: 'contents' }}>
      <Box role="img" aria-label={`${ariaLabel}: ${slices.map((s, i) => `${s.label} ${plural(s.count, ...unit)}, ${pctText(pct[i])}`).join('; ')}`}
        onMouseLeave={() => setActive(null)}
        sx={size ? { position: 'relative', width: size, height: size, flex: '0 0 auto' }
          : { position: 'relative', width: `min(100%, ${maxSize}px)`, aspectRatio: '1 / 1', flex: `0 1 ${maxSize}px`, minWidth: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={ring} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius="64%" outerRadius="94%"
              paddingAngle={ring.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}
              onMouseEnter={(_: unknown, j: number) => setActive(ring[j]?.i ?? null)}
              // A tap is also a hover on a phone: the tap shows the slice (a toggle would undo it at once).
              onClick={(_: unknown, j: number) => setActive(ring[j]?.i ?? null)}>
              {ring.map(s => (
                <Cell key={s.key} fill={s.color} style={{ cursor: 'pointer', outline: 'none', transition: 'opacity 0.15s' }}
                  // The others fade rather than this one growing, so nothing shifts.
                  opacity={active === null || active === s.i ? 1 : 0.3} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* The middle: the slice pointed at, or the total. Never takes the pointer. */}
        <Box aria-live="polite" sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', textAlign: 'center', px: '22%' }}>
          {a ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: a.color, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', lineHeight: 1.2, overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{a.label}</Typography>
              </Box>
              <Typography sx={{ fontSize: size ? `${Math.min(48, Math.round(size * 0.12))}px` : 'clamp(1.2rem, 4.5vw, 1.6rem)', fontWeight: 800, color: '#0c1e46', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{pctText(pct[active!])}</Typography>
              <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>{plural(a.count, ...unit)}</Typography>
            </>
          ) : (
            <>
              <Typography sx={{ fontSize: size ? `${Math.min(56, Math.round(size * 0.14))}px` : 'clamp(1.3rem, 5vw, 1.8rem)', fontWeight: 800, color: '#0c1e46', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{centerValue ?? total.toLocaleString('en-PH')}</Typography>
              <Typography sx={{ fontSize: size ? `${Math.min(15, Math.max(11.5, Math.round(size * 0.035)))}px` : '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', mt: 0.25 }}>{centerLabel ?? 'Total'}</Typography>
            </>
          )}
        </Box>
      </Box>
      </Box>

      {/* The legend: each row points at its slice; a row that opens something is a button. */}
      <Box role="list" aria-label={`${ariaLabel} legend`} onMouseLeave={() => setActive(null)}
        // Beside a filled donut, the rows share the whole height evenly - never shorter than a normal row.
        sx={size ? { flex: '1 1 auto', minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column' } : { flex: '1 1 200px', minWidth: 0, maxWidth: 420 }}>
        {slices.map((s, i) => {
          const on = active === i;
          const dim = active !== null && !on;
          const row = (
            <>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color, flexShrink: 0, opacity: s.count ? 1 : 0.4 }} />
              <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.88rem', color: s.count ? '#334155' : '#94a3b8', fontWeight: on ? 700 : 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</Typography>
              <Typography component="span" sx={{ fontSize: '0.8rem', color: '#64748b', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{s.count.toLocaleString('en-PH')}</Typography>
              <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46', fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>{pctText(pct[i])}</Typography>
            </>
          );
          const sx = {
            display: 'flex', alignItems: 'center', gap: 1, width: '100%', px: 1, py: 0.9, border: 0, ...(size && { height: '100%', px: 1.5 }), borderRadius: 1.5, font: 'inherit', textAlign: 'left' as const,
            bgcolor: on ? '#f1f5f9' : 'transparent', opacity: dim ? 0.55 : 1, transition: 'background-color 0.15s, opacity 0.15s',
            boxShadow: on ? `inset 3px 0 0 ${s.color}` : 'none', outline: 'none',
            '&:focus-visible': { boxShadow: `inset 0 0 0 2px #0f766e` },
          };
          const label = `${s.label}: ${plural(s.count, ...unit)}, ${pctText(pct[i])}`;
          const events = { onMouseEnter: () => setActive(i), onFocus: () => setActive(i), onBlur: () => setActive(null) };
          return (
            <Box key={s.key} role="listitem" sx={{ borderBottom: '1px solid #f1f5f9', ...(size && { flex: '1 0 auto', display: 'flex' }) }}>
              {s.onSelect ? (
                <Box component="button" type="button" onClick={s.onSelect} aria-label={`${label}. Open the list.`} {...events} sx={{ ...sx, cursor: 'pointer' }}>{row}</Box>
              ) : (
                <Box tabIndex={0} aria-label={label} {...events} onClick={() => setActive(i)} sx={{ ...sx, cursor: 'default' }}>{row}</Box>
              )}
            </Box>
          );
        })}
        {footer}
      </Box>
    </Box>
  );
}
