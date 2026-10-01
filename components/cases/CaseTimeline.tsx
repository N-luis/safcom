'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Button, Chip, TextField, Skeleton, Alert, Divider,
} from '@mui/material';
import {
  Timeline as TimelineIcon, Person, Shield, AutoAwesome, CheckCircle, Send,
} from '@mui/icons-material';
import { useLanguage } from '@/lib/i18n';
import {
  PROGRESS_LABELS, PROGRESS_STATE_LABELS, PROGRESS_VALUES, MAX_NOTE_LENGTH,
  type Progress, type ProgressState,
} from '@/lib/followUps';

/**
 * The resident's view of a case over time, and the form for adding to it.
 *
 * Only entries an officer chose to share reach this component - the API filters
 * them - so there is no risk of an internal note being one CSS rule away from
 * being read. Progress is a single tap, because the common follow-up is "still
 * happening" from a phone and a long form would stop people sending it.
 */

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface Entry {
  id: string;
  createdAt: string;
  updateType: string;
  authorRole: string;
  authorName: string;
  progress?: string | null;
  content: string;
}

const PROGRESS_COLOR: Record<ProgressState, string> = {
  improving: '#22c55e', no_change: '#64748b', worsening: '#ef4444', resolved: '#0ea5e9',
};

const CHOICE_COLOR: Record<Progress, string> = {
  still_happening: '#64748b', improving: '#22c55e', worsening: '#ef4444', resolved: '#0ea5e9',
};

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CaseTimeline({ caseId, caseStatus, accent = '#14b8a6' }: {
  caseId: string;
  caseStatus: string;
  accent?: string;
}) {
  const { lang } = useLanguage();
  const { data, isLoading, mutate } = useSWR<{
    progressState: ProgressState; status: string; timeline: Entry[];
  }>(`/api/resident/cases/${caseId}/follow-ups`, fetcher);

  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Progress>('still_happening');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const closed = ['Resolved', 'Closed'].includes(caseStatus);
  const state = data?.progressState ?? 'no_change';

  const submit = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const res = await fetch(`/api/resident/cases/${caseId}/follow-ups`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Could not save your update.'); return; }

      setSuccess(
        json.data?.pendingConfirmation
          ? 'Thank you. A barangay officer will confirm and close the case.'
          : json.data?.riskChange
            ? `Update saved. This case has been raised to ${json.data.riskChange.to} priority and an officer has been alerted.`
            : 'Update saved. The barangay can see it now.',
      );
      setNote(''); setOpen(false);
      mutate();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />

      {/* ── Progress ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>
          Progress
        </Typography>
        {isLoading ? <Skeleton variant="rounded" width={96} height={22} /> : (
          <Chip
            label={PROGRESS_STATE_LABELS[state][lang]}
            size="small"
            sx={{ bgcolor: `${PROGRESS_COLOR[state]}18`, color: PROGRESS_COLOR[state], fontWeight: 800, fontSize: '0.74rem' }}
          />
        )}
      </Box>

      {success && <Alert severity="success" sx={{ mb: 1.5, borderRadius: 2 }}>{success}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1.5, borderRadius: 2 }}>{error}</Alert>}

      {/* ── Add a follow-up ── */}
      {!closed && (
        open ? (
          <Box sx={{ border: '1px solid #e8edf2', borderRadius: 2.5, p: 1.75, mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.25 }}>
              {PROGRESS_VALUES.map(p => (
                <Button
                  key={p}
                  onClick={() => setProgress(p)}
                  aria-pressed={progress === p}
                  sx={{
                    minHeight: 44, flex: '1 1 140px', textTransform: 'none', fontWeight: 700,
                    fontSize: '0.82rem', borderRadius: 2,
                    border: `1.5px solid ${progress === p ? CHOICE_COLOR[p] : '#e2e8f0'}`,
                    bgcolor: progress === p ? `${CHOICE_COLOR[p]}14` : 'transparent',
                    color: progress === p ? CHOICE_COLOR[p] : '#64748b',
                  }}
                >
                  {PROGRESS_LABELS[p][lang]}
                </Button>
              ))}
            </Box>
            <TextField
              fullWidth multiline minRows={2}
              value={note}
              onChange={e => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              placeholder={lang === 'tl' ? 'Magdagdag ng detalye (opsyonal)' : 'Add any detail (optional)'}
              helperText={`${note.length}/${MAX_NOTE_LENGTH}`}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: '0.88rem' } }}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1.25, flexDirection: { xs: 'column', sm: 'row' } }}>
              <Button
                onClick={submit} disabled={saving} variant="contained" startIcon={<Send />}
                sx={{ minHeight: 44, flex: 1, textTransform: 'none', fontWeight: 700, bgcolor: accent, '&:hover': { bgcolor: '#0d9488' } }}
              >
                {saving ? 'Saving…' : lang === 'tl' ? 'Ipadala' : 'Send update'}
              </Button>
              <Button
                onClick={() => { setOpen(false); setError(''); }} disabled={saving}
                sx={{ minHeight: 44, textTransform: 'none', color: '#64748b' }}
              >
                {lang === 'tl' ? 'Kanselahin' : 'Cancel'}
              </Button>
            </Box>
          </Box>
        ) : null
      )}

      {/* ── Timeline ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <TimelineIcon sx={{ fontSize: 15, color: '#94a3b8' }} />
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>
          {lang === 'tl' ? 'Kasaysayan' : 'Timeline'}
        </Typography>
      </Box>

      {isLoading ? (
        <Box>{[0, 1].map(i => <Skeleton key={i} variant="rounded" height={52} sx={{ mb: 1 }} />)}</Box>
      ) : !data?.timeline.length ? (
        <Typography sx={{ fontSize: '0.84rem', color: '#94a3b8' }}>
          {lang === 'tl' ? 'Wala pang update sa kasong ito.' : 'No updates on this case yet.'}
        </Typography>
      ) : (
        <Box sx={{ position: 'relative', pl: 2.25 }}>
          {/* The rail sits behind the dots and stops at the last entry. */}
          <Box sx={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 2, bgcolor: '#eef2f6' }} />
          {data.timeline.map(e => {
            const isResident = e.authorRole === 'resident';
            const isSystem = e.authorRole === 'system';
            const Icon = isResident ? Person : isSystem ? AutoAwesome : Shield;
            const dot = isResident ? accent : isSystem ? '#8b5cf6' : '#64748b';
            return (
              <Box key={e.id} sx={{ position: 'relative', mb: 1.5 }}>
                <Box sx={{
                  position: 'absolute', left: -20, top: 4, width: 10, height: 10,
                  borderRadius: '50%', bgcolor: dot, border: '2px solid #fff',
                }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
                  <Icon sx={{ fontSize: 13, color: dot }} />
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>{e.authorName}</Typography>
                  {e.progress && (
                    <Chip
                      label={PROGRESS_LABELS[e.progress as Progress]?.[lang] ?? e.progress}
                      size="small"
                      sx={{
                        height: 18, fontSize: '0.68rem', fontWeight: 700,
                        bgcolor: `${CHOICE_COLOR[e.progress as Progress] ?? '#64748b'}18`,
                        color: CHOICE_COLOR[e.progress as Progress] ?? '#64748b',
                      }}
                    />
                  )}
                  <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', ml: 'auto' }}>{when(e.createdAt)}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.84rem', color: '#475569', lineHeight: 1.5, mt: 0.2 }}>
                  {e.content}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}

      {/* The button lives next to Close in the dialog actions; this is the
          in-body entry point when the form is collapsed. */}
      {!closed && !open && (
        <Button
          onClick={() => { setOpen(true); setSuccess(''); }}
          startIcon={<CheckCircle />}
          variant="outlined"
          fullWidth
          sx={{
            mt: 1.5, minHeight: 44, textTransform: 'none', fontWeight: 700,
            borderColor: accent, color: accent,
          }}
        >
          {lang === 'tl' ? 'Magdagdag ng update' : 'Add follow-up'}
        </Button>
      )}

      <Typography sx={{ fontSize: '0.74rem', color: '#cbd5e1', mt: 1.25, lineHeight: 1.5 }}>
        {lang === 'tl'
          ? 'Ang pagsusuri ng SafeComm ay paunang pagtaya lamang at hindi nagtatakda ng pananagutan. Susuriin ito ng opisyal ng barangay.'
          : 'SafeComm’s assessment is an initial one and does not determine fault. A barangay officer reviews every case.'}
      </Typography>
    </Box>
  );
}
