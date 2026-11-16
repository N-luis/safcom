'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Alert, Skeleton, Chip, Divider,
  FormControlLabel, Checkbox, FormGroup, RadioGroup, Radio, CircularProgress, useMediaQuery, useTheme,
} from '@mui/material';
import { EventAvailable, Close } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { formatHearingWhen, phDay, phTime, type ScheduleConflict } from '@/lib/hearings';
import {
  APPOINTMENT_TYPES, APPOINTMENT_TYPE_KEYS, APPOINTMENT_STATUSES, APPOINTMENT_EVENT_LABELS, ATTENDANCE_OPTIONS, ATTENDANCE_KEYS, REFERRAL_STATUS_OPTIONS,
  REFERRAL_STATUS_KEYS, NOTIFY_OPTIONS, NOTIFY_KEYS, participantLabel, typeLabel, notifyRefusal, appointmentDayArrived,
  type AppointmentType, type NotifyVia, type Participant, type AppointmentAttendance, type AppointmentReferralStatus,
  COURT_MATTERS, COURT_MATTER_KEYS, COURT_SOURCES, COURT_SOURCE_KEYS, NOT_A_COURT, isCourtType, type CourtMatter, type CourtSource,
} from '@/lib/vawcAppointments';
import { ConflictList } from '@/components/hearings/ConflictWarnings';
import { NAVY, VIOLET, APPT_STATUS_COLOR, getJson, send, todayPh, conflictsOf, chipSx, type AppointmentDetail } from './appointmentUi';

type Mode = null | 'edit' | 'reschedule' | 'cancel' | 'record' | 'amend' | { decline: string } | { approve: string };

/** One appointment: its record, history and actions, for the officials who may see it. */
export default function AppointmentDetailsDialog({ id, caseHref, onClose, onChanged }: {
  id: string; caseHref?: string; onClose: () => void; onChanged?: () => void;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { data, error, isLoading, mutate } = useSWR<AppointmentDetail>(`/api/vawc/appointments/${id}`, getJson);
  const [mode, setMode] = useState<Mode>(null);
  const a = data?.appointment;
  const c = data?.case;
  const changed = () => { setMode(null); void mutate(); onChanged?.(); };
  const pending = a?.requests.filter(r => r.status === 'PENDING') ?? [];
  const recorded = a && (a.status === 'COMPLETED' || a.status === 'NOT_HELD');

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pr: 6 }}>
        <EventAvailable sx={{ color: VIOLET }} />
        {a ? typeLabel(a.type) : 'Hearing'}
        {a && <Chip size="small" label={APPOINTMENT_STATUSES[a.status]} sx={chipSx(APPT_STATUS_COLOR[a.status])} />}
        {a && <Typography component="span" sx={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>{a.reference}</Typography>}
        <Button onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 8, top: 10, minWidth: 0 }}><Close /></Button>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {isLoading && <Skeleton variant="rounded" height={260} />}
        {error && !data && <Alert severity="error" sx={{ borderRadius: 2 }}>{error.message}</Alert>}
        {a && c && (
          <>
            {data.accessMessage && <Alert severity="info" sx={{ borderRadius: 2 }}>{data.accessMessage}</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
              <Fact label="Date and time">{formatHearingWhen(a.scheduledAt)}{a.rescheduleCount > 0 && <Chip size="small" label={`Moved ${a.rescheduleCount}x`} sx={{ ...chipSx('#b45309'), ml: 0.75 }} />}</Fact>
              <Fact label={isCourtType(a.type) ? 'Court' : 'Venue'}>{a.venue}</Fact>
              {isCourtType(a.type) && <Fact label="Court matter">{COURT_MATTERS[a.courtMatter as CourtMatter] ?? '-'}{a.courtReference && <span style={{ color: '#64748b' }}> · {a.courtReference}</span>}</Fact>}
              {isCourtType(a.type) && <Fact label="Date officially provided by">{COURT_SOURCES[a.courtSource as CourtSource] ?? '-'}</Fact>}
              <Fact label="Case">{caseHref ? <a href={caseHref} style={{ color: '#0369a1', fontWeight: 700 }}>{c.caseNumber}</a> : c.caseNumber} <span style={{ color: '#64748b' }}>· {c.caseType}</span></Fact>
              <Fact label="Assigned VAWC officer">{a.assignedOfficer?.name ?? 'Not assigned'}</Fact>
              <Fact label="Participants">{a.participants.map(p => participantLabel(p, c.reportingRelationship)).join(', ')}</Fact>
              <Fact label="Notification">
                {NOTIFY_OPTIONS[a.notifyVia as NotifyVia]?.short ?? a.notifyVia}
                {a.notifyVia === 'SAFECOMM_ACCOUNT' && (
                  <Typography component="span" sx={{ display: 'block', fontSize: '0.76rem', color: '#64748b' }}>
                    {a.residentAcknowledgedAt ? `Acknowledged ${formatHearingWhen(a.residentAcknowledgedAt)}` : a.residentSeenAt ? `Seen ${formatHearingWhen(a.residentSeenAt)}, not acknowledged` : 'Not seen yet'}
                  </Typography>
                )}
              </Fact>
            </Box>
            {isCourtType(a.type) && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{NOT_A_COURT}</Alert>}
            <Fact label="Purpose (officials only)">{a.purpose}</Fact>
            {a.internalNotes && <Fact label="Internal notes (officials only)">{a.internalNotes}</Fact>}
            {a.residentInstructions && <Fact label="Instructions the resident sees">{a.residentInstructions}</Fact>}
            {a.statusReason && <Fact label={a.status === 'CANCELLED' ? 'Why it was cancelled' : 'Why the date changed'}>{a.statusReason}</Fact>}

            {pending.map(r => (
              <Alert key={r.id} severity="warning" sx={{ borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem' }}>The resident asked for a new date</Typography>
                <Typography sx={{ fontSize: '0.82rem' }}>{r.reason}</Typography>
                {r.preferredSchedule && <Typography sx={{ fontSize: '0.8rem' }}>Would suit them: {r.preferredSchedule}</Typography>}
                {data.canEdit && a.open && !mode && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button size="small" variant="contained" onClick={() => setMode({ approve: r.id })} sx={{ textTransform: 'none', bgcolor: NAVY }}>Set a new date</Button>
                    <Button size="small" onClick={() => setMode({ decline: r.id })} sx={{ textTransform: 'none' }}>Decline with a reply</Button>
                  </Box>
                )}
              </Alert>
            ))}

            {recorded && (
              <Box sx={{ p: 1.5, border: '1px solid #e2e8f0', borderRadius: 2, display: 'grid', gap: 1 }}>
                <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.9rem' }}>Outcome (officials only)</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                  <Fact label="Attendance">{ATTENDANCE_OPTIONS[a.attendance as AppointmentAttendance] ?? 'Not recorded'}</Fact>
                  <Fact label="Referral status">{REFERRAL_STATUS_OPTIONS[a.referralStatus as AppointmentReferralStatus] ?? 'Not recorded'}</Fact>
                  <Fact label="Next follow-up">{a.nextAppointmentAt ? formatHearingWhen(a.nextAppointmentAt) : 'None set'}</Fact>
                  <Fact label="Recorded by">{a.completedBy ?? '-'}{a.completedAt && `, ${formatHearingWhen(a.completedAt)}`}</Fact>
                </Box>
                {a.outcomeNotes && <Fact label="Outcome notes">{a.outcomeNotes}</Fact>}
                {a.followUpActions && <Fact label="Follow-up actions">{a.followUpActions}</Fact>}
              </Box>
            )}

            {mode === 'edit' && <EditForm d={data} onDone={changed} onCancel={() => setMode(null)} />}
            {(mode === 'reschedule' || (mode && typeof mode === 'object' && 'approve' in mode)) && (
              <RescheduleForm d={data} requestId={typeof mode === 'object' && mode && 'approve' in mode ? mode.approve : undefined} onDone={changed} onCancel={() => setMode(null)} />
            )}
            {mode === 'cancel' && <ReasonForm title="Cancel this hearing" label="Why it is cancelled (officials only)" button="Cancel hearing" danger
              onSubmit={reason => send(`/api/vawc/appointments/${a.id}`, 'PATCH', { action: 'cancel', reason })} done="Hearing cancelled" onDone={changed} onCancel={() => setMode(null)} />}
            {mode && typeof mode === 'object' && 'decline' in mode && (
              <ReasonForm title="Decline the request" label="Your reply - the resident reads this" button="Send reply"
                onSubmit={reviewNote => send(`/api/vawc/appointments/${a.id}`, 'PATCH', { action: 'review_request', requestId: mode.decline, reviewNote })}
                done="Reply sent" onDone={changed} onCancel={() => setMode(null)} />
            )}
            {(mode === 'record' || mode === 'amend') && <OutcomeForm d={data} amend={mode === 'amend'} onDone={changed} onCancel={() => setMode(null)} />}

            <Divider />
            <Box>
              <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.9rem', mb: 0.75 }}>History</Typography>
              <Box component="ol" sx={{ m: 0, pl: 2.25, display: 'grid', gap: 0.75 }}>
                {a.events.map(e => (
                  <li key={e.id}>
                    <Typography sx={{ fontSize: '0.82rem', color: '#334155' }}>
                      <b>{APPOINTMENT_EVENT_LABELS[e.kind] ?? e.kind}</b>
                      {eventDetail(e)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{e.by ?? 'SafeComm'} · {formatHearingWhen(e.createdAt)}</Typography>
                    {e.note && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{e.note}</Typography>}
                  </li>
                ))}
              </Box>
            </Box>
          </>
        )}
      </DialogContent>
      {a && data.canEdit && !mode && (
        <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
          {a.open && <Button onClick={() => setMode('cancel')} sx={{ textTransform: 'none', color: '#b91c1c' }}>Cancel hearing</Button>}
          {a.open && <Button onClick={() => setMode('edit')} sx={{ textTransform: 'none' }}>Edit details</Button>}
          {a.open && <Button onClick={() => setMode('reschedule')} sx={{ textTransform: 'none' }}>New date</Button>}
          {a.open && appointmentDayArrived(a.scheduledAt) && (
            <Button variant="contained" onClick={() => setMode('record')} sx={{ textTransform: 'none', bgcolor: NAVY }}>Record outcome</Button>
          )}
          {recorded && <Button variant="outlined" onClick={() => setMode('amend')} sx={{ textTransform: 'none' }}>Update outcome</Button>}
        </DialogActions>
      )}
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</Typography>
      <Typography component="div" sx={{ fontSize: '0.88rem', color: NAVY, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{children}</Typography>
    </Box>
  );
}

function eventDetail(e: AppointmentDetail['appointment']['events'][number]): string {
  const after = e.after ?? {};
  if ((e.kind === 'created' || e.kind === 'rescheduled') && typeof after.scheduledAt === 'string') return ` - ${formatHearingWhen(after.scheduledAt)}`;
  if (e.kind === 'updated' && Array.isArray(after.changed)) return ` - ${(after.changed as string[]).join(', ')}`;
  if ((e.kind === 'completed' || e.kind === 'not_held') && typeof after.attendance === 'string') return ` - ${ATTENDANCE_OPTIONS[after.attendance as AppointmentAttendance] ?? ''}`;
  return '';
}

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <Box sx={{ p: 1.5, border: `1px solid ${VIOLET}40`, borderRadius: 2, bgcolor: '#faf5ff', display: 'grid', gap: 1.25 }}>
      <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.9rem' }}>{title}</Typography>
      {children}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{actions}</Box>
    </Box>
  );
}

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string, onError?: (e: unknown) => boolean) => {
    setBusy(true);
    try { await fn(); toast.success(done); onDone(); }
    catch (e) { if (!onError?.(e)) toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

function EditForm({ d, onDone, onCancel }: { d: AppointmentDetail; onDone: () => void; onCancel: () => void }) {
  const a = d.appointment;
  const [type, setType] = useState<AppointmentType>(a.type as AppointmentType);
  const [venue, setVenue] = useState(a.venue);
  const [officer, setOfficer] = useState(a.assignedOfficer?.id ?? '');
  const [participants, setParticipants] = useState<Participant[]>(a.participants);
  const [purpose, setPurpose] = useState(a.purpose);
  const [notes, setNotes] = useState(a.internalNotes ?? '');
  const [notifyVia, setNotify] = useState<NotifyVia>(a.notifyVia as NotifyVia);
  const [instructions, setInstructions] = useState(a.residentInstructions ?? '');
  const [courtMatter, setCourtMatter] = useState(a.courtMatter ?? '');
  const [courtSource, setCourtSource] = useState(a.courtSource ?? '');
  const [courtReference, setCourtReference] = useState(a.courtReference ?? '');
  const court = isCourtType(type);
  const { busy, run } = useSubmit(onDone);
  const refusal = notifyRefusal(notifyVia, { hasAccount: d.case.hasAccount }, participants);
  const toggle = (p: Participant) => setParticipants(participants.includes(p) ? participants.filter(x => x !== p) : [...participants, p]);
  return (
    <Panel title="Edit details" actions={<>
      <Button onClick={onCancel} sx={{ textTransform: 'none' }}>Back</Button>
      <Button variant="contained" disabled={busy || Boolean(refusal) || !participants.length} sx={{ textTransform: 'none', bgcolor: NAVY }}
        onClick={() => run(() => send(`/api/vawc/appointments/${a.id}`, 'PATCH', {
          action: 'update', type, venue: venue.trim(), assignedOfficerId: officer || null, participants, purpose: purpose.trim(), internalNotes: notes.trim(),
          notifyVia, residentInstructions: instructions.trim(),
          ...(court && { courtMatter: courtMatter || undefined, courtSource: courtSource || undefined, courtReference: courtReference.trim() }),
        }), 'Hearing updated')}>Save changes</Button>
    </>}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        <TextField select size="small" label="Hearing type" value={type} onChange={e => setType(e.target.value as AppointmentType)}>
          {APPOINTMENT_TYPE_KEYS.map(t => <MenuItem key={t} value={t}>{APPOINTMENT_TYPES[t].label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Assigned VAWC officer" value={officer} onChange={e => setOfficer(e.target.value)}>
          <MenuItem value="">Not assigned</MenuItem>
          {d.officers.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
        </TextField>
        <TextField size="small" label={court ? 'Court (name and branch)' : 'Venue or approved meeting location'} value={venue} onChange={e => setVenue(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} />
        {court && (
          <>
            <TextField select size="small" label="Court matter" value={courtMatter} onChange={e => setCourtMatter(e.target.value)}>
              {COURT_MATTER_KEYS.map(k => <MenuItem key={k} value={k}>{COURT_MATTERS[k]}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Date officially provided by" value={courtSource} onChange={e => setCourtSource(e.target.value)}>
              {COURT_SOURCE_KEYS.map(k => <MenuItem key={k} value={k}>{COURT_SOURCES[k]}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Court case or docket number (if given)" value={courtReference} onChange={e => setCourtReference(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} />
          </>
        )}
      </Box>
      <FormGroup row>
        {d.case.participantChoices.map(p => (
          <FormControlLabel key={p} control={<Checkbox size="small" checked={participants.includes(p)} onChange={() => toggle(p)} />}
            label={<Typography sx={{ fontSize: '0.82rem' }}>{participantLabel(p, d.case.reportingRelationship)}</Typography>} />
        ))}
      </FormGroup>
      <TextField size="small" label="Purpose (officials only)" value={purpose} onChange={e => setPurpose(e.target.value)} multiline minRows={2} />
      <TextField size="small" label="Internal notes (officials only)" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={2} />
      <RadioGroup value={notifyVia} onChange={e => setNotify(e.target.value as NotifyVia)}>
        {NOTIFY_KEYS.map(k => <FormControlLabel key={k} value={k} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.82rem' }}>{NOTIFY_OPTIONS[k].label}</Typography>} />)}
      </RadioGroup>
      {refusal && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{refusal}</Alert>}
      {notifyVia === 'SAFECOMM_ACCOUNT' && <TextField size="small" label="Instructions the resident sees" value={instructions} onChange={e => setInstructions(e.target.value)} />}
    </Panel>
  );
}

function RescheduleForm({ d, requestId, onDone, onCancel }: { d: AppointmentDetail; requestId?: string; onDone: () => void; onCancel: () => void }) {
  const a = d.appointment;
  const [date, setDate] = useState('');
  const [time, setTime] = useState(phTime(a.scheduledAt));
  const [venue, setVenue] = useState(a.venue);
  const [reason, setReason] = useState(requestId ? 'The resident asked for a new date.' : '');
  const [clash, setClash] = useState<ScheduleConflict[] | null>(null);
  const { busy, run } = useSubmit(onDone);
  const submit = (confirmConflicts = false) => run(() => send(`/api/vawc/appointments/${a.id}`, 'PATCH', {
    action: 'reschedule', date, time, venue: venue.trim(), reason: reason.trim(), requestId, confirmConflicts,
  }), a.notifyVia === 'SAFECOMM_ACCOUNT' ? 'New date set - the resident was notified' : 'New date set', e => { const c = conflictsOf(e); if (c) setClash(c); return Boolean(c); });
  return (
    <Panel title={requestId ? 'Set a new date (approves the request)' : 'Set a new date'} actions={<>
      <Button onClick={onCancel} sx={{ textTransform: 'none' }}>Back</Button>
      {clash && <Button onClick={() => submit(true)} disabled={busy} sx={{ textTransform: 'none', color: '#b45309' }}>Set it anyway</Button>}
      <Button variant="contained" disabled={busy || !date || !time || reason.trim().length < 3} onClick={() => submit(false)} sx={{ textTransform: 'none', bgcolor: NAVY }}>Save new date</Button>
    </>}>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Now: {formatHearingWhen(a.scheduledAt)}{phDay(a.scheduledAt) < todayPh() ? ' (passed)' : ''}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        <TextField size="small" type="date" label="New date" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }} />
        <TextField size="small" type="time" label="New time" value={time} onChange={e => setTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Venue" value={venue} onChange={e => setVenue(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} />
        <TextField size="small" label="Why the date changes (officials only)" value={reason} onChange={e => setReason(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} />
      </Box>
      {clash && <ConflictList conflicts={clash} footer="The other hearing is not changed. Pick another time, or go ahead only if both can really happen." />}
    </Panel>
  );
}

function ReasonForm({ title, label, button, danger, onSubmit, done, onDone, onCancel }: {
  title: string; label: string; button: string; danger?: boolean; onSubmit: (text: string) => Promise<unknown>; done: string; onDone: () => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const { busy, run } = useSubmit(onDone);
  return (
    <Panel title={title} actions={<>
      <Button onClick={onCancel} sx={{ textTransform: 'none' }}>Back</Button>
      <Button variant="contained" disabled={busy || text.trim().length < 3} onClick={() => run(() => onSubmit(text.trim()), done)}
        sx={{ textTransform: 'none', bgcolor: danger ? '#b91c1c' : NAVY }}>{busy ? <CircularProgress size={16} color="inherit" /> : button}</Button>
    </>}>
      <TextField size="small" label={label} value={text} onChange={e => setText(e.target.value)} multiline minRows={2} autoFocus />
    </Panel>
  );
}

function OutcomeForm({ d, amend, onDone, onCancel }: { d: AppointmentDetail; amend: boolean; onDone: () => void; onCancel: () => void }) {
  const a = d.appointment;
  const [held, setHeld] = useState(a.status !== 'NOT_HELD');
  const [attendance, setAttendance] = useState<AppointmentAttendance>((a.attendance as AppointmentAttendance) ?? 'ATTENDED');
  const [notes, setNotes] = useState(a.outcomeNotes ?? '');
  const [followUp, setFollowUp] = useState(a.followUpActions ?? '');
  const [referral, setReferral] = useState<AppointmentReferralStatus | ''>((a.referralStatus as AppointmentReferralStatus) ?? '');
  const [nextDate, setNextDate] = useState(a.nextAppointmentAt ? phDay(a.nextAppointmentAt) : '');
  const [nextTime, setNextTime] = useState(a.nextAppointmentAt ? phTime(a.nextAppointmentAt) : '09:00');
  const { busy, run } = useSubmit(onDone);
  const body = {
    outcomeNotes: notes.trim(), followUpActions: followUp.trim(), ...(referral && { referralStatus: referral }),
    ...(nextDate ? { nextDate, nextTime } : amend && a.nextAppointmentAt ? { nextDate: null } : {}),
  };
  return (
    <Panel title={amend ? 'Update the outcome record' : 'Record the outcome'} actions={<>
      <Button onClick={onCancel} sx={{ textTransform: 'none' }}>Back</Button>
      <Button variant="contained" disabled={busy} sx={{ textTransform: 'none', bgcolor: NAVY }}
        onClick={() => run(() => send(`/api/vawc/appointments/${a.id}`, 'PATCH', amend ? { action: 'amend_outcome', ...body } : { action: 'record', held, attendance, ...body }),
          'Outcome recorded')}>Save</Button>
    </>}>
      {!amend && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
          <TextField select size="small" label="Did it take place?" value={held ? 'yes' : 'no'} onChange={e => setHeld(e.target.value === 'yes')}>
            <MenuItem value="yes">Yes - it was held</MenuItem>
            <MenuItem value="no">No - it did not take place</MenuItem>
          </TextField>
          <TextField select size="small" label="Attendance" value={attendance} onChange={e => setAttendance(e.target.value as AppointmentAttendance)}>
            {ATTENDANCE_KEYS.map(k => <MenuItem key={k} value={k}>{ATTENDANCE_OPTIONS[k]}</MenuItem>)}
          </TextField>
        </Box>
      )}
      <TextField size="small" label="Outcome notes (officials only)" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={2} />
      <TextField size="small" label="Follow-up actions (officials only)" value={followUp} onChange={e => setFollowUp(e.target.value)} multiline minRows={2} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.25 }}>
        <TextField select size="small" label="Referral status" value={referral} onChange={e => setReferral(e.target.value as AppointmentReferralStatus)}>
          <MenuItem value="" disabled>Choose</MenuItem>
          {REFERRAL_STATUS_KEYS.map(k => <MenuItem key={k} value={k}>{REFERRAL_STATUS_OPTIONS[k]}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="Next follow-up (optional)" value={nextDate} onChange={e => setNextDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="time" label="Time" value={nextTime} onChange={e => setNextTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} disabled={!nextDate} />
      </Box>
    </Panel>
  );
}
