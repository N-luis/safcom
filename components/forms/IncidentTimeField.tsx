'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography, Button, FormHelperText } from '@mui/material';
import { RestartAlt } from '@mui/icons-material';
import { formatExactTime, isFutureIncidentTime, nowInPh, parseExactTime } from '@/lib/incidentTime';

const TEAL = '#0f766e';
const TEAL_SOFT = '#ccfbf1';
const NAVY = '#0c1e46';
const CARD = '#f1f5f9';

/** One row of a wheel, and how many show at once: 5 x 34 = 170px tall. */
const ROW = 34;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ROW;

const HOURS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const MERIDIEMS = ['AM', 'PM'] as const;

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One scrolling column. Scroll-snap stops it on a row; the row in the middle
 * is the value. `onPick(i, byUser)` reports where it settled - `byUser` is
 * true only when the resident scrolled, swiped, used the wheel or a key, so
 * the wheels being placed on load never counts as choosing a time.
 */
function Wheel({ label, items, index, onPick, active, disabled, spoken }: {
  label: string;
  items: readonly string[];
  index: number;
  onPick: (i: number, byUser: boolean) => void;
  /** False while "Not sure": the wheel shows where it is, greyed. */
  active: boolean;
  disabled?: boolean;
  /** How a screen reader says the value, e.g. "9 o'clock". */
  spoken: (v: string) => string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const [center, setCenter] = useState(index);
  const intent = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placed = useRef(false);
  const wheelAcc = useRef(0);
  const latest = useRef({ index, onPick, n: items.length });
  useEffect(() => { latest.current = { index, onPick, n: items.length }; });

  // Put the wheel on `index` when it changes from outside (load, keys, a tap).
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    if (Math.round(box.scrollTop / ROW) !== index) {
      box.scrollTo({ top: index * ROW, behavior: placed.current && !reducedMotion() ? 'smooth' : 'auto' });
    }
    placed.current = true;
    setCenter(index);
  }, [index]);

  // A mouse wheel moves one row per notch (a trackpad, one row per 40px), not a page.
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      const { index: i, onPick: pick, n } = latest.current;
      let step = 0;
      if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40) step = Math.sign(e.deltaY);
      else {
        wheelAcc.current += e.deltaY;
        if (Math.abs(wheelAcc.current) >= 40) { step = Math.sign(wheelAcc.current); wheelAcc.current = 0; }
      }
      if (step) pick(clamp(i + step, n), true);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [disabled]);

  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  const onScroll = () => {
    const box = el.current;
    if (!box) return;
    setCenter(clamp(Math.round(box.scrollTop / ROW), items.length));
    if (settle.current) clearTimeout(settle.current);
    // Settled: no scroll for a moment (covers momentum after a swipe).
    settle.current = setTimeout(() => {
      const i = clamp(Math.round(box.scrollTop / ROW), items.length);
      const byUser = intent.current;
      intent.current = false;
      if (byUser || i !== latest.current.index) latest.current.onPick(i, byUser);
    }, 140);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = items.length;
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1
      : e.key === 'PageUp' ? index - 5 : e.key === 'PageDown' ? index + 5
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    intent.current = true;
    onPick(clamp(to, n), true);
  };

  return (
    <Box
      ref={el}
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      aria-valuenow={index}
      aria-valuetext={active ? spoken(items[index]) : `${spoken(items[index])}, not chosen - time is "Not sure"`}
      aria-disabled={disabled || undefined}
      onScroll={onScroll}
      onPointerDown={() => { intent.current = true; }}
      onTouchStart={() => { intent.current = true; }}
      onKeyDown={onKeyDown}
      sx={{
        height: ROW * VISIBLE, overflowY: disabled ? 'hidden' : 'auto', overscrollBehavior: 'contain',
        scrollSnapType: 'y mandatory', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
        position: 'relative', zIndex: 1, outline: 'none', borderRadius: 2, cursor: disabled ? 'default' : 'ns-resize',
        // Fade the rows above and below the middle.
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 32%, #000 68%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 32%, #000 68%, transparent 100%)',
        '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${TEAL}` },
      }}
    >
      <Box aria-hidden sx={{ py: `${PAD}px` }}>
        {items.map((v, i) => {
          const on = i === center;
          return (
            <Box key={v}
              onClick={() => { if (disabled) return; intent.current = true; onPick(i, true); }}
              sx={{
                height: ROW, display: 'flex', alignItems: 'center', justifyContent: 'center', scrollSnapAlign: 'center',
                fontVariantNumeric: 'tabular-nums', userSelect: 'none',
                fontSize: on ? '1.15rem' : '1rem', fontWeight: on ? 800 : 600,
                color: on ? (active ? TEAL : '#64748b') : NAVY,
                opacity: on ? 1 : Math.abs(i - center) === 1 ? 0.55 : 0.3,
                transition: 'color 120ms, opacity 120ms, font-size 120ms',
              }}>
              {v}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * "About what time?" - an iOS-style scroll wheel: hour, minutes, AM/PM.
 * "Not sure" (the default) saves nothing; scrolling any wheel chooses the time
 * the three wheels show. `value` is what is stored: '' or "9:30 PM".
 */
export default function IncidentTimeField({ value, onChange, date, error, disabled }: {
  value: string;
  onChange: (v: string) => void;
  /** The incident date (YYYY-MM-DD), if chosen - a time later today is flagged at once. */
  date?: string;
  /** The form's error message, if any. */
  error?: string;
  disabled?: boolean;
}) {
  const start = parseExactTime(value);
  const [chosen, setChosen] = useState(Boolean(start));
  // Fixed first render (it must match the server's); "Not sure" wheels move to the current time after mount.
  const [h, setH] = useState(start ? HOURS.indexOf(start.hour) : 11);
  const [m, setM] = useState(start ? Number(start.minute) : 0);
  const [ap, setAp] = useState(start ? MERIDIEMS.indexOf(start.meridiem) : 0);
  const idx = useRef({ h, m, ap });
  const chosenRef = useRef(chosen);
  useEffect(() => { idx.current = { h, m, ap }; chosenRef.current = chosen; });

  // Only on mount: "Not sure" wheels start at the current time (after the
  // first paint, so the server-rendered HTML still matches).
  const hadStart = useRef(Boolean(start));
  useEffect(() => {
    if (hadStart.current) return;
    const id = requestAnimationFrame(() => {
      if (chosenRef.current) return;
      const mins = nowInPh().minutes;
      const hour24 = Math.floor(mins / 60);
      setH((hour24 % 12 || 12) - 1);
      setM(Math.floor((mins % 60) / 5) * 5);
      setAp(hour24 < 12 ? 0 : 1);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const timeOf = (i: { h: number; m: number; ap: number }) => formatExactTime({ hour: HOURS[i.h], minute: MINUTES[i.m], meridiem: MERIDIEMS[i.ap] });

  const pick = useCallback((col: 'h' | 'm' | 'ap', i: number, byUser: boolean) => {
    const next = { ...idx.current, [col]: i };
    idx.current = next;
    if (col === 'h') setH(i); else if (col === 'm') setM(i); else setAp(i);
    if (byUser) { setChosen(true); onChange(timeOf(next)); }
  }, [onChange]);

  const clear = () => { setChosen(false); onChange(''); };

  const shown = chosen ? timeOf({ h, m, ap }) : null;
  const later = shown && isFutureIncidentTime(date, shown) ? 'That time has not come yet today - choose an earlier time, or "Not sure"' : null;
  const message = later ?? error ?? null;

  return (
    <Box sx={{ maxWidth: { sm: 'calc(50% - 6px)' } }}>
      <Typography id="incident-time-label" sx={{ fontSize: '0.9rem', fontWeight: 700, color: NAVY }}>About what time? (optional)</Typography>

      <Box role="group" aria-labelledby="incident-time-label" aria-describedby="incident-time-readout"
        sx={{ mt: 0.75, bgcolor: CARD, borderRadius: 3, border: '1px solid #e2e8f0', p: 1.25, opacity: disabled ? 0.6 : 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', px: 0.5, mb: 0.75 }}>
          <Typography id="incident-time-readout" aria-live="polite"
            sx={{ fontSize: '0.95rem', fontWeight: 800, color: shown ? TEAL : '#64748b', fontVariantNumeric: 'tabular-nums' }}>
            {shown ? `Around ${shown}` : 'Not sure'}
          </Typography>
          <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>
            {shown ? 'An estimate is fine' : 'Scroll to set the time'}
          </Typography>
        </Box>

        <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 10px minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center' }}>
          {/* The band the middle row sits in. */}
          <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, top: PAD, height: ROW, borderRadius: 2,
            bgcolor: shown ? TEAL_SOFT : '#e2e8f0', transition: 'background-color 150ms', pointerEvents: 'none' }} />
          <Wheel label="Hour" items={HOURS} index={h} onPick={(i, u) => pick('h', i, u)} active={Boolean(shown)} disabled={disabled}
            spoken={v => `${v} o'clock`} />
          <Typography aria-hidden sx={{ position: 'relative', zIndex: 1, textAlign: 'center', fontWeight: 800, color: shown ? TEAL : '#94a3b8' }}>:</Typography>
          <Wheel label="Minutes" items={MINUTES} index={m} onPick={(i, u) => pick('m', i, u)} active={Boolean(shown)} disabled={disabled}
            spoken={v => `${v} minutes`} />
          <Wheel label="AM or PM" items={MERIDIEMS} index={ap} onPick={(i, u) => pick('ap', i, u)} active={Boolean(shown)} disabled={disabled}
            spoken={v => v} />
        </Box>

        <Button size="small" onClick={clear} disabled={disabled || !shown} startIcon={<RestartAlt sx={{ fontSize: 17 }} />}
          sx={{ mt: 0.5, textTransform: 'none', color: '#475569', px: 0.75, minHeight: 34, fontSize: '0.8rem' }}>
          Not sure – clear the time
        </Button>
      </Box>

      {message && <FormHelperText error role="alert" sx={{ mx: 0, mt: 0.75, fontSize: '0.8rem' }}>{message}</FormHelperText>}
    </Box>
  );
}
