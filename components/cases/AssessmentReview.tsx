'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Chip, Button, TextField, MenuItem, CircularProgress, Alert, Divider,
} from '@mui/material';
import { CheckCircle, Edit, Person } from '@mui/icons-material';
import { CASE_PRIORITY } from '@/lib/caseAssessment';

/**
 * The officer's decision on the assessment.
 *
 * The reading the system produces is a recommendation; what the case is
 * handled as is a person's call. Until an officer has agreed with it or
 * changed it, this says so plainly, because an unreviewed suggestion sitting
 * on a case looks exactly like a decision somebody made.
 *
 * Agreeing and changing are both recorded, with who and when. Only a change
 * asks for a reason: requiring one to agree would produce a column of "ok".
 */

interface StoredAssessment {
  priority: string;
  summary?: string | null;
  reason?: string | null;
  overridePriority?: string | null;
  overrideReason?: string | null;
  overriddenAt?: string | null;
  overriddenBy?: { id: string; name: string; role: string } | null;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(async r => {
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data as StoredAssessment;
  });

const PRIORITY_COLOR: Record<string, string> = {
  'Immediate Response': '#b42318',
  'Urgent Attention': '#c2410c',
  'Priority Attention': '#b45309',
  'Standard Processing': '#0f766e',
  Routine: '#475569',
};

export default function AssessmentReview({ caseId, onChanged }: {
  caseId: string;
  /** Lets the page re-read the case once its level has moved. */
  onChanged?: () => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<StoredAssessment>(
    `/api/cases/${caseId}/assessment`, fetcher, { shouldRetryOnError: false },
  );

  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'adjust' | null>(null);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState('');

  // 404 here means nothing has been assessed yet, which is a state to show
  // rather than an error; the review still works and assesses on the way.
  const notAssessed = !!error;
  const recommended = data?.priority ?? null;
  const decided = data?.overridePriority ?? null;

  async function send(priority: string, confirm: boolean) {
    setBusy(confirm ? 'confirm' : 'adjust'); setFailed(''); setDone('');
    try {
      const res = await fetch(`/api/cases/${caseId}/assessment`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirm ? { priority, confirm: true } : { priority, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setFailed(json?.error ?? 'Could not save that. Please try again.'); return; }
      setDone(confirm ? 'Assessment confirmed.' : 'Classification updated.');
      setEditing(false); setReason('');
      await mutate();
      onChanged?.();
    } catch {
      setFailed('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const label = {
    fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase' as const, color: '#94a3b8',
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        <CircularProgress size={14} />
        <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>Loading the assessment…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 1.5 }}>
      <Divider sx={{ mb: 1.5 }} />
      <Typography sx={{ ...label, mb: 1 }}>Officer review</Typography>

      {notAssessed && (
        <Typography sx={{ fontSize: '0.84rem', color: '#64748b', mb: 1.25 }}>
          This case has not been assessed yet. Setting a classification below will assess it
          from the report first, then record your decision.
        </Typography>
      )}

      {recommended && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b', minWidth: 104 }}>Recommended</Typography>
          <Chip label={recommended} size="small" sx={{
            bgcolor: `${PRIORITY_COLOR[recommended] ?? '#64748b'}14`,
            color: PRIORITY_COLOR[recommended] ?? '#64748b', fontWeight: 700, fontSize: '0.74rem',
          }} />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.82rem', color: '#64748b', minWidth: 104 }}>Officer decision</Typography>
        {decided ? (
          <Chip label={decided} size="small" sx={{
            bgcolor: `${PRIORITY_COLOR[decided] ?? '#64748b'}14`,
            color: PRIORITY_COLOR[decided] ?? '#64748b', fontWeight: 700, fontSize: '0.74rem',
          }} />
        ) : (
          <Chip label="Not reviewed yet" size="small"
            sx={{ bgcolor: '#fff7ed', color: '#b45309', fontWeight: 700, fontSize: '0.74rem' }} />
        )}
      </Box>

      {decided && data?.overriddenBy && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mb: 1.25 }}>
          <Person aria-hidden sx={{ fontSize: 15, color: '#94a3b8', mt: 0.2 }} />
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
            {data.overriddenBy.name}
            {data.overriddenAt && ` · ${new Date(data.overriddenAt).toLocaleString('en-PH', {
              year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}`}
            {data.overrideReason && <> — &ldquo;{data.overrideReason}&rdquo;</>}
          </Typography>
        </Box>
      )}

      {done && <Alert severity="success" sx={{ py: 0.25, mb: 1, borderRadius: 2, fontSize: '0.82rem' }}>{done}</Alert>}
      {failed && <Alert severity="error" sx={{ py: 0.25, mb: 1, borderRadius: 2, fontSize: '0.82rem' }}>{failed}</Alert>}

      {editing ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <TextField
            select size="small" label="Classification"
            value={choice} onChange={e => setChoice(e.target.value)}
            fullWidth
          >
            {CASE_PRIORITY.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label="Reason for the change" value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="What in the report led you to a different level?"
            fullWidth multiline rows={2}
            helperText={`${reason.trim().length}/5 characters minimum`}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained" size="small"
              disabled={!choice || reason.trim().length < 5 || busy !== null}
              onClick={() => send(choice, false)}
              sx={{ minHeight: 40, borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              {busy === 'adjust' ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : 'Save classification'}
            </Button>
            <Button
              size="small" onClick={() => { setEditing(false); setFailed(''); }}
              sx={{ minHeight: 40, textTransform: 'none', color: '#64748b' }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {recommended && !decided && (
            <Button
              variant="contained" size="small"
              startIcon={<CheckCircle sx={{ fontSize: 16 }} />}
              disabled={busy !== null}
              onClick={() => send(recommended, true)}
              sx={{
                minHeight: 40, borderRadius: 2, textTransform: 'none', fontWeight: 700,
                bgcolor: '#0f766e', '&:hover': { bgcolor: '#0b5e58' },
              }}
            >
              {busy === 'confirm' ? <CircularProgress size={15} sx={{ color: '#fff' }} /> : 'Confirm assessment'}
            </Button>
          )}
          <Button
            variant="outlined" size="small"
            startIcon={<Edit sx={{ fontSize: 15 }} />}
            disabled={busy !== null}
            onClick={() => { setChoice(decided ?? recommended ?? ''); setEditing(true); setDone(''); }}
            sx={{ minHeight: 40, borderRadius: 2, textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#334155' }}
          >
            {decided ? 'Change classification' : 'Set a different level'}
          </Button>
        </Box>
      )}

      <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', mt: 1.25, lineHeight: 1.5 }}>
        The assessment supports the officer&apos;s judgement; it does not replace it, and it is
        not a legal determination.
      </Typography>
    </Box>
  );
}
