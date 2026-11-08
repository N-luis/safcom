'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Button, Chip, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Skeleton, CircularProgress,
} from '@mui/material';
import { Diversity3, Add, Edit, ContentCopy } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { SEX_AT_BIRTH } from '@/lib/victimSurvivors';

/**
 * The victim-survivors of a VAWC case, one per person, for the women-and-
 * children statistics in Analytics. No name or contact detail is kept here -
 * only sex at birth, birthdate or age at the incident, and the VAWC client
 * code that recognises the same person on another case.
 */

const NAVY = '#0c1e46';
const PURPLE = '#6d28d9';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;
interface Victim { id: string; sexAtBirth: string | null; birthDate: string | null; ageAtIncident: number | null; clientCode: string | null;
  source: string; createdAt: string; removedAt: string | null; removedReason: string | null; recordedBy: string | null; removedBy: string | null }

const getJson = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load');
  return body.data;
};
async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
  return json.data;
}
const day = (d: string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
const sexLabel = (s: string | null) => (s ? SEX_AT_BIRTH[s as keyof typeof SEX_AT_BIRTH] ?? s : 'Sex not recorded');

export default function VictimSurvivorsPanel({ caseId }: { caseId: string }) {
  const url = `/api/cases/${caseId}/victim-survivors`;
  const { data, error, isLoading, mutate } = useSWR<Data>(url, getJson);
  const [editing, setEditing] = useState<{ start: Partial<Victim> | null; id: string | null; source: 'official' | 'intake' } | null>(null);
  const [removing, setRemoving] = useState<Victim | null>(null);

  const active: Victim[] = data?.victims.filter((v: Victim) => !v.removedAt) ?? [];
  const removed: Victim[] = data?.victims.filter((v: Victim) => v.removedAt) ?? [];
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Diversity3 sx={{ fontSize: 17, color: PURPLE }} />
        <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: PURPLE, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Victim-survivors - for the statistics</Typography>
        {data?.canEdit && (
          <Button size="small" startIcon={<Add />} onClick={() => setEditing({ start: null, id: null, source: 'official' })} sx={{ ml: 'auto', textTransform: 'none' }}>
            Add a victim-survivor
          </Button>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mb: 1 }}>
        One entry per person affected - a mother and each of her children are separate entries. Only sex at birth, age at the incident and the VAWC client code are kept here, for the women and children figures in Analytics; names stay in the intake form.
      </Typography>
      {error ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{error.message}</Alert> : isLoading || !data ? <Skeleton variant="rounded" height={60} /> : (
        <>
          {active.length === 0 && (
            <Alert severity={data.fromIntake ? 'info' : 'warning'} sx={{ borderRadius: 2, mb: 1, fontSize: '0.8rem' }}
              action={data.fromIntake && data.canEdit ? (
                <Button size="small" color="inherit" startIcon={<ContentCopy />} sx={{ textTransform: 'none' }}
                  onClick={() => setEditing({ start: data.fromIntake, id: null, source: 'intake' })}>Record from the intake form</Button>
              ) : undefined}>
              {data.fromIntake
                ? 'None recorded yet. The statistics use the victim-survivor on the completed VAWC intake form until one is recorded here.'
                : 'None recorded yet. Until one is, this case is counted as "no victim-survivor recorded" - never as zero people.'}
            </Alert>
          )}
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {active.map((v, i) => (
              <Box key={v.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
                <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.84rem' }}>Victim-survivor {i + 1}</Typography>
                <Chip size="small" label={sexLabel(v.sexAtBirth)} sx={{ height: 22, fontWeight: 600 }} />
                <Chip size="small" label={v.birthDate ? `Born ${day(`${v.birthDate}T00:00:00+08:00`)}` : v.ageAtIncident !== null ? `Age ${v.ageAtIncident} at the incident` : 'Age not recorded'} sx={{ height: 22, fontWeight: 600 }} />
                <Chip size="small" label={v.clientCode ? `Client code ${v.clientCode}` : 'No client code'} sx={{ height: 22, fontWeight: 600 }} />
                <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  {v.source === 'intake' ? 'From the intake form' : 'Recorded'}{v.recordedBy ? ` by ${v.recordedBy}` : ''} · {day(v.createdAt)}
                </Typography>
                {data.canEdit && (
                  <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                    <Button size="small" startIcon={<Edit sx={{ fontSize: 16 }} />} onClick={() => setEditing({ start: v, id: v.id, source: v.source === 'intake' ? 'intake' : 'official' })} sx={{ textTransform: 'none' }}>Edit</Button>
                    <Button size="small" color="error" onClick={() => setRemoving(v)} sx={{ textTransform: 'none' }}>Remove</Button>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
          {removed.length > 0 && (
            <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.75 }}>
              {removed.length} removed entr{removed.length === 1 ? 'y is' : 'ies are'} kept on record and left out of the statistics
              {removed[0].removedReason ? ` - latest: "${removed[0].removedReason}"${removed[0].removedBy ? `, by ${removed[0].removedBy}` : ''}` : ''}.
            </Typography>
          )}
          {!data.canEdit && <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', mt: 0.75 }}>Recording is for the officer this case is assigned to.</Typography>}
        </>
      )}
      {editing && <VictimDialog url={url} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
      {removing && <RemoveDialog url={`${url}/${removing.id}`} onClose={() => setRemoving(null)} onSaved={() => { setRemoving(null); void mutate(); }} />}
    </Box>
  );
}

function VictimDialog({ url, editing, onClose, onSaved }: { url: string; editing: { start: Partial<Victim> | null; id: string | null; source: 'official' | 'intake' }; onClose: () => void; onSaved: () => void }) {
  const s = editing.start ?? {};
  const [sex, setSex] = useState(s.sexAtBirth ?? '');
  const [birth, setBirth] = useState(s.birthDate ?? '');
  const [age, setAge] = useState(s.ageAtIncident != null ? String(s.ageAtIncident) : '');
  const [code, setCode] = useState(s.clientCode ?? '');
  const [saving, setSaving] = useState(false);
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const save = async () => {
    setSaving(true);
    try {
      const body = { sexAtBirth: sex || null, birthDate: birth || null, ageAtIncident: birth ? null : age === '' ? null : Number(age), clientCode: code.trim() || null, source: editing.source };
      await send(editing.id ? `${url}/${editing.id}` : url, editing.id ? 'PATCH' : 'POST', body);
      toast.success(editing.id ? 'Victim-survivor updated' : 'Victim-survivor recorded');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{editing.id ? 'Edit victim-survivor' : 'Add a victim-survivor'}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Record only what the person or the intake form states. Leave anything unknown blank - it is counted as &quot;not recorded&quot;, never guessed.</Typography>
        <TextField select size="small" label="Sex assigned at birth" value={sex} onChange={e => setSex(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value="">Not recorded</MenuItem>
          {Object.entries(SEX_AT_BIRTH).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="Birthdate" value={birth} onChange={e => setBirth(e.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today, min: '1900-01-01' } }}
          helperText="With the incident date, this gives the age at the incident" />
        <TextField size="small" type="number" label="Age at the incident" value={birth ? '' : age} disabled={Boolean(birth)} onChange={e => setAge(e.target.value)}
          slotProps={{ htmlInput: { min: 0, max: 120, inputMode: 'numeric' } }} helperText={birth ? 'Taken from the birthdate' : 'Only if the birthdate is not known'} />
        <TextField size="small" label="VAWC client code" value={code} onChange={e => setCode(e.target.value)} slotProps={{ htmlInput: { maxLength: 40 } }}
          helperText="The same code on another case is the same person - so they are counted once" />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={save} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RemoveDialog({ url, onClose, onSaved }: { url: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Remove this entry?</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: '0.84rem', color: '#334155', mb: 1.5 }}>It is kept on record with your reason, and left out of the statistics from now on.</Typography>
        <TextField fullWidth size="small" label="Why it is removed *" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button color="error" variant="outlined" disabled={saving || reason.trim().length < 3} sx={{ textTransform: 'none' }}
          onClick={async () => {
            setSaving(true);
            try { await send(url, 'DELETE', { reason: reason.trim() }); toast.success('Entry removed'); onSaved(); }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove'); } finally { setSaving(false); }
          }}>Remove</Button>
      </DialogActions>
    </Dialog>
  );
}
