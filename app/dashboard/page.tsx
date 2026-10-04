'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Card, CardContent, Typography, Chip, Button, Avatar, Skeleton,
  IconButton, Tooltip, Drawer, useMediaQuery, useTheme,
  ToggleButton, ToggleButtonGroup, LinearProgress, Grid,
} from '@mui/material';
import {
  FolderOpen, Warning, Menu as MenuIcon, ArrowForward, Gavel, Shield,
  PersonOutlined, TrendingUp, CheckCircle, Refresh, NotificationsActive,
} from '@mui/icons-material';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend,
} from 'recharts';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import AnnounceButton from '@/components/announcements/AnnounceButton';
import CaptainSidebar, { CAPTAIN_SIDEBAR_WIDTH as SIDEBAR_W } from '@/components/layout/CaptainSidebar';

const ACCENT = '#0f766e';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json().then(d => d.data);
  });

const RISK_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e',
};
const MODULE_COLOR: Record<string, string> = { Blotter: '#3b82f6', VAWC: '#7c3aed' };
const ROLE_LABEL: Record<string, string> = {
  admin: 'Barangay Captain',
  system_admin: 'System Admin',
  officer: 'Blotter Officer',
  vawc_officer: 'VAWC Officer',
};

interface CaseRow {
  id: string; caseNumber: string; residentName: string; caseType: string;
  module: 'Blotter' | 'VAWC'; status: string; riskLevel: string;
  barangay: string; filedAt: string; officer: string | null;
}
interface ModuleSummary {
  total: number; open: number; inProgress: number; resolved: number;
  critical: number; highRisk: number; unassigned: number;
}
interface Overview {
  generatedAt: string;
  residents: { total: number; pending: number; active: number };
  staff: {
    total: number;
    byRole: { role: string; count: number }[];
    members: { id: string; name: string; email: string; role: string; barangay: string | null; joinedAt: string; caseload: number }[];
  };
  modules: { blotter: ModuleSummary; vawc: ModuleSummary };
  totals: { cases: number; active: number; resolved: number; criticalOpen: number; alerts: number; resolutionRate: number; safetyIndex: number };
  trends: { month: string; blotter: number; vawc: number; resolved: number }[];
  recentCases: CaseRow[];
  escalations: CaseRow[];
  alerts: { id: string; title: string; message: string; level: string; createdAt: string }[];
  activities: { id: string; type: string; message: string; color: string; createdAt: string }[];
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString();
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon, loading, onClick }: {
  label: string; value: ReactNode; sub?: string; color: string;
  icon: ReactNode; loading: boolean; onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      sx={{
        height: '100%', borderLeft: `3px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s',
        ...(onClick && { '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 10px 26px ${color}22` } }),
      }}
    >
      <CardContent sx={{ p: 2.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </Box>
          {onClick && <ArrowForward sx={{ fontSize: 15, color: '#cbd5e1' }} />}
        </Box>
        <Typography sx={{ fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          {label}
        </Typography>
        {loading
          ? <Skeleton variant="text" width={70} height={42} />
          : <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color, lineHeight: 1.2 }}>{value}</Typography>}
        {sub && <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function ModuleCard({ title, summary, color, icon, loading, onOpen }: {
  title: string; summary?: ModuleSummary; color: string;
  icon: ReactNode; loading: boolean; onOpen: () => void;
}) {
  const rows = [
    { label: 'Open', value: summary?.open ?? 0, color: '#3b82f6' },
    { label: 'In progress', value: summary?.inProgress ?? 0, color: '#f59e0b' },
    { label: 'Resolved', value: summary?.resolved ?? 0, color: '#22c55e' },
  ];
  const total = summary?.total ?? 0;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a' }}>{title}</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
              {loading ? '—' : `${total} case${total !== 1 ? 's' : ''} on record`}
            </Typography>
          </Box>
          <Button size="small" onClick={onOpen} endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
            sx={{ color, fontWeight: 700, fontSize: '0.86rem', textTransform: 'none' }}>
            Open
          </Button>
        </Box>

        {loading ? <Skeleton variant="rectangular" height={86} sx={{ borderRadius: 2 }} /> : (
          <>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
              {rows.map(r => (
                <Box key={r.label} sx={{ flex: 1, textAlign: 'center', py: 1, borderRadius: 2, bgcolor: `${r.color}0d`, border: `1px solid ${r.color}22` }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: r.color, lineHeight: 1.2 }}>{r.value}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>{r.label}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
              {(summary?.critical ?? 0) > 0 && (
                <Chip size="small" label={`${summary?.critical} critical`}
                  sx={{ bgcolor: '#fef2f2', color: '#dc2626', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
              )}
              {(summary?.unassigned ?? 0) > 0 && (
                <Chip size="small" label={`${summary?.unassigned} unassigned`}
                  sx={{ bgcolor: '#fff7ed', color: '#d97706', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
              )}
              {(summary?.critical ?? 0) === 0 && (summary?.unassigned ?? 0) === 0 && (
                <Chip size="small" label="No escalations" icon={<CheckCircle sx={{ fontSize: '11px !important' }} />}
                  sx={{ bgcolor: '#f0fdf4', color: '#15803d', fontWeight: 600, fontSize: '0.72rem', height: 22 }} />
              )}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CaseTable({ rows, loading, emptyText }: { rows: CaseRow[]; loading: boolean; emptyText: string }) {
  if (loading) {
    return <Box sx={{ p: 2 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} variant="text" height={38} />)}</Box>;
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 5 }}>
        <CheckCircle sx={{ fontSize: 34, color: '#cbd5e1', mb: 1 }} />
        <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>{emptyText}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth: 720 }}>
        <Box sx={{
          display: 'grid', gridTemplateColumns: '1.1fr 1.5fr 0.9fr 1fr 0.9fr 1fr',
          gap: 1.5, px: 2, py: 1.25, bgcolor: '#f8fafc',
          fontSize: '0.78rem', fontWeight: 800, color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span>Case</span><span>Resident / Type</span><span>Module</span>
          <span>Risk</span><span>Status</span><span>Officer</span>
        </Box>
        {rows.map(c => (
          <Box key={c.id} sx={{
            display: 'grid', gridTemplateColumns: '1.1fr 1.5fr 0.9fr 1fr 0.9fr 1fr',
            gap: 1.5, px: 2, py: 1.4, alignItems: 'center',
            borderTop: '1px solid #f1f5f9',
            '&:hover': { bgcolor: '#fafbfc' },
          }}>
            <Box>
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>{c.caseNumber}</Typography>
              <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{timeAgo(c.filedAt)}</Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.86rem', color: '#1f2937', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.residentName}
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.caseType}
              </Typography>
            </Box>
            <Chip size="small" label={c.module}
              sx={{ width: 'fit-content', bgcolor: `${MODULE_COLOR[c.module]}15`, color: MODULE_COLOR[c.module], fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
            <Chip size="small" label={c.riskLevel}
              sx={{ width: 'fit-content', bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}15`, color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
            <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>{c.status}</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: c.officer ? '#475569' : '#f97316', fontWeight: c.officer ? 400 : 700 }}>
              {c.officer ?? 'Unassigned'}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function KapitanDashboardPage() {
  const router = useRouter();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [scope, setScope] = useState<'all' | 'Blotter' | 'VAWC'>('all');

  const { data, error, isLoading, mutate } = useSWR<Overview>('/api/kapitan/overview', fetcher, {
    refreshInterval: 30000,
  });

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => { if (!r.ok) { router.push('/login'); return null; } return r.json(); })
      .then(d => { if (d?.data) setUserName(d.data.name || ''); })
      .catch(() => router.push('/login'));
  }, [router]);

  // On error we stop "loading" so the banner shows instead of skeletons spinning forever.
  const loading = !error && (isLoading || !data);
  const t = data?.totals;

  const recent = (data?.recentCases ?? []).filter(c => scope === 'all' || c.module === scope);
  const escalations = (data?.escalations ?? []).filter(c => scope === 'all' || c.module === scope);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f5f7fb' }}>
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_W, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', top: 0, left: 0, width: SIDEBAR_W, height: '100vh', zIndex: 100 }}>
            <CaptainSidebar onClose={() => {}} userName={userName} />
          </Box>
        </Box>
      )}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_W, border: 'none' } }} ModalProps={{ keepMounted: true }}>
        <CaptainSidebar onClose={() => setDrawerOpen(false)} userName={userName} />
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {isMobile && (
              <IconButton size="small" onClick={() => setDrawerOpen(true)}><MenuIcon /></IconButton>
            )}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  Command Overview
                </Typography>
                <Chip label="Barangay Captain" size="small"
                  sx={{ bgcolor: `${ACCENT}14`, color: ACCENT, fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
              </Box>
              <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mt: 0.2 }}>
                Consolidated oversight of the Blotter and VAWC modules
                {data && ` · updated ${timeAgo(data.generatedAt)}`}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
            <ToggleButtonGroup size="small" exclusive value={scope}
              onChange={(_, v) => v && setScope(v)}
              sx={{ flex: { xs: 1, sm: 'none' }, '& .MuiToggleButton-root': { flex: { xs: 1, sm: 'none' } } }}>
              <ToggleButton value="all" sx={{ textTransform: 'none', fontSize: '0.82rem', px: 1.5 }}>All</ToggleButton>
              <ToggleButton value="Blotter" sx={{ textTransform: 'none', fontSize: '0.82rem', px: 1.5 }}>Blotter</ToggleButton>
              <ToggleButton value="VAWC" sx={{ textTransform: 'none', fontSize: '0.82rem', px: 1.5 }}>VAWC</ToggleButton>
            </ToggleButtonGroup>
            <AnnounceButton accent={ACCENT} />
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={() => mutate()} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
                <Refresh sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {error && (
          <Card sx={{ mb: 2.5, border: '1px solid #fecaca', bgcolor: '#fef2f2' }}>
            <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Warning sx={{ color: '#dc2626' }} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#991b1b' }}>
                  {String(error.message) === '403'
                    ? 'This dashboard is restricted to the Barangay Captain'
                    : 'Could not load oversight data'}
                </Typography>
                <Typography sx={{ fontSize: '0.86rem', color: '#b91c1c' }}>
                  {String(error.message) === '403'
                    ? 'Your account does not have captain-level access.'
                    : 'The server did not respond. Check your connection and try again.'}
                </Typography>
              </Box>
              <Button size="small" onClick={() => mutate()} startIcon={<Refresh sx={{ fontSize: 15 }} />}
                sx={{ textTransform: 'none', fontWeight: 700, color: '#991b1b' }}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stat row */}
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Total Residents" color="#0f766e" loading={loading}
              icon={<PersonOutlined sx={{ fontSize: 18 }} />}
              value={data?.residents.total ?? 0}
              sub={`${data?.residents.pending ?? 0} pending verification`}
              onClick={() => router.push('/residents')} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Active Cases" color="#d97706" loading={loading}
              icon={<FolderOpen sx={{ fontSize: 18 }} />}
              value={t?.active ?? 0}
              sub={`of ${t?.cases ?? 0} total on record`} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Critical Open" color="#dc2626" loading={loading}
              icon={<Warning sx={{ fontSize: 18 }} />}
              value={t?.criticalOpen ?? 0}
              sub={`${t?.alerts ?? 0} active alert${(t?.alerts ?? 0) !== 1 ? 's' : ''}`} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <StatCard label="Safety Index" color="#475569" loading={loading}
              icon={<TrendingUp sx={{ fontSize: 18 }} />}
              value={`${t?.safetyIndex ?? 0}%`}
              sub={`${t?.resolutionRate ?? 0}% resolution rate`} />
          </Grid>
        </Grid>

        {/* Module bridges */}
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <ModuleCard title="Blotter Module" color={MODULE_COLOR.Blotter} loading={loading}
              icon={<Gavel sx={{ fontSize: 20 }} />}
              summary={data?.modules.blotter}
              onOpen={() => router.push('/blotter-officer')} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <ModuleCard title="VAWC Module" color={MODULE_COLOR.VAWC} loading={loading}
              icon={<Shield sx={{ fontSize: 20 }} />}
              summary={data?.modules.vawc}
              onOpen={() => router.push('/vawc')} />
          </Grid>
        </Grid>

        {/* Trends + escalations */}
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 12, lg: 7 }} sx={{ minWidth: 0 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a' }}>Case Intake Trends</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mb: 2 }}>
                  Cases filed per month, split by module — last 6 months
                </Typography>
                {/* minWidth:0 stops the grid item from collapsing ResponsiveContainer to -1 */}
                <Box sx={{ height: { xs: 220, sm: 270 }, minWidth: 0 }}>
                  {loading ? <Skeleton variant="rectangular" height="100%" sx={{ borderRadius: 2 }} /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data?.trends ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="kb" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={MODULE_COLOR.Blotter} stopOpacity={0.35} />
                            <stop offset="95%" stopColor={MODULE_COLOR.Blotter} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="kv" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={MODULE_COLOR.VAWC} stopOpacity={0.35} />
                            <stop offset="95%" stopColor={MODULE_COLOR.VAWC} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                        <ChartTooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }} />
                        <Legend wrapperStyle={{ fontSize: '0.86rem' }} />
                        <Area type="monotone" dataKey="blotter" name="Blotter" stroke={MODULE_COLOR.Blotter} fill="url(#kb)" strokeWidth={2.5} />
                        <Area type="monotone" dataKey="vawc" name="VAWC" stroke={MODULE_COLOR.VAWC} fill="url(#kv)" strokeWidth={2.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 5 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
                  <NotificationsActive sx={{ fontSize: 17, color: '#dc2626' }} />
                  <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a' }}>Needs Your Attention</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mb: 1.5 }}>
                  Unresolved high and critical cases across both modules
                </Typography>
                {loading ? (
                  <Box>{[0, 1, 2].map(i => <Skeleton key={i} variant="text" height={44} />)}</Box>
                ) : escalations.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CheckCircle sx={{ fontSize: 32, color: '#22c55e', mb: 1 }} />
                    <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>No open escalations</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {escalations.map((c, i) => (
                      <motion.div key={c.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                        <Box
                          onClick={() => router.push(c.module === 'VAWC' ? '/vawc/cases' : `/blotter-officer/case-management/${c.id}`)}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 1.25, p: 1.25,
                            borderRadius: 2, cursor: 'pointer',
                            border: `1px solid ${RISK_COLOR[c.riskLevel] ?? '#e2e8f0'}22`,
                            bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}07`,
                            '&:hover': { bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}12` },
                            transition: 'background 0.15s',
                          }}
                        >
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: RISK_COLOR[c.riskLevel] ?? '#64748b', flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.residentName}
                            </Typography>
                            <Typography sx={{ fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.caseType} · {c.officer ?? 'Unassigned'}
                            </Typography>
                          </Box>
                          <Chip size="small" label={c.module}
                            sx={{ bgcolor: `${MODULE_COLOR[c.module]}15`, color: MODULE_COLOR[c.module], fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                        </Box>
                      </motion.div>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Case registry */}
        <Card sx={{ mb: 2.5 }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a' }}>Latest Case Activity</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                  Most recent filings from both modules{scope !== 'all' ? ` — ${scope} only` : ''}
                </Typography>
              </Box>
              <Button size="small" endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
                onClick={() => router.push(scope === 'VAWC' ? '/vawc/cases' : '/blotter-officer/case-management')}
                sx={{ color: ACCENT, fontWeight: 700, fontSize: '0.86rem', textTransform: 'none' }}>
                View all
              </Button>
            </Box>
            <CaseTable rows={recent} loading={loading} emptyText={`No ${scope === 'all' ? '' : scope + ' '}cases on record yet`} />
          </CardContent>
        </Card>

        {/* Staff + activity */}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a', flex: 1 }}>Barangay Staff</Typography>
                  {(data?.staff.byRole ?? []).map(r => (
                    <Chip key={r.role} size="small" label={`${ROLE_LABEL[r.role] ?? r.role}: ${r.count}`}
                      sx={{ bgcolor: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: '0.72rem', height: 22 }} />
                  ))}
                </Box>
                {loading ? (
                  <Box>{[0, 1, 2].map(i => <Skeleton key={i} variant="text" height={44} />)}</Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {(data?.staff.members ?? []).slice(0, 6).map(m => (
                      <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.1, borderRadius: 2, border: '1px solid #f1f5f9' }}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: '#e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                          {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>{m.name}</Typography>
                          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ROLE_LABEL[m.role] ?? m.role}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right', minWidth: 74 }}>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: m.caseload > 0 ? '#0f172a' : '#cbd5e1' }}>
                            {m.caseload}
                          </Typography>
                          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>caseload</Typography>
                        </Box>
                      </Box>
                    ))}
                    {(data?.staff.members.length ?? 0) > 6 && (
                      <Button size="small" onClick={() => router.push('/users')}
                        sx={{ alignSelf: 'flex-start', color: ACCENT, fontWeight: 700, fontSize: '0.82rem', textTransform: 'none' }}>
                        View all {data?.staff.total} staff →
                      </Button>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 5 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0f172a', mb: 1.5 }}>Recent Activity</Typography>
                {loading ? (
                  <Box>{[0, 1, 2, 3].map(i => <Skeleton key={i} variant="text" height={38} />)}</Box>
                ) : (data?.activities.length ?? 0) === 0 ? (
                  <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8', fontStyle: 'italic', py: 3, textAlign: 'center' }}>
                    No recorded activity yet
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.4 }}>
                    {(data?.activities ?? []).slice(0, 7).map(a => (
                      <Box key={a.id} sx={{ display: 'flex', gap: 1.25 }}>
                        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: a.color || '#3b82f6', mt: '5px', flexShrink: 0 }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.86rem', color: '#334155', lineHeight: 1.45 }}>{a.message}</Typography>
                          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{timeAgo(a.createdAt)}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {(t?.criticalOpen ?? 0) > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <LinearProgress variant="determinate" value={t?.safetyIndex ?? 0}
              sx={{ height: 5, borderRadius: 3, bgcolor: '#e2e8f0', '& .MuiLinearProgress-bar': { bgcolor: (t?.safetyIndex ?? 0) > 60 ? '#22c55e' : (t?.safetyIndex ?? 0) > 30 ? '#f59e0b' : '#dc2626', borderRadius: 3 } }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.75 }}>
              Safety index = resolution rate minus a penalty for unresolved critical and high-risk cases.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
