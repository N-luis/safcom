'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, CircularProgress, ToggleButton, ToggleButtonGroup, Divider,
} from '@mui/material';
import { Gavel, CalendarToday, Schedule, LocationOn, Description, Download, CheckCircle, EventRepeat, InfoOutlined } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { formatHearingDate, formatHearingTime } from '@/lib/hearings';

interface ResidentHearing {
  id: string; reference: string; hearingNumber: number; title: string;
  case: { id: string; caseNumber: string };
  scheduledAt: string; venue: string; status: string; statusLabel: string; upcoming: boolean; rescheduled: boolean;
  notice: { id: string; noticeNumber: string; status: string; statusLabel: string; issuedAt: string | null; acknowledgedAt: string | null; canAcknowledge: boolean } | null;
  intent: 'WILL_ATTEND' | 'CANNOT_ATTEND' | null; intentAt: string | null; canConfirm: boolean;
  requests: { id: string; status: 'PENDING' | 'APPROVED' | 'DECLINED'; reason: string; preferredSchedule: string | null; reviewNote: string | null; createdAt: string; reviewedAt: string | null }[];
  canRequest: boolean;
  outcome: { text: string; summary: string | null } | null;
  instructions: string[];
}
interface Data { upcoming: ResidentHearing[]; history: { case: { id: string; caseNumber: string }; hearings: ResidentHearing[]; next: ResidentHearing | null }[] }

const NAVY = '#0c1e46';
const TEAL = '#0f766e';
const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load your hearings');
  return body.data as Data;
};
const STATUS_COLOR: Record<string, string> = { SCHEDULED: '#0369a1', NOTICE_ISSUED: '#4f46e5', ACKNOWLEDGED: TEAL, RESCHEDULED: '#b45309', COMPLETED: '#15803d', CANCELLED: '#64748b' };
const chip = (c: string) => ({ height: 24, fontWeight: 700, fontSize: '0.74rem', bgcolor: `${c}14`, color: c, border: `1px solid ${c}33` });
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

async function post(hid: string, body: unknown) {
  const res = await fetch(`/api/resident/hearings/${hid}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
}

/**
 * My Hearings: the hearings on the resident's own cases. They can read and
 * download their notice, acknowledge it, say whether they will attend, and
 * ask for a new date. The barangay sets the dates and keeps the record -
 * nothing here changes the schedule, the attendance record or the outcome.
 */
export default function MyHearingsPage() {
  const { data, error, isLoading, mutate } = useSWR<Data>('/api/resident/hearings', fetcher);
  const [ack, setAck] = useState<ResidentHearing | null>(null);
  const [resched, setResched] = useState<ResidentHearing | null>(null);

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
        <Gavel sx={{ color: TEAL }} />
        <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.25rem', md: '1.5rem' }, color: NAVY }}>My Hearings</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.88rem', color: '#64748b', mb: 2 }}>
        Barangay hearings on your cases. You can view your notice, acknowledge it, tell the barangay whether you will attend, and ask for a new date.
        Dates, attendance and outcomes are recorded by barangay officials.
      </Typography>

      {isLoading && <><Skeleton variant="rounded" height={160} sx={{ mb: 2 }} /><Skeleton variant="rounded" height={120} /></>}
      {error && !data && <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>}

      {data && (
        <>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1.02rem', mb: 1 }}>Upcoming Hearings</Typography>
          {data.upcoming.length === 0 ? (
            <Card sx={{ borderRadius: 3, mb: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <CalendarToday sx={{ fontSize: 34, color: '#cbd5e1' }} />
                <Typography sx={{ color: '#64748b', fontSize: '0.9rem', mt: 1 }}>No upcoming hearing. When the barangay schedules one on your case, it appears here and in your notifications.</Typography>
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ display: 'grid', gap: 2, mb: 3 }}>
              {data.upcoming.map(h => <UpcomingCard key={h.id} h={h} onAck={() => setAck(h)} onResched={() => setResched(h)} refresh={() => mutate()} />)}
            </Box>
          )}

          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1.02rem', mb: 1 }}>Hearing History</Typography>
          {data.history.length === 0 ? (
            <Typography sx={{ color: '#94a3b8', fontSize: '0.88rem' }}>No hearings on your cases yet.</Typography>
          ) : (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {data.history.map(g => (
                <Card key={g.case.id} sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
                  <CardContent sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                      <Typography sx={{ fontWeight: 800, color: NAVY }}>Case {g.case.caseNumber}</Typography>
                      {g.next && <Chip size="small" label={`Next: Hearing ${g.next.hearingNumber}, ${formatHearingDate(g.next.scheduledAt)}`} sx={chip('#0369a1')} />}
                    </Box>
                    <Box sx={{ display: 'grid', gap: 1 }}>
                      {g.hearings.map(h => (
                        <Box key={h.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                          <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: `${STATUS_COLOR[h.status] ?? '#64748b'}18`, color: STATUS_COLOR[h.status] ?? '#64748b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0 }}>H{h.hearingNumber}</Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                              <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY }}>Hearing {h.hearingNumber} - {h.title}</Typography>
                              <Chip size="small" label={h.statusLabel} sx={chip(STATUS_COLOR[h.status] ?? '#64748b')} />
                            </Box>
                            <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>{formatHearingDate(h.scheduledAt)}, {formatHearingTime(h.scheduledAt)} · {h.venue}</Typography>
                            {h.outcome && <Typography sx={{ fontSize: '0.84rem', color: '#334155', mt: 0.25 }}>{h.outcome.text}</Typography>}
                            {h.outcome?.summary && <Typography sx={{ fontSize: '0.82rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{h.outcome.summary}</Typography>}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </>
      )}

      {ack && <AcknowledgeDialog h={ack} onClose={() => setAck(null)} onDone={() => { setAck(null); void mutate(); }} />}
      {resched && <RescheduleDialog h={resched} onClose={() => setResched(null)} onDone={() => { setResched(null); void mutate(); }} />}
    </Box>
  );
}

function UpcomingCard({ h, onAck, onResched, refresh }: { h: ResidentHearing; onAck: () => void; onResched: () => void; refresh: () => void }) {
  const [saving, setSaving] = useState(false);
  const latest = h.requests[0];
  const reply = async (intent: 'WILL_ATTEND' | 'CANNOT_ATTEND') => {
    if (intent === h.intent) return;
    setSaving(true);
    try { await post(h.id, { action: 'attendance', intent }); toast.success(intent === 'WILL_ATTEND' ? 'Thank you - the barangay knows you will attend' : 'The barangay has been told you cannot attend'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };
  return (
    <Card sx={{ borderRadius: 3, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>Hearing {h.hearingNumber} - {h.title}</Typography>
          <Chip size="small" label={h.statusLabel} sx={chip(STATUS_COLOR[h.status] ?? '#64748b')} />
          <Typography sx={{ ml: { sm: 'auto' }, fontSize: '0.8rem', color: '#64748b' }}>Case {h.case.caseNumber}</Typography>
        </Box>
        {h.rescheduled && <Alert severity="info" sx={{ mt: 1, borderRadius: 2, py: 0, fontSize: '0.8rem' }}>This hearing has a new date. The details below are the current ones.</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.5 }}>
          {[{ Icon: CalendarToday, label: 'Date', v: formatHearingDate(h.scheduledAt) }, { Icon: Schedule, label: 'Time', v: formatHearingTime(h.scheduledAt) }, { Icon: LocationOn, label: 'Venue', v: h.venue }].map(f => (
            <Box key={f.label} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <f.Icon sx={{ fontSize: 18, color: TEAL }} />
              <Box>
                <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</Typography>
                <Typography sx={{ fontSize: '0.92rem', color: NAVY, fontWeight: 600 }}>{f.v}</Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Description sx={{ fontSize: 18, color: '#4f46e5' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY }}>Your notice</Typography>
          {h.notice ? (
            <>
              <Chip size="small" label={h.notice.statusLabel} sx={chip(h.notice.status === 'ACKNOWLEDGED' ? '#15803d' : '#4f46e5')} />
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{h.notice.noticeNumber}{h.notice.issuedAt ? ` · issued ${when(h.notice.issuedAt)}` : ''}</Typography>
            </>
          ) : <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>Not issued yet - you will be notified when it is.</Typography>}
        </Box>
        {h.notice && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Button size="small" variant="outlined" startIcon={<Description />} href={`/api/resident/hearings/${h.id}/notice?inline=1`} target="_blank" rel="noopener" sx={{ textTransform: 'none', borderRadius: 2 }}>View notice</Button>
            <Button size="small" variant="outlined" startIcon={<Download />} href={`/api/resident/hearings/${h.id}/notice`} sx={{ textTransform: 'none', borderRadius: 2 }}>Download or print</Button>
            {h.notice.canAcknowledge ? (
              <Button size="small" variant="contained" startIcon={<CheckCircle />} onClick={onAck} sx={{ textTransform: 'none', borderRadius: 2, bgcolor: TEAL }}>Acknowledge receipt</Button>
            ) : h.notice.acknowledgedAt && <Typography sx={{ fontSize: '0.8rem', color: '#15803d', alignSelf: 'center' }}>Acknowledged {when(h.notice.acknowledgedAt)}</Typography>}
          </Box>
        )}

        {h.canConfirm && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY, mb: 0.75 }}>Will you attend?</Typography>
            <ToggleButtonGroup exclusive size="small" value={h.intent} disabled={saving} onChange={(_, v) => v && reply(v)} sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="WILL_ATTEND" sx={{ textTransform: 'none', px: 2 }}>Yes, I will attend</ToggleButton>
              <ToggleButton value="CANNOT_ATTEND" sx={{ textTransform: 'none', px: 2 }}>I cannot attend</ToggleButton>
            </ToggleButtonGroup>
            {h.intent === 'CANNOT_ATTEND' && h.canRequest && <Typography sx={{ fontSize: '0.8rem', color: '#b45309', mt: 0.75 }}>If you need a new date, request one below.</Typography>}
          </>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <EventRepeat sx={{ fontSize: 18, color: '#b45309' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY }}>Need a different date?</Typography>
          {h.canRequest && <Button size="small" onClick={onResched} sx={{ textTransform: 'none', ml: 'auto' }}>Request rescheduling</Button>}
        </Box>
        {latest ? (
          <Typography sx={{ fontSize: '0.82rem', color: '#475569', mt: 0.5 }}>
            {latest.status === 'PENDING' ? `Your request (${when(latest.createdAt)}) is waiting for the barangay. The date stays the same unless an official approves it.`
              : latest.status === 'APPROVED' ? 'Your last request was approved - the date above is the new one.'
                : `Your last request was not approved${latest.reviewNote ? `: ${latest.reviewNote}` : '.'}`}
          </Typography>
        ) : !h.canRequest ? null : <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mt: 0.5 }}>Ask as early as you can. An official reviews every request.</Typography>}

        {h.instructions.length > 0 && (
          <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: '#f0fdfa', border: '1px solid #ccfbf1' }}>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mb: 0.5 }}>
              <InfoOutlined sx={{ fontSize: 16, color: TEAL }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: TEAL }}>Before the hearing</Typography>
            </Box>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {h.instructions.map(i => <Typography key={i} component="li" sx={{ fontSize: '0.82rem', color: '#334155' }}>{i}</Typography>)}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function AcknowledgeDialog({ h, onClose, onDone }: { h: ResidentHearing; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Acknowledge your notice</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: '0.88rem', color: '#334155' }}>
          You confirm that you received notice {h.notice?.noticeNumber} for Hearing {h.hearingNumber} on {formatHearingDate(h.scheduledAt)} at {formatHearingTime(h.scheduledAt)}, {h.venue}.
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mt: 1 }}>This only confirms receipt. It does not change the date.</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={saving} sx={{ textTransform: 'none', bgcolor: TEAL }}
          onClick={async () => {
            setSaving(true);
            try { await post(h.id, { action: 'acknowledge' }); toast.success('Notice acknowledged'); onDone(); }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
          }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'I received this notice'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RescheduleDialog({ h, onClose, onDone }: { h: ResidentHearing; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [preferred, setPreferred] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Request a new date - Hearing {h.hearingNumber}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>
          The hearing stays on {formatHearingDate(h.scheduledAt)}, {formatHearingTime(h.scheduledAt)} unless a barangay official approves your request. You will be notified of the answer.
        </Alert>
        <TextField label="Why do you need a new date? *" multiline minRows={3} value={reason} onChange={e => setReason(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }} helperText={`${reason.trim().length < 10 ? 'At least 10 characters. ' : ''}Do not include anyone else's personal details.`} />
        <TextField label="Dates or times that would suit you (optional)" value={preferred} onChange={e => setPreferred(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }}
          placeholder="e.g. any weekday morning next week" />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={saving || reason.trim().length < 10} sx={{ textTransform: 'none', bgcolor: TEAL }}
          onClick={async () => {
            setSaving(true);
            try { await post(h.id, { action: 'reschedule', reason: reason.trim(), preferredSchedule: preferred.trim() || undefined }); toast.success('Request sent to the barangay'); onDone(); }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send'); } finally { setSaving(false); }
          }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Send request'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
