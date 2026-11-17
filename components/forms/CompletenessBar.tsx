'use client';

import { Box } from '@mui/material';
import { keyframes } from '@mui/system';
import type { Completeness } from '@/lib/intake';

/**
 * "How complete is the information" - three blocks, one per level the server
 * reads (not enough yet, partial, enough for a preliminary assessment).
 *
 * It moves with the questions: the block of the level the report is at fills
 * as the resident answers (or skips) each question, and is full once nothing
 * is left to ask; when the server reads a higher level, the next block fills
 * in, and the colour changes with it. It never runs into a block the server
 * has not reached, so the bar can never say more than the reading does. While
 * the next reading is on its way the block being filled shimmers.
 */

const LEVEL: Record<Completeness, number> = { INSUFFICIENT: 1, PARTIAL: 2, SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: 3 };
export const LEVEL_COLOR: Record<Completeness, string> = {
  INSUFFICIENT: '#f97316', PARTIAL: '#eab308', SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: '#22c55e',
};
/** How much of the current block shows before any question is answered - enough to see. */
const START = 0.15;

/**
 * How far the questions have come, 0..1: the answers so far against those
 * still known to be coming. Full only when nothing is left to ask.
 */
export function questionProgress(answered: number, remaining: number, moreToCome: boolean): number {
  if (remaining <= 0 && !moreToCome) return 1;
  const left = Math.max(remaining, 0) + (moreToCome ? 1 : 0);
  return answered / (answered + Math.max(left, 1));
}

/** Each block's fill, 0..1: blocks below the level full, the level's own block by the questions' progress, none above. */
export function blockFills(level: Completeness, progress: number): [number, number, number] {
  const L = LEVEL[level];
  const own = L === 3 ? 1 : START + (1 - START) * Math.min(Math.max(progress, 0), 1);
  return [1, 2, 3].map(i => (i < L ? 1 : i === L ? own : 0)) as [number, number, number];
}

const shimmer = keyframes`0% { transform: translateX(-100%); } 100% { transform: translateX(100%); }`;

export default function CompletenessBar({ level, progress, loading, label }: {
  level: Completeness;
  progress: number;
  /** A new reading is on its way (an answer was just sent). */
  loading: boolean;
  /** The level in words, for screen readers. */
  label: string;
}) {
  const fills = blockFills(level, progress);
  const color = LEVEL_COLOR[level];
  const active = LEVEL[level] - 1;
  const overall = Math.round(((fills[0] + fills[1] + fills[2]) / 3) * 100);
  return (
    <Box role="progressbar" data-testid="completeness-bar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall} aria-valuetext={label} aria-busy={loading}
      data-level={level} data-fills={fills.map(f => f.toFixed(2)).join(',')}
      sx={{ display: 'flex', gap: 0.5, width: '100%' }}>
      {fills.map((f, i) => (
        <Box key={i} sx={{ position: 'relative', flex: '1 1 0', minWidth: 0, height: { xs: 8, sm: 6 }, borderRadius: 3, bgcolor: '#e2e8f0', overflow: 'hidden' }}>
          <Box data-fill={i} sx={{
            position: 'absolute', inset: 0, right: 'auto', width: `${f * 100}%`, borderRadius: 3, bgcolor: color,
            transition: 'width 600ms cubic-bezier(0.22, 1, 0.36, 1), background-color 400ms ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }} />
          {loading && i === active && (
            <Box aria-hidden sx={{
              position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent, ${color}55, transparent)`,
              animation: `${shimmer} 1.1s ease-in-out infinite`,
              '@media (prefers-reduced-motion: reduce)': { animation: 'none', bgcolor: `${color}22` },
            }} />
          )}
        </Box>
      ))}
    </Box>
  );
}
