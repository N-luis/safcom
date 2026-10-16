'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { Place, TouchApp } from '@mui/icons-material';
import {
  BarangayBaseUnder, BarangayBaseOver, FONT, MAP_W, MAP_H,
} from '@/components/maps/BarangayBaseArt';
import type { BarangayStreet } from '@/lib/streets';
import { TARGETS, type Shape, type Target } from '@/lib/barangayStreetTargets';
import { pointForStreet } from '@/lib/streetPoints';

/**
 * The barangay's own map, used to choose the street an incident happened on.
 *
 * Residents know this drawing - it is the map on the wall of the hall, with
 * the Shell station, McDonald's and the Brgy Hall where they expect them.
 * Finding "Eugenio Compound" on it is immediate in a way that finding it in a
 * dropdown, or on a world map zoomed to a patch of grey roofs, is not.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. No risk. No heat, no colours that mean severity, no incident counts.
 *    That map is the officers'. Someone about to report something they are
 *    frightened of should not first be shown that their street is red, and
 *    the counts are not theirs to see.
 *
 * 2. No coordinates. The drawing is a diagram, not a projection - see the
 *    note in BarangayBaseArt. A tap here names a street; a coordinate, if
 *    there is to be one, comes from a point checked against a geocoder.
 */

const ACCENT = '#14b8a6';


/**
 * Only what a shape is painted with. Spreading SVGProps instead fails to
 * typecheck: rect, line and path disagree about what their ref points at,
 * and nothing here ever takes a ref.
 */
interface Paint {
  fill?: string;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

type ShapeElProps = { sh: Shape } & Paint;

function ShapeEl({ sh, ...rest }: ShapeElProps) {
  if (sh.t === 'rect') {
    return <rect x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={2} {...rest} />;
  }
  if (sh.t === 'line') {
    return (
      <line
        x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2}
        strokeWidth={sh.w} strokeLinecap="round" {...rest}
      />
    );
  }
  return <path d={sh.d} strokeWidth={sh.w} strokeLinecap="round" {...rest} />;
}

export default function BarangayStreetMap({ value, onPick, disabled }: {
  /** The street currently chosen in the form, so the map agrees with it. */
  value?: string;
  onPick: (street: BarangayStreet) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<Target | null>(null);

  const selected = TARGETS.find(t => t.street === value) ?? null;
  const shown = hover ?? selected;
  // Only claims an exact point where a real, read-back coordinate exists.
  const exact = shown ? Boolean(pointForStreet(shown.street)) : false;

  const choose = (t: Target) => { if (!disabled) onPick(t.street); };

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
      <Box sx={{
        px: 1.5, py: 1, borderBottom: '1px solid #eef2f6',
        display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
      }}>
        <TouchApp sx={{ fontSize: 16, color: ACCENT }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>
          Tap the street where it happened
        </Typography>
        {selected && (
          <Chip
            label={selected.street}
            size="small"
            sx={{
              ml: 'auto', bgcolor: `${ACCENT}18`, color: '#0f766e',
              fontWeight: 700, fontSize: '0.74rem', height: 22,
            }}
          />
        )}
      </Box>

      <Box sx={{ bgcolor: '#fdfbf7' }}>
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'manipulation' }}
          aria-label="Map of Biñang 2nd, Bocaue. Tap a street to choose where the incident happened."
          role="group"
        >
          <BarangayBaseUnder />
          <BarangayBaseOver />

          {/* The chosen road, lit along its length under the pin. */}
          {selected?.show.map((sh, i) => (
            <ShapeEl
              key={`sel-${i}`} sh={sh}
              fill={sh.t === 'rect' ? ACCENT : 'none'}
              stroke={ACCENT}
              strokeOpacity={sh.t === 'rect' ? 0 : 0.75}
              style={{ pointerEvents: 'none', opacity: sh.t === 'rect' ? 0.55 : 1 }}
            />
          ))}

          {/* Hover only previews; it never changes what is chosen. */}
          {hover && hover !== selected && hover.show.map((sh, i) => (
            <ShapeEl
              key={`hov-${i}`} sh={sh}
              fill={sh.t === 'rect' ? ACCENT : 'none'}
              stroke={ACCENT}
              strokeOpacity={sh.t === 'rect' ? 0 : 0.4}
              style={{ pointerEvents: 'none', opacity: sh.t === 'rect' ? 0.3 : 1 }}
            />
          ))}

          {/* Tap targets. Invisible, but each is a real button to a screen
              reader and reachable from the keyboard. */}
          {TARGETS.map(t => (
            <g
              key={t.street}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${t.street} — ${t.near}`}
              aria-pressed={value === t.street}
              onClick={() => choose(t)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(t); }
              }}
              onMouseEnter={() => setHover(t)}
              onMouseLeave={() => setHover(h => (h === t ? null : h))}
              onFocus={() => setHover(t)}
              onBlur={() => setHover(h => (h === t ? null : h))}
              style={{ cursor: disabled ? 'default' : 'pointer', outline: 'none' }}
            >
              {t.hit.map((sh, i) => (
                <ShapeEl
                  key={i} sh={sh}
                  fill={sh.t === 'rect' ? 'transparent' : 'none'}
                  stroke="transparent"
                />
              ))}
            </g>
          ))}

          {/* The pin, on the street that was chosen. */}
          {selected && (
            <g transform={`translate(${selected.pin[0]},${selected.pin[1]})`} style={{ pointerEvents: 'none' }}>
              <circle r={13} fill={ACCENT} opacity={0.18}>
                <animate attributeName="r" values="11;17;11" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.22;0.04;0.22" dur="2s" repeatCount="indefinite" />
              </circle>
              <path
                d="M 0,-17 C 6.5,-17 10,-12.5 10,-8 C 10,-2 0,0 0,0 C 0,0 -10,-2 -10,-8 C -10,-12.5 -6.5,-17 0,-17 Z"
                fill={ACCENT} stroke="#fff" strokeWidth={2}
              />
              <circle cy={-8.5} r={3.4} fill="#fff" />
            </g>
          )}

          {/* Compass, so the drawing is read the way it is drawn. */}
          <g transform="translate(722,34)">
            <circle r={14} fill="#fff" stroke="#e2e8f0" strokeWidth={1.2} />
            <path d="M 0,-9 L 3.4,4 L 0,1.2 L -3.4,4 Z" fill="#334155" />
            <text y={11.5} textAnchor="middle" fontSize={7} fill="#374151" fontFamily={FONT} fontWeight="700">N</text>
          </g>
        </svg>
      </Box>

      <Box sx={{ px: 1.5, py: 1.25, borderTop: '1px solid #eef2f6', minHeight: 58 }}>
        {shown ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Place sx={{ fontSize: 15, color: ACCENT }} />
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#0c1e46' }}>
                {shown.street}
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
                — {shown.near}
              </Typography>
            </Box>
            {shown === selected && (
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.4 }}>
                {exact
                  ? 'Saved. To mark the exact spot, switch to Exact spot above and move the pin.'
                  : 'Saved. There is no exact point for this street yet — switch to Exact spot above and tap where it happened.'}
              </Typography>
            )}
          </>
        ) : (
          <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            No street chosen yet. Tap a road on the map, or pick one from the list below.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
