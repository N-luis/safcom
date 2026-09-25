'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Grid, Typography, Card, CardContent, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TablePagination,
  Button, TextField, InputAdornment, LinearProgress, Skeleton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Tooltip, IconButton,
  Menu, MenuItem as MuiMenuItem,
} from '@mui/material';
import { Search, Add, FileDownload, Assessment, MoreVert, Visibility, Edit, Delete } from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useReports, useReportStats } from '@/hooks/useApi';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { mutate } from 'swr';

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  Approved: { color: '#16a34a', bg: '#dcfce7' },
  'Under Review': { color: '#d97706', bg: '#fef3c7' },
  Pending: { color: '#9333ea', bg: '#f3e8ff' },
  Rejected: { color: '#dc2626', bg: '#fee2e2' },
};

const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Medium: '#f97316', Low: '#22c55e' };

const CATEGORIES = ['Incident Report', 'Assessment', 'Risk Assessment', 'Statistical Report', 'Intervention', 'Program Report', 'Compliance Report', 'Monitoring Report'];

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [statusFilter, setStatusFilter] = useState('');
  const [newReportOpen, setNewReportOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuReport, setMenuReport] = useState<Record<string, unknown> | null>(null);
  const [viewReport, setViewReport] = useState<Record<string, unknown> | null>(null);
  const [editReport, setEditReport] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading, mutate: mutateReports } = useReports({
    page: page + 1,
    limit: rowsPerPage,
    ...(search ? { search } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  const { data: stats } = useReportStats();

  const reports: Record<string, unknown>[] = data?.reports ?? [];
  const total: number = data?.pagination?.total ?? 0;

  const summaryCards = [
    { label: 'Total Reports', value: stats?.total ?? 0, color: '#3b82f6', pct: 100 },
    { label: 'Approved', value: stats?.approved ?? 0, color: '#22c55e', pct: stats?.total ? Math.round(((stats.approved ?? 0) / stats.total) * 100) : 0 },
    { label: 'Under Review', value: stats?.underReview ?? 0, color: '#f97316', pct: stats?.total ? Math.round(((stats.underReview ?? 0) / stats.total) * 100) : 0 },
    { label: 'Pending', value: stats?.pending ?? 0, color: '#eab308', pct: stats?.total ? Math.round(((stats.pending ?? 0) / stats.total) * 100) : 0 },
  ];

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch('/api/reports?limit=1000&sortBy=createdAt&sortDir=desc');
      const json = await res.json();
      const all: Record<string, unknown>[] = json.data?.reports ?? [];

      const headers = ['Report #', 'Title', 'Category', 'Status', 'Priority', 'Submitted By', 'Date'];
      const rows = all.map(r => [
        r.reportNumber, r.title, r.category, r.status, r.priority,
        (r.submittedBy as { name: string } | null)?.name ?? 'N/A',
        new Date(r.createdAt as string).toLocaleDateString(),
      ]);

      const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `safcom-reports-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Reports exported as CSV');
    } catch {
      toast.error('Export failed');
    }
  }, []);

  async function deleteReport(id: string) {
    await fetch(`/api/reports/${id}`, { method: 'DELETE' });
    mutateReports();
    mutate('/api/reports/stats');
    setMenuAnchor(null);
    toast.success('Report deleted');
  }

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Reports</Typography>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>Manage and review all submitted reports</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" startIcon={<FileDownload />} sx={{ borderRadius: 2.5, textTransform: 'none' }} onClick={handleExport}>
              Export CSV
            </Button>
            <Button variant="contained" startIcon={<Add />} sx={{ borderRadius: 2.5, textTransform: 'none' }} onClick={() => setNewReportOpen(true)}>
              New Report
            </Button>
          </Box>
        </Box>

        {/* Summary cards */}
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          {summaryCards.map((card, i) => (
            <Grid size={{ xs: 6, md: 3 }} key={card.label}>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                  <CardContent>
                    <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">{card.label}</Typography>
                    {isLoading ? (
                      <Skeleton width={60} height={48} />
                    ) : (
                      <Typography variant="h4" sx={{ fontWeight: 800, mb: 1.5, mt: 0.5, color: card.color }}>{card.value}</Typography>
                    )}
                    <LinearProgress
                      variant="determinate" value={card.pct}
                      sx={{ borderRadius: 4, height: 6, bgcolor: `${card.color}20`,
                        '& .MuiLinearProgress-bar': { bgcolor: card.color, borderRadius: 4 } }}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </Grid>

        {/* Table */}
        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>All Reports</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Status</InputLabel>
                  <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }} label="Status" sx={{ borderRadius: 2 }}>
                    <MenuItem value="">All Statuses</MenuItem>
                    {['Pending', 'Under Review', 'Approved', 'Rejected'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  size="small" placeholder="Search reports..."
                  value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>,
                      sx: { borderRadius: 2.5 },
                    },
                  }}
                />
              </Box>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', bgcolor: 'action.hover', py: 1.2 } }}>
                    <TableCell>Report</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Submitted By</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {isLoading ? (
                    [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(7)].map((_, j) => <TableCell key={j}><Skeleton height={32} /></TableCell>)}
                      </TableRow>
                    ))
                  ) : reports.map((r) => {
                    const sc = STATUS_COLORS[(r.status as string)] ?? { color: '#6b7280', bg: '#f3f4f6' };
                    return (
                      <TableRow key={r.id as string} sx={{ '&:hover': { bgcolor: 'action.hover' }, '& td': { py: 1.5, fontSize: '0.9rem' } }}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: 'primary.light', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Assessment sx={{ fontSize: 16, color: 'primary.dark' }} />
                            </Box>
                            <Box>
                              <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.title as string}</Typography>
                              <Typography sx={{ fontSize: '0.78rem' }} color="text.secondary">{r.reportNumber as string}</Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>{r.category as string}</TableCell>
                        <TableCell>
                          <Chip label={r.status as string} size="small" sx={{ bgcolor: sc.bg, color: sc.color, fontWeight: 700, fontSize: '0.78rem' }} />
                        </TableCell>
                        <TableCell>
                          <Chip label={r.priority as string} size="small"
                            sx={{ bgcolor: `${PRIORITY_COLORS[r.priority as string] ?? '#6b7280'}18`, color: PRIORITY_COLORS[r.priority as string] ?? '#6b7280', fontWeight: 700, fontSize: '0.78rem' }} />
                        </TableCell>
                        <TableCell>{(r.submittedBy as { name: string } | null)?.name ?? '—'}</TableCell>
                        <TableCell>{new Date(r.createdAt as string).toLocaleDateString()}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={e => { setMenuAnchor(e.currentTarget); setMenuReport(r); }}>
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div" count={total} page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
              rowsPerPageOptions={[5, 10, 25]}
            />
          </CardContent>
        </Card>
      </Box>

      {/* Row action menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)} slotProps={{ paper: { elevation: 4, sx: { borderRadius: 2 } } }}>
        <MuiMenuItem onClick={() => { setViewReport(menuReport); setMenuAnchor(null); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Visibility fontSize="small" /> View Details
        </MuiMenuItem>
        <MuiMenuItem onClick={() => { setEditReport(menuReport); setMenuAnchor(null); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Edit fontSize="small" /> Edit Report
        </MuiMenuItem>
        <MuiMenuItem onClick={() => menuReport && deleteReport(menuReport.id as string)} sx={{ gap: 1.5, fontSize: '0.94rem', color: 'error.main' }}>
          <Delete fontSize="small" /> Delete
        </MuiMenuItem>
      </Menu>

      {/* View report modal */}
      {viewReport && (
        <Dialog open={Boolean(viewReport)} onClose={() => setViewReport(null)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}>{viewReport.title as string}</DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={viewReport.status as string} size="small" sx={{ bgcolor: STATUS_COLORS[viewReport.status as string]?.bg, color: STATUS_COLORS[viewReport.status as string]?.color, fontWeight: 700 }} />
              <Chip label={viewReport.priority as string} size="small" sx={{ bgcolor: `${PRIORITY_COLORS[viewReport.priority as string]}18`, color: PRIORITY_COLORS[viewReport.priority as string], fontWeight: 700 }} />
              <Chip label={viewReport.category as string} size="small" variant="outlined" />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Box><Typography sx={{ fontSize: '0.86rem', fontWeight: 600 }} color="text.secondary">Report #</Typography><Typography sx={{ fontSize: '0.94rem' }}>{viewReport.reportNumber as string}</Typography></Box>
              <Box><Typography sx={{ fontSize: '0.86rem', fontWeight: 600 }} color="text.secondary">Submitted By</Typography><Typography sx={{ fontSize: '0.94rem' }}>{(viewReport.submittedBy as { name: string } | null)?.name ?? '—'}</Typography></Box>
              <Box><Typography sx={{ fontSize: '0.86rem', fontWeight: 600 }} color="text.secondary">Date Filed</Typography><Typography sx={{ fontSize: '0.94rem' }}>{new Date(viewReport.createdAt as string).toLocaleString()}</Typography></Box>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, mb: 0.5 }} color="text.secondary">Content</Typography>
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                <Typography sx={{ fontSize: '0.94rem', lineHeight: 1.7 }}>{viewReport.content as string}</Typography>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setViewReport(null)} sx={{ borderRadius: 2, textTransform: 'none' }}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* New Report modal */}
      <NewReportDialog
        open={newReportOpen}
        onClose={() => setNewReportOpen(false)}
        onCreated={() => { mutateReports(); mutate('/api/reports/stats'); }}
      />

      {/* Edit Report modal */}
      <EditReportDialog
        report={editReport}
        onClose={() => setEditReport(null)}
        onSaved={() => { mutateReports(); mutate('/api/reports/stats'); }}
      />
    </DashboardLayout>
  );
}

function NewReportDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', category: '', priority: 'Medium', content: '' });
  const [saving, setSaving] = useState(false);

  function setField(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function submit() {
    if (!form.title.trim() || !form.category || !form.content.trim()) {
      toast.error('Please fill all required fields');
      return;
    }
    setSaving(true);
    try {
      const reportNumber = `RPT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, reportNumber, status: 'Pending' }),
      });
      if (res.ok) {
        toast.success('Report submitted!');
        setForm({ title: '', category: '', priority: 'Medium', content: '' });
        onCreated();
        onClose();
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Failed to create report');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>New Report</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        <TextField label="Report Title" fullWidth size="small" required value={form.title} onChange={e => setField('title', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small" required>
            <InputLabel>Category</InputLabel>
            <Select value={form.category} onChange={e => setField('category', e.target.value)} label="Category" sx={{ borderRadius: 2 }}>
              {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Priority</InputLabel>
            <Select value={form.priority} onChange={e => setField('priority', e.target.value)} label="Priority" sx={{ borderRadius: 2 }}>
              {['Low', 'Medium', 'High'].map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <TextField
          label="Report Content" fullWidth multiline rows={5} size="small" required
          value={form.content} onChange={e => setField('content', e.target.value)}
          placeholder="Describe the findings, observations, and recommendations..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {saving ? 'Submitting...' : 'Submit Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditReportDialog({ report, onClose, onSaved }: { report: Record<string, unknown> | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: '', category: '', status: '', priority: '', content: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (report) {
      setForm({
        title: (report.title as string) ?? '',
        category: (report.category as string) ?? '',
        status: (report.status as string) ?? '',
        priority: (report.priority as string) ?? '',
        content: (report.content as string) ?? '',
      });
    }
  }, [report]);

  function setField(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function submit() {
    if (!report) return;
    if (!form.title.trim() || !form.category || !form.content.trim()) {
      toast.error('Please fill all required fields');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success('Report updated!');
        onSaved();
        onClose();
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Failed to update report');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(report)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Edit Report</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        <TextField label="Report Title" fullWidth size="small" required value={form.title} onChange={e => setField('title', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small" required>
            <InputLabel>Category</InputLabel>
            <Select value={form.category} onChange={e => setField('category', e.target.value)} label="Category" sx={{ borderRadius: 2 }}>
              {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Priority</InputLabel>
            <Select value={form.priority} onChange={e => setField('priority', e.target.value)} label="Priority" sx={{ borderRadius: 2 }}>
              {['Low', 'Medium', 'High'].map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <FormControl fullWidth size="small">
          <InputLabel>Status</InputLabel>
          <Select value={form.status} onChange={e => setField('status', e.target.value)} label="Status" sx={{ borderRadius: 2 }}>
            {['Pending', 'Under Review', 'Approved', 'Rejected'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField
          label="Report Content" fullWidth multiline rows={5} size="small" required
          value={form.content} onChange={e => setField('content', e.target.value)}
          placeholder="Describe the findings, observations, and recommendations..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
