'use client';

import { useState, useCallback } from 'react';
import {
  Box, Grid, Typography, Card, CardContent, Chip, IconButton,
  TextField, InputAdornment, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Skeleton, Button, Divider, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, Paper,
} from '@mui/material';
import {
  FolderOpen, Warning, CheckCircle,
  Search, Visibility, ArrowForward, LocationOn, AccessTime,
  PlayCircle, PendingActions, Close,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { useCaseStats, useCases } from '@/hooks/useApi';
import { useRouter } from 'next/navigation';
import AnnounceButton from '@/components/announcements/AnnounceButton';

const CATEGORY_COLORS = ['#14b8a6', '#3b82f6', '#f97316', '#8b5cf6', '#ef4444', '#94a3b8'];

const STAT_CARDS = [
  { key: 'total', title: 'TOTAL CASES', subtitle: 'All Time', subtitleColor: '#3b82f6', icon: FolderOpen, iconColor: '#3b82f6', filter: {} },
  { key: 'pending', title: 'PENDING CASES', subtitle: 'Requires Action', subtitleColor: '#f97316', icon: PendingActions, iconColor: '#f97316', filter: { status: 'Open' } },
  { key: 'ongoing', title: 'ONGOING CASES', subtitle: 'Active', subtitleColor: '#14b8a6', icon: PlayCircle, iconColor: '#14b8a6', filter: { status: 'In Progress' } },
  { key: 'resolved', title: 'RESOLVED CASES', subtitle: 'Completed', subtitleColor: '#3b82f6', icon: CheckCircle, iconColor: '#22c55e', filter: { status: 'Resolved' } },
];

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} mins ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLOR: Record<string, string> = {
  Open: '#f97316', 'In Progress': '#22c55e', Resolved: '#3b82f6', Closed: '#94a3b8',
};
const RISK_COLOR: Record<string, string> = {
  High: '#ef4444', Medium: '#f97316', Low: '#22c55e', Critical: '#8b5cf6',
};

interface CaseRow {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; filedAt: string;
  description?: string; assignedTo?: { name: string } | null;
}

function CaseDetailDialog({ c, onClose, onUpdate }: { c: CaseRow; onClose: () => void; onUpdate: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{c.caseNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{c.caseType}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2 }}>
        <Grid container spacing={2}>
          {[
            { label: 'Reporter / Subject', value: c.residentName },
            { label: 'Street', value: c.barangay },
            { label: 'Filed At', value: new Date(c.filedAt).toLocaleString() },
            { label: 'Assigned To', value: c.assignedTo?.name || 'Unassigned' },
          ].map(row => (
            <Grid size={{ xs: 6 }} key={row.label}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.25 }}>{row.label}</Typography>
              <Typography sx={{ fontSize: '0.94rem', fontWeight: 500 }}>{row.value}</Typography>
            </Grid>
          ))}
          <Grid size={{ xs: 6 }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.25 }}>Status</Typography>
            <Chip label={c.status} size="small" sx={{ bgcolor: `${STATUS_COLOR[c.status] ?? '#94a3b8'}20`, color: STATUS_COLOR[c.status] ?? '#94a3b8', fontWeight: 600, fontSize: '0.86rem' }} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.25 }}>Risk Level</Typography>
            <Chip label={c.riskLevel} size="small" sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#94a3b8'}20`, color: RISK_COLOR[c.riskLevel] ?? '#94a3b8', fontWeight: 600, fontSize: '0.86rem' }} />
          </Grid>
          {c.description && (
            <Grid size={{ xs: 12 }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.5 }}>Description</Typography>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Typography sx={{ fontSize: '0.94rem', lineHeight: 1.6 }}>{c.description}</Typography>
              </Paper>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined" size="small" sx={{ borderRadius: 2 }}>Close</Button>
        <Button onClick={onUpdate} variant="contained" size="small" sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
          Update Case
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function BlotterDashboard() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = useCaseStats();
  const [page, setPage] = useState(1);
  const { data: casesData, isLoading: casesLoading } = useCases({ page, limit: 5, sortBy: 'filedAt', sortDir: 'desc' });
  const { data: urgentData } = useCases({ riskLevel: 'High', limit: 3, sortBy: 'filedAt', sortDir: 'desc' });

  const [search, setSearch] = useState('');
  const [selectedCase, setSelectedCase] = useState<CaseRow | null>(null);

  const byCaseType: { caseType: string; count: number }[] = stats?.byCaseType ?? [];
  const typeTotal = byCaseType.reduce((sum, t) => sum + t.count, 0);
  const categories = byCaseType.slice(0, 5).map((t, i) => ({
    name: t.caseType,
    value: typeTotal > 0 ? Math.round((t.count / typeTotal) * 100) : 0,
    count: t.count,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    linkable: true,
  }));
  if (byCaseType.length > 5) {
    const othersCount = byCaseType.slice(5).reduce((sum, t) => sum + t.count, 0);
    categories.push({
      name: 'Others',
      value: typeTotal > 0 ? Math.round((othersCount / typeTotal) * 100) : 0,
      count: othersCount,
      color: CATEGORY_COLORS[CATEGORY_COLORS.length - 1],
      linkable: false,
    });
  }

  const statValues = {
    total: stats?.total ?? 0,
    pending: stats?.open ?? 0,
    ongoing: stats?.inProgress ?? 0,
    resolved: stats?.resolved ?? 0,
  } as Record<string, number>;

  const cases: CaseRow[] = casesData?.cases ?? [];
  const urgentCases: CaseRow[] = urgentData?.cases ?? [];

  const filtered = cases.filter(c =>
    !search || c.caseNumber.toLowerCase().includes(search.toLowerCase()) ||
    c.residentName.toLowerCase().includes(search.toLowerCase()) ||
    c.caseType.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
            Dashboard Overview
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.25 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Typography>
        </Box>
        <AnnounceButton accent="#3b82f6" />
      </Box>

      {/* Stat cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {STAT_CARDS.map((card, i) => (
          <Grid size={{ xs: 6, lg: 3 }} key={card.key}>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <Card
                onClick={() => {
                  const params = new URLSearchParams(card.filter as Record<string, string>);
                  const qs = params.toString();
                  router.push(`/blotter-officer/case-management${qs ? `?${qs}` : ''}`);
                }}
                sx={{
                  height: '100%', cursor: 'pointer', transition: 'all 0.2s',
                  '&:hover': { boxShadow: '0 6px 24px rgba(0,0,0,0.12)', transform: 'translateY(-2px)' },
                }}
              >
                <CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
                    <Typography sx={{ fontSize: '0.72rem', color: card.subtitleColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 }}>
                      {card.subtitle}
                    </Typography>
                    <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: `${card.iconColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ml: 1 }}>
                      <card.icon sx={{ fontSize: 20, color: card.iconColor }} />
                    </Box>
                  </Box>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {card.title}
                  </Typography>
                  {statsLoading ? (
                    <Skeleton variant="text" width={70} height={44} />
                  ) : (
                    <Typography sx={{ fontSize: { xs: '1.6rem', sm: '2.1rem' }, fontWeight: 800, color: '#0c1e46', lineHeight: 1 }}>
                      {statValues[card.key].toLocaleString()}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Middle row: chart + urgent cases */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {/* Case Distribution */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
                  Case Distribution by Category
                </Typography>
                <Chip label="All-Time Totals" size="small" sx={{ fontSize: '0.78rem', height: 24, bgcolor: '#f1f5f9' }} />
              </Box>

              {statsLoading ? (
                <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
              ) : categories.length === 0 ? (
                <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '0.94rem', color: 'text.secondary' }}>No cases recorded yet</Typography>
                </Box>
              ) : (
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 3 }}>
                {/* Donut chart */}
                <Box sx={{ position: 'relative', width: 220, height: 220, flexShrink: 0 }}>
                  <ResponsiveContainer width={220} height={220}>
                    <PieChart>
                      <Pie
                        data={categories}
                        cx="50%" cy="50%"
                        innerRadius={72} outerRadius={95}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {categories.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip
                        formatter={(value: unknown, _name: unknown, item: { payload?: { count?: number } }) => [`${value}% (${item?.payload?.count ?? 0} cases)`, '']}
                        contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: '0.9rem' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box sx={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none',
                  }}>
                    <Typography sx={{ fontSize: '1.8rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1 }}>
                      {categories.length}
                    </Typography>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b', lineHeight: 1.4 }}>Categories</Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Total Data</Typography>
                  </Box>
                </Box>

                {/* Legend */}
                <Box sx={{ flex: 1 }}>
                  {categories.map((cat) => (
                    <Box
                      key={cat.name}
                      onClick={cat.linkable ? () => router.push(`/blotter-officer/case-management?search=${encodeURIComponent(cat.name)}`) : undefined}
                      sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, borderRadius: 1, px: 0.5,
                        ...(cat.linkable ? { cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' } } : {}),
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cat.color, flexShrink: 0 }} />
                        <Typography sx={{ fontSize: '0.9rem', color: '#475569' }}>{cat.name}</Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>{cat.value}% · {cat.count}</Typography>
                    </Box>
                  ))}
                  <Divider sx={{ my: 1.5 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>Total Recorded</Typography>
                    <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46' }}>
                      {(stats?.total ?? 0).toLocaleString()}
                    </Typography>
                  </Box>
                </Box>
              </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Urgent Cases */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ p: 2.5, pb: 1, flexShrink: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Warning sx={{ color: '#ef4444', fontSize: 20 }} />
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
                  Urgent Cases (High Risk)
                </Typography>
              </Box>

              {urgentCases.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <CheckCircle sx={{ color: '#22c55e', fontSize: 36, mb: 1 }} />
                  <Typography sx={{ fontSize: '0.94rem', color: 'text.secondary' }}>No high-risk cases</Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {urgentCases.map((c) => (
                    <Box
                      key={c.id}
                      onClick={() => setSelectedCase(c)}
                      sx={{
                        p: 1.5, border: '1px solid #fee2e2', borderRadius: 2.5,
                        cursor: 'pointer', transition: 'all 0.15s',
                        '&:hover': { bgcolor: '#fff5f5', borderColor: '#fca5a5' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {c.caseType} — #{c.caseNumber}
                        </Typography>
                        <Chip label="HIGH" size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 22, px: 0.5 }} />
                      </Box>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: '#0c1e46', mb: 0.25 }}>
                        {c.residentName}
                      </Typography>
                      {c.description && (
                        <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 0.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {c.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <LocationOn sx={{ fontSize: 12, color: '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.barangay}</Typography>
                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          <AccessTime sx={{ fontSize: 11, color: '#94a3b8' }} />
                          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{timeAgo(c.filedAt)}</Typography>
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
            <Box sx={{ mt: 'auto', px: 2.5, pb: 2.5, pt: 1 }}>
              <Button
                fullWidth variant="outlined" size="small"
                endIcon={<ArrowForward fontSize="small" />}
                onClick={() => router.push('/blotter-officer/case-management?riskLevel=High')}
                sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569', fontSize: '0.86rem', '&:hover': { borderColor: '#ef4444', color: '#ef4444', bgcolor: '#fff5f5' } }}
              >
                View All High Risk Cases
              </Button>
            </Box>
          </Card>
        </Grid>
      </Grid>

      {/* Recently Assigned Cases table */}
      <Card>
        <CardContent sx={{ p: 2.5, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 1.5 }}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Recently Assigned Cases</Typography>
              <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>Your current active queue for review and validation.</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small" placeholder="Filter cases..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> } }}
                sx={{ width: { xs: '100%', sm: 210 }, '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: '0.9rem', height: 36 } }}
              />
              <Tooltip title="Open Case Management">
                <IconButton
                  size="small"
                  onClick={() => router.push('/blotter-officer/case-management')}
                  sx={{ border: '1px solid #e2e8f0', borderRadius: 1.5, width: 36, height: 36 }}
                >
                  <ArrowForward fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </CardContent>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.25, borderBottom: '1px solid #f1f5f9' } }}>
                {['Case ID', 'Reporter / Subject', 'Category', 'Status', 'Risk Level', 'Timestamp', ''].map(h => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {casesLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton variant="text" width={80} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary', fontSize: '0.94rem' }}>
                    No cases found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => (
                  <TableRow
                    key={c.id}
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, '& td': { py: 1.25, borderBottom: '1px solid #f8fafc' } }}
                    onClick={() => setSelectedCase(c)}
                  >
                    <TableCell>
                      <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{
                          width: 30, height: 30, borderRadius: '50%', bgcolor: '#dbeafe',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.78rem', fontWeight: 700, color: '#1d4ed8', flexShrink: 0,
                        }}>
                          {c.residentName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{c.residentName}</Typography>
                          <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>Reporting Party</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem' }}>{c.caseType}</Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_COLOR[c.status] ?? '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.9rem', color: STATUS_COLOR[c.status] ?? '#94a3b8', fontWeight: 600 }}>
                          {c.status}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: RISK_COLOR[c.riskLevel] ?? '#94a3b8' }}>
                        {c.riskLevel}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>{timeAgo(c.filedAt)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title="View Details">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setSelectedCase(c); }}>
                          <Visibility sx={{ fontSize: 16, color: '#94a3b8' }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>
            Showing {filtered.length} of {casesData?.pagination?.total ?? 0} assigned cases
            {casesData?.pagination?.totalPages > 1 ? ` — page ${casesData.pagination.page} of ${casesData.pagination.totalPages}` : ''}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small" variant="outlined"
              disabled={page <= 1}
              sx={{ borderRadius: 1.5, fontSize: '0.86rem', py: 0.25, borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="small" variant="outlined"
              disabled={!casesData?.pagination?.totalPages || page >= casesData.pagination.totalPages}
              sx={{ borderRadius: 1.5, fontSize: '0.86rem', py: 0.25, borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </Box>
        </Box>
      </Card>

      {selectedCase && (
        <CaseDetailDialog
          c={selectedCase}
          onClose={() => setSelectedCase(null)}
          onUpdate={() => {
            setSelectedCase(null);
            router.push(`/blotter-officer/case-management?caseNumber=${encodeURIComponent(selectedCase.caseNumber)}`);
          }}
        />
      )}
    </Box>
  );
}
