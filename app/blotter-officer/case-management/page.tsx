'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, InputAdornment,
  Select, MenuItem, FormControl, InputLabel, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, IconButton, Tooltip, Skeleton,
  Divider, Paper,
  Drawer, Tab, Tabs, Fade,
} from '@mui/material';
import {
  Add, Search, FilterList, Visibility, Edit, FolderOpen,
  CheckCircle, Warning, Circle, RefreshOutlined, LocationOn, Person,
  AccessTime, ArrowBack, Save, OpenInNew,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useCases, useCaseStats } from '@/hooks/useApi';
import { mutate } from 'swr';
import toast from 'react-hot-toast';

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];

const STATUS_COLOR: Record<string, string> = { Open: '#f97316', 'In Progress': '#22c55e', Resolved: '#3b82f6', Closed: '#94a3b8' };
const RISK_COLOR: Record<string, string> = { High: '#ef4444', Critical: '#8b5cf6', Medium: '#f97316', Low: '#22c55e' };

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString();
}

interface CaseRow {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; description: string;
  notes?: string; filedAt: string; assignedTo?: { name: string } | null;
}

function CaseDrawer({ c, open, onClose }: { c: CaseRow | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [editStatus, setEditStatus] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (!c) return null;

  const trimmedNote = note.trim();
  const statusChanged = !!editStatus && editStatus !== c.status;
  const hasChanges = statusChanged || trimmedNote.length > 0;

  const saveChanges = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (statusChanged) payload.status = editStatus;
      if (trimmedNote) {
        payload.notes = c.notes
          ? `${c.notes}\n\n[${new Date().toLocaleString()}] ${trimmedNote}`
          : `[${new Date().toLocaleString()}] ${trimmedNote}`;
      }

      const res = await fetch(`/api/cases/${c.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to update case');

      toast.success('Case updated successfully');
      setNote('');
      setEditStatus('');
      mutate(key => typeof key === 'string' && key.includes('/api/cases'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update case');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 }, p: 0 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2.5, borderBottom: '1px solid #f1f5f9' }}>
        <IconButton size="small" onClick={onClose} sx={{ mr: 1 }}><ArrowBack fontSize="small" /></IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.98rem' }}>{c.caseNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{c.caseType}</Typography>
        </Box>
        <Chip
          label={c.riskLevel}
          size="small"
          sx={{ bgcolor: `${RISK_COLOR[c.riskLevel]}20`, color: RISK_COLOR[c.riskLevel], fontWeight: 700, fontSize: '0.82rem' }}
        />
        <Tooltip title="Open full detail view">
          <IconButton
            size="small"
            onClick={() => { onClose(); router.push(`/blotter-officer/case-management/${c.id}`); }}
            sx={{ ml: 0.5 }}
          >
            <OpenInNew sx={{ fontSize: 16, color: '#64748b' }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: '1px solid #f1f5f9', '& .MuiTab-root': { fontSize: '0.9rem', minHeight: 40, textTransform: 'none', fontWeight: 500 } }}>
        <Tab label="Details" />
        <Tab label="Update" />
      </Tabs>

      <Box sx={{ p: 2.5, overflow: 'auto', flex: 1 }}>
        {tab === 0 && (
          <Box>
            {[
              { label: 'Reporter / Subject', value: c.residentName, icon: Person },
              { label: 'Street', value: c.barangay, icon: LocationOn },
              { label: 'Filed', value: new Date(c.filedAt).toLocaleString(), icon: AccessTime },
              { label: 'Assigned To', value: c.assignedTo?.name || 'Unassigned', icon: Person },
            ].map(({ label, value, icon: Icon }) => (
              <Box key={label} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon sx={{ fontSize: 16, color: '#64748b' }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.1 }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.94rem', fontWeight: 500 }}>{value}</Typography>
                </Box>
              </Box>
            ))}
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.5 }}>Status</Typography>
              <Chip label={c.status} size="small" sx={{ bgcolor: `${STATUS_COLOR[c.status]}20`, color: STATUS_COLOR[c.status], fontWeight: 600 }} />
            </Box>
            <Divider sx={{ my: 2 }} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, mb: 1 }}>Description</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
              <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#475569' }}>{c.description}</Typography>
            </Paper>
            {c.notes && (
              <Box sx={{ mt: 2 }}>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, mb: 1 }}>Notes</Typography>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fefce8' }}>
                  <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#78350f' }}>{c.notes}</Typography>
                </Paper>
              </Box>
            )}
          </Box>
        )}
        {tab === 1 && (
          <Box>
            <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, mb: 0.5 }}>Update Case</Typography>
            <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 2 }}>
              Change the case status and/or add a note. Both are saved together to the case record and an activity log entry is created when the status changes.
            </Typography>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Status</InputLabel>
              <Select value={editStatus || c.status} label="Status" onChange={e => setEditStatus(e.target.value)} sx={{ borderRadius: 2 }}>
                {STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              fullWidth label="Add a note (optional)" multiline rows={4} size="small"
              placeholder="Investigation update, follow-up action, resolution summary, etc."
              value={note} onChange={e => setNote(e.target.value)}
              helperText={c.notes ? 'New notes are appended to the existing case notes with a timestamp.' : undefined}
              sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Button
              fullWidth variant="contained" startIcon={<Save />}
              onClick={saveChanges}
              disabled={saving || !hasChanges}
              sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}

export default function CaseManagementPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [page, setPage] = useState(1);
  const [drawerCase, setDrawerCase] = useState<CaseRow | null>(null);
  const [autoOpenTarget, setAutoOpenTarget] = useState<string | null>(null);

  // Deep-link support: dashboard cards/links navigate here with ?caseNumber=, ?search=, ?status=, ?riskLevel=
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cn = sp.get('caseNumber');
    const q = sp.get('search');
    const st = sp.get('status');
    const risk = sp.get('riskLevel');
    if (cn) { setSearch(cn); setAutoOpenTarget(cn); }
    else if (q) setSearch(q);
    if (st) setStatusFilter(st);
    if (risk) setRiskFilter(risk);
  }, []);

  const params = useMemo(() => {
    const p: Record<string, string | number> = { limit: 10, page, sortBy: 'riskLevel', sortDir: 'desc' };
    if (search) p.search = search;
    if (statusFilter) p.status = statusFilter;
    if (riskFilter) p.riskLevel = riskFilter;
    return p;
  }, [search, statusFilter, riskFilter, page]);

  const { data, isLoading } = useCases(params);
  const { data: stats } = useCaseStats();

  const cases: CaseRow[] = data?.cases ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.totalPages ?? 1;

  useEffect(() => {
    if (!autoOpenTarget) return;
    const match = cases.find(c => c.caseNumber === autoOpenTarget);
    if (match) { setDrawerCase(match); setAutoOpenTarget(null); }
  }, [autoOpenTarget, cases]);

  const statusSummary = [
    { label: 'Open', count: stats?.open ?? 0, color: '#f97316' },
    { label: 'In Progress', count: stats?.inProgress ?? 0, color: '#22c55e' },
    { label: 'Resolved', count: stats?.resolved ?? 0, color: '#3b82f6' },
    { label: 'Closed', count: stats?.closed ?? 0, color: '#94a3b8' },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Case Management</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Manage, track and resolve blotter cases</Typography>
        </Box>
        <Button
          variant="contained" startIcon={<Add />}
          onClick={() => router.push('/blotter-officer/walk-in-report')}
          sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' }, fontWeight: 600 }}
        >
          New Case
        </Button>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statusSummary.map((s, i) => (
          <Grid size={{ xs: 6, sm: 3 }} key={s.label}>
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
              <Card
                sx={{ cursor: 'pointer', transition: 'all 0.2s', border: statusFilter === s.label ? `2px solid ${s.color}` : '2px solid transparent', '&:hover': { boxShadow: `0 4px 16px ${s.color}30` } }}
                onClick={() => setStatusFilter(prev => prev === s.label ? '' : s.label)}
              >
                <CardContent sx={{ p: 2, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: s.color }}>{s.count}</Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', fontWeight: 500 }}>{s.label}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Filter bar */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small" placeholder="Search by name, case ID, type…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment> } }}
              sx={{ flex: 1, minWidth: 200, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={e => { setStatusFilter(e.target.value); setPage(1); }} sx={{ borderRadius: 2 }}>
                <MenuItem value="">All</MenuItem>
                {STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Risk</InputLabel>
              <Select value={riskFilter} label="Risk" onChange={e => { setRiskFilter(e.target.value); setPage(1); }} sx={{ borderRadius: 2 }}>
                <MenuItem value="">All</MenuItem>
                {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </Select>
            </FormControl>
            {(search || statusFilter || riskFilter) && (
              <Button size="small" variant="outlined" onClick={() => { setSearch(''); setStatusFilter(''); setRiskFilter(''); setPage(1); }} sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b' }}>
                Clear
              </Button>
            )}
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={() => mutate(key => typeof key === 'string' && key.includes('/api/cases'))} sx={{ ml: 'auto' }}>
                <RefreshOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.5, borderBottom: '1px solid #f1f5f9' } }}>
                {['Case ID', 'Reporter / Subject', 'Type', 'Street', 'Status', 'Risk', 'Filed', 'Actions'].map(h => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton variant="text" width={70} /></TableCell>)}</TableRow>
              )) : cases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5 }}>
                    <FolderOpen sx={{ fontSize: 36, color: '#cbd5e1', mb: 1, display: 'block', mx: 'auto' }} />
                    <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>No cases found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                cases.map((c) => (
                  <TableRow key={c.id} sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, '& td': { py: 1.25, borderBottom: '1px solid #f8fafc' } }} onClick={() => setDrawerCase(c)}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', flexShrink: 0 }}>
                          {c.residentName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </Box>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{c.residentName}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.9rem' }}>{c.caseType}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>{c.barangay}</Typography></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STATUS_COLOR[c.status] ?? '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.86rem', color: STATUS_COLOR[c.status], fontWeight: 600 }}>{c.status}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip label={c.riskLevel} size="small" sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#94a3b8'}18`, color: RISK_COLOR[c.riskLevel] ?? '#94a3b8', fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>{timeAgo(c.filedAt)}</Typography></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Quick view / Edit">
                          <IconButton size="small" onClick={e => { e.stopPropagation(); setDrawerCase(c); }}>
                            <Visibility sx={{ fontSize: 15, color: '#94a3b8' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Full detail view">
                          <IconButton size="small" onClick={e => { e.stopPropagation(); router.push(`/blotter-officer/case-management/${c.id}`); }}>
                            <OpenInNew sx={{ fontSize: 15, color: '#94a3b8' }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Pagination */}
        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>
            Page {page} of {totalPages} · {total} total cases
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage(p => p - 1)} sx={{ borderRadius: 1.5, fontSize: '0.86rem', borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}>
              Previous
            </Button>
            <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} sx={{ borderRadius: 1.5, fontSize: '0.86rem', borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}>
              Next
            </Button>
          </Box>
        </Box>
      </Card>

      <CaseDrawer c={drawerCase} open={!!drawerCase} onClose={() => setDrawerCase(null)} />
    </Box>
  );
}
