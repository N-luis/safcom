'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { TextField, InputAdornment, type TextFieldProps } from '@mui/material';
import { PH_COUNTRY_CODE, PH_MOBILE_HINT, groupPhMobile, isPhMobileLocal, phMobileLocal } from '@/lib/phoneNumber';

/**
 * A Philippine mobile number: "+63" is fixed in front and cannot be deleted,
 * and only the 10 digits after it can be typed. Letters and symbols never
 * appear; a pasted "+63 917 ...", "0917..." or "917-123-4567" is cleaned up;
 * the digits are shown grouped (917 123 4567) without moving the cursor.
 *
 * `value` / `onChange` carry only the 10 local digits ("9171234567"); turn
 * them into "+639171234567" with normalizePhMobile when sending.
 */
export default function PhMobileField({ value, onChange, label, disabled, optional = true, sx, size = 'small' }: {
  value: string;
  onChange: (localDigits: string) => void;
  label: string;
  disabled?: boolean;
  /** Empty is allowed; only a started-but-wrong number is flagged. */
  optional?: boolean;
  sx?: TextFieldProps['sx'];
  size?: TextFieldProps['size'];
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Where the cursor should land, counted in digits, after the regrouped value renders.
  const caretDigits = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caretDigits.current === null || document.activeElement !== el) return;
    let seen = 0, pos = 0;
    const shown = el.value;
    while (pos < shown.length && seen < caretDigits.current) { if (/\d/.test(shown[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
    caretDigits.current = null;
  });

  const local = phMobileLocal(value);
  const wrong = local.length > 0 && !isPhMobileLocal(local);
  const missing = !optional && local.length === 0;
  const showError = touched && (wrong || missing);

  return (
    <TextField
      size={size}
      label={label}
      value={groupPhMobile(local)}
      disabled={disabled}
      error={showError}
      helperText={showError ? (missing ? 'A mobile number is required' : PH_MOBILE_HINT) : 'Mobile number - 10 digits after +63'}
      onBlur={() => setTouched(true)}
      onChange={e => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        const before = phMobileLocal(raw.slice(0, caret));
        const next = phMobileLocal(raw);
        // A pasted "+63..." or "09..." loses digits in front; never place the cursor past the end.
        caretDigits.current = Math.min(before.length, next.length);
        onChange(next);
      }}
      sx={sx}
      slotProps={{
        input: {
          startAdornment: <InputAdornment position="start" sx={{ '& p': { fontWeight: 600, color: '#0c1e46' } }}>{PH_COUNTRY_CODE}</InputAdornment>,
        },
        htmlInput: {
          inputMode: 'numeric',
          autoComplete: 'tel-national',
          placeholder: '917 123 4567',
        },
      }}
      inputRef={ref}
    />
  );
}
