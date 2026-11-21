'use client';

import { useState } from 'react';
import {
  Box, Typography, TextField, Button, Alert, CircularProgress, FormControlLabel, Checkbox, MenuItem,
} from '@mui/material';
import { Phone } from '@mui/icons-material';
import AddressFields, { emptyAddress, type AddressValue } from '@/components/forms/AddressFields';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';

const NAVY = '#0c1e46';

/** The emergency numbers, always shown with a referral: an urgent danger is never left to a form. */
export function EmergencyNumbers() {
  return (
    <Alert severity="error" icon={<Phone />} sx={{ borderRadius: 2 }}>
      <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }}>Kung may agarang panganib, tumawag kaagad. (If anyone is in immediate danger, call now.)</Typography>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
        {EMERGENCY_CONTACTS.map(c => <a key={c.label} href={`tel:${c.number.replace(/[^\d+]/g, '')}`} style={{ color: '#991b1b', fontWeight: 700 }}>{c.label}: {c.number}</a>)}
      </Box>
    </Alert>
  );
}

/**
 * A referral record - what cannot be filed as a standard SafeComm report
 * (the reporter is not yet a verified resident, the incident is outside the
 * jurisdiction, or it is urgent) - so it is not lost. The barangay reviews
 * it; it is never a case. The server decides which kind it is.
 */
export default function ReferralForm({ initial, initialSummary = '', reason }: {
  initial?: Partial<AddressValue>; initialSummary?: string;
  /** Why the resident is here, said at the top. */
  reason: string;
}) {
  const [place, setPlace] = useState<AddressValue>({ ...emptyAddress(), ...initial });
  const [summary, setSummary] = useState(initialSummary);
  const [urgent, setUrgent] = useState(false);
  const [relationship, setRelationship] = useState('SELF');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kindLabel: string; guidance: string[] } | null>(null);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/resident/referrals', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urgent, reportingRelationship: relationship, province: place.province.trim(), municipality: place.municipality.trim(),
          barangay: place.barangay.trim(), street: place.street.trim(), locationDetails: (place.details ?? '').trim(), summary: summary.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'Could not save the record'); return; }
      setDone({ kindLabel: j.data.kindLabel, guidance: j.data.guidance ?? [] });
    } catch { setError('Could not save the record right now.'); } finally { setBusy(false); }
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography sx={{ fontSize: '0.86rem', color: '#475569' }}>{reason}</Typography>
      <EmergencyNumbers />
      {done ? (
        <Alert severity="success" sx={{ borderRadius: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }}>Saved as a referral record ({done.kindLabel}).</Typography>
          {done.guidance.map(g => <Typography key={g} sx={{ fontSize: '0.84rem' }}>{g}</Typography>)}
        </Alert>
      ) : (
        <>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.92rem' }}>Where it happened</Typography>
          <AddressFields value={place} onChange={setPlace} mode="incident" disabled={busy} idPrefix="ref" />
          <TextField select size="small" label="Who is this about?" value={relationship} onChange={e => setRelationship(e.target.value)} disabled={busy}>
            <MenuItem value="SELF">Me</MenuItem>
            <MenuItem value="ON_BEHALF">Someone else, on their behalf</MenuItem>
            <MenuItem value="THIRD_PARTY">Something I saw happen to others</MenuItem>
          </TextField>
          <TextField multiline minRows={3} label="What happened (optional)" value={summary} onChange={e => setSummary(e.target.value)} disabled={busy}
            slotProps={{ htmlInput: { maxLength: 2000 } }} helperText="Only what the barangay needs to know to help or refer you." />
          <FormControlLabel control={<Checkbox checked={urgent} onChange={e => setUrgent(e.target.checked)} disabled={busy} />}
            label="This is urgent - someone may be in danger" />
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
          <Box><Button variant="contained" onClick={save} disabled={busy} sx={{ textTransform: 'none', bgcolor: NAVY }}>
            {busy ? <CircularProgress size={16} color="inherit" /> : 'Save as a referral record'}
          </Button></Box>
          <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>A referral record is not a SafeComm case. The Barangay Captain reviews it and, where it is the barangay&apos;s to act on, staff take it in.</Typography>
        </>
      )}
    </Box>
  );
}
