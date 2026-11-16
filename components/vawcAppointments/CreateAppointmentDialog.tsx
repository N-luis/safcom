'use client';

import { useState } from 'react';
import useSWR, { mutate as mutateAll } from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Alert, Autocomplete,
  CircularProgress, Skeleton, Chip, FormControlLabel, Radio, RadioGroup, Checkbox, FormGroup, useMediaQuery, useTheme,
} from '@mui/material';
import { EventAvailable } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  APPOINTMENT_TYPES, APPOINTMENT_TYPE_KEYS, NOTIFY_OPTIONS, NOTIFY_KEYS, COURT_MATTERS, COURT_MATTER_KEYS, COURT_SOURCES, COURT_SOURCE_KEYS, NOT_A_COURT,
  participantLabel, defaultParticipants, notifyRefusal, isCourtType, courtRefusal, type AppointmentType, type NotifyVia, type Participant, type CourtMatter, type CourtSource,
} from '@/lib/vawcAppointments';
import type { ScheduleConflict } from '@/lib/hearings';
import { ConflictList } from '@/components/hearings/ConflictWarnings';
import { NAVY, VIOLET, getJson, send, todayPh, conflictsOf, chipSx, type AppointmentCaseContext, type Officer } from './appointmentUi';

interface CaseOption {
  id: string; caseNumber: string; caseType: string; status: string; riskLevel: string | null; filedAt: string;
  assignedTo: { id: string; name: string; me: boolean } | null; canSchedule: boolean; canClaim: boolean;
}
interface CaseData { case: AppointmentCaseContext; officers: Officer[]; appointments: number; canEdit: boolean; accessMessage: string | null; canClaim: boolean }

const filed = (d: string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });

const DEFAULT_VENUE = 'Barangay VAWC Desk - private room';
/** Every list and calendar of VAWC Hearings reads these routes: refreshed together after a save. */
export const refreshHearings = () => mutateAll(k => typeof k === 'string' && k.startsWith('/api/vawc/appointments'));

/**
 * Create a hearing (the VAWC desk's own scheduling) on a VAWC case. The case is chosen from the VAWC
 * case records by its reference (or given), and the appointment is saved
 * against that case's id - never matched by a name. Who it is for never
 * includes the respondent, and there is no mediation or joint session to
 * choose (RA 9262 sec. 33).
 */
export default function CreateAppointmentDialog({ caseId: fixedCase, initialDate, onClose, onCreated }: {
  caseId?: string; initialDate?: string; onClose: () => void; onCreated: (caseId: string) => void;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CaseOption | null>(null);
  const caseId = fixedCase ?? picked?.id ?? null;
  const options = useSWR<{ rows: CaseOption[] }>(fixedCase ? null : `/api/vawc/appointments/cases${q ? `?q=${encodeURIComponent(q)}` : ''}`, getJson, { keepPreviousData: true });
  const detail = useSWR<CaseData>(caseId ? `/api/vawc/appointments/cases?caseId=${encodeURIComponent(caseId)}` : null, getJson);
  const d = detail.data;

  const [type, setType] = useState<AppointmentType>('VICTIM_INTERVIEW');
  const [date, setDate] = useState(initialDate && initialDate >= todayPh() ? initialDate : '');
  const [time, setTime] = useState('09:00');
  const [venue, setVenue] = useState(DEFAULT_VENUE);
  const [courtMatter, setCourtMatter] = useState<CourtMatter | ''>('');
  const [courtSource, setCourtSource] = useState<CourtSource | ''>('');
  const [courtReference, setCourtReference] = useState('');
  // One key per form opened: a second click, or a retry after a lost reply, saves nothing new.
  const [submissionKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const court = isCourtType(type);
  const [officerIn, setOfficer] = useState<string | null>(null);
  const [participantsIn, setParticipants] = useState<Participant[] | null>(null);
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [notifyIn, setNotify] = useState<NotifyVia | null>(null);
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [clash, setClash] = useState<ScheduleConflict[] | null>(null);

  // Defaults from the case until the officer changes them.
  const participants = participantsIn ?? (d ? defaultParticipants(type, d.case.reportingRelationship) : []);
  const officer = officerIn ?? d?.case.assignedTo?.id ?? '';
  const canInApp = d ? !notifyRefusal('SAFECOMM_ACCOUNT', { hasAccount: d.case.hasAccount }, participants) : false;
  const forResident = participants.includes('REPORTER') || participants.includes('VICTIM_SURVIVOR');
  const notifyVia: NotifyVia = notifyIn && (notifyIn !== 'SAFECOMM_ACCOUNT' || canInApp) ? notifyIn : canInApp ? 'SAFECOMM_ACCOUNT' : forResident ? 'OFFICER_CONTACT' : 'NONE';
  const ready = Boolean(d?.canEdit);

  const claim = async () => {
    if (!caseId) return;
    setClaiming(true);
    try { await send(`/api/cases/${caseId}/claim`, 'POST', {}); toast.success('The case is now assigned to you'); await detail.mutate(); void options.mutate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not take the case'); } finally { setClaiming(false); }
  };

  const save = async (confirmConflicts = false) => {
    if (!caseId || saving) return;
    if (!date || !time) { toast.error('Choose the date and time'); return; }
    if (!participants.length) { toast.error('Choose who the hearing is for'); return; }
    if (purpose.trim().length < 5) { toast.error('Write the purpose (at least 5 characters)'); return; }
    if (venue.trim().length < 2) { toast.error(court ? 'Enter the court' : 'Enter the venue'); return; }
    const courtErr = courtRefusal(type, { courtMatter: courtMatter || null, courtSource: courtSource || null });
    if (courtErr) { toast.error(courtErr); return; }
    setSaving(true);
    try {
      await send('/api/vawc/appointments', 'POST', {
        caseId, type, date, time, venue: venue.trim(), assignedOfficerId: officer || null, participants, purpose: purpose.trim(),
        internalNotes: notes.trim() || undefined, notifyVia, residentInstructions: notifyVia === 'SAFECOMM_ACCOUNT' ? instructions.trim() || undefined : undefined,
        confirmConflicts, submissionKey,
        ...(court && { courtMatter, courtSource, courtReference: courtReference.trim() || undefined }),
      });
      toast.success(notifyVia === 'SAFECOMM_ACCOUNT' ? 'Hearing saved - the resident was notified in their account' : 'Hearing saved');
      void refreshHearings();
      onCreated(caseId);
    } catch (e) {
      const conflicts = conflictsOf(e);
      if (conflicts) setClash(conflicts);
      else toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  };

  const toggle = (p: Participant) => setParticipants(participants.includes(p) ? participants.filter(x => x !== p) : [...participants, p]);
  const detailError = detail.error as (Error & { status?: number; canClaim?: boolean }) | undefined;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 1 }}>
        <EventAvailable sx={{ color: VIOLET }} /> Create Hearing
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {!fixedCase && (
          <Autocomplete
            options={options.data?.rows ?? []} value={picked} loading={options.isLoading}
            onChange={(_, v) => { setPicked(v); setParticipants(null); setNotify(null); setOfficer(null); setClash(null); }}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ(v.trim()); }}
            filterOptions={x => x} getOptionLabel={o => o.caseNumber} isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText={options.error ? 'The cases could not be loaded' : q ? 'No VAWC case with that reference' : 'No open VAWC case you can schedule'}
            loadingText="Loading VAWC cases..."
            renderOption={(props, o) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'grid !important', gap: 0.25 }}>
                  <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.88rem' }}>{o.caseNumber} <span style={{ color: '#64748b', fontWeight: 500 }}>· {o.caseType} · {o.status}</span></Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: o.canSchedule ? '#15803d' : '#94a3b8' }}>
                    Filed {filed(o.filedAt)} · {o.assignedTo ? (o.assignedTo.me ? 'Assigned to you' : `Assigned to ${o.assignedTo.name}`) : 'Unassigned'}
                  </Typography>
                </Box>
              );
            }}
            renderInput={p => <TextField {...p} label="VAWC case" placeholder="Choose, or type the case reference" />}
          />
        )}
        {!fixedCase && options.error && (
          <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => options.mutate()}>Retry</Button>}>
            {(options.error as Error).message}
          </Alert>
        )}
        {!fixedCase && !caseId && options.data && !options.data.rows.length && !q && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>No open VAWC case is assigned to you or waiting to be taken.</Alert>
        )}

        {caseId && detail.isLoading && <Skeleton variant="rounded" height={160} />}
        {detailError && !d && (
          <Alert severity={detailError.status === 403 ? 'info' : 'error'} sx={{ borderRadius: 2 }} action={detailError.canClaim ? (
            <Button color="inherit" size="small" onClick={claim} disabled={claiming}>{claiming ? 'Taking...' : 'Take this case'}</Button>
          ) : undefined}>{detailError.message}</Alert>
        )}

        {d && (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', p: 1.25, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#faf5ff' }}>
              <Typography sx={{ fontWeight: 800, color: NAVY }}>{d.case.caseNumber}</Typography>
              <Chip size="small" label={d.case.caseType} sx={chipSx(VIOLET)} />
              <Chip size="small" label={d.case.status} sx={chipSx('#475569')} />
              {d.case.riskLevel && <Chip size="small" label={`${d.case.riskLevel} risk`} sx={chipSx('#b45309')} />}
              <Chip size="small" label={d.case.hasAccount ? 'Reporter has a SafeComm account' : 'No SafeComm account'} sx={chipSx('#0369a1')} />
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b', ml: { sm: 'auto' } }}>
                Filed {filed(d.case.filedAt)} · {d.case.assignedTo ? `Officer: ${d.case.assignedTo.name}` : 'Unassigned'}
              </Typography>
            </Box>

            {!d.canEdit && (
              <Alert severity="info" sx={{ borderRadius: 2 }} action={d.canClaim ? (
                <Button color="inherit" size="small" onClick={claim} disabled={claiming}>{claiming ? 'Taking...' : 'Take this case'}</Button>
              ) : undefined}>
                {d.accessMessage ?? 'Only the VAWC officer assigned to this case can schedule its hearings.'}
              </Alert>
            )}

            {ready && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <TextField select label="Hearing type" value={type} onChange={e => {
                    const next = e.target.value as AppointmentType;
                    // The court is the venue of a court date; the desk's room is not.
                    if (isCourtType(next) && venue === DEFAULT_VENUE) setVenue('');
                    if (!isCourtType(next) && !venue.trim()) setVenue(DEFAULT_VENUE);
                    setType(next); setParticipants(null);
                  }}>
                    {APPOINTMENT_TYPE_KEYS.map(t => <MenuItem key={t} value={t}>{APPOINTMENT_TYPES[t].label}</MenuItem>)}
                  </TextField>
                  <TextField select label="Assigned VAWC officer" value={officer} onChange={e => setOfficer(e.target.value)}>
                    <MenuItem value="">Not assigned</MenuItem>
                    {d.officers.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
                  </TextField>
                  <TextField type="date" label="Date" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }} />
                  <TextField type="time" label="Time" value={time} onChange={e => setTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField label={court ? 'Court (name and branch)' : 'Venue or approved meeting location'} value={venue} onChange={e => setVenue(e.target.value)}
                    placeholder={court ? 'e.g. RTC Branch 12 (Family Court)' : undefined} sx={{ gridColumn: { sm: '1 / -1' } }} />
                </Box>

                {court && (
                  <Box sx={{ display: 'grid', gap: 1.5 }}>
                    <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{NOT_A_COURT}</Alert>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                      <TextField select label="Court matter" value={courtMatter} onChange={e => setCourtMatter(e.target.value as CourtMatter)}>
                        {COURT_MATTER_KEYS.map(k => <MenuItem key={k} value={k}>{COURT_MATTERS[k]}</MenuItem>)}
                      </TextField>
                      <TextField select label="Date officially provided by" value={courtSource} onChange={e => setCourtSource(e.target.value as CourtSource)}>
                        {COURT_SOURCE_KEYS.map(k => <MenuItem key={k} value={k}>{COURT_SOURCES[k]}</MenuItem>)}
                      </TextField>
                      <TextField label="Court case or docket number (if given)" value={courtReference} onChange={e => setCourtReference(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }} />
                    </Box>
                  </Box>
                )}

                <Box>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY, mb: 0.5 }}>Intended participants</Typography>
                  <FormGroup row>
                    {d.case.participantChoices.map(p => (
                      <FormControlLabel key={p} control={<Checkbox size="small" checked={participants.includes(p)} onChange={() => toggle(p)} />}
                        label={<Typography sx={{ fontSize: '0.84rem' }}>{participantLabel(p, d.case.reportingRelationship)}</Typography>} />
                    ))}
                  </FormGroup>
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>The respondent is never a participant and is never notified.</Typography>
                </Box>

                <TextField label="Purpose" value={purpose} onChange={e => setPurpose(e.target.value)} multiline minRows={2} helperText="Officials only" />
                <TextField label="Internal notes" value={notes} onChange={e => setNotes(e.target.value)} multiline minRows={2} helperText="Officials only" />

                <Box>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY, mb: 0.5 }}>Notification</Typography>
                  <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: d.case.contact.preference === 'no_phone' ? '#fef2f2' : '#f8fafc', border: '1px solid #e2e8f0', mb: 1 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: d.case.contact.preference === 'no_phone' ? '#b91c1c' : '#334155' }}>Safe-contact preference: {d.case.contact.label}</Typography>
                    <Typography sx={{ fontSize: '0.76rem', color: '#475569' }}>{d.case.contact.guidance}</Typography>
                    {d.case.contact.note && <Typography sx={{ fontSize: '0.76rem', color: '#475569', mt: 0.25 }}>Their note: {d.case.contact.note}</Typography>}
                  </Box>
                  <RadioGroup value={notifyVia} onChange={e => setNotify(e.target.value as NotifyVia)}>
                    {NOTIFY_KEYS.map(k => (
                      <FormControlLabel key={k} value={k} disabled={k === 'SAFECOMM_ACCOUNT' && !canInApp} control={<Radio size="small" />}
                        label={<Typography sx={{ fontSize: '0.84rem' }}>{NOTIFY_OPTIONS[k].label}</Typography>} />
                    ))}
                  </RadioGroup>
                  {!canInApp && (
                    <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {notifyRefusal('SAFECOMM_ACCOUNT', { hasAccount: d.case.hasAccount }, participants)}
                    </Typography>
                  )}
                  {notifyVia === 'SAFECOMM_ACCOUNT' && (
                    <TextField label="Instructions for the resident (optional)" value={instructions} onChange={e => setInstructions(e.target.value)} fullWidth sx={{ mt: 1 }}
                      helperText="The resident sees this behind their login. The notice itself only gives the date and time." />
                  )}
                </Box>

                {clash && <ConflictList conflicts={clash} footer="The other hearing is not changed. Pick another time, or go ahead only if both can really happen." />}
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        {clash && ready && (
          <Button onClick={() => save(true)} disabled={saving} sx={{ textTransform: 'none', color: '#b45309' }}>Schedule anyway</Button>
        )}
        <Button variant="contained" onClick={() => save(false)} disabled={!ready || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <EventAvailable />}
          sx={{ textTransform: 'none', bgcolor: NAVY, borderRadius: 2 }}>
          Save hearing
        </Button>
      </DialogActions>
    </Dialog>
  );
}
