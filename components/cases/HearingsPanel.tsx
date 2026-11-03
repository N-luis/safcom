'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Checkbox, FormControlLabel, CircularProgress,
} from '@mui/material';
import { Gavel, Add } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { HEARING_OUTCOMES, HEARING_STATUSES, type HearingOutcome, type HearingStatus } from '@/lib/analytics';

/**
 * Katarungang Pambarangay hearings on a blotter case: schedule hearing 1 to 3,
 * then record each as held (with the outcome), postponed or cancelled. Not
 * mounted on VAWC cases, and the server refuses them in any case.
 */

interface Hearing {
  id: string; hearingNumber: number; scheduledAt: string; venue: string | null; status: HearingStatus;
  outcome: HearingOutcome | null; statusReason: string | null; notes: string | null;
}
interface Data { hearings: Hearing[]; next: number | null; canEdit: boolean; blocked: string | null }

const NAVY = '#0c1e46';
const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load the hearings');
  return body.data as Data;
};
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS_COLOR: Record<HearingStatus, string> = { SCHEDULED: '#0369a1', COMPLETED: '#15803d', POSTPONED: '#a16207', CANCELLED: '#64748b' };

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
}

export default function HearingsPanel({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Data>(`/api/cases/${caseId}/hearings`, fetcher);
  const [schedule, setSchedule] = useState(false);
  const [update, setUpdate] = useState<{ h: Hearing; action: 'complete' | 'postpone' | 'cancel' } | null>(null);
  const done = () => { setSchedule(false); setUpdate(null); void mutate(); onChanged?.(); };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Gavel sx={{ fontSize: 17, color: '#0369a1' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Hearings (Katarungang Pambarangay)</Typography>
          {data?.canEdit && data.next && !data.blocked && (
            <Button size="small" startIcon={<Add sx={{ fontSize: 15 }} />} onClick={() => setSchedule(true)} sx={{ ml: 'auto', textTransform: 'none', minHeight: 32 }}>
              Schedule hearing {data.next}
            </Button>
          )}
        </Box>
        {isLoading && <Skeleton height={60} />}
        {error && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{error.message}</Alert>}
        {data && (
          <>
            {data.hearings.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No hearing scheduled.</Typography>}
            {data.hearings.map(h => (
              <Box key={h.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1, mb: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: NAVY }}>Hearing {h.hearingNumber}</Typography>
                  <Chip size="small" label={HEARING_STATUSES[h.status]} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: `${STATUS_COLOR[h.status]}14`, color: STATUS_COLOR[h.status] }} />
                  <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{when(h.scheduledAt)}{h.venue ? ` · ${h.venue}` : ''}</Typography>
                  {data.canEdit && h.status === 'SCHEDULED' && (
                    <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                      <Button size="small" onClick={() => setUpdate({ h, action: 'complete' })} sx={{ textTransform: 'none', minHeight: 30 }}>Record as held</Button>
                      <Button size="small" onClick={() => setUpdate({ h, action: 'postpone' })} sx={{ textTransform: 'none', minHeight: 30, color: '#a16207' }}>Postpone</Button>
                      <Button size="small" onClick={() => setUpdate({ h, action: 'cancel' })} sx={{ textTransform: 'none', minHeight: 30, color: '#64748b' }}>Cancel</Button>
                    </Box>
                  )}
                </Box>
                {h.outcome && <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.25 }}>Outcome: {HEARING_OUTCOMES[h.outcome]}</Typography>}
                {h.statusReason && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25 }}>Reason: {h.statusReason}</Typography>}
                {h.notes && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25, whiteSpace: 'pre-wrap' }}>{h.notes}</Typography>}
              </Box>
            ))}
            {data.blocked && data.hearings.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.5 }}>{data.blocked}</Typography>}
          </>
        )}
      </CardContent>
      {schedule && data?.next && <ScheduleDialog caseId={caseId} number={data.next} first={data.hearings.length === 0} onClose={() => setSchedule(false)} onDone={done} />}
      {update && <UpdateDialog caseId={caseId} h={update.h} action={update.action} onClose={() => setUpdate(null)} onDone={done} />}
    </Card>
  );
}

function ScheduleDialog({ caseId, number, first, onClose, onDone }: { caseId: string; number: number; first: boolean; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState('');
  const [venue, setVenue] = useState('Barangay hall');
  const [notes, setNotes] = useState('');
  const [kp, setKp] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!at) { toast.error('Choose the date and time'); return; }
    if (first && !kp) { toast.error('Confirm the dispute is one the barangay may conciliate'); return; }
    setSaving(true);
    try {
      await send(`/api/cases/${caseId}/hearings`, 'POST', { hearingNumber: number, scheduledAt: new Date(at).toISOString(), venue, notes: notes || undefined, kpConfirmed: kp });
      toast.success(`Hearing ${number} scheduled`);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Schedule hearing {number}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <TextField size="small" type="datetime-local" label="Date and time" value={at} onChange={e => setAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Venue" value={venue} onChange={e => setVenue(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
        <TextField size="small" label="Notes (optional)" multiline minRows={2} value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        {first && (
          <FormControlLabel sx={{ alignItems: 'flex-start' }} control={<Checkbox checked={kp} onChange={e => setKp(e.target.checked)} sx={{ pt: 0.25 }} />}
            label={<Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>
              I have checked that this dispute is one the barangay may mediate or conciliate under the Katarungang Pambarangay
              (the parties, the offence and the place qualify), and that it is not a VAWC case.
            </Typography>} />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UpdateDialog({ caseId, h, action, onClose, onDone }: { caseId: string; h: Hearing; action: 'complete' | 'postpone' | 'cancel'; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<HearingOutcome | ''>('');
  const [reason, setReason] = useState('');
  const [newDate, setNewDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const body = action === 'complete' ? { action, outcome, notes: notes || undefined }
        : action === 'postpone' ? { action, reason, ...(newDate && { newDate: new Date(newDate).toISOString() }) }
          : { action, reason };
      await send(`/api/cases/${caseId}/hearings/${h.id}`, 'PATCH', body);
      toast.success('Hearing updated');
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };
  const title = action === 'complete' ? `Record hearing ${h.hearingNumber} as held` : action === 'postpone' ? `Postpone hearing ${h.hearingNumber}` : `Cancel hearing ${h.hearingNumber}`;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        {action === 'complete' ? (
          <>
            <TextField select size="small" label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value as HearingOutcome)}>
              {(Object.keys(HEARING_OUTCOMES) as HearingOutcome[]).map(k => <MenuItem key={k} value={k}>{HEARING_OUTCOMES[k]}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Notes (optional)" multiline minRows={2} value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          </>
        ) : (
          <>
            <TextField size="small" label="Reason" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
            {action === 'postpone' && (
              <TextField size="small" type="datetime-local" label="New date and time (optional)" value={newDate} onChange={e => setNewDate(e.target.value)}
                helperText="The postponed hearing stays on record; the new date is added beside it." slotProps={{ inputLabel: { shrink: true } }} />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" onClick={save} disabled={saving || (action === 'complete' ? !outcome : reason.trim().length < 3)} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
