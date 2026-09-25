'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, InputAdornment,
  Select, MenuItem, FormControl, InputLabel, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, IconButton, Skeleton,
  Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from '@mui/material';
import {
  Add, Search, Download, Visibility, Close, Assessment,
  FileDownload, CheckCircle, PendingActions,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useReports } from '@/hooks/useApi';
import { mutate } from 'swr';
import toast from 'react-hot-toast';

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function escapeCell(v: string | number | null | undefined) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function reportsToCSV(rows: Report[]): string {
  const headers = ['Report #', 'Title', 'Category', 'Priority', 'Status', 'Submitted By', 'Created', 'Content'];
  const lines = rows.map(r => [
    r.reportNumber, r.title, r.category, r.priority, r.status,
    r.submittedBy?.name ?? 'System',
    new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    r.content,
  ].map(escapeCell).join(','));
  return [headers.map(escapeCell).join(','), ...lines].join('\r\n');
}

function downloadCSV(csv: string, filename: string) {
  const BOM = '﻿'; // keeps accented chars readable in Excel
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CATEGORIES = ['Incident Report', 'Statistical Summary', 'Street Report', 'Risk Assessment', 'Monthly Report', 'Audit Report', 'Custom'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUS_COLOR: Record<string, string> = { Pending: '#f97316', 'In Review': '#3b82f6', Approved: '#22c55e', Rejected: '#ef4444' };
const PRIORITY_COLOR: Record<string, string> = { Low: '#22c55e', Medium: '#f97316', High: '#ef4444', Critical: '#8b5cf6' };

interface Report {
  id: string; reportNumber: string; title: string; category: string;
  status: string; priority: string; content: string; createdAt: string;
  submittedBy?: { name: string } | null;
}

function NewReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', category: 'Incident Report', priority: 'Medium', content: '' });
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title || !form.content) { toast.error('Please fill all required fields'); return; }
    setLoading(true);
    try {
      const rn = `RPT-${Date.now().toString().slice(-6)}`;
      const res = await fetch('/api/reports', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, reportNumber: rn }),
      });
      if (!res.ok) throw new Error();
      toast.success('Report created');
      mutate(key => typeof key === 'string' && key.includes('/api/reports'));
      onClose();
    } catch { toast.error('Failed to create report'); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontWeight: 700 }}>New Report</Typography>
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2.5 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Report Title *" size="small" value={form.title} onChange={e => set('title', e.target.value)} sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Category</InputLabel>
              <Select value={form.category} label="Category" onChange={e => set('category', e.target.value)} sx={{ borderRadius: 2 }}>
                {CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Priority</InputLabel>
              <Select value={form.priority} label="Priority" onChange={e => set('priority', e.target.value)} sx={{ borderRadius: 2 }}>
                {PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Report Content *" multiline rows={5} size="small" value={form.content} onChange={e => set('content', e.target.value)} sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} placeholder="Describe the incident, findings, and recommendations..." />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderRadius: 2 }}>Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={loading} sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
          Submit Report
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ReportViewDialog({ r, onClose }: { r: Report; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{r.reportNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{r.category}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2 }}>
        <Typography sx={{ fontWeight: 700, mb: 1.5 }}>{r.title}</Typography>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {[
            { label: 'Status', value: <Chip label={r.status} size="small" sx={{ bgcolor: `${STATUS_COLOR[r.status] ?? '#94a3b8'}20`, color: STATUS_COLOR[r.status] ?? '#94a3b8', fontWeight: 600, fontSize: '0.82rem' }} /> },
            { label: 'Priority', value: <Chip label={r.priority} size="small" sx={{ bgcolor: `${PRIORITY_COLOR[r.priority] ?? '#94a3b8'}20`, color: PRIORITY_COLOR[r.priority] ?? '#94a3b8', fontWeight: 600, fontSize: '0.82rem' }} /> },
            { label: 'Created', value: <Typography sx={{ fontSize: '0.9rem' }}>{new Date(r.createdAt).toLocaleDateString()}</Typography> },
            { label: 'By', value: <Typography sx={{ fontSize: '0.9rem' }}>{r.submittedBy?.name ?? 'System'}</Typography> },
          ].map(({ label, value }) => (
            <Grid size={{ xs: 6 }} key={label}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
              {value}
            </Grid>
          ))}
        </Grid>
        <Divider sx={{ mb: 2 }} />
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, mb: 1 }}>Content</Typography>
        <Box sx={{ p: 1.5, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.7, color: '#475569', whiteSpace: 'pre-wrap' }}>{r.content}</Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderRadius: 2 }}>Close</Button>
        <Button
          variant="contained"
          startIcon={<FileDownload />}
          onClick={() => { downloadCSV(reportsToCSV([r]), `${r.reportNumber}.csv`); toast.success(`${r.reportNumber} exported`); }}
          sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}
        >
          Export CSV
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useReports({ limit: 10, page, ...(search && { search }), ...(statusFilter && { status: statusFilter }) });
  const reports: Report[] = data?.reports ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.totalPages ?? 1;

  // Fetch ALL matching reports (up to 2000) and download as CSV
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ limit: '2000', page: '1' });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/reports?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch reports');
      const json = await res.json();
      const allReports: Report[] = json.data?.reports ?? [];
      if (allReports.length === 0) { toast.error('No reports to export'); return; }
      const date = new Date().toISOString().slice(0, 10);
      const label = statusFilter ? `-${statusFilter.toLowerCase().replace(/\s/g, '-')}` : '';
      downloadCSV(reportsToCSV(allReports), `blotter-reports${label}-${date}.csv`);
      toast.success(`Exported ${allReports.length} report${allReports.length !== 1 ? 's' : ''} to CSV`);
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // Export a single report row as CSV
  const handleExportOne = (r: Report, e: React.MouseEvent) => {
    e.stopPropagation();
    downloadCSV(reportsToCSV([r]), `${r.reportNumber}.csv`);
    toast.success(`${r.reportNumber} exported`);
  };

  const summaryStats = [
    { label: 'Total', value: total, color: '#3b82f6', icon: Assessment },
    { label: 'Pending', value: reports.filter(r => r.status === 'Pending').length, color: '#f97316', icon: PendingActions },
    { label: 'Approved', value: reports.filter(r => r.status === 'Approved').length, color: '#22c55e', icon: CheckCircle },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Reports</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Generate, manage and export blotter reports</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={exporting
              ? <FileDownload sx={{ animation: 'pulse 0.9s ease-in-out infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } } }} />
              : <FileDownload />}
            disabled={exporting}
            onClick={handleExportAll}
            sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}
          >
            {exporting ? 'Exporting…' : 'Export All'}
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => setNewOpen(true)} sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
            New Report
          </Button>
        </Box>
      </Box>

      {/* Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {summaryStats.map((s, i) => (
          <Grid size={{ xs: 4 }} key={s.label}>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <Card sx={{ textAlign: 'center', cursor: 'pointer', '&:hover': { boxShadow: `0 4px 16px ${s.color}25` } }}>
                <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
                  <s.icon sx={{ color: s.color, fontSize: 24, mb: 0.5 }} />
                  {isLoading ? <Skeleton variant="text" width={40} sx={{ mx: 'auto' }} /> : (
                    <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</Typography>
                  )}
                  <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', fontWeight: 500 }}>{s.label}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Filter */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small" placeholder="Search reports…"
              value={search} onChange={e => setSearch(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment> } }}
              sx={{ flex: 1, minWidth: 200, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={e => setStatusFilter(e.target.value)} sx={{ borderRadius: 2 }}>
                <MenuItem value="">All</MenuItem>
                {['Pending', 'In Review', 'Approved', 'Rejected'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.5, borderBottom: '1px solid #f1f5f9' } }}>
                {['Report #', 'Title', 'Category', 'Priority', 'Status', 'Created', 'Actions'].map(h => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton variant="text" width={80} /></TableCell>)}</TableRow>
              )) : reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 5 }}>
                    <Assessment sx={{ fontSize: 36, color: '#cbd5e1', display: 'block', mx: 'auto', mb: 1 }} />
                    <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>No reports found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                reports.map(r => (
                  <TableRow key={r.id} sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, '& td': { py: 1.25, borderBottom: '1px solid #f8fafc' } }} onClick={() => setViewReport(r)}>
                    <TableCell><Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>{r.reportNumber}</Typography></TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 500, maxWidth: 200, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {r.title}
                      </Typography>
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{r.category}</Typography></TableCell>
                    <TableCell>
                      <Chip label={r.priority} size="small" sx={{ bgcolor: `${PRIORITY_COLOR[r.priority] ?? '#94a3b8'}18`, color: PRIORITY_COLOR[r.priority] ?? '#94a3b8', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                    </TableCell>
                    <TableCell>
                      <Chip label={r.status} size="small" sx={{ bgcolor: `${STATUS_COLOR[r.status] ?? '#94a3b8'}18`, color: STATUS_COLOR[r.status] ?? '#94a3b8', fontWeight: 600, fontSize: '0.82rem', height: 24 }} />
                    </TableCell>
                    <TableCell><Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>{new Date(r.createdAt).toLocaleDateString()}</Typography></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.25 }}>
                        <Tooltip title="View">
                          <IconButton size="small" onClick={e => { e.stopPropagation(); setViewReport(r); }}>
                            <Visibility sx={{ fontSize: 15, color: '#94a3b8' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Export CSV">
                          <IconButton size="small" onClick={e => handleExportOne(r, e)}>
                            <Download sx={{ fontSize: 15, color: '#94a3b8' }} />
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

        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>Page {page} of {totalPages} · {total} reports</Typography>
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

      <NewReportDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {viewReport && <ReportViewDialog r={viewReport} onClose={() => setViewReport(null)} />}
    </Box>
  );
}
