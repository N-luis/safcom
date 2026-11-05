'use client';

import { useState } from 'react';
import {
  Box, FormControl, InputLabel, Select, MenuItem, ListSubheader, FormHelperText, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  TIME_PERIODS, HOURS_12, MINUTES_5, MERIDIEMS, formatExactTime, parseExactTime, periodOf, nowInPh,
} from '@/lib/incidentTime';

const EXACT = '__exact';

/**
 * "About what time?" - picked, not typed. "Not sure" (the default), a part of
 * the day, or "I know the exact time", which opens hour / minutes / AM-PM.
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

  const ph = nowInPh();
  const today = date === ph.date;
  const nowHour = Math.floor(ph.minutes / 60);
  const helper = error ?? (mode === EXACT ? 'Minutes are in steps of 5 - the nearest is fine' : 'Choose "Not sure" if you do not know - an estimate is fine');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControl size="small" fullWidth error={Boolean(error) && mode !== EXACT} disabled={disabled}>
        <InputLabel id="incident-time-label" shrink>About what time? (optional)</InputLabel>
        <Select
          labelId="incident-time-label"
          label="About what time? (optional)"
          notched
          displayEmpty
          value={mode}
          onChange={e => {
            const v = String(e.target.value);
            setMode(v);
            if (v === EXACT) emitExact(hour, minute, meridiem);
            else onChange(v);
          }}
          renderValue={v => {
            if (!v) return <Typography component="span" sx={{ color: '#64748b', fontSize: 'inherit' }}>Not sure</Typography>;
            if (v === EXACT) return 'Exact time';
            const p = periodOf(String(v));
            return p ? `${p.label} (${p.value.replace(/^[^(]*\(|\)$/g, '')})` : String(v);
          }}
          MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420 } } } }}
        >
          <MenuItem value="">Not sure</MenuItem>
          <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Part of the day</ListSubheader>
          {TIME_PERIODS.map(p => {
            const later = today && p.startHour > nowHour;
            return (
              <MenuItem key={p.value} value={p.value} disabled={later} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <span>{p.label}</span>
                <Typography component="span" sx={{ fontSize: '0.8rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                  {later ? 'later today' : p.value.replace(/^[^(]*\(|\)$/g, '')}
                </Typography>
              </MenuItem>
            );
          })}
          <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Exact time</ListSubheader>
          <MenuItem value={EXACT}>I know the exact time…</MenuItem>
        </Select>
        {mode !== EXACT && <FormHelperText>{helper}</FormHelperText>}
      </FormControl>

      {mode === EXACT && (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) auto', alignItems: 'center', gap: 0.75 }}>
            <FormControl size="small" error={Boolean(error) && !hour} disabled={disabled}>
              <InputLabel id="incident-hour-label">Hour</InputLabel>
              <Select labelId="incident-hour-label" label="Hour" value={hour}
                onChange={e => { const h = String(e.target.value); setHour(h); emitExact(h, minute, meridiem); }}
                MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}>
                {HOURS_12.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
              </Select>
            </FormControl>
            <Typography aria-hidden sx={{ fontWeight: 700, color: '#64748b' }}>:</Typography>
            <FormControl size="small" disabled={disabled}>
              <InputLabel id="incident-minute-label">Minutes</InputLabel>
              <Select labelId="incident-minute-label" label="Minutes" value={minute}
                onChange={e => { const m = String(e.target.value); setMinute(m); emitExact(hour, m, meridiem); }}
                MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}>
                {MINUTES_5.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
            <ToggleButtonGroup exclusive size="small" value={meridiem} disabled={disabled} aria-label="AM or PM"
              onChange={(_, v: 'AM' | 'PM' | null) => { if (!v) return; setMeridiem(v); emitExact(hour, minute, v); }}
              sx={{ '& .MuiToggleButton-root': { px: 1.5, minHeight: 40, fontWeight: 700, borderColor: error && !meridiem ? '#d32f2f' : undefined },
                '& .Mui-selected': { bgcolor: '#ccfbf1 !important', color: '#0f766e !important' } }}>
              {MERIDIEMS.map(m => <ToggleButton key={m} value={m} aria-label={m}>{m}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <FormHelperText error={Boolean(error)} sx={{ mx: 1.75 }}>{error ?? helper}</FormHelperText>
        </Box>
      )}
    </Box>
  );
}
