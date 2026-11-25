'use client';

import useSWR from 'swr';
import { Box, TextField, InputAdornment, CircularProgress, Typography } from '@mui/material';
import { LocationOn, InfoOutlined } from '@mui/icons-material';
import StreetSelect from './StreetSelect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

/**
 * The Street field of File a Report, following the incident's place (030).
 *
 *   place not chosen yet      -> disabled, asking for the province, municipality and barangay first
 *   loading the place's list  -> a spinner, never the previous place's options
 *   a verified list exists    -> the street dropdown, with that barangay's streets only
 *   no verified list          -> an empty text box for the street name
 *
 * The list comes from /api/registration/streets (VerifiedStreet). Biñang 2nd's
 * streets are offered for Biñang 2nd and nowhere else. The server checks the
 * street again when the report is submitted.
 */

export interface StreetOption { id: string; name: string; aliases: string[] }
export interface Place { province: string; municipality: string; barangay: string }
export type StreetListState =
  | { kind: 'incomplete' }
  | { kind: 'loading' }
  | { kind: 'list'; streets: StreetOption[] }
  | { kind: 'manual'; failed: boolean };

const fetcher = (url: string) => fetch(url).then(async r => {
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error ?? 'Could not load');
  return j.data as { identified: boolean; verified: boolean; streets: StreetOption[] };
});

export const placeKey = (p: Place) => [p.province, p.municipality, p.barangay].map(v => v.trim().toLowerCase()).join('|');

/** The street list for the place as it stands - debounced, so typing a barangay name does not fetch on every key. */
export function useVerifiedStreets(place: Place): StreetListState {
  const identified = Boolean(place.province.trim() && place.municipality.trim() && place.barangay.trim());
  const settled = useDebouncedValue(place, 350);
  const stale = placeKey(settled) !== placeKey(place);
  const url = identified && !stale
    ? `/api/registration/streets?${new URLSearchParams({ province: settled.province.trim(), municipality: settled.municipality.trim(), barangay: settled.barangay.trim() })}`
    : null;
  const { data, error } = useSWR(url, fetcher, { revalidateOnFocus: false, keepPreviousData: false });
  if (!identified) return { kind: 'incomplete' };
  if (stale || (!data && !error)) return { kind: 'loading' };
  if (error || !data) return { kind: 'manual', failed: true };
  return data.verified ? { kind: 'list', streets: data.streets } : { kind: 'manual', failed: false };
}

/** The verified street a value names, if it is on the list (by name or another spelling). */
export function streetIdOf(state: StreetListState, value: string): string | null {
  if (state.kind !== 'list') return null;
  const v = value.trim().toLowerCase();
  return state.streets.find(s => [s.name, ...s.aliases].some(n => n.trim().toLowerCase() === v))?.id ?? null;
}

const pin = <InputAdornment position="start"><LocationOn sx={{ fontSize: 17, color: '#94a3b8' }} /></InputAdornment>;

export default function IncidentStreetField({ state, value, onChange, error, helperText, disabled }: {
  state: StreetListState;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}) {
  if (state.kind === 'list') {
    return (
      <Box data-testid="street-list">
        <StreetSelect value={value} onChange={onChange} required size="medium" error={error} helperText={helperText}
          streets={state.streets.map(s => s.name)} />
      </Box>
    );
  }
  if (state.kind === 'manual') {
    return (
      <Box data-testid="street-manual" sx={{ display: 'grid', gap: 0.75 }}>
        <Box role="status" sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', color: '#475569' }}>
          <InfoOutlined sx={{ fontSize: 17, mt: 0.15, color: '#0369a1' }} />
          <Typography sx={{ fontSize: '0.8rem' }}>
            {state.failed
              ? 'The street list could not be loaded right now. Please enter the street name manually.'
              : 'No verified street list is available for this barangay. Please enter the street name manually.'}
          </Typography>
        </Box>
        <TextField label="Street *" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          placeholder="Enter the street name where the incident happened" fullWidth error={error}
          helperText={error && helperText ? helperText : 'Enter the street name or road where the incident occurred. Do not enter your home address unless it is also the incident location.'}
          slotProps={{ input: { startAdornment: pin }, htmlInput: { maxLength: 120 } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Box>
    );
  }
  // Loading, or no place yet: the same field, empty and disabled - never the last place's streets.
  const loading = state.kind === 'loading';
  return (
    <TextField data-testid={loading ? 'street-loading' : 'street-incomplete'} label="Street *" value="" disabled fullWidth
      placeholder={loading ? 'Loading the streets for this barangay…' : ''}
      helperText={loading ? 'Loading the streets for this barangay…' : 'Choose the province, municipality and barangay where it happened first.'}
      slotProps={{ input: { startAdornment: pin, endAdornment: loading ? <InputAdornment position="end"><CircularProgress size={18} /></InputAdornment> : undefined } }}
      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
  );
}
