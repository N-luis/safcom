'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Chip, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
} from '@mui/material';
import { EventAvailable, Place, Schedule, CheckCircle } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { formatHearingDate, formatHearingTime, formatHearingWhen } from '@/lib/hearings';

const ACCENT = '#14b8a6';
const NAVY = '#0c1e46';

interface Item {
  id: string; title: string; scheduledAt: string; venue: string; status: string; statusLabel: string; upcoming: boolean; rescheduled: boolean;
  acknowledgedAt: string | null; canAcknowledge: boolean; canRequest: boolean; instructions: string[];
  requests: { id: string; status: 'PENDING' | 'APPROVED' | 'DECLINED'; reason: string; preferredSchedule: string | null; reviewNote: string | null; createdAt: string; reviewedAt: string | null }[];
  updates: { id: string; message: string; at: string }[];
}
interface Data { upcoming: Item[]; all: Item[] }

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load your appointments');
  return body.data as Data;
};
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
};

const REQUEST_LABEL = { PENDING: 'Waiting for the barangay', APPROVED: 'Approved', DECLINED: 'Answered' } as const;

/**
 * My Appointments: the appointments the barangay set with the resident, on
 * their own reports - the date, time and place, what to bring, an
 * acknowledgement, and a way to ask for a new date. Nothing about the
 * officials' notes or records.
 */
export default function ResidentAppointments({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useSWR<Data>('/api/resident/appointments', fetcher, { refreshInterval: 60_000 });
  const [ask, setAsk] = useState<Item | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const others = data?.all.filter(a => !a.upcoming) ?? [];

  const acknowledge = async (a: Item) => {
    setBusy(a.id);
    try { await post(`/api/resident/appointments/${a.id}`, { action: 'acknowledge' }); toast.success('Thank you - the barangay can see you have seen it'); await mutate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(null); }
  };

  return (
    // Embedded: the Appointments tab of My Hearings & Notices (ResidentHearingsModule), which has the title.
    <Box sx={embedded ? { width: '100%', maxWidth: 1100 } : { p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      {!embedded && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#ccfbf1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EventAvailable sx={{ color: '#0f766e' }} />
          </Box>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>My Appointments</Typography>
        </Box>
      )}

      {error && !data && <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>}
      {isLoading && !data && <Skeleton variant="rounded" height={180} />}

      {data && (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {data.upcoming.length === 0 && (
            <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent sx={{ textAlign: 'center', py: 5 }}>
                <EventAvailable sx={{ fontSize: 36, color: '#cbd5e1' }} />
                <Typography sx={{ color: '#64748b', fontSize: '0.9rem', mt: 1 }}>You have no upcoming appointment.</Typography>
              </CardContent>
            </Card>
          )}
          {data.upcoming.map(a => (
            <Card key={a.id} data-appointment={a.id} sx={{ borderRadius: 3, boxShadow: 'none', border: `1px solid ${ACCENT}55` }}>
              <CardContent sx={{ display: 'grid', gap: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1.05rem' }}>{a.title}</Typography>
                  <Chip size="small" label={a.statusLabel} sx={{ fontWeight: 700, bgcolor: a.rescheduled ? '#fef3c7' : '#ccfbf1', color: a.rescheduled ? '#b45309' : '#0f766e' }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', color: '#334155' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><Schedule sx={{ fontSize: 18, color: '#0f766e' }} />
                    <Typography sx={{ fontWeight: 700 }}>{formatHearingDate(a.scheduledAt)}, {formatHearingTime(a.scheduledAt)}</Typography></Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><Place sx={{ fontSize: 18, color: '#0f766e' }} /><Typography>{a.venue}</Typography></Box>
                </Box>
                <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '0.86rem' }}>
                  {a.instructions.map(i => <li key={i}>{i}</li>)}
                </Box>
                {a.requests.map(r => (
                  <Alert key={r.id} severity={r.status === 'PENDING' ? 'info' : r.status === 'APPROVED' ? 'success' : 'warning'} sx={{ borderRadius: 2 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.84rem' }}>Your request for a new date: {REQUEST_LABEL[r.status]}</Typography>
                    {r.reviewNote && <Typography sx={{ fontSize: '0.82rem' }}>Reply: {r.reviewNote}</Typography>}
                  </Alert>
                ))}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  {a.acknowledgedAt
                    ? <Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#15803d', fontSize: '0.86rem', fontWeight: 700 }}><CheckCircle sx={{ fontSize: 18 }} /> You acknowledged this on {formatHearingWhen(a.acknowledgedAt)}</Typography>
                    : a.canAcknowledge && (
                      <Button variant="contained" onClick={() => acknowledge(a)} disabled={busy === a.id}
                        sx={{ textTransform: 'none', bgcolor: ACCENT, borderRadius: 2, minHeight: 44, '&:hover': { bgcolor: '#0d9488' } }}>
                        {busy === a.id ? <CircularProgress size={18} color="inherit" /> : 'I have seen this'}
                      </Button>
                    )}
                  {a.canRequest && <Button variant="outlined" onClick={() => setAsk(a)} sx={{ textTransform: 'none', borderRadius: 2, minHeight: 44 }}>Ask for a new date</Button>}
                </Box>
              </CardContent>
            </Card>
          ))}

          {others.length > 0 && (
            <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent>
                <Typography sx={{ fontWeight: 800, color: NAVY, mb: 1 }}>Past and cancelled</Typography>
                <Box sx={{ display: 'grid', gap: 1 }}>
                  {others.map(a => (
                    <Box key={a.id} sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', p: 1, borderRadius: 2, bgcolor: '#f8fafc' }}>
                      <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.88rem' }}>{a.title}</Typography>
                      <Typography sx={{ fontSize: '0.84rem', color: '#475569' }}>{formatHearingWhen(a.scheduledAt)}</Typography>
                      <Chip size="small" label={a.statusLabel} sx={{ ml: 'auto', fontWeight: 700 }} />
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      {ask && <AskDialog a={ask} onClose={() => setAsk(null)} onDone={() => { setAsk(null); void mutate(); }} />}
    </Box>
  );
}

function AskDialog({ a, onClose, onDone }: { a: Item; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [preferred, setPreferred] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post(`/api/resident/appointments/${a.id}`, { action: 'reschedule', reason: reason.trim(), preferredSchedule: preferred.trim() || undefined });
      toast.success('Request sent. The barangay will reply here.');
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Ask for a new date</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        <Typography sx={{ fontSize: '0.84rem', color: '#475569' }}>Now: {formatHearingWhen(a.scheduledAt)}. The date stays until the barangay answers.</Typography>
        <TextField label="Why you need a new date" value={reason} onChange={e => setReason(e.target.value)} multiline minRows={2} autoFocus />
        <TextField label="Days or times that are safe for you (optional)" value={preferred} onChange={e => setPreferred(e.target.value)} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || reason.trim().length < 5} sx={{ textTransform: 'none', bgcolor: ACCENT, '&:hover': { bgcolor: '#0d9488' } }}>Send request</Button>
      </DialogActions>
    </Dialog>
  );
}
