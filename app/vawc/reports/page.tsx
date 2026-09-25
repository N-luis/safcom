'use client';

import { useState, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, Skeleton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButtonGroup, ToggleButton, LinearProgress, Tooltip,
} from '@mui/material';
import {
  Assessment, FileDownload, TrendingUp, CheckCircle, Warning,
  FolderOpen, LocationOn, CalendarToday,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import useSWR from 'swr';
import toast from 'react-hot-toast';

const ACCENT = '#7c3aed';
const RISK_COLOR: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e',
};
const STATUS_COLOR: Record<string, string> = {
  Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#94a3b8',
};

const CASE_TYPE_COLORS = [
  '#7c3aed', '#ef4444', '#f97316', '#3b82f6', '#22c55e',
  '#ec4899', '#06b6d4', '#8b5cf6', '#f59e0b', '#14b8a6',
];

const PERIOD_LABELS: Record<string, string> = {
  '1': 'This Month',
  '3': 'Last 3 Months',
  '6': 'Last 6 Months',
  '12': 'Last 12 Months',
};

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Stats {
  total: number; highRisk: number; active: number; resolved: number; growth: number | null;
}
interface TrendRow { month: string; total: number; resolved: number; highRisk: number; }
interface VawcCase {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; filedAt: string; resolvedAt?: string | null;
  description?: string;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

// ─── CSV helpers ────────────────────────────────────────────────────────────────
function esc(v: string | number | null | undefined) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function casesToCSV(cases: VawcCase[], stats: Stats | undefined, period: string): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const resRate = stats && stats.total > 0 ? ((stats.resolved / stats.total) * 100).toFixed(1) : '0';

  // Summary section
  const summaryLines = [
    `"VAWC CASE REPORT — Generated ${date}"`,
    `"Period","${PERIOD_LABELS[period] ?? PERIOD_LABELS['6']}"`,
    `"Total Cases","${stats?.total ?? 0}"`,
    `"High / Critical Risk","${stats?.highRisk ?? 0}"`,
    `"Active Interventions","${stats?.active ?? 0}"`,
    `"Resolved Cases","${stats?.resolved ?? 0}"`,
    `"Resolution Rate","${resRate}%"`,
    `""`,
    `"CASE RECORDS (${cases.length} cases)"`,
  ];

  // Case records header + rows
  const headers = [
    'Case #', 'Resident Name', 'Case Type', 'Status', 'Risk Level',
    'Street/Barangay', 'Filed Date', 'Resolved Date', 'Description',
  ];
  const rows = cases.map(c => [
    c.caseNumber, c.residentName, c.caseType, c.status, c.riskLevel,
    c.barangay,
    new Date(c.filedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    c.resolvedAt ? new Date(c.resolvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—',
    c.description ?? '',
  ].map(esc).join(','));

  return [
    ...summaryLines,
    headers.map(h => esc(h)).join(','),
    ...rows,
  ].join('\r\n');
}

// Start date for a given period, aligned to calendar-month boundaries so it
// matches the months shown in the Case Volume Trend chart (e.g. "1M" = the
// current calendar month, "3M" = this month plus the 2 preceding months).
function periodStartDate(period: '1' | '3' | '6' | '12'): Date {
  const monthsAgo = { '1': 0, '3': 2, '6': 5, '12': 11 }[period];
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
}

function downloadCSV(csv: string, filename: string) {
  const BOM = '﻿';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function VawcReportsPage() {
  const [period, setPeriod] = useState<'1' | '3' | '6' | '12'>('6');
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: stats } = useSWR<Stats>('/api/vawc/stats', fetcher, { refreshInterval: 60000 });
  const { data: rawTrends } = useSWR<TrendRow[]>(`/api/vawc/trends?period=${period === '12' ? '12' : '6'}`, fetcher);

  // For 1M/3M, slice the most recent entries of the 6M data
  const trends = useMemo(() => {
    if (!rawTrends) return undefined;
    if (period === '1') return rawTrends.slice(-1);
    if (period === '3') return rawTrends.slice(-3);
    return rawTrends;
  }, [rawTrends, period]);

  // Recent cases for the table — scoped to the selected period so the table
  // and the exported CSV always show the same set of cases.
  const periodFrom = useMemo(() => periodStartDate(period), [period]);
  const caseParams = new URLSearchParams({ limit: '20', page: '1', from: periodFrom.toISOString() });
  if (statusFilter) caseParams.set('status', statusFilter);
  const { data: casesData } = useSWR<{ cases: VawcCase[]; pagination: { total: number } }>(
    `/api/vawc/cases?${caseParams}`, fetcher, { refreshInterval: 30000 }
  );
  const cases = casesData?.cases ?? [];
  const totalCases = casesData?.pagination?.total ?? 0;

  // Case type breakdown from trends (computed locally)
  const caseTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    cases.forEach(c => { counts[c.caseType] = (counts[c.caseType] ?? 0) + 1; });
    return Object.entries(counts)
      .map(([name, value]) => ({ name: name.replace(' - ', '\n').replace('VAWC - ', ''), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [cases]);

  const resRate = stats && stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;

  const summaryCards = [
    { icon: Assessment, label: 'Total Cases Filed', value: stats?.total ?? null, color: '#14b8a6', sub: stats?.growth != null ? `${stats.growth >= 0 ? '+' : ''}${stats.growth}% vs last month` : undefined },
    { icon: Warning, label: 'High / Critical Risk', value: stats?.highRisk ?? null, color: '#ef4444', sub: undefined },
    { icon: TrendingUp, label: 'Active Interventions', value: stats?.active ?? null, color: '#3b82f6', sub: undefined },
    { icon: CheckCircle, label: 'Resolved Cases', value: stats?.resolved ?? null, color: '#22c55e', sub: `${resRate}% resolution rate` },
  ];

  // Fetch all cases filed within the selected period for export (paginate through all pages)
  const handleExport = async () => {
    setExporting(true);
    try {
      const from = periodStartDate(period);

      const allCases: VawcCase[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({ limit: '100', page: String(page), from: from.toISOString() });
        if (statusFilter) params.set('status', statusFilter);
        const res = await fetch(`/api/vawc/cases?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch cases');
        const json = await res.json();
        const fetched: VawcCase[] = json.data?.cases ?? [];
        const total: number = json.data?.pagination?.total ?? 0;
        allCases.push(...fetched);
        hasMore = allCases.length < total;
        page++;
        if (page > 30) break; // safety cap
      }

      if (allCases.length === 0) { toast.error(`No VAWC cases filed in the ${PERIOD_LABELS[period].toLowerCase()}`); return; }

      const periodStats: Stats = {
        total: allCases.length,
        highRisk: allCases.filter(c => ['High', 'Critical'].includes(c.riskLevel)).length,
        active: allCases.filter(c => c.status === 'In Progress').length,
        resolved: allCases.filter(c => ['Resolved', 'Closed'].includes(c.status)).length,
        growth: null,
      };

      const date = new Date().toISOString().slice(0, 10);
      const suffix = statusFilter ? `-${statusFilter.toLowerCase().replace(/\s/g, '-')}` : '';
      downloadCSV(casesToCSV(allCases, periodStats, period), `vawc-cases-${period}m${suffix}-${date}.csv`);
      toast.success(`Exported ${allCases.length} VAWC case${allCases.length !== 1 ? 's' : ''} to CSV`);
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Reports</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>VAWC case statistics, trends, and exportable reports</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            size="small" value={period} exclusive
            onChange={(_, v) => { if (v) setPeriod(v); }}
            sx={{ '& .MuiToggleButton-root': { px: 2, py: 0.6, fontSize: '0.86rem', fontWeight: 600, borderColor: '#e2e8f0', color: '#64748b', '&.Mui-selected': { bgcolor: `${ACCENT}15`, color: ACCENT, borderColor: `${ACCENT}40` } } }}
          >
            <ToggleButton value="1">1M</ToggleButton>
            <ToggleButton value="3">3M</ToggleButton>
            <ToggleButton value="6">6M</ToggleButton>
            <ToggleButton value="12">1Y</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="outlined"
            startIcon={exporting
              ? <FileDownload sx={{ animation: 'pulse 0.9s ease-in-out infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } } }} />
              : <FileDownload />}
            disabled={exporting}
            onClick={handleExport}
            sx={{ borderColor: ACCENT, color: ACCENT, fontWeight: 600, '&:hover': { bgcolor: `${ACCENT}08` }, '&:disabled': { opacity: 0.6 } }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </Box>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {summaryCards.map((card) => (
          <Grid key={card.label} size={{ xs: 6, md: 3 }}>
            <Card sx={{ '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 24px ${card.color}18` }, transition: 'all 0.2s' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: `${card.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5 }}>
                  <card.icon sx={{ fontSize: 18, color: card.color }} />
                </Box>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>{card.label}</Typography>
                {card.value === null
                  ? <Skeleton variant="text" width={60} height={40} />
                  : <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1 }}>{card.value.toLocaleString()}</Typography>
                }
                {card.sub && <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.75 }}>{card.sub}</Typography>}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Charts row */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {/* Bar chart */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Case Volume Trend</Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>Filed vs. resolved vs. high-risk per month</Typography>
                </Box>
                <Chip label={PERIOD_LABELS[period]} size="small"
                  sx={{ bgcolor: `${ACCENT}10`, color: ACCENT, fontWeight: 600, fontSize: '0.78rem' }} />
              </Box>
              {!trends ? (
                <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
              ) : trends.length === 0 ? (
                <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                  <FolderOpen sx={{ fontSize: 36, color: '#e2e8f0' }} />
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No trend data available</Typography>
                </Box>
              ) : (
                <>
                  <Box sx={{ minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={trends} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barGap={4} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <ChartTooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: '0.86rem' }} formatter={(v: unknown, name: unknown) => [String(v), String(name)]} />
                        <Bar dataKey="total" name="Total Filed" radius={[4, 4, 0, 0]} fill={ACCENT} opacity={0.85} />
                        <Bar dataKey="resolved" name="Resolved" radius={[4, 4, 0, 0]} fill="#22c55e" opacity={0.85} />
                        <Bar dataKey="highRisk" name="High Risk" radius={[4, 4, 0, 0]} fill="#ef4444" opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2.5, mt: 1.5, justifyContent: 'center' }}>
                    {[{ color: ACCENT, label: 'Total Filed' }, { color: '#22c55e', label: 'Resolved' }, { color: '#ef4444', label: 'High Risk' }].map(l => (
                      <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: 1, bgcolor: l.color }} />
                        <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{l.label}</Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Case type breakdown donut */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.5 }}>Case Type Breakdown</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mb: 1.5 }}>Distribution of current cases by type</Typography>
              {cases.length === 0 ? (
                <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                  <FolderOpen sx={{ fontSize: 36, color: '#e2e8f0' }} />
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No cases yet</Typography>
                </Box>
              ) : caseTypeData.length === 0 ? (
                <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
              ) : (
                <Box sx={{ minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={caseTypeData} cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                        label={({ percent }) => (percent ?? 0) > 0.08 ? `${Math.round((percent ?? 0) * 100)}%` : ''}
                        labelLine={false}>
                        {caseTypeData.map((_, i) => (
                          <Cell key={i} fill={CASE_TYPE_COLORS[i % CASE_TYPE_COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip formatter={(v: unknown, _: unknown, props: { payload?: { name: string } }) => [String(v) + ' cases', props.payload?.name ?? '']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: '0.86rem' }} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: '0.78rem' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Resolution progress bar */}
      {stats && stats.total > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Overall Resolution Progress</Typography>
              <Chip label={`${resRate}% resolved`} size="small"
                sx={{ bgcolor: resRate >= 70 ? '#22c55e18' : resRate >= 40 ? '#f59e0b18' : '#ef444418', color: resRate >= 70 ? '#22c55e' : resRate >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 700 }} />
            </Box>
            <Grid container spacing={2}>
              {[
                { label: 'Resolved / Closed', value: stats.resolved, max: stats.total, color: '#22c55e' },
                { label: 'Active / In Progress', value: stats.active, max: stats.total, color: '#3b82f6' },
                { label: 'High / Critical Risk', value: stats.highRisk, max: stats.total, color: '#ef4444' },
              ].map(item => (
                <Grid key={item.label} size={{ xs: 12, sm: 4 }}>
                  <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{item.label}</Typography>
                    <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: item.color }}>{item.value} / {item.max}</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={(item.value / item.max) * 100}
                    sx={{ height: 8, borderRadius: 4, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 4 } }} />
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Recent Cases table */}
      <Card>
        <CardContent sx={{ p: 2.5, pb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Case Records</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                Showing {cases.length} of {totalCases} VAWC cases
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {['', 'Open', 'In Progress', 'Resolved', 'Closed'].map(s => (
                <Chip key={s || 'all'} label={s || 'All'} size="small"
                  onClick={() => setStatusFilter(s)}
                  sx={{
                    cursor: 'pointer', fontSize: '0.82rem',
                    bgcolor: statusFilter === s ? `${ACCENT}15` : '#f1f5f9',
                    color: statusFilter === s ? ACCENT : '#64748b',
                    fontWeight: statusFilter === s ? 700 : 400,
                    border: statusFilter === s ? `1px solid ${ACCENT}40` : '1px solid transparent',
                    '&:hover': { bgcolor: `${ACCENT}10` },
                  }}
                />
              ))}
            </Box>
          </Box>
        </CardContent>

        {cases.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 7 }}>
            <FolderOpen sx={{ fontSize: 40, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
            <Typography sx={{ fontSize: '0.94rem', color: '#94a3b8' }}>
              {statusFilter ? `No ${statusFilter} VAWC cases` : 'No VAWC cases yet'}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', bgcolor: '#f8fafc', py: 1.5, borderBottom: '1px solid #f1f5f9' } }}>
                  <TableCell>Case #</TableCell>
                  <TableCell>Resident</TableCell>
                  <TableCell>Case Type</TableCell>
                  <TableCell>Risk</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Street/Barangay</TableCell>
                  <TableCell>Filed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cases.map(c => (
                  <TableRow key={c.id} sx={{ '& td': { py: 1.1, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#fafbff' } }}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', color: ACCENT, fontFamily: 'monospace' }}>{c.caseNumber}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 500, color: '#0c1e46' }}>{c.residentName}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.caseType}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={c.riskLevel} size="small"
                        sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}15`, color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                    </TableCell>
                    <TableCell>
                      <Chip label={c.status} size="small"
                        sx={{ bgcolor: `${STATUS_COLOR[c.status] ?? '#94a3b8'}15`, color: STATUS_COLOR[c.status] ?? '#94a3b8', fontWeight: 600, fontSize: '0.78rem', height: 24 }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <LocationOn sx={{ fontSize: 12, color: '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.barangay}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <CalendarToday sx={{ fontSize: 11, color: '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                          {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {totalCases > 20 && (
          <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>
              Showing first 20 of {totalCases} cases. Click <strong>Export CSV</strong> to get all records.
            </Typography>
            <Tooltip title="Export all matching cases to CSV">
              <Button size="small" startIcon={<FileDownload sx={{ fontSize: 14 }} />}
                onClick={handleExport} disabled={exporting}
                sx={{ color: ACCENT, fontWeight: 600, fontSize: '0.86rem', textTransform: 'none' }}>
                Export All {totalCases} Cases
              </Button>
            </Tooltip>
          </Box>
        )}
      </Card>
    </Box>
  );
}
