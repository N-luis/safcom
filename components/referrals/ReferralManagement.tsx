'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Tabs, Tab, Chip, Button, Alert, Skeleton, TextField, Dialog, DialogTitle, DialogContent,
  IconButton, Divider, MenuItem, CircularProgress,
} from '@mui/material';
import { Close, Warning, Lock, ForwardToInbox, WhereToVote, History } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { REFERRAL_STATUSES, LOCATION_FLAGS, type ReferralStatus, type LocationFlag } from '@/lib/jurisdiction';

/**
 * Referral Management - what File a Report saved as a referral (incident
 * outside the jurisdiction) or held for location verification, and the short
 * referral form's records. The captain sees all; the VAWC desk the
 * confidential ones (the server decides which: /api/residency/referrals).
 */

const NAVY = '#0c1e46';
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error ?? 'Could not load'), { status: r.status });
  return b.data as T;
}
async function patch(body: unknown) {
  const r = await fetch('/api/residency/referrals', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Could not save');
  return j.data as Record<string, unknown> | null;
}
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '-');
const chip = (c: string) => ({ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: `${c}14`, color: c, border: `1px solid ${c}33` });
const STATUS_COLOR: Record<string, string> = {
  PENDING_REVIEW: '#0369a1', FOR_VERIFICATION: '#b45309', READY_FOR_REFERRAL: '#4338ca', REFERRED: '#7c3aed',
  ACKNOWLEDGED: '#15803d', FOLLOW_UP_REQUIRED: '#c2410c', CLOSED: '#64748b',
};
const KIND_COLOR: Record<string, string> = { OUTSIDE_JURISDICTION: '#c2410c', LOCATION_VERIFICATION: '#b45309', UNVERIFIED_REPORTER: '#475569', URGENT: '#b91c1c' };
const place = (r: { street?: string | null; locationDetails?: string | null; barangay?: string | null; municipality?: string | null; province?: string | null }) =>
  [r.street, r.locationDetails, r.barangay, r.municipality, r.province].filter(Boolean).join(', ') || 'Not given';

interface Row {
  id: string; referenceNumber: string | null; kind: string; kindLabel: string; urgent: boolean; status: string; statusLabel: string; source: string;
  confidential: boolean; recommendedDesk: string | null; province: string | null; municipality: string | null; barangay: string | null; street: string | null;
  locationDetails: string | null; reason: string | null; validationResult: string | null; receivingOffice: string | null; createdAt: string;
  resident: { name: string; residentNumber: string } | null;
}
interface ListData { counts: Record<string, number>; rows: Row[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;

const TABS: [string, string][] = [['OPEN', 'Open'], ...(Object.entries(REFERRAL_STATUSES) as [string, string][]), ['ALL', 'All']];

export default function ReferralManagement({ scope }: { scope: 'captain' | 'vawc' }) {
  const [status, setStatus] = useState('OPEN');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/residency/referrals?status=${status}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;
  const openCount = data ? Object.entries(data.counts).filter(([k]) => k !== 'CLOSED').reduce((n, [, v]) => n + v, 0) : null;
  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ForwardToInbox sx={{ color: '#c2410c' }} /></Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: NAVY, fontSize: { xs: '1.2rem', sm: '1.45rem' } }}>Referrals</Typography>
          <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>
            {scope === 'vawc' ? 'Confidential referrals - possible VAWC concerns from outside the jurisdiction, or held for location verification.'
              : 'Reports outside the barangay\'s jurisdiction, locations waiting for verification, and referral records. They are not cases.'}
          </Typography>
        </Box>
      </Box>
      {forbidden ? <Alert severity="info">Referral records are handled by the Barangay Captain and, for VAWC concerns, the VAWC desk.</Alert> : (
        <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
          <Tabs value={status} onChange={(_, v) => setStatus(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid #e2e8f0', px: 1 }}>
            {TABS.map(([k, label]) => (
              <Tab key={k} value={k} sx={{ textTransform: 'none', fontWeight: 600, minHeight: 44 }}
                label={`${label}${data ? ` (${k === 'OPEN' ? openCount : k === 'ALL' ? Object.values(data.counts).reduce((a, b) => a + b, 0) : data.counts[k] ?? 0})` : ''}`} />
            ))}
          </Tabs>
          <CardContent sx={{ display: 'grid', gap: 1.25 }}>
            {error && !forbidden && <Alert severity="warning">{error.message}</Alert>}
            {isLoading && !data && <Skeleton variant="rounded" height={160} />}
            {data && !data.rows.length && <Typography sx={{ color: '#64748b', py: 4, textAlign: 'center' }}>No referrals here.</Typography>}
            {data?.rows.map(r => (
              <Box key={r.id} component="button" onClick={() => setOpen(r.id)} data-testid="referral-row"
                sx={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', border: `1px solid ${r.urgent ? '#fecaca' : '#e2e8f0'}`, bgcolor: r.urgent ? '#fef2f2' : '#fff',
                  borderRadius: 2, p: 1.5, display: 'grid', gap: 0.6, '&:hover': { borderColor: '#94a3b8' }, '&:focus-visible': { outline: '2px solid #0f766e', outlineOffset: 2 } }}>
                <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>{r.referenceNumber ?? 'No reference'}</Typography>
                  {r.urgent && <Chip size="small" icon={<Warning sx={{ fontSize: 14 }} />} label="Urgent" sx={chip('#b91c1c')} />}
                  <Chip size="small" label={r.kindLabel} sx={chip(KIND_COLOR[r.kind] ?? '#475569')} />
                  <Chip size="small" label={r.statusLabel} sx={chip(STATUS_COLOR[r.status] ?? '#64748b')} />
                  {r.confidential && <Chip size="small" icon={<Lock sx={{ fontSize: 13 }} />} label="Confidential" sx={chip('#7c3aed')} />}
                  <Typography sx={{ fontSize: '0.76rem', color: '#64748b', ml: 'auto' }}>{when(r.createdAt)}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.83rem', color: NAVY }}><b>Where:</b> {place(r)}</Typography>
                {r.reason && <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{r.reason}</Typography>}
                <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>
                  {r.resident ? `From ${r.resident.name} (${r.resident.residentNumber})` : 'Reporter not linked'}{r.receivingOffice ? ` · Receiving office: ${r.receivingOffice}` : ''}
                  {r.source === 'REPORT_FORM' ? ' · from File a Report' : ' · from the referral form'}
                </Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} maxWidth="md" fullWidth scroll="paper"
        sx={{ '& .MuiDialog-paper': { m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)', sm: 'auto' }, borderRadius: 3 } }}>
        {open && <ReferralDetail id={open} onClose={() => setOpen(null)} onChanged={() => void mutate()} />}
      </Dialog>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.6 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</Typography>
      {children}
    </Box>
  );
}
function Line({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', minWidth: 150 }}>{k}</Typography>
      <Typography component="div" sx={{ fontSize: '0.82rem', color: NAVY, fontWeight: 600, flex: 1, minWidth: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{v}</Typography>
    </Box>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Saved', status: 'Status changed', note: 'Note', assigned: 'Assignment', receiving_office: 'Receiving office recorded', forwarded: 'Forwarded',
  acknowledged: 'Acknowledgment recorded', location_rechecked: 'Location corrected and re-checked', confirmed_outside: 'Verified outside', filed_as_case: 'Filed as a case',
};

function ReferralDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: r, error, mutate } = useSWR<Any>(`/api/residency/referrals?id=${id}`, getJson);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Any>({});
  const [panel, setPanel] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  const run = async (body: Any, done: string) => {
    setBusy(true);
    try {
      const res = await patch({ id, ...body });
      toast.success(res && typeof res.caseNumber === 'string' ? `${done}: ${res.caseNumber}` : done);
      setForm({}); setPanel(null); await mutate(); onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  if (error) return <DialogContent><Alert severity="warning">{error.message}</Alert></DialogContent>;
  if (!r) return <DialogContent><Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box></DialogContent>;
  const payload = (r.reportPayload ?? {}) as Any;
  const check = (r.locationCheck ?? {}) as Any;
  const closed = r.status === 'CLOSED';
  const verifying = r.kind === 'LOCATION_VERIFICATION';
  const flags = ((check.flags ?? []) as LocationFlag[]).filter(f => f !== 'BOUNDARY_NOT_CONFIGURED' && f !== 'NO_PIN');
  const manual: ReferralStatus[] = verifying ? ['FOLLOW_UP_REQUIRED', 'CLOSED'] : ['PENDING_REVIEW', 'READY_FOR_REFERRAL', 'FOLLOW_UP_REQUIRED', 'CLOSED'];
  const person = (p: Any | undefined) => p ? [p.fullName, p.relationship, p.age ? `age ${p.age}` : null, p.sex, p.contactNumber, p.address].filter(Boolean).join(' · ') : null;
  const panelBox = (key: string, title: string, fields: React.ReactNode, submit: () => void, can = true) => panel === key && (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, display: 'grid', gap: 1 }}>
      <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.86rem' }}>{title}</Typography>
      {fields}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={() => setPanel(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={busy || !can} onClick={submit} sx={{ textTransform: 'none', bgcolor: NAVY }}>{busy ? 'Saving…' : 'Save'}</Button>
      </Box>
    </Box>
  );
  const noteField = (label = 'Internal note (officials only)', required = true) => (
    <TextField size="small" label={`${label}${required ? ' *' : ''}`} value={form.note ?? ''} onChange={set('note')} multiline minRows={2} />
  );
  const msgField = <TextField size="small" label="Message for the reporter (optional - shown on their My Cases)" value={form.residentMessage ?? ''} onChange={set('residentMessage')} multiline minRows={2} />;
  const noteOk = (form.note ?? '').trim().length >= 3;
  const opt = (v: string | undefined) => (v ?? '').trim() || undefined;

  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>{r.referenceNumber ?? 'Referral record'}</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
            {r.urgent && <Chip size="small" icon={<Warning sx={{ fontSize: 14 }} />} label="Urgent" sx={chip('#b91c1c')} />}
            <Chip size="small" label={r.kindLabel} sx={chip(KIND_COLOR[r.kind] ?? '#475569')} />
            <Chip size="small" label={r.statusLabel} sx={chip(STATUS_COLOR[r.status] ?? '#64748b')} />
            {r.confidential && <Chip size="small" icon={<Lock sx={{ fontSize: 13 }} />} label="Confidential (possible VAWC)" sx={chip('#7c3aed')} />}
          </Box>
        </Box>
        <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2, px: { xs: 1.75, sm: 3 } }}>
        {r.case && <Alert severity="success">Filed as SafeComm case {r.case.caseNumber} after the location was verified inside the barangay.</Alert>}

        <Section title="Jurisdiction result (SafeComm's check - not the AI's)">
          <Line k="Incident location" v={place(r)} />
          <Line k="Map pin" v={r.latitude != null ? <a href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=18/${r.latitude}/${r.longitude}`} target="_blank" rel="noreferrer">{r.latitude}, {r.longitude}</a> : 'None'} />
          <Line k="Validation result" v={r.validationResult} />
          <Line k="Reason" v={r.reason} />
          {flags.length > 0 && <Line k="What the check found" v={flags.map(f => LOCATION_FLAGS[f] ?? f).join(' ')} />}
          <Line k="Jurisdiction named" v={r.recommendedDestination ? `${[r.recommendedDestination.barangay, r.recommendedDestination.municipality, r.recommendedDestination.province].filter(Boolean).join(', ')} (as the reporter gave it - verify before referring)` : null} />
          <Line k="Receiving office" v={r.receivingOffice ?? 'Not recorded yet'} />
          <Line k="Forwarded" v={r.forwardedAt ? when(r.forwardedAt) : null} />
          <Line k="Acknowledged" v={r.acknowledgedAt ? when(r.acknowledgedAt) : r.forwardedAt ? 'Not recorded - do not assume it was received' : null} />
          <Line k="Assigned to" v={r.assignedToName ?? 'No one'} />
        </Section>
        <Divider />
        <Section title="The report as submitted">
          <Line k="Reporter" v={r.resident ? `${r.resident.name} (${r.resident.residentNumber})${r.resident.contactNumber ? ` · ${r.resident.contactNumber}` : ''}` : 'Not linked'} />
          <Line k="Reporting for" v={r.reportingRelationship === 'SELF' ? 'Themself' : r.reportingRelationship === 'THIRD_PARTY' || r.reportingRelationship === 'ON_BEHALF' ? 'Someone else' : r.reportingRelationship} />
          <Line k="Person affected" v={person(payload.affectedParty) ?? payload.affectedPersonNote} />
          <Line k="Person reported" v={person(payload.reportedParty)} />
          <Line k="When" v={[r.incidentDate ? new Date(r.incidentDate).toLocaleDateString('en-PH', { dateStyle: 'long', timeZone: 'Asia/Manila' }) : null, r.incidentTimeApprox].filter(Boolean).join(', ') || null} />
          <Line k="What happened" v={r.summary} />
          {r.residentOriginalNarrative && <Line k="In the reporter's own words" v={r.residentOriginalNarrative} />}
          <Line k="Witnesses" v={payload.witnessInfo} />
          <Line k="Notes" v={payload.additionalNotes} />
          <Line k="Contact preference" v={[payload.contactPreference, payload.contactSafetyNote].filter(Boolean).join(' - ') || null} />
          <Line k="Desk (rules' reading)" v={r.recommendedDesk} />
          {r.attachments?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
              {(r.attachments as Any[]).map(a => (
                <a key={a.id} href={`/api/residency/referrals/${r.id}/attachments/${a.id}`} target="_blank" rel="noreferrer" title={a.filename}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/residency/referrals/${r.id}/attachments/${a.id}`} alt={a.filename} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </a>
              ))}
            </Box>
          )}
        </Section>
        <Divider />

        {!closed && (
          <Section title="Actions">
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {verifying && r.canFileAsCase && <Button size="small" variant="contained" onClick={() => setPanel('case')} sx={{ textTransform: 'none', bgcolor: '#15803d' }}>Verified inside - file as case</Button>}
              {verifying && <Button size="small" variant="outlined" onClick={() => setPanel('outside')} sx={{ textTransform: 'none' }}>Verified outside - refer</Button>}
              <Button size="small" variant="outlined" startIcon={<WhereToVote />} onClick={() => setPanel('relocate')} sx={{ textTransform: 'none' }}>Correct the location</Button>
              {!verifying && <Button size="small" variant="outlined" onClick={() => setPanel('office')} sx={{ textTransform: 'none' }}>Receiving office</Button>}
              {!verifying && <Button size="small" variant="outlined" onClick={() => setPanel('forwarded')} sx={{ textTransform: 'none' }}>Record forwarded</Button>}
              {!verifying && r.forwardedAt && <Button size="small" variant="outlined" onClick={() => setPanel('ack')} sx={{ textTransform: 'none' }}>Record acknowledgment</Button>}
              <Button size="small" variant="outlined" onClick={() => setPanel('status')} sx={{ textTransform: 'none' }}>Change status</Button>
              <Button size="small" variant="outlined" onClick={() => setPanel('assign')} sx={{ textTransform: 'none' }}>Assign</Button>
              <Button size="small" variant="outlined" onClick={() => setPanel('message')} sx={{ textTransform: 'none' }}>Message the reporter</Button>
            </Box>
            {panelBox('case', 'File it as a SafeComm case', <>
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>Only when you have verified the incident happened inside the barangay. The report is filed exactly as the resident submitted it - with the AI intake, desk recommendation, photos and people - and this record is closed.</Typography>
              {noteField('How the location was verified')}{msgField}
            </>, () => run({ action: 'file_as_case', note: form.note, residentMessage: opt(form.residentMessage) }, 'Filed as a case'), noteOk)}
            {panelBox('outside', 'Verified outside the jurisdiction', <>{noteField('How the location was verified')}{msgField}</>,
              () => run({ action: 'confirm_outside', note: form.note, residentMessage: opt(form.residentMessage) }, 'Handled as a referral'), noteOk)}
            {panelBox('relocate', 'Correct the incident location', <>
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>SafeComm checks the corrected place again. The earlier location and decision stay in the history.</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                {(['province', 'municipality', 'barangay', 'street', 'details'] as const).map(k => (
                  <TextField key={k} size="small" label={k === 'details' ? 'Landmark / details' : k[0].toUpperCase() + k.slice(1)} value={form[k] ?? (k === 'details' ? r.locationDetails : r[k]) ?? ''} onChange={set(k)} />
                ))}
                <TextField size="small" label="Latitude (optional)" value={form.latitude ?? ''} onChange={set('latitude')} />
                <TextField size="small" label="Longitude (optional)" value={form.longitude ?? ''} onChange={set('longitude')} />
              </Box>
              {noteField('Why it was corrected')}
            </>, () => {
              const lat = Number(form.latitude); const lng = Number(form.longitude);
              const pin = form.latitude && form.longitude && Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : {};
              const v = (k: string, cur: string | null) => (form[k] ?? cur ?? '').trim() || undefined;
              void run({ action: 'relocate', note: form.note, location: { province: v('province', r.province), municipality: v('municipality', r.municipality), barangay: v('barangay', r.barangay),
                street: v('street', r.street), details: v('details', r.locationDetails), ...pin } }, 'Location re-checked');
            }, noteOk)}
            {panelBox('office', 'Receiving office or jurisdiction', <>
              <TextField size="small" label="Receiving office (verified) *" value={form.receivingOffice ?? r.receivingOffice ?? ''} onChange={set('receivingOffice')} />{noteField('Note', false)}
            </>, () => run({ action: 'receiving_office', receivingOffice: form.receivingOffice ?? r.receivingOffice, note: opt(form.note) }, 'Receiving office recorded'),
            ((form.receivingOffice ?? r.receivingOffice ?? '') as string).trim().length >= 3)}
            {panelBox('forwarded', 'Record that it was forwarded', <>
              <TextField size="small" label="Sent to (receiving office) *" value={form.receivingOffice ?? r.receivingOffice ?? ''} onChange={set('receivingOffice')} />
              <TextField size="small" type="datetime-local" label="When it was forwarded" value={form.forwardedAt ?? ''} onChange={set('forwardedAt')} slotProps={{ inputLabel: { shrink: true } }} />
              {noteField('How it was sent')}{msgField}
            </>, () => run({ action: 'forwarded', receivingOffice: form.receivingOffice ?? r.receivingOffice, forwardedAt: form.forwardedAt ? new Date(form.forwardedAt).toISOString() : undefined, note: form.note, residentMessage: opt(form.residentMessage) }, 'Recorded as referred'),
            noteOk && ((form.receivingOffice ?? r.receivingOffice ?? '') as string).trim().length >= 3)}
            {panelBox('ack', 'Record the receiving office\'s acknowledgment', <>
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>Only when the receiving office actually confirmed receipt - write who confirmed it and how.</Typography>
              <TextField size="small" type="datetime-local" label="When they acknowledged it" value={form.acknowledgedAt ?? ''} onChange={set('acknowledgedAt')} slotProps={{ inputLabel: { shrink: true } }} />
              {noteField('Who acknowledged it, and how')}{msgField}
            </>, () => run({ action: 'acknowledged', acknowledgedAt: form.acknowledgedAt ? new Date(form.acknowledgedAt).toISOString() : undefined, note: form.note, residentMessage: opt(form.residentMessage) }, 'Acknowledgment recorded'), noteOk)}
            {panelBox('status', 'Change status', <>
              <TextField select size="small" label="Status" value={form.status ?? ''} onChange={set('status')}>
                {manual.filter(s => s !== r.status).map(s => <MenuItem key={s} value={s}>{REFERRAL_STATUSES[s]}</MenuItem>)}
              </TextField>
              {noteField(form.status === 'CLOSED' ? 'Why it is closed' : 'Note', form.status === 'CLOSED')}{msgField}
            </>, () => run({ action: 'status', status: form.status, note: opt(form.note), residentMessage: opt(form.residentMessage) }, 'Status updated'),
            Boolean(form.status) && (form.status !== 'CLOSED' || noteOk))}
            {panelBox('assign', 'Assign to an official', <>
              <TextField select size="small" label="Official" value={form.assignedToId ?? r.assignedToId ?? ''} onChange={set('assignedToId')}>
                <MenuItem value="">No one</MenuItem>
                {(r.assignable as Any[] ?? []).map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
            </>, () => run({ action: 'assign', assignedToId: (form.assignedToId ?? r.assignedToId) || null }, 'Assignment saved'))}
            {panelBox('message', 'Message the reporter', <>
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>Shown on their My Cases. Approved instructions or next steps only - no internal notes, no one else&apos;s details, and never that another office accepted it unless it did.</Typography>
              <TextField size="small" label="Message *" value={form.residentMessage ?? ''} onChange={set('residentMessage')} multiline minRows={2} />
            </>, () => run({ action: 'message', residentMessage: form.residentMessage }, 'Message shared'), (form.residentMessage ?? '').trim().length >= 3)}
          </Section>
        )}
        <Section title="Internal note">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField size="small" placeholder="Add a note for officials" value={form.quickNote ?? ''} onChange={set('quickNote')} sx={{ flex: 1, minWidth: 220 }} />
            <Button variant="outlined" disabled={busy || (form.quickNote ?? '').trim().length < 3} onClick={() => run({ action: 'note', note: form.quickNote }, 'Note added')} sx={{ textTransform: 'none' }}>Add note</Button>
          </Box>
        </Section>
        <Section title="History">
          <Box sx={{ display: 'grid', gap: 1 }}>
            {(r.events as Any[]).map(e => (
              <Box key={e.id} sx={{ borderLeft: '3px solid #cbd5e1', pl: 1.25 }}>
                <Typography sx={{ fontSize: '0.8rem', color: NAVY, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <History sx={{ fontSize: 14, color: '#94a3b8' }} />{EVENT_LABEL[e.kind] ?? e.kind}
                  {e.toStatus && e.fromStatus !== e.toStatus ? ` · ${REFERRAL_STATUSES[e.toStatus as ReferralStatus] ?? e.toStatus}` : ''}
                  <Typography component="span" sx={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 400, ml: 'auto' }}>{e.actorName} · {when(e.createdAt)}</Typography>
                </Typography>
                {e.note && <Typography sx={{ fontSize: '0.8rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{e.note}</Typography>}
                {e.residentMessage && <Typography sx={{ fontSize: '0.78rem', color: '#0f766e' }}>Shown to the reporter: {e.residentMessage}</Typography>}
              </Box>
            ))}
          </Box>
        </Section>
      </DialogContent>
    </>
  );
}
