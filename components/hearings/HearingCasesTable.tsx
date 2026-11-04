'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Button, TextField, MenuItem, Chip, Alert, Skeleton, InputAdornment, IconButton, Tooltip, CircularProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, TablePagination,
} from '@mui/material';
import { Search, Refresh, FolderOpen } from '@mui/icons-material';
import toast from 'react-hot-toast';
import type { HearingCaseRow, KpEligibilityState, CaseHearingState } from '@/lib/hearingCasesServer';
import { ELIGIBILITY_COLOR } from './CreateHearingDialog';
import { NAVY, STATUS_COLOR, chipSx, getJson, send } from './hearingUi';

interface CaseListData {
  rows: HearingCaseRow[]; total: number; page: number; pageSize: number; pages: number; statuses: string[]; truncated: boolean;
  counts: { eligibility: Record<KpEligibilityState, number>; hearing: Record<CaseHearingState, number> };
}

const ELIGIBILITY_OPTIONS: [KpEligibilityState, string][] = [
  ['ELIGIBLE', 'Eligible'], ['PENDING_REVIEW', 'Pending review'], ['NEEDS_VERIFICATION', 'Needs verification'], ['NOT_ELIGIBLE', 'Not eligible'],
];
const HEARING_OPTIONS: [CaseHearingState, string][] = [
  ['NOT_SCHEDULED', 'No hearing yet'], ['IN_PROGRESS', 'Proceeding open'], ['AWAITING_NEXT', 'Next stage due'], ['ENDED', 'Proceedings ended'],
];
const HEARING_STATE_COLOR: Record<CaseHearingState, string> = { NOT_SCHEDULED: '#64748b', IN_PROGRESS: '#0369a1', AWAITING_NEXT: '#4f46e5', ENDED: '#15803d' };
const tightChip = { fontSize: '0.68rem', '& .MuiChip-label': { px: 0.75 } };
const shortDate = (d: Date | string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });

/**
 * The blotter cases, for finding the one to schedule - with a hearing or not
 * yet. Each shows its Katarungang Pambarangay eligibility as the officials
 * recorded it (eligible, not eligible, or still to be reviewed - never
 * assumed) and what the official may do next with it.
 */
export default function HearingCasesTable({ caseBase, onCreate, onOpenHearing }: {
  caseBase: string;
  /** Open the Create Hearing dialog on this case - it also takes the eligibility review. */
  onCreate: (caseId: string) => void;
  onOpenHearing: (caseId: string, hearingId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [eligibility, setEligibility] = useState('');
  const [hearing, setHearing] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [claiming, setClaiming] = useState<string | null>(null);

  const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  if (q.trim()) params.set('q', q.trim());
  if (eligibility) params.set('eligibility', eligibility);
  if (hearing) params.set('hearing', hearing);
  const { data, error, isLoading, isValidating, mutate } = useSWR<CaseListData>(`/api/hearings/cases?${params}`, getJson, { keepPreviousData: true });
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const claim = async (r: HearingCaseRow) => {
    setClaiming(r.id);
    try { await send(`/api/cases/${r.id}/claim`, 'POST', {}); toast.success(`${r.caseNumber} is now assigned to you`); await mutate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not take the case'); } finally { setClaiming(null); }
  };

  return (
    <Box>
      <Typography sx={{ fontSize: '0.8rem', color: '#475569', mb: 1.5 }}>
        Every blotter case, scheduled or not. Eligibility for Katarungang Pambarangay proceedings is what an official recorded - the confirmed category
        and the eligibility review. A case is pending until it is reviewed, needs verification while a fact is unknown, and is not eligible only when an
        official recorded a legal exclusion. VAWC cases (RA 9262) are not listed.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 1fr auto' }, gap: 1, mb: 1.5 }}>
        <TextField size="small" placeholder="Case reference, complainant or respondent" value={q} onChange={e => filter(setQ)(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment> } }} />
        <TextField select size="small" label="Case status" value={status} onChange={e => filter(setStatus)(e.target.value)}>
          <MenuItem value="OPEN">Open cases</MenuItem>
          <MenuItem value="ANY">Any status</MenuItem>
          {(data?.statuses ?? []).map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="KP eligibility" value={eligibility} onChange={e => filter(setEligibility)(e.target.value)}>
          <MenuItem value="">Any</MenuItem>
          {ELIGIBILITY_OPTIONS.map(([k, l]) => <MenuItem key={k} value={k}>{l}{data ? ` (${data.counts.eligibility[k]})` : ''}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Hearing status" value={hearing} onChange={e => filter(setHearing)(e.target.value)}>
          <MenuItem value="">Any</MenuItem>
          {HEARING_OPTIONS.map(([k, l]) => <MenuItem key={k} value={k}>{l}{data ? ` (${data.counts.hearing[k]})` : ''}</MenuItem>)}
        </TextField>
        <Tooltip title="Reload"><IconButton onClick={() => mutate()} aria-label="Reload cases">{isValidating ? <CircularProgress size={20} /> : <Refresh />}</IconButton></Tooltip>
      </Box>

      {error && (
        <Alert severity={(error as { status?: number }).status === 403 ? 'info' : 'error'} sx={{ borderRadius: 2, mb: 1.5 }}
          action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>
      )}
      {isLoading && !data && <Skeleton variant="rounded" height={240} />}
      {data && !data.rows.length && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <FolderOpen sx={{ fontSize: 36, color: '#cbd5e1' }} />
          <Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>
            {q || eligibility || hearing || status !== 'OPEN' ? 'No blotter case matches these filters.' : 'No open blotter cases. Cases filed or recorded on the blotter desk appear here.'}
          </Typography>
        </Box>
      )}
      {data && data.rows.length > 0 && (
        <>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 940, '& td, & th': { px: 0.75 } }}>
              <TableHead>
                <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } }}>
                  <TableCell>Case reference</TableCell><TableCell>Complainant</TableCell><TableCell>Respondent</TableCell><TableCell>Case category</TableCell>
                  <TableCell>Date reported</TableCell><TableCell>Case status</TableCell><TableCell>KP eligibility</TableCell><TableCell>Hearing status</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map(r => (
                  <TableRow key={r.id} hover sx={{ '& td': { fontSize: '0.8rem', verticalAlign: 'top' } }}>
                    <TableCell>
                      <a href={`${caseBase}/${r.id}`} style={{ color: '#0369a1', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.caseNumber}</a>
                      <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                        {r.assignedTo ? (r.assignedTo.me ? 'Assigned to you' : `Assigned to ${r.assignedTo.name}`) : 'Unassigned'}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.complainant}</TableCell>
                    <TableCell>
                      {r.respondents.length ? r.respondents.map(p => (
                        <Box key={p.id}>{p.name}{p.hasAccount && <Chip size="small" label="SafeComm" sx={{ ...chipSx('#0f766e'), height: 18, ml: 0.5 }} />}</Box>
                      )) : <span style={{ color: '#b45309' }}>Not recorded</span>}
                    </TableCell>
                    <TableCell>
                      {r.caseType}
                      {!r.eligibility.categoryVerified && <Typography sx={{ fontSize: '0.7rem', color: '#b45309' }}>Category not confirmed</Typography>}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{shortDate(r.filedAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.status}</TableCell>
                    <TableCell>
                      <Tooltip title={r.eligibility.reasons.join(' ') || 'Reviewed by an official as eligible for barangay conciliation'}>
                        <Chip size="small" label={r.eligibility.label} sx={{ ...chipSx(ELIGIBILITY_COLOR[r.eligibility.state]), ...tightChip }} />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={r.hearing.label} sx={{ ...chipSx(HEARING_STATE_COLOR[r.hearing.state]), ...tightChip }} />
                      {r.hearing.latest && r.hearing.state === 'IN_PROGRESS' && (
                        <Typography sx={{ fontSize: '0.7rem', color: STATUS_COLOR[r.hearing.latest.status], mt: 0.25 }}>
                          {r.hearing.latest.title} · {r.hearing.latest.statusLabel} · {shortDate(r.hearing.latest.scheduledAt)}
                        </Typography>
                      )}
                      {r.hearing.state === 'AWAITING_NEXT' && r.next && <Typography sx={{ fontSize: '0.7rem', color: '#4f46e5', mt: 0.25 }}>Next: {r.next.title}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><RowAction r={r} claiming={claiming === r.id} onClaim={claim} onCreate={onCreate} onOpenHearing={onOpenHearing} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={data.total} page={data.page - 1} rowsPerPage={data.pageSize} rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_, p) => setPage(p + 1)} onRowsPerPageChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} />
          {data.truncated && <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Only the most recent cases are scanned - narrow the search to find older ones.</Typography>}
        </>
      )}
    </Box>
  );
}

/** What the official can do with this case now. */
function RowAction({ r, claiming, onClaim, onCreate, onOpenHearing }: {
  r: HearingCaseRow; claiming: boolean; onClaim: (r: HearingCaseRow) => void; onCreate: (caseId: string) => void; onOpenHearing: (caseId: string, hearingId: string) => void;
}) {
  const btn = { textTransform: 'none' as const, borderRadius: 2, px: 1, minWidth: 0, fontSize: '0.76rem' };
  if (!r.canManage) {
    if (r.canClaim) {
      return (
        <Button size="small" variant="outlined" onClick={() => onClaim(r)} disabled={claiming} sx={btn}>
          {claiming ? <CircularProgress size={14} /> : 'Take case'}
        </Button>
      );
    }
    return <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Managed by {r.assignedTo?.name ?? 'another official'}</Typography>;
  }
  if (r.hearing.state === 'IN_PROGRESS' && r.hearing.latest) {
    return <Button size="small" variant="outlined" onClick={() => onOpenHearing(r.id, r.hearing.latest!.id)} sx={btn}>View hearing</Button>;
  }
  if (r.hearing.state === 'ENDED' && r.hearing.latest) {
    return <Button size="small" onClick={() => onOpenHearing(r.id, r.hearing.latest!.id)} sx={btn}>View proceedings</Button>;
  }
  if (r.eligibility.state === 'ELIGIBLE' && r.next) {
    return <Button size="small" variant="contained" onClick={() => onCreate(r.id)} sx={{ ...btn, bgcolor: NAVY }}>Create hearing</Button>;
  }
  if (r.eligibility.state === 'NEEDS_VERIFICATION') return <Button size="small" variant="outlined" color="warning" onClick={() => onCreate(r.id)} sx={btn}>Continue review</Button>;
  if (r.eligibility.state === 'PENDING_REVIEW') return <Button size="small" variant="outlined" color="warning" onClick={() => onCreate(r.id)} sx={btn}>Review eligibility</Button>;
  if (r.eligibility.state === 'NOT_ELIGIBLE') return <Button size="small" color="error" onClick={() => onCreate(r.id)} sx={btn}>Why not eligible</Button>;
  return <Button size="small" onClick={() => onCreate(r.id)} sx={btn}>View case</Button>;
}
