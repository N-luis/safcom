'use client';

import { Box, TextField, MenuItem, Autocomplete, Typography } from '@mui/material';
import {
  BULACAN_MUNICIPALITIES, BOCAUE_BARANGAYS, BARANGAY_STREETS_FOR_FORM, DEFAULT_JURISDICTION,
  sameName, isJurisdictionBarangay, matchStreet,
} from '@/lib/jurisdiction';

export interface AddressValue {
  province: string; municipality: string; barangay: string; street: string;
  houseNumber?: string; purok?: string; details?: string;
}

export const emptyAddress = (withJurisdiction = true): AddressValue => ({
  province: withJurisdiction ? DEFAULT_JURISDICTION.province : '',
  municipality: withJurisdiction ? DEFAULT_JURISDICTION.municipality : '',
  barangay: withJurisdiction ? DEFAULT_JURISDICTION.barangay : '',
  street: '', houseNumber: '', purok: '', details: '',
});

const OTHER = '__other__';

/**
 * An address, part by part, from lists wherever there is one: the province,
 * then the municipality under it, then the barangay under that, then - in
 * the barangay SafeComm serves - its own streets. Anything not on a list is
 * typed (so a person from elsewhere can say where they are from, and be told
 * where to go). Typed values are never "corrected": a street not on the list
 * shows the list's nearest names as suggestions to choose, nothing more.
 *
 * mode residence: house number and purok/subdivision too. mode incident: a
 * landmark or details field, since an incident may be on no street.
 */
export default function AddressFields({ value, onChange, mode, disabled, errors = {}, idPrefix = 'addr', areaOnly = false, houseRequired = false }: {
  value: AddressValue; onChange: (next: AddressValue) => void; mode: 'residence' | 'incident';
  disabled?: boolean; errors?: Partial<Record<keyof AddressValue, string>>; idPrefix?: string;
  /** Only the province, municipality and barangay (the form has its own street fields). */
  areaOnly?: boolean;
  /** The house or building number is required (registration). */
  houseRequired?: boolean;
}) {
  const set = (k: keyof AddressValue, v: string) => {
    const next = { ...value, [k]: v };
    // A higher level changed: the levels under it no longer apply.
    if (k === 'province' && !sameName(v, value.province)) { next.municipality = ''; next.barangay = ''; next.street = ''; }
    if (k === 'municipality' && !sameName(v, value.municipality)) { next.barangay = ''; next.street = ''; }
    if (k === 'barangay' && !sameName(v, value.barangay)) next.street = '';
    onChange(next);
  };
  const bulacan = sameName(value.province, 'Bulacan');
  const bocaue = bulacan && sameName(value.municipality, 'Bocaue');
  const ours = bocaue && isJurisdictionBarangay(value.barangay, DEFAULT_JURISDICTION);
  const province = sameName(value.province, 'Bulacan') ? 'Bulacan' : value.province ? OTHER : '';
  const muniListed = bulacan && BULACAN_MUNICIPALITIES.some(m => sameName(m, value.municipality));
  const brgyListed = bocaue && BOCAUE_BARANGAYS.some(b => sameName(b, value.barangay));
  const street = ours && value.street ? matchStreet(value.street) : null;
  const req = mode === 'residence' ? ' *' : ' *';

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
      <TextField select size="small" id={`${idPrefix}-province`} label={`Province${req}`} disabled={disabled} value={province}
        onChange={e => set('province', e.target.value === OTHER ? ' ' : e.target.value)} error={Boolean(errors.province)} helperText={errors.province}>
        <MenuItem value="Bulacan">Bulacan</MenuItem>
        <MenuItem value={OTHER}>Another province (type it)</MenuItem>
      </TextField>
      {province === OTHER
        ? <TextField size="small" label={`Province name${req}`} disabled={disabled} value={value.province.trim()} onChange={e => set('province', e.target.value)} />
        : <Box sx={{ display: { xs: 'none', sm: 'block' } }} />}

      {bulacan ? (
        <TextField select size="small" id={`${idPrefix}-municipality`} label={`Municipality / city${req}`} disabled={disabled}
          value={muniListed ? BULACAN_MUNICIPALITIES.find(m => sameName(m, value.municipality)) : value.municipality ? OTHER : ''}
          onChange={e => set('municipality', e.target.value === OTHER ? ' ' : e.target.value)} error={Boolean(errors.municipality)} helperText={errors.municipality}>
          {BULACAN_MUNICIPALITIES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          <MenuItem value={OTHER}>Another (type it)</MenuItem>
        </TextField>
      ) : (
        <TextField size="small" label={`Municipality / city${req}`} disabled={disabled} value={value.municipality} onChange={e => set('municipality', e.target.value)}
          error={Boolean(errors.municipality)} helperText={errors.municipality} />
      )}
      {bulacan && !muniListed && value.municipality
        ? <TextField size="small" label={`Municipality name${req}`} disabled={disabled} value={value.municipality.trim()} onChange={e => set('municipality', e.target.value)} />
        : null}

      {bocaue ? (
        <TextField select size="small" id={`${idPrefix}-barangay`} label={`Barangay${req}`} disabled={disabled}
          value={brgyListed ? BOCAUE_BARANGAYS.find(b => sameName(b, value.barangay)) : value.barangay ? OTHER : ''}
          onChange={e => set('barangay', e.target.value === OTHER ? ' ' : e.target.value)} error={Boolean(errors.barangay)} helperText={errors.barangay}>
          {BOCAUE_BARANGAYS.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
          <MenuItem value={OTHER}>Another (type it)</MenuItem>
        </TextField>
      ) : (
        <TextField size="small" label={`Barangay${req}`} disabled={disabled} value={value.barangay} onChange={e => set('barangay', e.target.value)}
          error={Boolean(errors.barangay)} helperText={errors.barangay} />
      )}
      {bocaue && !brgyListed && value.barangay
        ? <TextField size="small" label={`Barangay name${req}`} disabled={disabled} value={value.barangay.trim()} onChange={e => set('barangay', e.target.value)} />
        : null}

      {!areaOnly && <Autocomplete
        id={`${idPrefix}-street`} freeSolo disabled={disabled} options={ours ? [...BARANGAY_STREETS_FOR_FORM] : []} value={value.street}
        onInputChange={(_, v, reason) => { if (reason !== 'reset' || v) set('street', v); }}
        onChange={(_, v) => set('street', typeof v === 'string' ? v : '')}
        renderInput={p => (
          <TextField {...p} size="small" label={mode === 'residence' ? 'Street / subdivision *' : 'Street (or a landmark below)'}
            error={Boolean(errors.street)}
            helperText={errors.street ?? (street && !street.known
              ? street.suggestions.length ? `Not on the barangay's street list. Did you mean ${street.suggestions.join(' or ')}? Choose it only if it is right.` : 'Not on the barangay\'s street list - an official will check it.'
              : ours ? 'Choose from the barangay\'s streets, or type it' : ' ')} />
        )}
      />}
      {areaOnly ? null : mode === 'residence' ? (
        <>
          <TextField size="small" id={`${idPrefix}-house`} label={houseRequired ? 'House / building no. *' : 'House / building no. (optional)'} disabled={disabled}
            value={value.houseNumber ?? ''} onChange={e => set('houseNumber', e.target.value)}
            error={Boolean(errors.houseNumber)} helperText={errors.houseNumber}
            slotProps={{ htmlInput: { maxLength: 40 } }} />
          <TextField size="small" label="Purok / subdivision (optional)" disabled={disabled} value={value.purok ?? ''} onChange={e => set('purok', e.target.value)}
            slotProps={{ htmlInput: { maxLength: 80 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
        </>
      ) : (
        <TextField size="small" label="Landmark or other details" disabled={disabled} value={value.details ?? ''} onChange={e => set('details', e.target.value)}
          placeholder="e.g. beside the chapel" slotProps={{ htmlInput: { maxLength: 300 } }} />
      )}
      {!ours && value.barangay.trim() && value.municipality.trim() && (
        <Typography sx={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: '#b45309' }}>
          SafeComm serves Barangay {DEFAULT_JURISDICTION.barangay}, {DEFAULT_JURISDICTION.municipality}, {DEFAULT_JURISDICTION.province}. {mode === 'residence'
            ? 'An address elsewhere cannot be registered here - please contact your own barangay.'
            : 'An incident elsewhere is referred to the barangay or authority where it happened.'}
        </Typography>
      )}
    </Box>
  );
}
