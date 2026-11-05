'use client';

import { useState } from 'react';
import { Box, Typography, ButtonBase, FormHelperText } from '@mui/material';
import { WbTwilight, LightMode, WbSunny, WbCloudy, NightsStay, Bedtime, HelpOutlineOutlined, Schedule } from '@mui/icons-material';
import {
  TIME_PERIODS, HOURS_12, MINUTES_5, MERIDIEMS, formatExactTime, parseExactTime, periodOf, nowInPh,
} from '@/lib/incidentTime';

const EXACT = '__exact';
const TEAL = '#0f766e';
const NAVY = '#0c1e46';
const PERIOD_ICON = [WbTwilight, LightMode, WbSunny, WbCloudy, NightsStay, Bedtime];
const range = (v: string) => v.replace(/^[^(]*\(|\)$/g, '').replace(' - ', ' – ');

/** One tappable choice: a radio in a group, drawn as a tile. */
function Choice({ selected, disabled, onClick, children, label, dense }: {
  selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; label?: string; dense?: boolean;
}) {
  return (
    <ButtonBase role="radio" aria-checked={selected} aria-label={label} disabled={disabled} onClick={onClick} focusRipple
      sx={{
        borderRadius: 2, border: '1.5px solid', borderColor: selected ? TEAL : '#cbd5e1',
        bgcolor: selected ? '#f0fdfa' : '#fff', color: selected ? TEAL : NAVY,
        minHeight: dense ? 40 : 56, px: dense ? 0.5 : 1.25, py: dense ? 0.5 : 0.75,
        display: 'flex', flexDirection: 'column', alignItems: dense ? 'center' : 'flex-start', justifyContent: 'center', gap: 0.15,
        textAlign: dense ? 'center' : 'left', width: '100%', fontVariantNumeric: 'tabular-nums',
        boxShadow: selected ? `inset 0 0 0 1px ${TEAL}` : 'none',
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': { borderColor: selected ? TEAL : '#94a3b8' },
        '&.Mui-focusVisible': { outline: `2px solid ${TEAL}`, outlineOffset: 2 },
        '&.Mui-disabled': { opacity: 0.45, bgcolor: '#f8fafc' },
      }}>
      {children}
    </ButtonBase>
  );
}

/**
 * "About what time?" - picked from options shown on the form, never typed and
 * never a drop-down. "Not sure" (the default), a part of the day, or "Exact
 * time", which shows the hours, the minutes and AM/PM as buttons.
 * `value` is what is stored: '' | a TIME_PERIODS value | "9:05 PM". An exact
 * time that is only half chosen is passed up as it stands ("9:05 ?"), so the
 * form's check flags it instead of it being dropped.
 */
export default function IncidentTimeField({ value, onChange, date, error, disabled }: {
  value: string;
  onChange: (v: string) => void;
  /** The incident date (YYYY-MM-DD), if chosen - parts of today still to come are not offered. */
  date?: string;
  /** The form's error message, if any. */
  error?: string;
  disabled?: boolean;
}) {
  const start = parseExactTime(value);
  const [mode, setMode] = useState<string>(() => (start ? EXACT : periodOf(value)?.value ?? ''));
  const [hour, setHour] = useState(start?.hour ?? '');
  const [minute, setMinute] = useState(start?.minute ?? '00');
  const [meridiem, setMeridiem] = useState<'' | 'AM' | 'PM'>(start?.meridiem ?? '');

  const emitExact = (h: string, m: string, ap: '' | 'AM' | 'PM') => {
    if (!h && !ap) return onChange('');
    onChange(h && ap ? formatExactTime({ hour: h, minute: m, meridiem: ap }) : `${h || '?'}:${m} ${ap || '?'}`);
  };
  const choose = (v: string) => { setMode(v); if (v === EXACT) emitExact(hour, minute, meridiem); else onChange(v); };

  const ph = nowInPh();
  const today = date === ph.date;
  const nowHour = Math.floor(ph.minutes / 60);
  const chosenExact = hour && meridiem ? `${hour}:${minute} ${meridiem}` : null;
  // A part of the day chosen first, then the date set to today: say so at once, not only on submit.
  const chosenPeriod = periodOf(mode);
  const notYet = today && chosenPeriod !== null && chosenPeriod.startHour > nowHour
    ? 'That part of the day has not come yet today - choose another, or "Not sure"' : null;
  const message = notYet ?? error;
  const sub = (text: string) => <Typography component="span" sx={{ fontSize: '0.74rem', color: '#64748b', lineHeight: 1.3 }}>{text}</Typography>;
  const groupLabel = (id: string, text: string) => (
    <Typography id={id} sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.5 }}>{text}</Typography>
  );

  return (
    <Box>
      <Typography id="incident-time-label" sx={{ fontSize: '0.9rem', fontWeight: 700, color: NAVY }}>About what time? (optional)</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1 }}>Choose the closest one. An estimate is fine.</Typography>

      <Box role="radiogroup" aria-labelledby="incident-time-label"
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
        <Choice selected={mode === ''} disabled={disabled} onClick={() => choose('')}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><HelpOutlineOutlined sx={{ fontSize: 18 }} /><Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 700 }}>Not sure</Typography></Box>
          {sub('I do not know the time')}
        </Choice>
        {TIME_PERIODS.map((p, i) => {
          const Icon = PERIOD_ICON[i];
          const later = today && p.startHour > nowHour;
          return (
            <Choice key={p.value} selected={mode === p.value} disabled={disabled || later} onClick={() => choose(p.value)}
              label={`${p.label}, ${range(p.value)}${later ? ', later today' : ''}`}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><Icon sx={{ fontSize: 18 }} /><Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 700 }}>{p.label}</Typography></Box>
              {sub(later ? 'Later today' : range(p.value))}
            </Choice>
          );
        })}
        <Choice selected={mode === EXACT} disabled={disabled} onClick={() => choose(EXACT)}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><Schedule sx={{ fontSize: 18 }} /><Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 700 }}>Exact time</Typography></Box>
          {sub(chosenExact && mode === EXACT ? chosenExact : 'I know the time')}
        </Choice>
      </Box>

      {mode === EXACT && (
        <Box sx={{ mt: 1.5, p: { xs: 1.25, sm: 1.5 }, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>Choose the time</Typography>
            <Typography aria-live="polite" sx={{ fontSize: '1.05rem', fontWeight: 800, color: chosenExact ? TEAL : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
              {chosenExact ?? `${hour || '--'}:${minute} ${meridiem || '--'}`}
            </Typography>
          </Box>

          <Box>
            {groupLabel('incident-hour-label', 'Hour')}
            <Box role="radiogroup" aria-labelledby="incident-hour-label"
              sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(6, minmax(0, 1fr))', sm: 'repeat(12, minmax(0, 1fr))' }, gap: 0.75 }}>
              {HOURS_12.map(h => (
                <Choice key={h} dense selected={hour === h} disabled={disabled} label={`${h} o'clock`}
                  onClick={() => { setHour(h); emitExact(h, minute, meridiem); }}>
                  <Typography component="span" sx={{ fontSize: '0.92rem', fontWeight: 700 }}>{h}</Typography>
                </Choice>
              ))}
            </Box>
          </Box>

          <Box>
            {groupLabel('incident-minute-label', 'Minutes')}
            <Box role="radiogroup" aria-labelledby="incident-minute-label"
              sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(6, minmax(0, 1fr))', sm: 'repeat(12, minmax(0, 1fr))' }, gap: 0.75 }}>
              {MINUTES_5.map(m => (
                <Choice key={m} dense selected={minute === m} disabled={disabled} label={`${m} minutes`}
                  onClick={() => { setMinute(m); emitExact(hour, m, meridiem); }}>
                  <Typography component="span" sx={{ fontSize: '0.92rem', fontWeight: 700 }}>:{m}</Typography>
                </Choice>
              ))}
            </Box>
          </Box>

          <Box>
            {groupLabel('incident-meridiem-label', 'AM or PM')}
            <Box role="radiogroup" aria-labelledby="incident-meridiem-label"
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75, maxWidth: { sm: 360 } }}>
              {MERIDIEMS.map(ap => (
                <Choice key={ap} dense selected={meridiem === ap} disabled={disabled} label={ap === 'AM' ? 'AM, midnight to noon' : 'PM, noon to midnight'}
                  onClick={() => { setMeridiem(ap); emitExact(hour, minute, ap); }}>
                  <Typography component="span" sx={{ fontSize: '0.92rem', fontWeight: 800 }}>{ap}</Typography>
                  {sub(ap === 'AM' ? 'Midnight to noon' : 'Noon to midnight')}
                </Choice>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {message && <FormHelperText error role="alert" sx={{ mx: 0, mt: 0.75, fontSize: '0.8rem' }}>{message}</FormHelperText>}
    </Box>
  );
}
