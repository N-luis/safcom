'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, Chip, Button, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton, Dialog, DialogTitle, DialogContent, DialogActions,
  Grid, Divider, Select, MenuItem, FormControl, InputLabel,
  Alert, CircularProgress, Tooltip,
} from '@mui/material';
import {
  Search, Add, FolderOpen, Assessment, LocationOn, CalendarToday,
  Edit, CheckCircle, Close, AutoAwesome,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import { VAWC_TYPES } from '@/lib/vawcTypes';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const STATUS_COLOR: Record<string, string> = { Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#94a3b8' };
const STATUS_BG: Record<string, string> = { Open: '#fff7ed', 'In Progress': '#eff6ff', Resolved: '#f0fdf4', Closed: '#f8fafc' };
const RISK_COLOR: Record<string, string> = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' };
const RISK_BG: Record<string, string> = { Critical: '#fef2f2', High: '#fff7ed', Medium: '#fffbeb', Low: '#f0fdf4' };
const ACCENT = '#7c3aed';

interface CaseRow {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; description: string;
  notes: string | null; filedAt: string; updatedAt: string;
  assignedTo: { name: string } | null;
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

const MotionTableRow = motion(TableRow);

// ─── Case Detail/Edit Dialog ──────────────────────────────────────────────────
function CaseDialog({ c, onClose, onSaved }: { c: CaseRow; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(c.status);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/vawc/cases/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, notes }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Update failed'); setSaving(false); return; }
      const newRisk = j.data?.riskLevel as string | undefined;
      toast.success(
        newRisk && newRisk !== c.riskLevel
          ? `Case updated — AI re-flagged risk: ${c.riskLevel} → ${newRisk}`
          : 'Case updated'
      );
      onSaved();
      setEditing(false);
    } catch { setErr('Network error'); }
    setSaving(false);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 800, color: '#0c1e46', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Assessment sx={{ color: ACCENT }} />
          Case #{c.caseNumber}
          <Chip label={c.status} size="small" sx={{ bgcolor: STATUS_BG[c.status], color: STATUS_COLOR[c.status] ?? '#64748b', fontWeight: 700, fontSize: '0.82rem', ml: 'auto' }} />
        </Box>
      </DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{err}</Alert>}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {[
            { label: 'Subject Name', value: c.residentName },
            { label: 'Case Type', value: c.caseType },
            { label: 'Street/Barangay', value: c.barangay },
            { label: 'Filed', value: new Date(c.filedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
            { label: 'Last Updated', value: timeAgo(c.updatedAt) },
            { label: 'Assigned To', value: c.assignedTo?.name ?? '—' },
          ].map(item => (
            <Grid key={item.label} size={{ xs: 6 }}>
              <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.25 }}>{item.label}</Typography>
              <Typography sx={{ fontSize: '0.94rem', color: '#0c1e46', fontWeight: 500 }}>{item.value}</Typography>
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ mb: 2 }} />
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Description</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7, bgcolor: '#f8fafc', p: 1.75, borderRadius: 2, mb: 2 }}>{c.description}</Typography>

        {editing ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={status} onChange={e => setStatus(e.target.value)} label="Status">
                  {['Open', 'In Progress', 'Resolved', 'Closed'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, mb: 0.5 }}>Risk Level</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: 40 }}>
                <Chip label={c.riskLevel} size="small" sx={{ bgcolor: RISK_BG[c.riskLevel], color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.82rem' }} />
                <Tooltip title="Risk level is set by SafComm AI and is automatically re-analyzed every time this case is updated — it is not editable manually.">
                  <AutoAwesome sx={{ fontSize: 15, color: '#94a3b8' }} />
                </Tooltip>
              </Box>
            </Grid>
            <Grid size={12}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1.25, mb: 0.5, borderRadius: 2, border: '1px dashed #c4b5fd', bgcolor: '#faf5ff' }}>
                <AutoAwesome sx={{ color: ACCENT, fontSize: 16, mt: 0.15 }} />
                <Typography sx={{ fontSize: '0.82rem', color: '#6d28d9', lineHeight: 1.55 }}>
                  Saving will trigger SafComm AI to re-analyze and re-flag this case&apos;s risk level based on its updated status, case age, and incident history.
                </Typography>
              </Box>
            </Grid>
            <Grid size={12}>
              <TextField label="Officer Notes" multiline rows={3} fullWidth size="small"
                value={notes} onChange={e => setNotes(e.target.value)} />
            </Grid>
          </Grid>
        ) : c.notes ? (
          <Box>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Officer Notes</Typography>
            <Typography sx={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.7, bgcolor: '#fff7ed', p: 1.75, borderRadius: 2, border: '1px solid #fed7aa' }}>{c.notes}</Typography>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        {editing ? (
          <>
            <Button onClick={() => setEditing(false)} startIcon={<Close sx={{ fontSize: 15 }} />} sx={{ color: '#64748b' }}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={saving} startIcon={<CheckCircle sx={{ fontSize: 15 }} />}
              sx={{ bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' }, borderRadius: 2 }}>
              {saving ? <CircularProgress size={16} color="inherit" /> : 'Save Changes'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} sx={{ color: '#64748b' }}>Close</Button>
            <Button variant="contained" onClick={() => setEditing(true)} startIcon={<Edit sx={{ fontSize: 15 }} />}
              sx={{ bgcolor: ACCENT, '&:hover': { bgcolor: '#6d28d9' }, borderRadius: 2 }}>
              Edit Case
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ─── Filter presets ───────────────────────────────────────────────────────────
// Each dashboard stat card links here with ?filter=<key>. A preset exists because
// some cards count a GROUP of values as one number, which the single-value Status
// and Risk dropdowns cannot express - so the preset drives the query instead and
// says so on screen, keeping the list total equal to the number that was clicked.
const PRESETS: Record<string, { label: string; params: Record<string, string>; bg: string; fg: string }> = {
  urgent: {
    label: 'Urgent only (High/Critical, unresolved)',
    params: { urgent: 'true' }, bg: '#fef2f2', fg: '#ef4444',
  },
  'high-risk': {
    label: 'High-risk cases (High + Critical)',
    params: { risk: 'High,Critical' }, bg: '#fef2f2', fg: '#ef4444',
  },
  active: {
    label: 'Active interventions (In Progress)',
    params: { status: 'In Progress' }, bg: '#eff6ff', fg: '#3b82f6',
  },
  resolved: {
    label: 'Resolved cases (Resolved + Closed)',
    params: { status: 'Resolved,Closed' }, bg: '#f0fdf4', fg: '#22c55e',
  },
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VawcCasesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CaseRow | null>(null);
  const [preset, setPreset] = useState('');
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Deep-link support: dashboard links navigate here with ?highlight=,
  // ?filter=<preset key>, ?riskLevel=, ?status=, ?search=
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const hl = sp.get('highlight');
    const f = sp.get('filter');
    const riskParam = sp.get('riskLevel');
    const statusParam = sp.get('status');
    const searchParam = sp.get('search');
    if (hl) setHighlightId(hl);
    if (f && PRESETS[f]) setPreset(f);
    // Single-value deep links still drive the dropdowns directly; a preset wins
    // because it can express groups the dropdowns cannot.
    if (riskParam) setRisk(riskParam);
    if (statusParam) setStatus(statusParam);
    if (searchParam) setSearch(searchParam);
  }, []);

  const query = new URLSearchParams({
    limit: '15', page: String(page),
    ...(preset ? PRESETS[preset].params : { ...(status && { status }), ...(risk && { risk }) }),
    ...(type && { type }), ...(search && { search }),
  }).toString();

  const { data, isLoading, mutate } = useSWR<{ cases: CaseRow[]; total: number; totalPages: number }>(
    `/api/vawc/cases?${query}`, fetcher, { keepPreviousData: true }
  );

  // Auto-open the highlighted case once it's loaded (deep-link from dashboard urgent-cases row)
  useEffect(() => {
    if (!highlightId || !data?.cases?.length) return;
    const match = data.cases.find(c => c.id === highlightId);
    if (match) { setSelected(match); setHighlightId(null); }
  }, [highlightId, data]);

  const cases = data?.cases ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <Box sx={{ maxWidth: 1280 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Case Monitoring</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>All VAWC cases — track, update, and manage interventions</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => router.push('/vawc/walk-in')}
          sx={{ bgcolor: ACCENT, fontWeight: 600, borderRadius: 2, '&:hover': { bgcolor: '#6d28d9' } }}>
          New Case
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {preset && PRESETS[preset] && (
          <Chip
            label={PRESETS[preset].label}
            onDelete={() => { setPreset(''); setPage(1); }}
            sx={{ bgcolor: PRESETS[preset].bg, color: PRESETS[preset].fg, fontWeight: 700, fontSize: '0.86rem' }}
          />
        )}
        <TextField size="small" placeholder="Search name, case no…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          sx={{ width: { xs: '100%', sm: 260 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17, color: '#94a3b8' }} /></InputAdornment> } }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }} disabled={!!preset}>
          <InputLabel>Status</InputLabel>
          <Select value={preset ? '' : status} onChange={e => { setStatus(e.target.value); setPage(1); }} label="Status">
            <MenuItem value="">All</MenuItem>
            {['Open', 'In Progress', 'Resolved', 'Closed'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }} disabled={!!preset}>
          <InputLabel>Risk Level</InputLabel>
          <Select value={preset ? '' : risk} onChange={e => { setRisk(e.target.value); setPage(1); }} label="Risk Level">
            <MenuItem value="">All</MenuItem>
            {['Critical', 'High', 'Medium', 'Low'].map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Case Type</InputLabel>
          <Select value={type} onChange={e => { setType(e.target.value); setPage(1); }} label="Case Type">
            <MenuItem value="">All</MenuItem>
            {VAWC_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', py: 1.3, borderBottom: '1px solid #f1f5f9' } }}>
                {['Case ID', 'Subject', 'Type', 'Street/Barangay', 'Risk', 'Status', 'Filed', 'Updated'].map(h => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <AnimatePresence>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell key={j}><Skeleton variant="text" width={70} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : cases.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5 }}>
                          <FolderOpen sx={{ fontSize: 40, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                          <Typography sx={{ fontSize: '0.94rem', color: '#94a3b8' }}>No VAWC cases found</Typography>
                          <Button size="small" onClick={() => router.push('/vawc/walk-in')} sx={{ mt: 1, color: ACCENT, fontWeight: 600 }}>
                            File a new case →
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  : cases.map((c, i) => (
                      <MotionTableRow key={c.id}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                        onClick={() => setSelected(c)}
                        sx={{ cursor: 'pointer', '& td': { py: 1.3, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#fafbfc' } }}
                      >
                        <TableCell><Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography></TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: '#0c1e46' }}>{c.residentName}</Typography>
                        </TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#64748b', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseType}</Typography></TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <LocationOn sx={{ fontSize: 13, color: '#94a3b8' }} />
                            <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.barangay}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip label={c.riskLevel} size="small"
                            sx={{ bgcolor: RISK_BG[c.riskLevel], color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                        </TableCell>
                        <TableCell>
                          <Chip label={c.status} size="small"
                            sx={{ bgcolor: STATUS_BG[c.status], color: STATUS_COLOR[c.status] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CalendarToday sx={{ fontSize: 12, color: '#94a3b8' }} />
                            <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{timeAgo(c.updatedAt)}</Typography></TableCell>
                      </MotionTableRow>
                    ))
                }
              </AnimatePresence>
            </TableBody>
          </Table>
        </TableContainer>

        {totalPages > 1 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.75, borderTop: '1px solid #f1f5f9' }}>
            <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>Page {page} of {totalPages} · {data?.total} cases</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" disabled={page === 1} onClick={() => setPage(p => p - 1)} sx={{ minWidth: 60 }}>Prev</Button>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} sx={{ minWidth: 60 }}>Next</Button>
            </Box>
          </Box>
        )}
      </Card>

      {selected && (
        <CaseDialog c={selected} onClose={() => setSelected(null)} onSaved={() => { mutate(); setSelected(null); }} />
      )}
    </Box>
  );
}
