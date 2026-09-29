'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box, Typography, Card, CardActionArea, CardContent, Grid, Chip, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton, Avatar, Fab, Tooltip, IconButton,
} from '@mui/material';
import {
  GridView, ChatBubbleOutlined, Autorenew, CheckCircleOutlined,
  TrendingUp, Add, MoreHoriz, Refresh, Shield, Assessment,
  LocationOn, Update, ArrowForward,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip as ChartTooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from 'framer-motion';

const MotionTableRow = motion(TableRow);
import useSWR, { mutate } from 'swr';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('Fetch error');
    return r.json().then(d => d.data);
  });

const STATUS_COLOR: Record<string, string> = {
  Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#94a3b8',
};
const STATUS_CHIP: Record<string, string> = {
  Open: '#fff7ed', 'In Progress': '#eff6ff', Resolved: '#f0fdf4', Closed: '#f8fafc',
};

function timeAgo(d: string) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface StatsData {
  total: number; pending: number; ongoing: number; resolved: number;
  growth: number | null; lastUpdatedCase: string | null;
}

interface CaseRow {
  id: string; caseNumber: string; caseType: string; description: string;
  status: string; barangay: string; filedAt: string;
}

interface Update {
  id: string; title: string; message: string; color: string; createdAt: string; source: string;
}

const UPDATE_ICON: Record<string, typeof Shield> = {
  case: Assessment,
  alert: Shield,
};

export default function ResidentDashboard() {
  const router = useRouter();
  const [residentName, setResidentName] = useState('');

  const { data: stats, isLoading: statsLoading } = useSWR<StatsData>('/api/resident/cases/stats', fetcher, { refreshInterval: 30000 });
  const { data: casesData, isLoading: casesLoading } = useSWR('/api/resident/cases?limit=5', fetcher, { refreshInterval: 30000 });
  const { data: updates, isLoading: updatesLoading, mutate: refreshUpdates } = useSWR<Update[]>('/api/resident/updates?limit=4', fetcher, { refreshInterval: 30000 });

  const recentCases: CaseRow[] = casesData?.cases ?? [];

  useEffect(() => {
    fetch('/api/auth/resident-me', { credentials: 'include' })
      .then(r => r.json())
      .then(json => {
        if (json?.data) setResidentName(`${json.data.firstName}`);
      })
      .catch(() => {});
  }, []);

  // Case distribution for donut
  const total = stats?.total ?? 0;
  const donutData = [
    { name: 'Resolved', value: stats?.resolved ?? 0, color: '#22c55e' },
    { name: 'Ongoing', value: stats?.ongoing ?? 0, color: '#3b82f6' },
    { name: 'Pending', value: stats?.pending ?? 0, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const statCards = [
    {
      icon: GridView, label: 'Lifetime', title: 'Total Reports Submitted',
      href: '/resident/my-cases', hint: 'all your reports',
      value: stats?.total ?? 0, color: '#14b8a6',
      sub: stats?.growth != null
        ? { text: `${stats.growth >= 0 ? '+' : ''}${stats.growth}% from last month`, color: stats.growth >= 0 ? '#22c55e' : '#ef4444', icon: TrendingUp }
        : { text: 'No data yet', color: '#94a3b8', icon: null },
    },
    {
      icon: ChatBubbleOutlined, label: 'Urgent', title: 'Pending Cases',
      href: '/resident/my-cases?status=Open', hint: 'reports awaiting verification',
      value: stats?.pending ?? 0, color: '#f59e0b',
      sub: { text: 'Awaiting verification', color: '#94a3b8', icon: null },
    },
    {
      icon: Autorenew, label: 'Active', title: 'Ongoing Cases',
      href: '/resident/my-cases?status=In%20Progress', hint: 'cases being worked on',
      value: stats?.ongoing ?? 0, color: '#3b82f6',
      sub: stats?.lastUpdatedCase
        ? { text: `Updated ${timeAgo(stats.lastUpdatedCase)}`, color: '#3b82f6', icon: null }
        : { text: 'No active cases', color: '#94a3b8', icon: null },
    },
    {
      icon: CheckCircleOutlined, label: 'Success', title: 'Resolved Cases',
      href: '/resident/my-cases?status=Resolved,Closed', hint: 'resolved and closed cases',
      value: stats?.resolved ?? 0, color: '#22c55e',
      sub: { text: 'Cases closed successfully', color: '#94a3b8', icon: null },
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1280 }}>
      {/* ── Top bar ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3.5, flexWrap: 'wrap', gap: 1.5 }}>
        <Typography sx={{ fontSize: { xs: '0.98rem', sm: '1.05rem' }, color: '#475569' }}>
          Welcome back,{' '}
          <Box component="span" sx={{ fontWeight: 800, color: '#0c1e46' }}>
            {residentName ? `Resident ${residentName}` : 'Resident'}
          </Box>
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Avatar sx={{ width: 18, height: 22, fontSize: '0.72rem', bgcolor: '#14b8a6' }}>
            {residentName?.[0] ?? 'R'}
          </Avatar>}
          onClick={() => router.push('/resident/profile')}
          sx={{ borderColor: '#14b8a6', color: '#14b8a6', fontWeight: 600, fontSize: '0.9rem', borderRadius: 2, '&:hover': { bgcolor: 'rgba(20,184,166,0.06)', borderColor: '#0d9488' } }}
        >
          Resident Profile
        </Button>
      </Box>

      {/* ── Stat cards ── */}
      <Grid container spacing={2} sx={{ mb: 3.5 }}>
        {statCards.map((card, i) => (
          <Grid key={card.title} size={{ xs: 6, sm: 6, md: 3 }}>
            {/* height:100% on the Card only resolves if every wrapper between it
              * and the Grid item also has one - motion.div sits in between. */}
            <motion.div
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              style={{ height: '100%' }}
            >
              <Card sx={{
                height: '100%', display: 'flex', flexDirection: 'column',
                border: `1px solid ${card.color}26`,
                transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
                '&:hover': { boxShadow: `0 10px 28px ${card.color}2e`, transform: 'translateY(-3px)', borderColor: card.color },
                // Pressing it moves, so the click does not feel like nothing happened.
                '&:active': { transform: 'translateY(-1px)', transition: 'transform 0.06s' },
                '&:has(a:focus-visible)': { boxShadow: `0 10px 28px ${card.color}2e`, borderColor: card.color },
                '@media (prefers-reduced-motion: reduce)': {
                  '&:hover': { transform: 'none' }, '&:active': { transform: 'none' },
                },
              }}>
                {/* A real anchor, so middle-click, open-in-new-tab and the
                  * keyboard all work without extra handlers. */}
                <CardActionArea
                  component={Link}
                  href={card.href}
                  aria-label={`${card.title}: view ${card.hint}`}
                  sx={{
                    flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'stretch', justifyContent: 'flex-start', borderRadius: 'inherit',
                    '& .MuiCardActionArea-focusHighlight': { display: 'none' },
                    '&:hover .res-hint, &:focus-visible .res-hint': { opacity: 1 },
                    '&:hover .res-arrow, &:focus-visible .res-arrow': { transform: 'translateX(3px)' },
                    '@media (prefers-reduced-motion: reduce)': {
                      '&:hover .res-arrow': { transform: 'none' },
                    },
                  }}
                >
                {/* No width:100% here: there is no CssBaseline in this layout, so
                  * box-sizing is content-box and the padding would land outside
                  * the card. The action area stretches its children already. */}
                <CardContent sx={{ p: 2.5, pb: '20px !important', position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: `${card.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <card.icon sx={{ fontSize: 20, color: card.color }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 500 }}>{card.label}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#64748b', mt: 1.5, mb: 0.5 }}>{card.title}</Typography>
                  {statsLoading
                    ? <Skeleton variant="text" width={50} height={42} />
                    : <Typography sx={{ fontSize: '2rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1.1 }}>
                        {String(card.value).padStart(2, '0')}
                      </Typography>
                  }
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, rowGap: 0.5, mt: 'auto', pt: 1, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      {card.sub.icon && <card.sub.icon sx={{ fontSize: 13, color: card.sub.color }} />}
                      <Typography sx={{ fontSize: '0.82rem', color: card.sub.color }}>{card.sub.text}</Typography>
                    </Box>
                    {/* Visible at rest: a hover-only cue leaves the card looking
                      * unclickable to anyone who has not hovered it yet. */}
                    <Box className="res-hint" sx={{
                      ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.3,
                      opacity: 0.8, transition: 'opacity 0.2s', color: card.color, flexShrink: 0,
                    }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit', whiteSpace: 'nowrap' }}>View</Typography>
                      <ArrowForward className="res-arrow" sx={{ fontSize: 13, transition: 'transform 0.2s' }} />
                    </Box>
                  </Box>
                </CardContent>
                </CardActionArea>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* ── Main content row ── */}
      <Grid container spacing={2.5}>
        {/* Recent Reports */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5, pb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.5 }}>
                <Box>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46' }}>Recent Reports</Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>History of your latest community submissions</Typography>
                </Box>
                <Button
                  size="small"
                  onClick={() => router.push('/resident/my-cases')}
                  sx={{ fontSize: '0.86rem', color: '#14b8a6', fontWeight: 600, '&:hover': { bgcolor: 'rgba(20,184,166,0.06)' } }}
                >
                  View All
                </Button>
              </Box>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', py: 1.25, borderBottom: '1px solid #f1f5f9' } }}>
                    {['Case ID', 'Description', 'Category', 'Status', 'Date'].map(h => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {casesLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((__, j) => (
                            <TableCell key={j}><Skeleton variant="text" width={60} /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    : recentCases.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={5} sx={{ textAlign: 'center', py: 5 }}>
                            <Assessment sx={{ fontSize: 36, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                            <Typography sx={{ fontSize: '0.94rem', color: '#94a3b8', fontWeight: 500 }}>No reports yet</Typography>
                            <Button size="small" onClick={() => router.push('/resident/report-case')} sx={{ mt: 1, color: '#14b8a6', fontWeight: 600 }}>
                              File your first report →
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    : recentCases.map((c, i) => (
                        <MotionTableRow
                          key={c.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.05 }}
                          onClick={() => router.push('/resident/my-cases')}
                          sx={{ cursor: 'pointer', '& td': { py: 1.35, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#f8fafc' } }}
                        >
                          <TableCell>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>
                              #{c.caseNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.9rem', color: '#374151', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.description.length > 28 ? c.description.slice(0, 28) + '…' : c.description}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.caseType.split(' ')[0]}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={c.status}
                              size="small"
                              sx={{
                                bgcolor: STATUS_CHIP[c.status] ?? '#f1f5f9',
                                color: STATUS_COLOR[c.status] ?? '#64748b',
                                fontWeight: 700, fontSize: '0.78rem', height: 24,
                                border: `1px solid ${STATUS_COLOR[c.status] ?? '#e2e8f0'}30`,
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>
                              {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Typography>
                          </TableCell>
                        </MotionTableRow>
                      ))
                  }
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        {/* Right column */}
        <Grid size={{ xs: 12, md: 5 }}>
          {/* Case Distribution */}
          <Card sx={{ mb: 2.5 }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46', mb: 0.25 }}>Case Distribution</Typography>
              {statsLoading
                ? <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2, mt: 1 }} />
                : total === 0
                ? (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      <GridView sx={{ fontSize: 36, color: '#e2e8f0' }} />
                      <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8', mt: 1 }}>No case data yet</Typography>
                    </Box>
                  )
                : (
                    <>
                      <Box sx={{ position: 'relative', height: 200 }}>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={donutData}
                              cx="50%" cy="50%"
                              innerRadius={62} outerRadius={88}
                              dataKey="value"
                              strokeWidth={0}
                            >
                              {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <ChartTooltip
                              formatter={(v: unknown) => [`${String(v)} cases`, '']}
                              contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        {/* Center label */}
                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerEvents: 'none' }}>
                          <Typography sx={{ fontSize: '1.8rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1 }}>{total}</Typography>
                          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>TOTAL</Typography>
                        </Box>
                      </Box>
                      {/* Legend */}
                      <Box sx={{ mt: 0.5 }}>
                        {donutData.map(d => (
                          <Box key={d.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.6, borderBottom: '1px solid #f8fafc' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
                              <Typography sx={{ fontSize: '0.9rem', color: '#475569' }}>{d.name}</Typography>
                            </Box>
                            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>
                              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '0%'}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </>
                  )
              }
            </CardContent>
          </Card>

          {/* Latest Updates */}
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46' }}>Latest Updates</Typography>
                <IconButton size="small" sx={{ color: '#94a3b8' }}>
                  <MoreHoriz sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>

              {updatesLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                      <Skeleton variant="circular" width={36} height={36} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width="70%" height={18} />
                        <Skeleton variant="text" width="90%" height={15} />
                        <Skeleton variant="text" width="40%" height={14} />
                      </Box>
                    </Box>
                  ))
                : (updates ?? []).length === 0
                ? (
                    <Box sx={{ textAlign: 'center', py: 2.5 }}>
                      <Update sx={{ fontSize: 32, color: '#e2e8f0' }} />
                      <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8', mt: 0.75 }}>No updates yet</Typography>
                    </Box>
                  )
                : (updates ?? []).map((u, i) => {
                    const IconComp = UPDATE_ICON[u.source] ?? Shield;
                    return (
                      <motion.div key={u.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: `${u.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <IconComp sx={{ fontSize: 18, color: u.color }} />
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46', lineHeight: 1.3 }}>{u.title}</Typography>
                            <Typography sx={{ fontSize: '0.86rem', color: '#64748b', mt: 0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.message}</Typography>
                            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.35 }}>{timeAgo(u.createdAt)}</Typography>
                          </Box>
                        </Box>
                      </motion.div>
                    );
                  })
              }

              <Button
                fullWidth
                variant="outlined"
                startIcon={<Refresh sx={{ fontSize: 16 }} />}
                onClick={() => refreshUpdates()}
                sx={{ mt: 0.5, borderColor: '#e2e8f0', color: '#64748b', fontWeight: 600, fontSize: '0.9rem', '&:hover': { borderColor: '#14b8a6', color: '#14b8a6', bgcolor: 'rgba(20,184,166,0.04)' } }}
              >
                Refresh Feed
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* FAB */}
      <Tooltip title="File a New Report" placement="left">
        <Fab
          color="primary"
          onClick={() => router.push('/resident/report-case')}
          sx={{
            position: 'fixed', bottom: 28, right: 28, zIndex: 50,
            bgcolor: '#14b8a6', '&:hover': { bgcolor: '#0d9488' },
            boxShadow: '0 8px 24px rgba(20,184,166,0.45)',
          }}
        >
          <Add />
        </Fab>
      </Tooltip>
    </Box>
  );
}
