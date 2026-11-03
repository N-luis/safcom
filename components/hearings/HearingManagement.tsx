'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Tabs, Tab, TextField, MenuItem, Chip, Alert, Skeleton, InputAdornment, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Gavel, Add, Search, ChevronLeft, ChevronRight, CalendarMonth, Refresh, WarningAmber } from '@mui/icons-material';
import {
  HEARING_STATUSES, HEARING_TITLES, NOTICE_STATUSES, ATTENDANCE, formatHearingDate, formatHearingTime, phDay, outcomeLabel,
  type HearingStatus, type NoticeStatus, type Attendance,
} from '@/lib/hearings';
import CreateHearingDialog from './CreateHearingDialog';
import HearingDetailsDialog from './HearingDetailsDialog';
import { NAVY, STATUS_COLOR, NOTICE_COLOR, ATTENDANCE_COLOR, chipSx, getJson } from './hearingUi';

interface Row {
  id: string; reference: string; hearingNumber: number; scheduledAt: string; venue: string | null; status: HearingStatus; outcome: string | null;
  rescheduleCount: number; updatedAt: string;
  case: { id: string; caseNumber: string; caseType: string; status: string };
  complainant: string; respondent: string; official: { id: string; name: string } | null;
  attendance: { complainant: Attendance; respondent: Attendance };
  notices: { complainant: NoticeStatus | null; respondent: NoticeStatus | null };
  residentIntent: string | null; pendingRequests: number; overdue: boolean; approaching: boolean; canEdit: boolean;
}
interface ListData {
  rows: Row[]; canCreate: boolean;
  summary: { total: number; drafts: number; upcoming: number; overdue: number; noticesPending: number; completed: number; rescheduled: number; cancelled: number; pendingRequests: number };
}

const TAB_HINTS: Record<number, string> = {
  1: 'Hearing 1 - Initial Hearing: pick an eligible case, set the date, time, venue and official, review the parties, issue notices, record attendance, proceedings and the outcome, then schedule Hearing 2 if the matter continues.',
  2: 'Hearing 2 - Follow-up Hearing: read the previous hearing record, set the next proceeding, record attendance, notes, agreements or developments and the outcome, then schedule Hearing 3 if needed.',
  3: 'Hearing 3 - Further Proceeding: with Hearings 1 and 2 on record, record the latest proceeding, attendance and outcome - settled, continued, referred or otherwise disposed of - and the case\'s next action.',
};

/**
 * Hearing Management for officials: every hearing they may see, by hearing
 * number or on a calendar, with the record behind each one. Hearings are
 * created one at a time, each only when the one before it calls for it.
 */
export default function HearingManagement({ caseBase }: { caseBase: string }) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [create, setCreate] = useState<{ caseId?: string } | null>(null);
  const [open, setOpen] = useState<{ caseId: string; hearingId: string } | null>(null);

  const params = new URLSearchParams();
  if (tab >= 1 && tab <= 3) params.set('number', String(tab));
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q.trim()) params.set('q', q.trim());
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/hearings?${params}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;

  const tiles = data ? [
    { label: 'Upcoming', value: data.summary.upcoming, color: '#0369a1' },
    { label: 'Notices to issue', value: data.summary.noticesPending, color: '#4f46e5' },
    { label: 'Past date, not recorded', value: data.summary.overdue, color: '#b91c1c' },
    { label: 'Requests for a new date', value: data.summary.pendingRequests, color: '#b45309' },
    { label: 'Completed', value: data.summary.completed, color: '#15803d' },
    { label: 'Drafts', value: data.summary.drafts, color: '#64748b' },
  ] : [];

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Gavel sx={{ color: '#0369a1' }} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>Hearing Management</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Katarungang Pambarangay hearings for eligible blotter disputes. VAWC cases under RA 9262 are never heard here.</Typography>
          </Box>
        </Box>
        {data?.canCreate && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreate({})} sx={{ ml: { sm: 'auto' }, textTransform: 'none', bgcolor: NAVY, borderRadius: 2, minHeight: 40 }}>
            Create Hearing
          </Button>
        )}
      </Box>

      {forbidden && <Alert severity="info" sx={{ borderRadius: 2 }}>{error?.message}</Alert>}
      {error && !forbidden && !data && (
        <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>
      )}

      {!forbidden && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.25, mb: 2 }}>
            {isLoading && !data ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="rounded" height={72} />) : tiles.map(t => (
              <Card key={t.label} sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: t.value ? t.color : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t.label}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid #e2e8f0', px: 1 }}>
              <Tab label="All hearings" sx={{ textTransform: 'none', fontWeight: 600 }} />
              {[1, 2, 3].map(n => <Tab key={n} label={`Hearing ${n} - ${HEARING_TITLES[n]}`} sx={{ textTransform: 'none', fontWeight: 600 }} />)}
              <Tab icon={<CalendarMonth sx={{ fontSize: 18 }} />} iconPosition="start" label="Calendar" sx={{ textTransform: 'none', fontWeight: 600, minHeight: 48 }} />
            </Tabs>
            <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
              {TAB_HINTS[tab] && <Typography sx={{ fontSize: '0.8rem', color: '#475569', mb: 1.5 }}>{TAB_HINTS[tab]}</Typography>}
              {tab !== 4 && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 1fr auto' }, gap: 1, mb: 1.5 }}>
                  <TextField size="small" placeholder="Case number or hearing ID" value={q} onChange={e => setQ(e.target.value)}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment> } }} />
                  <TextField select size="small" label="Status" value={status} onChange={e => setStatus(e.target.value)}>
                    <MenuItem value="">Any status</MenuItem>
                    {(Object.keys(HEARING_STATUSES) as HearingStatus[]).map(s => <MenuItem key={s} value={s}>{HEARING_STATUSES[s]}</MenuItem>)}
                  </TextField>
                  <TextField size="small" type="date" label="From" value={from} onChange={e => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField size="small" type="date" label="To" value={to} onChange={e => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <Tooltip title="Reload"><IconButton onClick={() => mutate()} aria-label="Reload"><Refresh /></IconButton></Tooltip>
                </Box>
              )}
              {isLoading && !data && <Skeleton variant="rounded" height={240} />}
              {data && tab !== 4 && <RecordsTable rows={data.rows} caseBase={caseBase} onOpen={r => setOpen({ caseId: r.case.id, hearingId: r.id })} filtered={Boolean(q || status || from || to)} />}
              {data && tab === 4 && <Calendar rows={data.rows} onOpen={r => setOpen({ caseId: r.case.id, hearingId: r.id })} />}
            </CardContent>
          </Card>
        </>
      )}

      {create && (
        <CreateHearingDialog caseId={create.caseId} onClose={() => setCreate(null)}
          classificationHref={id => `${caseBase}/${id}`}
          onCreated={() => { setCreate(null); void mutate(); }} />
      )}
      {open && (
        <HearingDetailsDialog caseId={open.caseId} hearingId={open.hearingId} caseHref={`${caseBase}/${open.caseId}`}
          onClose={() => setOpen(null)} onChanged={() => mutate()}
          onScheduleNext={caseId => { setOpen(null); setCreate({ caseId }); }} />
      )}
    </Box>
  );
}

function RecordsTable({ rows, caseBase, onOpen, filtered }: { rows: Row[]; caseBase: string; onOpen: (r: Row) => void; filtered: boolean }) {
  if (!rows.length) {
    return (
      <Box sx={{ textAlign: 'center', py: 5 }}>
        <Gavel sx={{ fontSize: 36, color: '#cbd5e1' }} />
        <Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>{filtered ? 'No hearing matches these filters.' : 'No hearings yet. Create Hearing 1 on an eligible case to start.'}</Typography>
      </Box>
    );
  }
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 980 }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } }}>
            <TableCell>Hearing ID</TableCell><TableCell>Case</TableCell><TableCell>Hearing</TableCell><TableCell>Date and time</TableCell>
            <TableCell>Venue</TableCell><TableCell>Parties</TableCell><TableCell>Official</TableCell><TableCell>Status</TableCell>
            <TableCell>Notices</TableCell><TableCell>Attendance</TableCell><TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id} hover sx={{ cursor: 'pointer', '& td': { fontSize: '0.8rem' } }} onClick={() => onOpen(r)}>
              <TableCell sx={{ fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{r.reference}</TableCell>
              <TableCell>
                <a href={`${caseBase}/${r.case.id}`} onClick={e => e.stopPropagation()} style={{ color: '#0369a1', fontWeight: 600 }}>{r.case.caseNumber}</a>
                <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{r.case.caseType}</Typography>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Hearing {r.hearingNumber}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {formatHearingDate(r.scheduledAt)}<br /><span style={{ color: '#64748b' }}>{formatHearingTime(r.scheduledAt)}</span>
                {r.approaching && <Chip size="small" label="Within 48h" sx={{ ...chipSx('#b45309'), ml: 0.5 }} />}
              </TableCell>
              <TableCell>{r.venue ?? 'Barangay Hall'}</TableCell>
              <TableCell><Typography sx={{ fontSize: '0.78rem' }}>{r.complainant}</Typography><Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>vs {r.respondent}</Typography></TableCell>
              <TableCell>{r.official?.name ?? <span style={{ color: '#94a3b8' }}>Not assigned</span>}</TableCell>
              <TableCell>
                <Chip size="small" label={HEARING_STATUSES[r.status]} sx={chipSx(STATUS_COLOR[r.status])} />
                {r.outcome && <Typography sx={{ fontSize: '0.7rem', color: '#475569', mt: 0.25 }}>{outcomeLabel(r.outcome)}</Typography>}
                {r.overdue && <Typography sx={{ fontSize: '0.7rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 0.25 }}><WarningAmber sx={{ fontSize: 13 }} /> Record the outcome</Typography>}
                {r.pendingRequests > 0 && <Typography sx={{ fontSize: '0.7rem', color: '#b45309' }}>New date requested</Typography>}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {(['complainant', 'respondent'] as const).map(k => (
                  <Box key={k} sx={{ fontSize: '0.72rem', color: r.notices[k] ? NOTICE_COLOR[r.notices[k]!] : '#94a3b8' }}>
                    {k === 'complainant' ? 'C' : 'R'}: {r.notices[k] ? NOTICE_STATUSES[r.notices[k]!] : 'none'}
                  </Box>
                ))}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {(['complainant', 'respondent'] as const).map(k => (
                  <Box key={k} sx={{ fontSize: '0.72rem', color: ATTENDANCE_COLOR[r.attendance[k]] }}>{k === 'complainant' ? 'C' : 'R'}: {ATTENDANCE[r.attendance[k]]}</Box>
                ))}
              </TableCell>
              <TableCell align="right"><Button size="small" onClick={e => { e.stopPropagation(); onOpen(r); }} sx={{ textTransform: 'none' }}>View details</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A month of hearings, by their Philippine date. */
function Calendar({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const today = phDay(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) if (r.status !== 'CANCELLED') { const d = phDay(r.scheduledAt); map.set(d, [...(map.get(d) ?? []), r]); }
    return map;
  }, [rows]);
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <IconButton size="small" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft /></IconButton>
        <Typography sx={{ fontWeight: 800, color: NAVY, minWidth: 150, textAlign: 'center' }}>{first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Typography>
        <IconButton size="small" onClick={() => shift(1)} aria-label="Next month"><ChevronRight /></IconButton>
        <Button size="small" onClick={() => setMonth(today.slice(0, 7))} sx={{ textTransform: 'none' }}>Today</Button>
        <Typography sx={{ ml: 'auto', fontSize: '0.75rem', color: '#94a3b8' }}>Cancelled hearings are not shown</Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(96px, 1fr))', gap: 0.5, minWidth: 700 }}>
          {WEEKDAYS.map(d => <Typography key={d} sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textAlign: 'center' }}>{d}</Typography>)}
          {cells.map((d, i) => (
            <Box key={i} sx={{ minHeight: 92, border: '1px solid', borderColor: d === today ? '#0369a1' : '#e2e8f0', borderRadius: 1.5, p: 0.5, bgcolor: d ? '#fff' : '#f8fafc' }}>
              {d && <Typography sx={{ fontSize: '0.72rem', fontWeight: d === today ? 800 : 600, color: d === today ? '#0369a1' : '#64748b' }}>{Number(d.slice(8))}</Typography>}
              {d && (byDay.get(d) ?? []).map(r => (
                <Box key={r.id} component="button" onClick={() => onOpen(r)}
                  sx={{ display: 'block', width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 1, px: 0.5, py: 0.25, mt: 0.25,
                    bgcolor: `${STATUS_COLOR[r.status]}14`, color: STATUS_COLOR[r.status], fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
                    '&:focus-visible': { outline: `2px solid ${STATUS_COLOR[r.status]}` } }}>
                  {formatHearingTime(r.scheduledAt)} H{r.hearingNumber} · {r.case.caseNumber}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
