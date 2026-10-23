'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Button, TextField, MenuItem, ListSubheader, Alert, Chip, CircularProgress,
} from '@mui/material';
import { CheckCircle, Edit, Gavel } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  BLOTTER_CATEGORIES, VAWC_CATEGORIES, categoryByName, MATRIX_REVIEW_STATUS,
} from '@/lib/classificationSchema';

/**
 * The officer's decision on a case's category.
 *
 * Shows what the classification matrix says about the current category - its
 * definition, where the law sits, what must be confirmed, whether barangay
 * conciliation can apply - and lets the officer confirm it or change it with
 * a reason. Every decision is recorded with who, when, before and after.
 */

const CONCILIATION: Record<string, string> = {
  not_allowed: 'Not for barangay conciliation',
  check_exceptions: 'Conciliation may apply — check the exceptions',
  not_applicable: 'Conciliation does not apply',
};

export default function CategoryReview({ caseId, caseType, basePath, onChanged }: {
  caseId: string;
  caseType: string;
  /** This desk's case list, for when the case is referred away. */
  basePath: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  const meta = categoryByName(caseType);
  const [mode, setMode] = useState<'view' | 'change'>('view');
  const [next, setNext] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const send = async (body: Record<string, unknown>) => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/cases/${caseId}/classification`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? 'Could not save the decision'); return; }
      if (json?.data?.referredAway) {
        // This officer can no longer open it; the other desk now has it.
        toast.success(`Referred to the ${json.data.desk === 'VAWC' ? 'VAWC desk' : 'blotter desk'}`);
        router.push(basePath);
        return;
      }
      toast.success(body.confirm ? 'Category confirmed' : 'Category changed');
      setMode('view'); setNext(''); setReason('');
      onChanged();
    } catch {
      setError('Network error — nothing was changed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const label = { fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' };

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, mb: 1.5, bgcolor: '#fafafa' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
        <Gavel sx={{ fontSize: 16, color: '#475569' }} />
        <Typography sx={label}>Category decision</Typography>
        <Chip size="small" label={meta?.desk === 'VAWC' ? 'VAWC desk' : 'Blotter desk'}
          sx={{ ml: 'auto', height: 20, fontSize: '0.7rem', fontWeight: 700,
            bgcolor: meta?.desk === 'VAWC' ? '#f5f3ff' : '#f0fdfa', color: meta?.desk === 'VAWC' ? '#6d28d9' : '#0f766e' }} />
      </Box>

      <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#0c1e46' }}>{caseType}</Typography>
      {meta && (
        <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{meta.definition}</Typography>
          {meta.legalBasis.length > 0 && (
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
              <b>Where to look:</b> {meta.legalBasis.join('; ')}
            </Typography>
          )}
          {meta.confirm.length > 0 && (
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
              <b>Confirm before relying on it:</b> {meta.confirm.join(' ')}
            </Typography>
          )}
          <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
            <b>{CONCILIATION[meta.conciliation]}</b>{meta.referral ? ` · Usual referral: ${meta.referral}` : ''}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>{MATRIX_REVIEW_STATUS}</Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mt: 1, borderRadius: 2, fontSize: '0.8rem' }}>{error}</Alert>}

      {mode === 'view' ? (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" disabled={saving}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <CheckCircle sx={{ fontSize: 16 }} />}
            onClick={() => send({ caseType, confirm: true })}
            sx={{ minHeight: 36, textTransform: 'none', fontWeight: 700, bgcolor: '#0f766e', '&:hover': { bgcolor: '#115e59' } }}>
            Confirm category
          </Button>
          <Button size="small" variant="outlined" disabled={saving} startIcon={<Edit sx={{ fontSize: 15 }} />}
            onClick={() => setMode('change')}
            sx={{ minHeight: 36, textTransform: 'none', fontWeight: 700, borderColor: '#cbd5e1', color: '#334155' }}>
            Change category
          </Button>
        </Box>
      ) : (
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField select size="small" label="New category" value={next} onChange={e => setNext(e.target.value)}
            slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 340 } } } } } }}>
            <ListSubheader>Blotter desk</ListSubheader>
            {BLOTTER_CATEGORIES.filter(c => c.category !== caseType).map(c => (
              <MenuItem key={`b-${c.category}`} value={c.category}>{c.category}</MenuItem>
            ))}
            <ListSubheader sx={{ color: '#6d28d9' }}>VAWC desk (confidential)</ListSubheader>
            {VAWC_CATEGORIES.filter(c => c.category !== caseType).map(c => (
              <MenuItem key={`v-${c.category}`} value={c.category}>{c.category}</MenuItem>
            ))}
          </TextField>
          {next && categoryByName(next)?.desk !== meta?.desk && (
            <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
              This moves the case to the {categoryByName(next)?.desk === 'VAWC' ? 'VAWC desk' : 'blotter desk'}
              {categoryByName(next)?.desk === 'VAWC' ? '. You may no longer be able to open it afterwards.' : '.'}
            </Alert>
          )}
          <TextField size="small" label="Reason (required)" value={reason} onChange={e => setReason(e.target.value)}
            multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }}
            helperText="Recorded with your name and the time, beside the category it replaces." />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => { setMode('view'); setError(''); }} sx={{ textTransform: 'none', color: '#64748b' }}>
              Cancel
            </Button>
            <Button size="small" variant="contained" disabled={saving || !next || reason.trim().length < 5}
              onClick={() => send({ caseType: next, reason: reason.trim() })}
              sx={{ textTransform: 'none', fontWeight: 700 }}>
              {saving ? <CircularProgress size={14} color="inherit" /> : 'Save change'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
