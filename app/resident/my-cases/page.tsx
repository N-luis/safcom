'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton, TextField, InputAdornment, MenuItem, Select,
  FormControl, InputLabel, Dialog, DialogTitle, DialogContent,
  DialogActions, Divider, Fab, Tooltip,
} from '@mui/material';
import {
  Search, FolderOpen, Add, Assessment, CheckCircle, Autorenew,
  Warning, ArrowBack, CalendarToday, LocationOn,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';

const MotionTableRow = motion(TableRow);
import useSWR from 'swr';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const STATUS_COLOR: Record<string, string> = {
  Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#94a3b8',
};
const STATUS_BG: Record<string, string> = {
  Open: '#fff7ed', 'In Progress': '#eff6ff', Resolved: '#f0fdf4', Closed: '#f8fafc',
};

interface CaseRow {
  id: string; caseNumber: string; caseType: string; description: string;
  status: string; riskLevel: string; barangay: string; filedAt: string; updatedAt: string; notes: string | null;
}

interface CasesData {
  cases: CaseRow[]; total: number; page: number; limit: number; totalPages: number;
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CaseDetailDialog({ c, onClose }: { c: CaseRow; onClose: () => void }) {
  const color = STATUS_COLOR[c.status] ?? '#64748b';
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 800, color: '#0c1e46', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Assessment sx={{ color: '#14b8a6' }} />
          Case #{c.caseNumber}
          <Chip label={c.status} size="small" sx={{ bgcolor: STATUS_BG[c.status], color, fontWeight: 700, fontSize: '0.82rem', ml: 'auto' }} />
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {[
            { label: 'Case Type', value: c.caseType },
            { label: 'Risk Level', value: c.riskLevel },
            { label: 'Barangay', value: c.barangay },
            { label: 'Filed', value: new Date(c.filedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
            { label: 'Last Updated', value: timeAgo(c.updatedAt) },
          ].map(item => (
            <Grid key={item.label} size={{ xs: 6 }}>
              <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.25 }}>{item.label}</Typography>
              <Typography sx={{ fontSize: '0.94rem', color: '#0c1e46', fontWeight: 500 }}>{item.value}</Typography>
            </Grid>
          ))}
        </Grid>
        <Divider sx={{ mb: 2 }} />
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Description</Typography>
        <Typography sx={{ fontSize: '0.94rem', color: '#374151', lineHeight: 1.7, bgcolor: '#f8fafc', p: 2, borderRadius: 2 }}>
          {c.description}
        </Typography>
        {c.notes && (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Officer Notes</Typography>
            <Typography sx={{ fontSize: '0.94rem', color: '#374151', lineHeight: 1.7, bgcolor: '#fff7ed', p: 2, borderRadius: 2, border: '1px solid #fed7aa' }}>
              {c.notes}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} variant="contained" sx={{ bgcolor: '#14b8a6', '&:hover': { bgcolor: '#0d9488' }, borderRadius: 2 }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function MyCasesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  // The dashboard stat cards link here with ?status=, which may name a group
  // ("Resolved,Closed") so the list total matches the number that was clicked.
  // Seeded as the initial state rather than set from an effect: an effect would
  // render the unfiltered list first and then replace it.
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? '');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CaseRow | null>(null);

  const query = new URLSearchParams({ limit: '10', page: String(page), ...(statusFilter && { status: statusFilter }), ...(search && { search }) }).toString();
  const { data, isLoading } = useSWR<CasesData>(`/api/resident/cases?${query}`, fetcher, { keepPreviousData: true });

  const cases = data?.cases ?? [];
  const totalPages = data?.totalPages ?? 1;

  const statusCounts = { All: data?.total ?? 0 };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>My Cases</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>All reports you have submitted</Typography>
        </Box>
        <Button
          variant="contained" startIcon={<Add />}
          onClick={() => router.push('/resident/report-case')}
          sx={{ bgcolor: '#14b8a6', fontWeight: 600, borderRadius: 2, '&:hover': { bgcolor: '#0d9488' } }}
        >
          New Report
        </Button>
      </Box>

      {/* Status summary chips */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
        {[
          { label: 'All', value: '', count: data?.total ?? 0, color: '#0c1e46' },
          { label: 'Open', value: 'Open', count: null, color: '#f97316' },
          { label: 'In Progress', value: 'In Progress', count: null, color: '#3b82f6' },
          { label: 'Resolved', value: 'Resolved,Closed', count: null, color: '#22c55e' },
        ].map(s => (
          <Chip
            key={s.label}
            label={s.count != null ? `${s.label} (${s.count})` : s.label}
            onClick={() => { setStatusFilter(s.value); setPage(1); }}
            sx={{
              bgcolor: statusFilter === s.value ? `${s.color}18` : '#f1f5f9',
              color: statusFilter === s.value ? s.color : '#64748b',
              fontWeight: statusFilter === s.value ? 700 : 400,
              border: statusFilter === s.value ? `1px solid ${s.color}30` : '1px solid transparent',
              cursor: 'pointer', fontSize: '0.86rem',
              transition: 'all 0.15s',
            }}
          />
        ))}
      </Box>

      {/* Search */}
      <Box sx={{ mb: 2.5 }}>
        <TextField
          size="small" placeholder="Search by case number, type, or description…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          sx={{ width: { xs: '100%', sm: 380 } }}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18, color: '#94a3b8' }} /></InputAdornment>,
            },
          }}
        />
      </Box>

      {/* Table */}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', py: 1.3, borderBottom: '1px solid #f1f5f9' } }}>
                {['Case ID', 'Type', 'Description', 'Barangay', 'Status', 'Filed', 'Updated'].map(h => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <AnimatePresence>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <TableCell key={j}><Skeleton variant="text" width={70} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : cases.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ textAlign: 'center', py: 5 }}>
                          <FolderOpen sx={{ fontSize: 40, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                          <Typography sx={{ fontSize: '0.94rem', color: '#94a3b8', fontWeight: 500 }}>No cases found</Typography>
                          {!search && !statusFilter && (
                            <Button size="small" onClick={() => router.push('/resident/report-case')} sx={{ mt: 1, color: '#14b8a6', fontWeight: 600 }}>
                              File your first report →
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  : cases.map((c, i) => (
                      <MotionTableRow
                        key={c.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => setSelected(c)}
                        sx={{ cursor: 'pointer', '& td': { py: 1.3, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#f8fafc' } }}
                      >
                        <TableCell><Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography></TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#374151' }}>{c.caseType.split(' ').slice(0, 2).join(' ')}</Typography></TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.86rem', color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.description}
                          </Typography>
                        </TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.barangay}</Typography></TableCell>
                        <TableCell>
                          <Chip
                            label={c.status}
                            size="small"
                            sx={{ bgcolor: STATUS_BG[c.status], color: STATUS_COLOR[c.status] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }}
                          />
                        </TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>{new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Typography></TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>{timeAgo(c.updatedAt)}</Typography></TableCell>
                      </MotionTableRow>
                    ))
                }
              </AnimatePresence>
            </TableBody>
          </Table>
        </TableContainer>

        {totalPages > 1 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.75, borderTop: '1px solid #f1f5f9' }}>
            <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>Page {page} of {totalPages}</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" disabled={page === 1} onClick={() => setPage(p => p - 1)} sx={{ minWidth: 60 }}>Prev</Button>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} sx={{ minWidth: 60 }}>Next</Button>
            </Box>
          </Box>
        )}
      </Card>

      {selected && <CaseDetailDialog c={selected} onClose={() => setSelected(null)} />}

      <Tooltip title="File a New Report" placement="left">
        <Fab onClick={() => router.push('/resident/report-case')} sx={{ position: 'fixed', bottom: 28, right: 28, bgcolor: '#14b8a6', '&:hover': { bgcolor: '#0d9488' }, boxShadow: '0 8px 24px rgba(20,184,166,0.45)' }}>
          <Add />
        </Fab>
      </Tooltip>
    </Box>
  );
}

/**
 * useSearchParams bails out of static prerendering, so the page that uses it
 * must sit behind a Suspense boundary - without this the production build
 * fails on "/resident/my-cases" even though it runs fine in dev.
 */
export default function MyCasesPageWrapper() {
  return (
    <Suspense fallback={
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Skeleton variant="text" width={200} height={38} />
        <Skeleton variant="rounded" height={320} sx={{ mt: 2 }} />
      </Box>
    }>
      <MyCasesPage />
    </Suspense>
  );
}
