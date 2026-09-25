'use client';

import { useState } from 'react';
import { Box, TextField, MenuItem, InputAdornment } from '@mui/material';
import { LocationOn } from '@mui/icons-material';
import { BARANGAY_STREETS, OTHER_STREET, isKnownStreet } from '@/lib/streets';

/**
 * Street picker shared by every form that files a case, so the value stored in
 * Case.barangay is the street the incident happened on rather than the
 * barangay name. Anything off the list is kept verbatim behind an "Other"
 * option — a blotter has to be able to record a location wherever it is.
 */
export default function StreetSelect({
  value, onChange, label = 'Street', required = false,
  error, helperText, size = 'small', fullWidth = true,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
}) {
  // Tracked explicitly: deriving "Other" from the value alone would collapse
  // the text box the moment someone cleared it to retype.
  const [otherMode, setOtherMode] = useState(value !== '' && !isKnownStreet(value));
  const showOther = otherMode || (value !== '' && !isKnownStreet(value));

  const handleSelect = (v: string) => {
    if (v === OTHER_STREET) { setOtherMode(true); onChange(''); }
    else { setOtherMode(false); onChange(v); }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: showOther ? 1.5 : 0 }}>
      <TextField
        select
        label={required ? `${label} *` : label}
        value={showOther ? OTHER_STREET : value}
        onChange={e => handleSelect(e.target.value)}
        error={error}
        helperText={helperText}
        size={size}
        fullWidth={fullWidth}
        slotProps={{
          select: { renderValue: (v: unknown) => (v === OTHER_STREET && value ? value : String(v ?? '')) },
          input: { startAdornment: <InputAdornment position="start"><LocationOn sx={{ fontSize: 17, color: '#94a3b8' }} /></InputAdornment> },
        }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
      >
        {BARANGAY_STREETS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        <MenuItem
          value={OTHER_STREET}
          sx={{ borderTop: '1px solid #e2e8f0', mt: 0.5, pt: 1, color: '#64748b', fontStyle: 'italic' }}
        >
          Other — not on this list
        </MenuItem>
      </TextField>

      {showOther && (
        <TextField
          label="Specify street / location"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. Purok 3 near the covered court"
          size={size}
          fullWidth={fullWidth}
          autoFocus
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><LocationOn sx={{ fontSize: 17, color: '#94a3b8' }} /></InputAdornment> } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />
      )}
    </Box>
  );
}
