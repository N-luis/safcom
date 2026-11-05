'use client';

import { useRef, useState } from 'react';
import { Box, Typography, ButtonBase, Button, FormHelperText } from '@mui/material';
import { RestartAlt } from '@mui/icons-material';
import { formatExactTime, isFutureIncidentTime, parseExactTime } from '@/lib/incidentTime';

const TEAL = '#0f766e';
const TEAL_SOFT = '#ccfbf1';
const NAVY = '#0c1e46';
const FACE = '#f1f5f9';

type Dial = 'hour' | 'minute';
type Meridiem = '' | 'AM' | 'PM';

const HOUR_MARKS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const MINUTE_MARKS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
/** Where the numbers sit, as a share of the face's half-width. */
const RING = 0.78;

/** A point on the face, in percent of its box, for a clockwise angle from 12 o'clock. */
const at = (deg: number, r = RING) => {
  const a = (deg * Math.PI) / 180;
  // Rounded: the server and the browser can differ in the last digits of
  // sin/cos, and an unrounded position would not hydrate.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { x: round(50 + 50 * r * Math.sin(a)), y: round(50 - 50 * r * Math.cos(a)) };
};

/**
 * "About what time?" as a clock: tap or drag round the face to the hour, and
 * it moves on to the minutes (marked every 5, any minute by dragging); AM / PM
 * beside it. "Not sure" (the default) leaves the time out.
 * `value` is what is stored: '' or "9:05 PM". A time that is only half chosen
 * is passed up as it stands ("9:05 ?"), so the form's check flags it instead
 * of it being dropped.
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
  const [hour, setHour] = useState(start?.hour ?? '');
  const [minute, setMinute] = useState(start?.minute ?? '00');
  const [meridiem, setMeridiem] = useState<Meridiem>(start?.meridiem ?? '');
  const [dial, setDial] = useState<Dial>('hour');
  const face = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const emit = (h: string, m: string, ap: Meridiem) => {
    if (!h && !ap) return onChange('');
    onChange(h && ap ? formatExactTime({ hour: h, minute: m, meridiem: ap }) : `${h || '?'}:${m} ${ap || '?'}`);
  };
  const pickHour = (h: string) => { setHour(h); emit(h, minute, meridiem); };
  const pickMinute = (m: string) => { setMinute(m); emit(hour, m, meridiem); };
  const pickMeridiem = (ap: 'AM' | 'PM') => { setMeridiem(ap); emit(hour, minute, ap); };
  const clear = () => { setHour(''); setMinute('00'); setMeridiem(''); setDial('hour'); onChange(''); };

  /** The value under the pointer, from its angle round the centre. */
  const fromPointer = (clientX: number, clientY: number) => {
    const el = face.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.08) return; // the very centre has no direction
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    if (dial === 'hour') pickHour(String(Math.round(deg / 30) % 12 || 12));
    else pickMinute(String(Math.round(deg / 6) % 60).padStart(2, '0'));
  };

  const set = Boolean(hour);
  const complete = Boolean(hour && meridiem);
  const shown = complete ? formatExactTime({ hour, minute, meridiem: meridiem as 'AM' | 'PM' }) : null;
  const later = shown && isFutureIncidentTime(date, shown) ? 'That time has not come yet today - choose an earlier time, or "Not sure"' : null;
  const needsMeridiem = set && !meridiem ? 'Choose AM or PM' : null;
  const message = later ?? (needsMeridiem && error ? needsMeridiem : error) ?? null;

  // The hand points at the chosen value on the current dial.
  const handDeg = dial === 'hour' ? (hour ? (Number(hour) % 12) * 30 : null) : Number(minute) * 6;
  const tip = handDeg === null ? null : at(handDeg);
  const marks = dial === 'hour' ? HOUR_MARKS : MINUTE_MARKS;
  const isOn = (m: string) => (dial === 'hour' ? hour === m : minute === m);

  const segment = (which: Dial, text: string, label: string) => (
    <ButtonBase onClick={() => setDial(which)} disabled={disabled} aria-pressed={dial === which} aria-label={label} focusRipple
      sx={{ borderRadius: 2, px: 1.25, py: 0.25, bgcolor: dial === which ? TEAL_SOFT : FACE, color: dial === which ? TEAL : NAVY,
        fontSize: { xs: '2.4rem', sm: '2.75rem' }, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', minWidth: { xs: 76, sm: 88 },
        '&.Mui-focusVisible': { outline: `2px solid ${TEAL}`, outlineOffset: 2 } }}>
      {text}
    </ButtonBase>
  );
  const meridiemButton = (ap: 'AM' | 'PM') => (
    <ButtonBase key={ap} onClick={() => pickMeridiem(ap)} disabled={disabled} role="radio" aria-checked={meridiem === ap} focusRipple
      sx={{ px: 1.5, minHeight: 40, fontWeight: 800, fontSize: '0.95rem', bgcolor: meridiem === ap ? TEAL_SOFT : '#fff', color: meridiem === ap ? TEAL : '#475569',
        '&.Mui-focusVisible': { outline: `2px solid ${TEAL}`, outlineOffset: -2 } }}>
      {ap}
    </ButtonBase>
  );

  return (
    <Box>
      <Typography id="incident-time-label" sx={{ fontSize: '0.9rem', fontWeight: 700, color: NAVY }}>About what time? (optional)</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1.25 }}>
        Tap the clock to set the hour, then the minutes. An estimate is fine - leave it on &quot;Not sure&quot; if you do not know.
      </Typography>

      <Box role="group" aria-labelledby="incident-time-label"
        sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: { xs: 2, sm: 4 },
          border: '1px solid #e2e8f0', borderRadius: 3, p: { xs: 1.5, sm: 2.5 }, bgcolor: '#fff' }}>

        {/* The readout: hour and minutes switch the dial; AM / PM beside them. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: { xs: 'center', sm: 'flex-start' }, gap: 1.25, order: { xs: 0, sm: 1 }, flex: { sm: 1 } }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {set ? 'Time it happened' : 'Not sure'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {segment('hour', hour || '--', `Hour, ${hour || 'not set'}. Show the hours on the clock`)}
            <Typography aria-hidden sx={{ fontSize: '2.4rem', fontWeight: 800, color: '#94a3b8', lineHeight: 1 }}>:</Typography>
            {segment('minute', set ? minute : '--', `Minutes, ${set ? minute : 'not set'}. Show the minutes on the clock`)}
            <Box role="radiogroup" aria-label="AM or PM"
              sx={{ display: 'flex', flexDirection: 'column', border: `1.5px solid ${needsMeridiem && error ? '#d32f2f' : '#cbd5e1'}`, borderRadius: 2, overflow: 'hidden', ml: 0.5,
                '& > :first-of-type': { borderBottom: '1px solid #cbd5e1' } }}>
              {meridiemButton('AM')}{meridiemButton('PM')}
            </Box>
          </Box>
          <Typography aria-live="polite" sx={{ fontSize: '0.82rem', color: shown ? TEAL : '#64748b', fontWeight: shown ? 700 : 400, minHeight: '1.3em' }}>
            {shown ? `Chosen: ${shown}` : set ? 'Choose AM or PM' : dial === 'hour' ? 'Choose the hour on the clock' : 'Choose the minutes on the clock'}
          </Typography>
          <Button size="small" onClick={clear} disabled={disabled || (!set && !meridiem)} startIcon={<RestartAlt />}
            sx={{ textTransform: 'none', color: '#475569', px: 1, minHeight: 36 }}>
            Not sure - clear the time
          </Button>
        </Box>

        {/* The face. Tap a number, or drag round it; the hour moves on to the minutes. */}
        <Box
          ref={face}
          aria-label={dial === 'hour' ? 'Clock - choose the hour' : 'Clock - choose the minutes'}
          onPointerDown={e => {
            if (disabled) return;
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e.clientX, e.clientY);
          }}
          onPointerMove={e => { if (dragging.current) fromPointer(e.clientX, e.clientY); }}
          onPointerUp={() => {
            if (!dragging.current) return;
            dragging.current = false;
            if (dial === 'hour') setDial('minute');
          }}
          onPointerCancel={() => { dragging.current = false; }}
          sx={{
            position: 'relative', width: 'min(100%, 272px)', aspectRatio: '1 / 1', borderRadius: '50%', bgcolor: FACE, flexShrink: 0,
            touchAction: 'none', userSelect: 'none', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, order: { xs: 1, sm: 0 },
          }}>
          <svg viewBox="0 0 100 100" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {/* Minute ticks, so a dragged minute between the numbers has a place. */}
            {dial === 'minute' && Array.from({ length: 60 }, (_, i) => i).filter(i => i % 5).map(i => {
              const a = at(i * 6, 0.93), b = at(i * 6, 0.97);
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#cbd5e1" strokeWidth={0.6} />;
            })}
            {tip && (
              <>
                <line x1={50} y1={50} x2={tip.x} y2={tip.y} stroke={TEAL} strokeWidth={1.1} strokeLinecap="round" />
                <circle cx={tip.x} cy={tip.y} r={8.2} fill={TEAL} />
                {dial === 'minute' && Number(minute) % 5 !== 0 && <circle cx={tip.x} cy={tip.y} r={1.4} fill="#fff" />}
              </>
            )}
            <circle cx={50} cy={50} r={2} fill={tip ? TEAL : '#94a3b8'} />
          </svg>
          <Box role="radiogroup" aria-label={dial === 'hour' ? 'Hour' : 'Minutes'} sx={{ position: 'absolute', inset: 0 }}>
            {marks.map((m, i) => {
              const p = at(i * 30);
              const on = isOn(m);
              return (
                <ButtonBase key={`${dial}-${m}`} role="radio" aria-checked={on} disabled={disabled} tabIndex={on || (!hour && i === 0) ? 0 : -1}
                  aria-label={dial === 'hour' ? `${m} o'clock` : `${m} minutes`}
                  // Mouse and touch are read from the angle on the face; this is for the keyboard.
                  onClick={e => { if (e.detail === 0) { if (dial === 'hour') pickHour(m); else pickMinute(m); } }}
                  onKeyDown={e => {
                    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const next = marks[(i + step + 12) % 12];
                    if (dial === 'hour') pickHour(next); else pickMinute(next);
                    const btns = (e.currentTarget.parentElement?.querySelectorAll('[role=radio]') ?? []) as NodeListOf<HTMLElement>;
                    btns[(i + step + 12) % 12]?.focus();
                  }}
                  sx={{
                    position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)',
                    width: '15%', aspectRatio: '1 / 1', borderRadius: '50%', fontSize: { xs: '0.95rem', sm: '1rem' }, fontWeight: 700,
                    color: on ? '#fff' : NAVY, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
                    '&.Mui-focusVisible': { outline: `2px solid ${TEAL}`, outlineOffset: 1 },
                  }}>
                  {m}
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
      </Box>

      {message && (
        <FormHelperText error role="alert" sx={{ mx: 0, mt: 0.75, fontSize: '0.8rem' }}>{message}</FormHelperText>
      )}
    </Box>
  );
}
