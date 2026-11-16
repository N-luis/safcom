'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Tabs, Tab, TextField, MenuItem, Chip, Alert, Skeleton, InputAdornment, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { EventAvailable, Add, Search, CalendarMonth, Refresh, WarningAmber } from '@mui/icons-material';
import { formatHearingDate, formatHearingTime } from '@/lib/hearings';
import {
  APPOINTMENT_TYPES, APPOINTMENT_TYPE_KEYS, APPOINTMENT_STATUSES, APPOINTMENT_VIEWS, APPOINTMENT_VIEW_KEYS, NOTIFY_OPTIONS,
  type AppointmentView, type NotifyVia,
} from '@/lib/vawcAppointments';
import CreateAppointmentDialog from './CreateAppointmentDialog';
import AppointmentDetailsDialog from './AppointmentDetailsDialog';
import { NAVY, VIOLET, APPT_STATUS_COLOR, chipSx, getJson, type AppointmentList, type AppointmentRow } from './appointmentUi';

const CASE_BASE = '/vawc/cases';

/**
 * VAWC Appointments & Follow-ups for the VAWC desk: the appointments on the
 * VAWC cases they handle - upcoming, past, rescheduled, completed and
 * cancelled - and Create Appointment. Separate from Hearing Management: no
 * blotter case, no KP stage, no respondent.
 */
export default function VawcAppointments() {
  const [view, setView] = useState<AppointmentView | 'all'>('upcoming');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [officer, setOfficer] = useState('');
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<AppointmentRow | null>(null);

  const params = new URLSearchParams();
  if (view !== 'all') params.set('view', view);
  if (type) params.set('type', type);
  if (officer) params.set('officer', officer);
  if (q.trim()) params.set('q', q.trim());
  const { data, error, isLoading, mutate } = useSWR<AppointmentList>(`/api/vawc/appointments?${params}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;

  const tiles = data ? [
    { label: 'Upcoming', value: data.summary.upcoming, color: '#0369a1' },
    { label: 'Past date, outcome not recorded', value: data.summary.overdue, color: '#b91c1c' },
    { label: 'New date requested', value: data.summary.pendingRequests, color: '#b45309' },
    { label: 'Rescheduled', value: data.summary.rescheduled, color: '#b45309' },
    { label: 'Completed', value: data.summary.completed, color: '#15803d' },
    { label: 'Cancelled', value: data.summary.cancelled, color: '#64748b' },
  ] : [];

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 1, minWidth: 0 }}>
          <Box sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 2, bgcolor: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EventAvailable sx={{ color: VIOLET }} />
          </Box>
          <Box>
            <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>VAWC Appointments &amp; Follow-ups</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Confidential appointments on VAWC cases (RA 9262). Never a hearing, never mediation, never with the respondent.</Typography>
          </Box>
        </Box>
        <Box sx={{ ml: { sm: 'auto' }, display: 'flex', gap: 1, flexShrink: 0, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <Button variant="outlined" startIcon={<CalendarMonth />} href="/vawc/appointments/calendar" sx={{ textTransform: 'none', borderRadius: 2, minHeight: 40 }}>
            Appointment Calendar
          </Button>
          {data?.canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreate(true)} sx={{ textTransform: 'none', bgcolor: NAVY, borderRadius: 2, minHeight: 40 }}>
              Create Appointment
            </Button>
          )}
        </Box>
      </Box>

      {forbidden && <Alert severity="info" sx={{ borderRadius: 2 }}>{error?.message}</Alert>}
      {error && !forbidden && !data && (
        <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>
      )}

      {!forbidden && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.25, mb: 2 }}>
            {isLoading && !data ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />) : tiles.map(t => (
              <Card key={t.label} sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0', height: '100%' }}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: t.value ? t.color : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t.label}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
            <Tabs value={view} onChange={(_, v) => setView(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid #e2e8f0', px: 1 }}>
              {APPOINTMENT_VIEW_KEYS.map(v => <Tab key={v} value={v} label={APPOINTMENT_VIEWS[v]} sx={{ textTransform: 'none', fontWeight: 600 }} />)}
              <Tab value="all" label="All" sx={{ textTransform: 'none', fontWeight: 600 }} />
            </Tabs>
            <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr auto' }, gap: 1, mb: 1.5 }}>
                <TextField size="small" placeholder="Case reference or appointment ID" value={q} onChange={e => setQ(e.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment> } }} />
                <TextField select size="small" label="Type" value={type} onChange={e => setType(e.target.value)}>
                  <MenuItem value="">All types</MenuItem>
                  {APPOINTMENT_TYPE_KEYS.map(t => <MenuItem key={t} value={t}>{APPOINTMENT_TYPES[t].label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="VAWC officer" value={officer} onChange={e => setOfficer(e.target.value)}>
                  <MenuItem value="">All officers</MenuItem>
                  {(data?.filters.officers ?? []).map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
                </TextField>
                <Tooltip title="Reload"><IconButton onClick={() => mutate()} aria-label="Reload"><Refresh /></IconButton></Tooltip>
              </Box>
              {isLoading && !data && <Skeleton variant="rounded" height={240} />}
              {data && <Records rows={data.rows} onOpen={setOpen} filtered={Boolean(q || type || officer)} />}
            </CardContent>
          </Card>
        </>
      )}

      {create && <CreateAppointmentDialog onClose={() => setCreate(false)} onCreated={() => { setCreate(false); void mutate(); }} />}
      {open && <AppointmentDetailsDialog id={open.id} caseHref={`${CASE_BASE}/${open.case.id}`} onClose={() => setOpen(null)} onChanged={() => mutate()} />}
    </Box>
  );
}

function Records({ rows, onOpen, filtered }: { rows: AppointmentRow[]; onOpen: (r: AppointmentRow) => void; filtered: boolean }) {
  if (!rows.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 5 }}>
        <EventAvailable sx={{ fontSize: 36, color: '#cbd5e1' }} />
        <Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>{filtered ? 'No appointment matches these filters.' : 'No appointments here.'}</Typography>
      </Box>
    );
  }
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 960 }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } }}>
            <TableCell>Appointment ID</TableCell><TableCell>Case</TableCell><TableCell>Type</TableCell><TableCell>Date and time</TableCell>
            <TableCell>Venue</TableCell><TableCell>Officer</TableCell><TableCell>Status</TableCell><TableCell>Resident notice</TableCell><TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id} hover sx={{ cursor: 'pointer', '& td': { fontSize: '0.8rem' } }} onClick={() => onOpen(r)} data-appointment={r.id}>
              <TableCell sx={{ fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{r.reference}</TableCell>
              <TableCell>
                <a href={`${CASE_BASE}/${r.case.id}`} onClick={e => e.stopPropagation()} style={{ color: '#0369a1', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.case.caseNumber}</a>
                <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{r.case.caseType}</Typography>
              </TableCell>
              <TableCell>{r.typeLabel}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatHearingDate(r.scheduledAt)}<br /><span style={{ color: '#64748b' }}>{formatHearingTime(r.scheduledAt)}</span></TableCell>
              <TableCell>{r.venue}</TableCell>
              <TableCell>{r.officer?.name ?? <span style={{ color: '#94a3b8' }}>Not assigned</span>}</TableCell>
              <TableCell>
                <Chip size="small" label={APPOINTMENT_STATUSES[r.status]} sx={chipSx(APPT_STATUS_COLOR[r.status])} />
                {r.overdue && <Typography sx={{ fontSize: '0.7rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 0.25 }}><WarningAmber sx={{ fontSize: 13 }} /> Record the outcome</Typography>}
                {r.pendingRequests > 0 && <Typography sx={{ fontSize: '0.7rem', color: '#b45309' }}>New date requested</Typography>}
              </TableCell>
              <TableCell sx={{ fontSize: '0.74rem !important', color: '#475569' }}>
                {NOTIFY_OPTIONS[r.notifyVia as NotifyVia]?.short ?? r.notifyVia}
                {r.notifyVia === 'SAFECOMM_ACCOUNT' && <Typography sx={{ fontSize: '0.7rem', color: r.acknowledged ? '#15803d' : '#94a3b8' }}>{r.acknowledged ? 'Acknowledged' : 'Not acknowledged'}</Typography>}
              </TableCell>
              <TableCell align="right"><Button size="small" onClick={e => { e.stopPropagation(); onOpen(r); }} sx={{ textTransform: 'none' }}>View details</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
