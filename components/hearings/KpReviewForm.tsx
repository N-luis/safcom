'use client';

import { useState } from 'react';
import { Box, Typography, Checkbox, FormControlLabel, TextField, Button, CircularProgress, Alert } from '@mui/material';
import { FactCheck } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { KP_CHECKLIST, type KpCheckKey } from '@/lib/hearings';
import { NAVY, send } from './hearingUi';

/**
 * The official's eligibility review for Katarungang Pambarangay proceedings.
 * Every point is confirmed by the official; an unticked point makes the
 * review "not eligible", and the official says why.
 */
export default function KpReviewForm({ caseId, caseType, onSaved }: { caseId: string; caseType: string; onSaved: () => void }) {
  const [checks, setChecks] = useState<Record<KpCheckKey, boolean>>(() => Object.fromEntries(KP_CHECKLIST.map(c => [c.key, false])) as Record<KpCheckKey, boolean>);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const all = KP_CHECKLIST.every(c => checks[c.key]);

  const save = async () => {
    if (!all && note.trim().length < 3) { toast.error('Say briefly why the dispute is not eligible'); return; }
    setSaving(true);
    try {
      await send(`/api/cases/${caseId}/kp-review`, 'POST', { checklist: checks, note: note.trim() || undefined });
      toast.success(all ? 'Recorded as eligible for barangay conciliation' : 'Recorded as not eligible');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };

  return (
    <Box sx={{ border: '1px solid #cbd5e1', borderRadius: 2, p: 1.5, bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FactCheck sx={{ fontSize: 18, color: '#0369a1' }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>Eligibility review - Katarungang Pambarangay</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color: '#475569', mb: 1 }}>
        For the verified category <b>{caseType}</b>. Tick each point you have checked. This records your review; it is kept with your name and the date.
      </Typography>
      <Box sx={{ display: 'grid', gap: 0.25 }}>
        {KP_CHECKLIST.map(c => (
          <FormControlLabel key={c.key} sx={{ alignItems: 'flex-start', m: 0 }}
            control={<Checkbox size="small" checked={checks[c.key]} onChange={e => setChecks(s => ({ ...s, [c.key]: e.target.checked }))} sx={{ pt: 0.25 }} />}
            label={<Typography sx={{ fontSize: '0.8rem', color: '#334155', pt: 0.4 }}>{c.label}</Typography>} />
        ))}
      </Box>
      {!all && (
        <Alert severity="info" sx={{ mt: 1, borderRadius: 2, fontSize: '0.78rem', py: 0.25 }}>
          With any point unticked, the review is saved as <b>not eligible</b> and no hearing can be created.
        </Alert>
      )}
      <TextField fullWidth size="small" multiline minRows={2} sx={{ mt: 1 }} label={all ? 'Note (optional)' : 'Why it is not eligible *'}
        value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
        <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ textTransform: 'none', bgcolor: NAVY, minHeight: 34 }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : all ? 'Record as eligible' : 'Record as not eligible'}
        </Button>
      </Box>
    </Box>
  );
}
