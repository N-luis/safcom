'use client';

import { TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { Edit } from '@mui/icons-material';
import { InputAdornment } from '@mui/material';

/**
 * "Other" case-type handling, shared by every form that files a case.
 *
 * Picking "Other" reveals a box for the person to say what the case actually
 * is. The typed text is NOT used as the case type: `Case.caseType` drives the
 * category charts, the AI risk scoring and — via an exact match against
 * VAWC_TYPES — whether a case belongs to the VAWC module. Free text there
 * would silently misroute a "VAWC - Other" case into Blotter. The selection
 * stays canonical and the detail is written into the description instead,
 * where officers and the resident both see it.
 */

/** True for plain "Other" and for prefixed variants like "VAWC - Other". */
export function isOtherType(value: string | undefined | null): boolean {
  return /(^|[\s-])other$/i.test((value ?? '').trim());
}

/**
 * Puts the specified kind at the top of the description, so it is visible
 * wherever the case is read.
 */
export function withOtherDetail(description: string, caseType: string, detail: string): string {
  const clean = detail.trim();
  if (!isOtherType(caseType) || !clean) return description;
  return `Case type (Other): ${clean}\n\n${description}`;
}

export default function OtherTypeField({
  value,
  onChange,
  error,
  helperText,
  size = 'medium',
  sx,
  label = 'Please specify the case type *',
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  helperText?: string;
  size?: 'small' | 'medium';
  sx?: SxProps<Theme>;
  label?: string;
}) {
  return (
    <TextField
      label={label}
      fullWidth
      size={size}
      value={value}
      onChange={e => onChange(e.target.value)}
      error={error}
      helperText={helperText ?? 'Describe the kind of case in a few words — e.g. Lost property, Animal complaint, Boundary dispute'}
      placeholder="e.g. Lost property"
      autoFocus
      slotProps={{
        htmlInput: { maxLength: 60 },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Edit sx={{ fontSize: 17, color: '#9ca3af' }} />
            </InputAdornment>
          ),
        },
      }}
      sx={sx}
    />
  );
}
