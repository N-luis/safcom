'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box, Typography, Card, CardActionArea, CardContent, Grid, Chip, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton,
} from '@mui/material';
import {
  InsertDriveFileOutlined, Warning, FlashOn, CheckCircle,
  TrendingUp, TrendingDown, PushPin, ArrowForward,
} from '@mui/icons-material';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import AnnounceButton from '@/components/announcements/AnnounceButton';

const MotionTableRow = motion(TableRow);

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const ACCENT = '#7c3aed';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  total: number; highRisk: number; active: number; resolved: number;
  growth: number | null; newToday: number;
}
interface TrendRow { month: string; total: number; resolved: number; highRisk: number; }
interface UrgentCase {
  id: string; caseNumber: string; subjectName: string; riskLevel: string;
  filedAt: string; updatedAt: string; barangay: string;
}
interface UrgentData { cases: UrgentCase[]; totalUrgent: number; newCount: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just Now';
  if (m < 60) return `${m} min${m > 1 ? 's' : ''} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const RISK_COLOR: Record<string, string> = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' };
const RISK_BG: Record<string, string> = { Critical: '#fef2f2', High: '#fff7ed', Medium: '#fffbeb', Low: '#f0fdf4' };

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, badge, value, sub, color, iconBg, delay, href, hint }: {
  icon: React.ElementType; label: string; badge: { text: string; color: string; bg: string };
  value: number | null; sub: { text: string; positive?: boolean } | null;
  color: string; iconBg: string; delay: number;
  /** Where the card's number lives - the filtered case list that adds up to it. */
  href: string;
  /** What the viewer lands on, shown on hover so the click is predictable. */
  hint: string;
}) {
  return (
    // The Card's height:100% only resolves if every wrapper between it and the
    // Grid item also has a height — motion.div sits in between, so it needs one
    // too or the cards collapse to their own content height.
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      style={{ height: '100%' }}
    >
      <Card sx={{
        height: '100%', display: 'flex', flexDirection: 'column',
        transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
        // A resting border that is visible but quiet: the card reads as a
        // surface you can act on even before the pointer reaches it.
        border: `1px solid ${color}26`,
        '&:hover': { boxShadow: `0 10px 30px ${color}2e`, transform: 'translateY(-3px)', borderColor: color },
        // Pressing it moves: without this the click feels like nothing happened
        // during the moment before the next page paints.
        '&:active': { transform: 'translateY(-1px)', boxShadow: `0 4px 14px ${color}33`, transition: 'transform 0.06s, box-shadow 0.06s' },
        // Keyboard users get the same affordance as the pointer hover.
        '&:has(a:focus-visible)': { boxShadow: `0 10px 30px ${color}2e`, borderColor: color },
        '@media (prefers-reduced-motion: reduce)': {
          '&:hover': { transform: 'none' }, '&:active': { transform: 'none' },
        },
      }}>
        {/* A real anchor, not a button: middle-click and open-in-new-tab work,
            and it is reachable by keyboard without extra handlers. */}
        <CardActionArea
          component={Link}
          href={href}
          aria-label={`${label}: view ${hint}`}
          sx={{
            flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
            // stretch makes CardContent fill the width on its own. Do NOT add
            // width:100% - there is no CssBaseline in this layout, so box-sizing
            // is content-box and the 20px padding would land outside the card,
            // clipping the badge chip and the View hint against its right edge.
            alignItems: 'stretch', justifyContent: 'flex-start', borderRadius: 'inherit',
            '& .MuiCardActionArea-focusHighlight': { display: 'none' },
            // The hint is always on screen; hover only strengthens it and
            // nudges the arrow, so the card never looks inert at rest.
            '&:hover .stat-card-hint, &:focus-visible .stat-card-hint': { opacity: 1 },
            '&:hover .stat-card-arrow, &:focus-visible .stat-card-arrow': { transform: 'translateX(3px)' },
            '&:hover .stat-card-icon, &:focus-visible .stat-card-icon': { transform: 'scale(1.08)' },
            '@media (prefers-reduced-motion: reduce)': {
              '&:hover .stat-card-arrow, &:hover .stat-card-icon': { transform: 'none' },
            },
          }}
        >
        <CardContent sx={{ p: 2.5, pb: '20px !important', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
            <Box className="stat-card-icon" sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform 0.2s' }}>
              <Icon sx={{ fontSize: 20, color }} />
            </Box>
            <Chip label={badge.text} size="small" sx={{ bgcolor: badge.bg, color: badge.color, fontWeight: 700, fontSize: '0.72rem', height: 24, borderRadius: 1 }} />
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 500, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</Typography>
          {value === null
            ? <Skeleton variant="text" width={80} sx={{ fontSize: '2.2rem', mb: 1 }} />
            : <Typography sx={{ fontSize: '2.2rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1, mb: 1 }}>{value.toLocaleString()}</Typography>
          }
          {/* Always rendered, even when empty: only two of the four cards have a
              sub-line, and omitting the row entirely made those cards shorter. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, rowGap: 0.5, minHeight: 20, mt: 'auto', flexWrap: 'wrap' }}>
            {sub && (
              // Grouped so wrapping moves the whole sub-line, never splitting the
              // trend arrow away from its text.
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                {sub.positive !== undefined && (sub.positive ? <TrendingUp sx={{ fontSize: 13, color: '#22c55e' }} /> : <TrendingDown sx={{ fontSize: 13, color: '#ef4444' }} />)}
                <Typography sx={{ fontSize: '0.82rem', color: sub.positive === undefined ? '#94a3b8' : sub.positive ? '#22c55e' : '#ef4444' }}>{sub.text}</Typography>
              </Box>
            )}
            {/* Sits in the row already reserved above, so it can never change
                the card's height. Visible at rest - a hover-only cue leaves the
                card looking unclickable to anyone who has not hovered it yet. */}
            <Box
              className="stat-card-hint"
              sx={{
                ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.3,
                opacity: 0.8, transition: 'opacity 0.2s', color, flexShrink: 0,
              }}
            >
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit', whiteSpace: 'nowrap' }}>View</Typography>
              <ArrowForward className="stat-card-arrow" sx={{ fontSize: 13, transition: 'transform 0.2s' }} />
            </Box>
          </Box>
        </CardContent>
        </CardActionArea>
      </Card>
    </motion.div>
  );
}

// ─── Custom tooltip for chart ─────────────────────────────────────────────────
function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: 'white', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', minWidth: 140 }}>
      <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46', mb: 0.75 }}>{label}</Typography>
      {payload.map(p => (
        <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>{p.name}: <Box component="span" sx={{ fontWeight: 700 }}>{p.value}</Box></Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────
export default function VawcDashboard() {
  const router = useRouter();
  const [trendPeriod, setTrendPeriod] = useState<6 | 12>(6);

  const { data: stats } = useSWR<Stats>('/api/vawc/stats', fetcher, { refreshInterval: 30000 });
  const { data: trends } = useSWR<TrendRow[]>(`/api/vawc/trends?period=${trendPeriod}`, fetcher, { refreshInterval: 60000 });
  const { data: urgentData } = useSWR<UrgentData>('/api/vawc/urgent?limit=3', fetcher, { refreshInterval: 30000 });

  const total = stats?.total ?? null;
  const resolved = stats?.resolved ?? 0;
  const active = stats?.active ?? 0;
  const open = total !== null ? total - resolved - active : 0;

  const donutData = [
    { name: 'Resolved Cases', value: resolved, color: '#22c55e' },
    { name: 'In Progress', value: active, color: '#14b8a6' },
    { name: 'Urgent/New', value: open > 0 ? open : 0, color: '#ef4444' },
  ].filter(d => d.value > 0);

  const resolutionRate = total && total > 0 ? Math.round((resolved / total) * 100) : 0;

  const urgentCases = urgentData?.cases ?? [];
  const totalUrgent = urgentData?.totalUrgent ?? 0;
  const newCount = urgentData?.newCount ?? 0;

  return (
    <Box sx={{ maxWidth: 1280 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
              VAWC Dashboard
            </Typography>
            <Chip
              label="LIVE ANALYTICS"
              size="small"
              sx={{ bgcolor: 'rgba(20,184,166,0.1)', color: '#0d9488', fontWeight: 700, fontSize: '0.72rem', height: 24, letterSpacing: '0.06em', border: '1px solid rgba(20,184,166,0.25)' }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mt: 0.25 }}>
            Real-time monitoring of Violence Against Women and Children cases
          </Typography>
        </Box>
        <AnnounceButton accent="#7c3aed" />
      </Box>

      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            icon={InsertDriveFileOutlined}
            label="Total VAWC Cases"
            badge={{ text: stats?.growth != null ? `${stats.growth >= 0 ? '+' : ''}${stats.growth}%` : 'N/A', color: (stats?.growth ?? 0) >= 0 ? '#15803d' : '#b91c1c', bg: (stats?.growth ?? 0) >= 0 ? '#f0fdf4' : '#fef2f2' }}
            value={total}
            sub={stats?.newToday ? { text: `${stats.newToday} new today`, positive: undefined } : null}
            color="#14b8a6"
            iconBg="rgba(20,184,166,0.1)"
            delay={0}
            href="/vawc/cases"
            hint="all VAWC cases"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            icon={Warning}
            label="High-Risk Cases"
            badge={{ text: 'Priority', color: '#b91c1c', bg: '#fef2f2' }}
            value={stats?.highRisk ?? null}
            sub={null}
            color="#ef4444"
            iconBg="rgba(239,68,68,0.1)"
            delay={0.07}
            href="/vawc/cases?filter=high-risk"
            hint="cases flagged High or Critical"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            icon={FlashOn}
            label="Active Interventions"
            badge={{ text: 'Active', color: '#15803d', bg: '#f0fdf4' }}
            value={stats?.active ?? null}
            sub={null}
            color="#3b82f6"
            iconBg="rgba(59,130,246,0.1)"
            delay={0.14}
            href="/vawc/cases?filter=active"
            hint="cases in progress"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            icon={CheckCircle}
            label="Resolved Cases"
            badge={{ text: 'Success', color: '#15803d', bg: '#f0fdf4' }}
            value={stats?.resolved ?? null}
            sub={total ? { text: `${resolutionRate}% resolution rate`, positive: true } : null}
            color="#22c55e"
            iconBg="rgba(34,197,94,0.1)"
            delay={0.21}
            href="/vawc/cases?filter=resolved"
            hint="resolved and closed cases"
          />
        </Grid>
      </Grid>

      {/* Charts row */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {/* Monthly Trends */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.5 }}>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Monthly Incident Trends</Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mt: 0.2 }}>Comparative analysis of case reporting over time</Typography>
                </Box>
                <Box sx={{ display: 'flex', bgcolor: '#f8fafc', borderRadius: 1.5, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                  {([6, 12] as const).map(p => (
                    <Button key={p} size="small" onClick={() => setTrendPeriod(p)}
                      sx={{
                        minWidth: 72, px: 1.25, py: 0.5, fontSize: '0.82rem', fontWeight: 600, borderRadius: 0,
                        bgcolor: trendPeriod === p ? ACCENT : 'transparent',
                        color: trendPeriod === p ? 'white' : '#64748b',
                        '&:hover': { bgcolor: trendPeriod === p ? ACCENT : 'rgba(0,0,0,0.04)' },
                      }}>
                      {p === 6 ? '6 Months' : '1 Year'}
                    </Button>
                  ))}
                </Box>
              </Box>

              <Box sx={{ minWidth: 0, mt: 1.5 }}>
                {!trends ? (
                  <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={trends} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradHigh" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="total" name="Total Cases" stroke="#14b8a6" strokeWidth={2} fill="url(#gradTotal)" dot={false} activeDot={{ r: 5, fill: '#14b8a6' }} />
                      <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3" fill="url(#gradResolved)" dot={false} activeDot={{ r: 5, fill: '#22c55e' }} />
                      <Area type="monotone" dataKey="highRisk" name="High Risk" stroke="#ef4444" strokeWidth={2} fill="url(#gradHigh)" dot={false} activeDot={{ r: 5, fill: '#ef4444' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Case Distribution */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.25 }}>Case Distribution</Typography>

              {!stats ? (
                <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2, mt: 1 }} />
              ) : total === 0 ? (
                <Box sx={{ textAlign: 'center', py: 5 }}>
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No case data yet</Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, height: 240, mt: 1.5 }}>
                  {/* Donut */}
                  <Box sx={{ position: 'relative', width: 190, height: 190, flexShrink: 0 }}>
                    <ResponsiveContainer width={190} height={190}>
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={58} outerRadius={89} dataKey="value" strokeWidth={0}>
                          {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerEvents: 'none' }}>
                      <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Average</Typography>
                      <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1.1 }}>{resolutionRate}%</Typography>
                    </Box>
                  </Box>

                  {/* Legend */}
                  <Box sx={{ flex: 1 }}>
                    {donutData.map(d => (
                      <Box key={d.name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderBottom: '1px solid #f8fafc' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: '0.86rem', color: '#475569' }}>{d.name}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>
                          {total && total > 0 ? `${Math.round((d.value / total) * 100)}%` : '0%'}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Urgent Cases */}
      <Card>
        {/* Dark header */}
        <Box sx={{
          px: 2.5, py: 1.75, bgcolor: '#0c1e46',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderRadius: '8px 8px 0 0',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <PushPin sx={{ fontSize: 16, color: '#94a3b8' }} />
            <Typography sx={{ fontWeight: 700, color: 'white', fontSize: '0.98rem' }}>
              Urgent Cases Needing Attention
            </Typography>
          </Box>
          {newCount > 0 && (
            <Chip
              label={`ACTION REQUIRED: ${newCount} NEW`}
              size="small"
              sx={{ bgcolor: '#ef4444', color: 'white', fontWeight: 700, fontSize: '0.72rem', height: 24, letterSpacing: '0.04em' }}
            />
          )}
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b', py: 1.25, borderBottom: '1px solid #f1f5f9' } }}>
                {['Subject Name', 'Risk Level', 'Reporting Date', 'Last Interaction'].map(h => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {!urgentData ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}><Skeleton variant="text" width={80} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : urgentCases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4 }}>
                    <CheckCircle sx={{ fontSize: 32, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                    <Typography sx={{ fontSize: '0.94rem', color: '#94a3b8' }}>No urgent cases right now</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                urgentCases.map((c, i) => (
                  <MotionTableRow
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => router.push(`/vawc/cases?highlight=${c.id}`)}
                    sx={{ cursor: 'pointer', '& td': { py: 1.4, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#fafbfc' } }}
                  >
                    <TableCell>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>{c.subjectName}</Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.barangay}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={c.riskLevel.toUpperCase().replace('HIGH', 'HIGH RISK')} size="small"
                        sx={{ bgcolor: RISK_BG[c.riskLevel] ?? '#f8fafc', color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 24, border: `1px solid ${RISK_COLOR[c.riskLevel] ?? '#e2e8f0'}30` }} />
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem', color: '#475569' }}>
                        {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>{timeAgo(c.updatedAt)}</Typography>
                    </TableCell>
                  </MotionTableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer */}
        <Box sx={{ textAlign: 'center', py: 1.75, borderTop: '1px solid #f1f5f9' }}>
          <Button
            size="small" endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
            onClick={() => router.push('/vawc/cases?filter=urgent')}
            sx={{ color: '#14b8a6', fontWeight: 700, fontSize: '0.86rem', letterSpacing: '0.04em', '&:hover': { bgcolor: 'rgba(20,184,166,0.06)' } }}
          >
            SEE ALL URGENT ALERTS ({totalUrgent})
          </Button>
        </Box>
      </Card>
    </Box>
  );
}
