'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton, Button, Divider, Tooltip, Collapse, Alert, Dialog,
  DialogTitle, DialogContent, DialogActions, IconButton, Stack,
} from '@mui/material';
import {
  Psychology, Warning, CheckCircle, Info,
  AutoAwesome, Refresh, ExpandMore, ExpandLess, LocationOn,
  Person, AccessTime, Category, Science, DataObject,
} from '@mui/icons-material';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  Legend, Cell,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAIStats } from '@/hooks/useApi';

interface FactorScore {
  factor: string; weight: number; score: number; contribution: number; detail: string;
}

interface RiskCase {
  id: string; caseNumber: string; residentName: string; caseType: string;
  barangay: string; status: string; score: number; level: 'Critical' | 'High' | 'Medium' | 'Low';
  confidence: number; recommendation: string; factors: FactorScore[]; filedAt: string;
}

interface AIStatsData {
  summary: { critical: number; high: number; medium: number; low: number };
  byBarangay: { barangay: string; total: number; highRisk: number; avgScore: number }[];
  monthly: { month: string; High: number; Medium: number; Low: number }[];
  radarData: { subject: string; score: number; count: number; fullMark: number }[];
  topRiskCases: RiskCase[];
  totalAnalyzed: number;
  lastUpdated: string;
}

const RISK_COLOR: Record<string, string> = {
  Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e',
};

const FACTOR_ICON: Record<string, typeof Category> = {
  'Case Type Severity': Category,
  'Repeat Offender': Person,
  'Location Hotspot': LocationOn,
  'Response Urgency': AccessTime,
  'Incident Time': AccessTime,
};

function scoreColor(score: number) {
  return score >= 75 ? '#8b5cf6' : score >= 55 ? '#ef4444' : score >= 35 ? '#f97316' : '#22c55e';
}

function RiskScoreRing({ score, level, size = 64 }: { score: number; level: string; size?: number }) {
  const color = RISK_COLOR[level] ?? '#94a3b8';
  const inner = Math.round(size * 0.74);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${color} ${score * 3.6}deg, #f1f5f9 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ width: inner, height: inner, borderRadius: '50%', bgcolor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: size >= 60 ? '1rem' : '0.8rem', fontWeight: 800, color, lineHeight: 1 }}>{score}</Typography>
        </Box>
      </Box>
      <Chip label={level} size="small" sx={{ bgcolor: `${color}18`, color, fontWeight: 700, fontSize: '0.72rem', height: 22, px: 0.5 }} />
    </Box>
  );
}

const MotionTableRow = motion(TableRow);

function ExpandableRow({ c }: { c: RiskCase }) {
  const [open, setOpen] = useState(false);
  const color = RISK_COLOR[c.level] ?? '#94a3b8';
  return (
    <>
      <MotionTableRow
        onClick={() => setOpen(p => !p)}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        sx={{ cursor: 'pointer', '& td': { py: 1.2, borderBottom: open ? 'none' : '1px solid #f8fafc' }, '&:hover': { bgcolor: `${color}07` }, bgcolor: open ? `${color}05` : 'transparent', transition: 'background 0.15s' }}
      >
        <TableCell><Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>#{c.caseNumber}</Typography></TableCell>
        <TableCell>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{c.residentName}</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.barangay}</Typography>
        </TableCell>
        <TableCell>
          <Chip label={c.caseType.split(' ').slice(0, 2).join(' ')} size="small" sx={{ fontSize: '0.78rem', height: 24, bgcolor: '#f1f5f9', color: '#475569' }} />
        </TableCell>
        <TableCell><RiskScoreRing score={c.score} level={c.level} size={52} /></TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: c.status === 'Open' ? '#f97316' : c.status === 'In Progress' ? '#3b82f6' : '#22c55e', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.86rem' }}>{c.status}</Typography>
          </Box>
        </TableCell>
        <TableCell><Chip label={`${c.confidence}% conf.`} size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} /></TableCell>
        <TableCell padding="none" sx={{ pr: 1 }}>
          <IconButton size="small" sx={{ p: 0.3 }}>
            {open ? <ExpandLess sx={{ fontSize: 15, color: '#94a3b8' }} /> : <ExpandMore sx={{ fontSize: 15, color: '#94a3b8' }} />}
          </IconButton>
        </TableCell>
      </MotionTableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, borderBottom: open ? '1px solid #f1f5f9' : 'none', px: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2, px: 2.5, bgcolor: '#fafbfd', borderLeft: `3px solid ${color}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>AI Factor Breakdown — Overall Score: {c.score}/100</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: `${color}12`, borderRadius: 1.5, px: 1.25, py: 0.5 }}>
                  <AutoAwesome sx={{ fontSize: 13, color }} />
                  <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color }}>{c.recommendation}</Typography>
                </Box>
              </Box>
              <Grid container spacing={1.5}>
                {c.factors.map((f, i) => {
                  const IconComp = FACTOR_ICON[f.factor] ?? Info;
                  const col = scoreColor(f.score);
                  return (
                    <Grid key={f.factor} size={{ xs: 12, sm: 6 }}>
                      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                        <Box sx={{ mb: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.4 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                              <IconComp sx={{ fontSize: 13, color: col }} />
                              <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#374151' }}>{f.factor}</Typography>
                              <Chip label={`w:${f.weight}%`} size="small" sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#f1f5f9', color: '#94a3b8', ml: 0.25 }} />
                            </Box>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: col }}>{f.contribution}pts</Typography>
                          </Box>
                          <LinearProgress variant="determinate" value={f.score} sx={{ height: 5, borderRadius: 5, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: col, borderRadius: 5 } }} />
                          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.3, lineHeight: 1.4 }}>{f.detail}</Typography>
                        </Box>
                      </motion.div>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function ModelInfoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 800, color: '#0c1e46', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Psychology sx={{ color: '#8b5cf6', fontSize: 26 }} />AI Engine Information
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            <Chip label="Currently Active" color="success" size="small" sx={{ fontWeight: 700 }} />
            <Chip label="No API key required" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.78rem' }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46', mb: 0.5 }}>SafComm Rule-Based Engine v1.0</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mb: 1.5, lineHeight: 1.6 }}>
            Transparent, multi-factor weighted scoring running against live PostgreSQL data. Every score is traceable to a specific factor.
          </Typography>
          <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#374151', mb: 1 }}>Scoring Factors</Typography>
            {[
              { f: 'Case Type Severity', w: '30%', n: 'Keyword → severity map (Assault 95, Drugs 90 … Vandalism 28)' },
              { f: 'Repeat Offender', w: '25%', n: 'Prior blotter records linked to same resident ID' },
              { f: 'Location Hotspot', w: '20%', n: 'Case density in same barangay over last 30 days' },
              { f: 'Response Urgency', w: '15%', n: 'Days open × current status (Open overdue = highest)' },
              { f: 'Incident Time', w: '10%', n: 'Late-night filings (10pm–4am) carry elevated risk' },
            ].map(row => (
              <Box key={row.f} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
                <Chip label={row.w} size="small" sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#e0e7ff', color: '#4338ca', fontWeight: 700, flexShrink: 0, mt: '1px' }} />
                <Box>
                  <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#374151' }}>{row.f}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{row.n}</Typography>
                </Box>
              </Box>
            ))}
            <Divider sx={{ my: 1.25 }} />
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Thresholds: ≥75 = Critical · ≥55 = High · ≥35 = Medium · &lt;35 = Low</Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} variant="contained" sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function RiskPage() {
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  const { data: stats, isLoading, mutate } = useAIStats() as {
    data: AIStatsData | undefined; isLoading: boolean; mutate: () => Promise<unknown>;
  };

  const runAnalysis = async () => { setAnalysing(true); await mutate(); setAnalysing(false); };

  const summary = stats?.summary ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const summaryCards = [
    { label: 'Critical', count: summary.critical, color: '#8b5cf6', emoji: '🔴' },
    { label: 'High', count: summary.high, color: '#ef4444', emoji: '🟠' },
    { label: 'Medium', count: summary.medium, color: '#f97316', emoji: '🟡' },
    { label: 'Low', count: summary.low, color: '#22c55e', emoji: '🟢' },
  ];

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>AI Risk Prediction</Typography>
              <Chip label="Rule Engine v1.0" size="small" icon={<Science sx={{ fontSize: '13px !important', color: '#7c3aed !important' }} />}
                sx={{ bgcolor: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
            </Box>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>
              {stats
                ? `${stats.totalAnalyzed} case${stats.totalAnalyzed !== 1 ? 's' : ''} analyzed · Last run: ${new Date(stats.lastUpdated).toLocaleTimeString()}`
                : 'Community-wide risk analysis and threat assessment'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<DataObject sx={{ fontSize: 16 }} />}
              onClick={() => setModelInfoOpen(true)}
              sx={{ borderRadius: 2, fontSize: '0.9rem', color: '#64748b', borderColor: '#e2e8f0' }}>
              Model Info
            </Button>
            <Button variant="contained" size="small"
              startIcon={analysing
                ? <Refresh sx={{ animation: 'spin 0.9s linear infinite', '@keyframes spin': { '100%': { transform: 'rotate(360deg)' } } }} />
                : <AutoAwesome sx={{ fontSize: 18 }} />}
              onClick={runAnalysis} disabled={analysing}
              sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' }, fontWeight: 600 }}>
              {analysing ? 'Analysing…' : 'Run Analysis'}
            </Button>
          </Stack>
        </Box>

        {/* Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {summaryCards.map((r, i) => (
            <Grid key={r.label} size={{ xs: 6, sm: 3 }}>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <Card sx={{ textAlign: 'center', '&:hover': { boxShadow: `0 8px 24px ${r.color}22`, transform: 'translateY(-2px)' }, transition: 'all 0.2s' }}>
                  <CardContent sx={{ p: 2, pb: '16px !important' }}>
                    <Typography sx={{ fontSize: '1.5rem', mb: 0.25 }}>{r.emoji}</Typography>
                    {isLoading ? <Skeleton variant="text" width={44} height={48} sx={{ mx: 'auto' }} />
                      : <Typography sx={{ fontSize: '2.1rem', fontWeight: 800, color: r.color, lineHeight: 1 }}>{r.count}</Typography>}
                    <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', fontWeight: 600, mt: 0.25 }}>{r.label} Risk</Typography>
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </Grid>

        {/* Charts Row */}
        <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.4 }}>Risk Pattern by Category</Typography>
                <Typography color="text.secondary" sx={{ fontSize: '0.82rem', mb: 1.5 }}>Average computed risk score per incident type</Typography>
                <Box sx={{ minWidth: 0 }}>
                  {isLoading ? <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
                    : stats?.radarData?.length ? (
                      <ResponsiveContainer width="100%" height={240}>
                        <RadarChart data={stats.radarData}>
                          <PolarGrid stroke="#f1f5f9" />
                          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <Radar name="Avg Risk Score" dataKey="score" stroke="#0c1e46" fill="#0c1e46" fillOpacity={0.16} strokeWidth={2} dot={{ fill: '#0c1e46', r: 3 }} />
                          <ChartTooltip formatter={(v: unknown) => [`${String(v)}/100`, 'Avg Risk Score']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    ) : (
                      <Box sx={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                        <Psychology sx={{ fontSize: 36, color: '#e2e8f0' }} />
                        <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No case data yet — run analysis first</Typography>
                      </Box>
                    )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 7 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.4 }}>Monthly Risk Distribution</Typography>
                <Typography color="text.secondary" sx={{ fontSize: '0.82rem', mb: 1.5 }}>AI-computed risk levels stacked by month (last 6 months)</Typography>
                <Box sx={{ minWidth: 0 }}>
                  {isLoading ? <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
                    : (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={stats?.monthly ?? []} barSize={18} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                          <ChartTooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }} />
                          <Legend iconSize={10} wrapperStyle={{ fontSize: '0.86rem' }} />
                          <Bar dataKey="High" stackId="a" fill="#ef4444" />
                          <Bar dataKey="Medium" stackId="a" fill="#f97316" />
                          <Bar dataKey="Low" stackId="a" fill="#22c55e" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Barangay Hotspot */}
        <Card sx={{ mb: 2.5 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
              <LocationOn sx={{ color: '#ef4444', fontSize: 18 }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Barangay Risk Hotspots</Typography>
            </Box>
            <Typography color="text.secondary" sx={{ fontSize: '0.82rem', mb: 1.75 }}>Top barangays by average AI risk score (color = risk level)</Typography>
            <Box sx={{ minWidth: 0 }}>
              {isLoading ? <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
                : stats?.byBarangay?.length ? (
                  <ResponsiveContainer width="100%" height={stats?.byBarangay?.length ? Math.max(160, stats.byBarangay.length * 32 + 40) : 160}>
                    <BarChart data={stats.byBarangay} layout="vertical" barSize={18} margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <YAxis dataKey="barangay" type="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={95} />
                      <ChartTooltip formatter={(v: unknown, name: unknown) => [`${String(v)}${name === 'avgScore' ? '/100' : ' cases'}`, name === 'avgScore' ? 'Avg Risk Score' : 'High-Risk Cases']} contentStyle={{ borderRadius: 8, border: 'none', fontSize: '0.9rem' }} />
                      <Bar dataKey="avgScore" name="avgScore" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#64748b' }}>
                        {stats.byBarangay.map((d, i) => <Cell key={i} fill={scoreColor(d.avgScore)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                    <LocationOn sx={{ fontSize: 36, color: '#e2e8f0' }} />
                    <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No barangay data yet</Typography>
                  </Box>
                )}
            </Box>
          </CardContent>
        </Card>

        {/* Scoring Weights + High-Risk Cases */}
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Psychology sx={{ color: '#0c1e46', fontSize: 20 }} />
                  <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Scoring Weights</Typography>
                  <Tooltip title="Click 'Model Info' to see full algorithm details"><Info sx={{ fontSize: 14, color: '#94a3b8', ml: 'auto', cursor: 'help' }} /></Tooltip>
                </Box>
                {[
                  { factor: 'Case Type Severity', weight: 30, desc: 'Offense classification severity mapping' },
                  { factor: 'Repeat Offender', weight: 25, desc: 'Prior blotter records for same resident' },
                  { factor: 'Location Hotspot', weight: 20, desc: 'Barangay incident density (30 days)' },
                  { factor: 'Response Urgency', weight: 15, desc: 'Case age + current resolution status' },
                  { factor: 'Incident Time', weight: 10, desc: 'Hour-of-day risk multiplier' },
                ].map((f, i) => (
                  <motion.div key={f.factor} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4, alignItems: 'center' }}>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151' }}>{f.factor}</Typography>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#0c1e46' }}>{f.weight}%</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={f.weight * 3.2}
                        sx={{ height: 6, borderRadius: 5, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: '#0c1e46', borderRadius: 5 } }} />
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.35 }}>{f.desc}</Typography>
                    </Box>
                  </motion.div>
                ))}
                <Divider sx={{ my: 1.5 }} />
                <Alert severity="info" sx={{ fontSize: '0.78rem', py: 0.5, px: 1, '& .MuiAlert-icon': { fontSize: 16, pt: '3px' } }}>
                  ≥75 Critical · ≥55 High · ≥35 Medium · &lt;35 Low
                </Alert>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Card>
              <CardContent sx={{ p: 2.5, pb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning sx={{ color: '#ef4444', fontSize: 18 }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>High-Risk & Critical Cases</Typography>
                    {stats?.topRiskCases?.length ? (
                      <Chip label={`${stats.topRiskCases.length} flagged`} size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                    ) : null}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75 }}>
                    <Chip label="Live" size="small" sx={{ bgcolor: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
                    <Chip label="Click row to expand" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 24 }} />
                  </Box>
                </Box>
              </CardContent>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.2, borderBottom: '1px solid #f1f5f9' } }}>
                      {['Case #', 'Subject', 'Type', 'AI Score', 'Status', 'Confidence', ''].map(h => <TableCell key={h}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <AnimatePresence>
                      {isLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            {Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton variant="text" width={55} /></TableCell>)}
                          </TableRow>
                        ))
                        : (stats?.topRiskCases ?? []).length === 0
                        ? (
                          <TableRow>
                            <TableCell colSpan={7} sx={{ textAlign: 'center', py: 5 }}>
                              <CheckCircle sx={{ fontSize: 36, color: '#22c55e', display: 'block', mx: 'auto', mb: 1 }} />
                              <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, color: '#374151' }}>All Clear — No High-Risk Cases</Typography>
                              <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', mt: 0.25 }}>Click "Run Analysis" to score all cases.</Typography>
                            </TableCell>
                          </TableRow>
                        )
                        : (stats?.topRiskCases ?? []).map(c => <ExpandableRow key={c.id} c={c} />)
                      }
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Grid>
        </Grid>

        <ModelInfoDialog open={modelInfoOpen} onClose={() => setModelInfoOpen(false)} />
      </Box>
    </DashboardLayout>
  );
}
