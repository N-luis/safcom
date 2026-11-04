'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Tabs, Tab, TextField, MenuItem, Chip, Alert, Skeleton, InputAdornment, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Gavel, Add, Search, CalendarMonth, Refresh, WarningAmber } from '@mui/icons-material';
import {
  HEARING_STATUSES, KP_STAGES, KP_STAGE_KEYS, NOTICE_STATUSES, ATTENDANCE, formatHearingDate, formatHearingTime, outcomeLabel,
  type HearingStatus, type NoticeStatus, type Attendance, type KpStage,
} from '@/lib/hearings';
import CreateHearingDialog from './CreateHearingDialog';
import HearingDetailsDialog from './HearingDetailsDialog';
import { NAVY, STATUS_COLOR, NOTICE_COLOR, ATTENDANCE_COLOR, chipSx, getJson } from './hearingUi';

interface Row {
  id: string; reference: string; hearingNumber: number; stage: KpStage; session: number; title: string; scheduledAt: string; venue: string | null; status: HearingStatus; outcome: string | null;
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

/** The page slug of each stage: /blotter-officer/hearings/mediation, ... */
export const STAGE_SLUGS: Record<KpStage, string> = { MEDIATION: 'mediation', CONSTITUTION: 'pangkat', CONCILIATION: 'conciliation' };

const TAB_HINTS: Partial<Record<KpStage, string>> = {
  MEDIATION: 'A. Mediation before the Punong Barangay: one schedule makes KP Form No. 8 (Notice of Hearing) for the complainant and KP Form No. 9 (Summons) for the respondent. Record attendance and the outcome. Without a settlement, the case goes to the constitution of the Pangkat.',
  CONSTITUTION: 'B. Constitution of the Pangkat: KP Form No. 10 goes to both parties. Record the three members chosen, the chairman and the secretary, and give each member KP Form No. 11. Record the proceeding as held with "Pangkat constituted" to open conciliation.',
  CONCILIATION: 'C. Conciliation before the Pangkat: KP Form No. 12 goes to both parties. Only after the Pangkat is constituted. Record attendance and the outcome - settlement, no settlement, further proceedings, or a certification to file action.',
};

/**
 * Hearing Management for officials: every Katarungang Pambarangay
 * proceeding they may see, by stage - mediation, constitution of the
 * Pangkat, conciliation - with the record behind each one (the calendar is
 * its own page, HearingCalendar). Proceedings are created one at a time,
 * each only when the stage before it calls for it. Each stage tab is a page
 * of its own, so it can be linked to directly.
 */
export default function HearingManagement({ caseBase, basePath = '/blotter-officer/hearings', stage = null }: {
  caseBase: string; basePath?: string; stage?: KpStage | null;
}) {
  const router = useRouter();
  const tab = stage ?? 'ALL';
  const setTab = (v: KpStage | 'ALL') => router.push(v === 'ALL' ? basePath : `${basePath}/${STAGE_SLUGS[v]}`);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [create, setCreate] = useState<{ caseId?: string } | null>(null);
  const [open, setOpen] = useState<{ caseId: string; hearingId: string } | null>(null);

  const params = new URLSearchParams();
  if (stage) params.set('stage', stage);
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 1, minWidth: 0 }}>
          <Box sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 2, bgcolor: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Gavel sx={{ color: '#0369a1' }} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>Hearing Management</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Katarungang Pambarangay proceedings for eligible blotter disputes: mediation, constitution of the Pangkat, conciliation. VAWC cases under RA 9262 are never heard here.</Typography>
          </Box>
        </Box>
        <Box sx={{ ml: { sm: 'auto' }, display: 'flex', gap: 1, flexShrink: 0, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <Button variant="outlined" startIcon={<CalendarMonth />} href={`${basePath}/calendar`} sx={{ textTransform: 'none', borderRadius: 2, minHeight: 40 }}>
            Hearing Calendar
          </Button>
          {data?.canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreate({})} sx={{ textTransform: 'none', bgcolor: NAVY, borderRadius: 2, minHeight: 40 }}>
              Create Hearing
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
              <Tab value="ALL" label="All proceedings" sx={{ textTransform: 'none', fontWeight: 600 }} />
              {KP_STAGE_KEYS.map(s => <Tab key={s} value={s} label={`${KP_STAGES[s].letter}. ${KP_STAGES[s].label}`} sx={{ textTransform: 'none', fontWeight: 600 }} />)}
            </Tabs>
            <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
              {stage && TAB_HINTS[stage] && <Typography sx={{ fontSize: '0.8rem', color: '#475569', mb: 1.5 }}>{TAB_HINTS[stage]}</Typography>}
              {(
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
              {data && <RecordsTable rows={data.rows} caseBase={caseBase} onOpen={r => setOpen({ caseId: r.case.id, hearingId: r.id })} filtered={Boolean(q || status || from || to)} />}
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
        <Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>{filtered ? 'No proceeding matches these filters.' : 'No proceedings here yet. Every case starts with mediation before the Punong Barangay - create it on an eligible case.'}</Typography>
      </Box>
    );
  }
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 980 }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } }}>
            <TableCell>Hearing ID</TableCell><TableCell>Case</TableCell><TableCell>Stage</TableCell><TableCell>Date and time</TableCell>
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
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.title}</TableCell>
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
