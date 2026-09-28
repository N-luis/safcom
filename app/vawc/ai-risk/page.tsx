'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button,
  Skeleton, LinearProgress,
} from '@mui/material';
import {
  Warning, CheckCircle, TrendingUp, FolderOpen,
  ArrowForward, Shield, LocationOn, ReportProblem,
} from '@mui/icons-material';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import useSWR from 'swr';

const RiskHeatMap = dynamic(() => import('@/components/cases/RiskHeatMap'), { ssr: false });

function scoreColor(score: number) {
  return score >= 55 ? '#ef4444' : score >= 35 ? '#f97316' : '#22c55e';
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const ACCENT = '#7c3aed';
const RISK_COLOR: Record<string, string> = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' };

interface StreetRow { barangay: string; total: number; highRisk: number; avgScore: number; }
interface AreaIntervention extends StreetRow { dominantCaseTypes: string[]; }
interface Stats {
  total: number; highRisk: number; active: number; resolved: number;
  summary?: { critical: number; high: number; medium: number; low: number };
  byStreet?: StreetRow[];
  areaInterventions?: AreaIntervention[];
  totalAnalyzed?: number;
}
interface TrendRow { month: string; total: number; highRisk: number; }
interface UrgentCase { id: string; caseNumber: string; subjectName: string; riskLevel: string; filedAt: string; }

export default function VawcAiRiskPage() {
  const router = useRouter();
  const { data: stats } = useSWR<Stats>('/api/vawc/stats', fetcher);
  const { data: trends } = useSWR<TrendRow[]>('/api/vawc/trends?period=6', fetcher);
  const { data: urgentData } = useSWR<{ cases: UrgentCase[] }>('/api/vawc/urgent?limit=6', fetcher);

  const total = stats?.total ?? 0;
  const highRisk = stats?.highRisk ?? 0;
  const riskRatio = total > 0 ? (highRisk / total) * 100 : 0;

  const riskTrend = riskRatio > 30 ? 'Critical' : riskRatio > 15 ? 'High' : riskRatio > 8 ? 'Medium' : 'Low';

  const radarData = trends?.slice(-6).map(t => ({
    subject: t.month,
    cases: t.total,
    highRisk: t.highRisk,
    resolved: t.total > 0 ? Math.round(((t.total - t.highRisk) / t.total) * 100) : 0,
  })) ?? [];

  return (
    <Box sx={{ maxWidth: 1200 }}>
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>AI Risk Prediction</Typography>
          <Chip label="RULE-BASED ENGINE v1" size="small" sx={{ bgcolor: `${ACCENT}12`, color: ACCENT, fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
        </Box>
        <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>Automated risk scoring and pattern analysis for VAWC case escalation</Typography>
      </Box>

      {/* ── Risk Summary Cards ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Critical', value: stats?.summary?.critical, color: '#ef4444', icon: ReportProblem },
          { label: 'High Risk', value: stats?.summary?.high, color: '#f97316', icon: Warning },
          { label: 'Medium Risk', value: stats?.summary?.medium, color: '#f59e0b', icon: TrendingUp },
          { label: 'Low Risk', value: stats?.summary?.low, color: '#22c55e', icon: CheckCircle },
        ].map((s, i) => (
          <Grid key={s.label} size={{ xs: 6, md: 3 }}>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card sx={{ borderLeft: `3px solid ${s.color}`, height: '100%' }}>
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <s.icon sx={{ fontSize: 15, color: s.color }} />
                    <Typography sx={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{s.label}</Typography>
                  </Box>
                  {stats ? (
                    <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: s.color, lineHeight: 1.1 }}>
                      {s.value ?? 0}
                    </Typography>
                  ) : (
                    <Skeleton variant="text" width={48} height={34} />
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Risk meter */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 2 }}>Overall Risk Level</Typography>
              <Box sx={{ textAlign: 'center', py: 1 }}>
                <Box sx={{
                  width: 100, height: 100, borderRadius: '50%', mx: 'auto', mb: 2,
                  background: `conic-gradient(${RISK_COLOR[riskTrend]} ${riskRatio * 3.6}deg, #f1f5f9 0deg)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 0 0 8px white, 0 0 0 9px ${RISK_COLOR[riskTrend]}20`,
                  position: 'relative',
                }}>
                  <Box sx={{ width: 76, height: 76, borderRadius: '50%', bgcolor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: RISK_COLOR[riskTrend], lineHeight: 1 }}>{riskRatio.toFixed(0)}%</Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>High Risk</Typography>
                  </Box>
                </Box>
                <Chip label={riskTrend} sx={{ bgcolor: `${RISK_COLOR[riskTrend]}14`, color: RISK_COLOR[riskTrend], fontWeight: 700, fontSize: '0.9rem', mb: 1.5 }} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {[
                  { label: 'Total Cases', value: total, color: '#14b8a6' },
                  { label: 'High / Critical', value: highRisk, color: '#ef4444' },
                  { label: 'Active', value: stats?.active ?? 0, color: '#3b82f6' },
                ].map(item => (
                  <Box key={item.label}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                      <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{item.label}</Typography>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: item.color }}>{item.value}</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={total > 0 ? (item.value / total) * 100 : 0}
                      sx={{ height: 4, borderRadius: 2, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 2 } }} />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Radar chart */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.25 }}>6-Month Pattern Radar</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mb: 1.5 }}>Monthly case volume, high-risk proportion and resolution index</Typography>
              {!trends ? (
                <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
              ) : radarData.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <FolderOpen sx={{ fontSize: 36, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>Not enough data for radar analysis</Typography>
                </Box>
              ) : (
                <Box sx={{ minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <RadarChart data={radarData} margin={{ top: 4, right: 20, bottom: 4, left: 20 }}>
                      <PolarGrid stroke="#f1f5f9" />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <PolarRadiusAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Radar name="Cases" dataKey="cases" stroke={ACCENT} fill={ACCENT} fillOpacity={0.15} strokeWidth={2} />
                      <Radar name="High Risk" dataKey="highRisk" stroke="#ef4444" fill="#ef4444" fillOpacity={0.12} strokeWidth={1.5} strokeDasharray="5 3" />
                      <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.86rem' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── Street Risk Hotspots ── */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
            <LocationOn sx={{ color: '#ef4444', fontSize: 18 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Street Risk Hotspots</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.75 }}>
            Top streets by average VAWC risk score (color = risk level)
          </Typography>
          <Box sx={{ height: stats?.byStreet?.length ? Math.max(160, (stats.byStreet.length * 32) + 40) : 160 }}>
            {!stats
              ? <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
              : (stats.byStreet?.length ?? 0) > 0
              ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.byStreet} layout="vertical" barSize={18} margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis dataKey="barangay" type="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={95} />
                    <Tooltip
                      formatter={(v: unknown, name: unknown) => [
                        `${String(v)}${name === 'avgScore' ? '/100' : ' cases'}`,
                        name === 'avgScore' ? 'Avg Risk Score' : 'High-Risk Cases',
                      ]}
                      contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }}
                    />
                    <Bar dataKey="avgScore" name="avgScore" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#64748b' }}>
                      {(stats.byStreet ?? []).map((d, i) => (
                        <Cell key={i} fill={scoreColor(d.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
              : (
                <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                  <LocationOn sx={{ fontSize: 36, color: '#e2e8f0' }} />
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No street data yet</Typography>
                </Box>
              )
            }
          </Box>
        </CardContent>
      </Card>

      {/* ── Street Risk Heatmap ── */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4, flexWrap: 'wrap' }}>
            <Box sx={{
              width: 26, height: 26, borderRadius: 1.5,
              background: 'linear-gradient(135deg, #22c55e 0%, #f97316 50%, #ef4444 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <LocationOn sx={{ fontSize: 14, color: 'white' }} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
              Street Risk Heatmap
            </Typography>
            <Chip label="Live Map" size="small"
              sx={{ bgcolor: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
            <Chip label="Bocaue, Bulacan" size="small"
              icon={<LocationOn sx={{ fontSize: '11px !important', color: '#64748b !important' }} />}
              sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 24 }} />
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.75 }}>
            Street-level risk network plotted over the Biñang 2nd area map — heat intensity shows incident concentration per intersection and landmark
          </Typography>
          <RiskHeatMap
            title="Biñang 2nd, Bocaue — VAWC Street Risk Heatmap"
            contextLabel="VAWC geographic view"
            accent={ACCENT}
          />
        </CardContent>
      </Card>

      {/* ── Priority Areas ── */}
      {(stats?.areaInterventions?.length ?? 0) > 0 && (
        <Card sx={{ mb: 2.5 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
              <ReportProblem sx={{ color: ACCENT, fontSize: 18 }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Priority Areas</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.75 }}>
              Streets ranked by VAWC risk, with the case types driving each score
            </Typography>
            <Grid container spacing={1.5}>
              {(stats?.areaInterventions ?? []).slice(0, 6).map((a, i) => (
                <Grid key={a.barangay} size={{ xs: 12, sm: 6 }}>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <Box sx={{
                      p: 1.75, borderRadius: 2, height: '100%',
                      border: `1px solid ${scoreColor(a.avgScore)}28`,
                      bgcolor: `${scoreColor(a.avgScore)}06`,
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', flex: 1, minWidth: 0 }}>
                          {a.barangay}
                        </Typography>
                        <Chip label={`${a.avgScore}/100`} size="small"
                          sx={{ bgcolor: `${scoreColor(a.avgScore)}18`, color: scoreColor(a.avgScore), fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 0.75 }}>
                        <Chip label={`${a.total} case${a.total !== 1 ? 's' : ''}`} size="small"
                          sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
                        {a.highRisk > 0 && (
                          <Chip label={`${a.highRisk} high-risk`} size="small"
                            sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                        )}
                      </Box>
                      <Typography sx={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                        {a.dominantCaseTypes.length > 0 ? a.dominantCaseTypes.join(' · ') : 'No dominant case type'}
                      </Typography>
                    </Box>
                  </motion.div>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Urgent cases quick list */}
      {(urgentData?.cases?.length ?? 0) > 0 && (
        <Card>
          <CardContent sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Highest Risk — Action Required</Typography>
              <Button size="small" endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
                onClick={() => router.push('/vawc/cases?filter=urgent')}
                sx={{ color: ACCENT, fontWeight: 600, fontSize: '0.86rem' }}>
                View All
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <AnimatePresence>
                {(urgentData?.cases ?? []).map((c, i) => (
                  <motion.div key={c.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', gap: 2, p: 1.5,
                      borderRadius: 2, bgcolor: '#f8fafc', border: '1px solid #f1f5f9',
                      '&:hover': { bgcolor: '#f5f3ff', borderColor: `${ACCENT}20` }, transition: 'all 0.15s', cursor: 'pointer',
                    }}>
                      <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Shield sx={{ fontSize: 16, color: RISK_COLOR[c.riskLevel] ?? '#64748b' }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>{c.subjectName}</Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>#{c.caseNumber}</Typography>
                      </Box>
                      <Chip label={c.riskLevel} size="small"
                        sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}12`, color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                    </Box>
                  </motion.div>
                ))}
              </AnimatePresence>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
