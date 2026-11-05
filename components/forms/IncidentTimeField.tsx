'use client';

import { useRef, useState } from 'react';
import { TextField, Link } from '@mui/material';
import { INCIDENT_TIME_HINT, fromTimeInput, isFutureIncidentTime, toTimeInput } from '@/lib/incidentTime';

/** What is sent up for a time that was started but not finished, so the form's check flags it. */
const UNFINISHED = '?:?? ?';

/**
 * "About what time?" - the browser's own time field, the same size and style
 * as the date field beside it: a clock button opens the hour / minutes / AM-PM
 * list (a wheel on phones), and the time can also be typed segment by segment.
 * Blank is "not sure", and "Clear" empties every part at once.
 * `value` is what is stored: '' or "9:30 PM".
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
  const ref = useRef<HTMLInputElement | null>(null);
  // Something is in the field, even half a time (the browser then reports '').
  const [started, setStarted] = useState(Boolean(value));
  // Half a time when the field was left: said at once, not only on submit.
  const [half, setHalf] = useState(false);
  const later = value && isFutureIncidentTime(date, value) ? 'That time has not come yet today' : null;
  const message = later ?? (half ? INCIDENT_TIME_HINT : null) ?? error;

  // The browser reports a half-typed time as '' with badInput set; pass that
  // up as unfinished rather than letting it read as "not sure".
  // While typing it is not flagged yet - only once the field is left half done.
  const read = (el: HTMLInputElement, leaving: boolean) => {
    const isHalf = !el.value && el.validity.badInput;
    setStarted(Boolean(el.value) || isHalf);
    if (leaving || !isHalf) setHalf(isHalf);
    if (isHalf) return onChange(UNFINISHED);
    const v = fromTimeInput(el.value);
    onChange(v === null ? UNFINISHED : v);
  };
  const clear = () => {
    if (ref.current) ref.current.value = '';
    setStarted(false);
    setHalf(false);
    onChange('');
  };

  return (
    <TextField
      label="About what time? (optional)"
      type="time"
      size="small"
      inputRef={ref}
      value={toTimeInput(value)}
      onChange={e => read(e.target as HTMLInputElement, false)}
      onBlur={e => read(e.target as HTMLInputElement, true)}
      disabled={disabled}
      error={Boolean(message)}
      helperText={
        <>
          {message ?? 'Leave blank if you are not sure'}
          {(started || value) && !disabled && (
            <> · <Link component="button" type="button" onClick={clear} underline="always"
              sx={{ fontSize: 'inherit', verticalAlign: 'baseline', color: '#0f766e', fontWeight: 600 }}>Clear</Link></>
          )}
        </>
      }
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60 } }}
    />
  );
}
