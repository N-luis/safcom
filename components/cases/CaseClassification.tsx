'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Grid, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Skeleton, Tooltip, Button, Alert,
} from '@mui/material';
import {
  Category, TrendingUp, TrendingDown, TrendingFlat, OpenInNew,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import { metaFor, type CategoryMeta } from '@/lib/classificationSchema';

/**
 * How this desk's cases break down by category.
 *
 * Both desks mount this. The blotter had a version of it and the VAWC desk
 * had nothing, which is the gap this closes - but the blotter's version drew
 * a hard-coded distribution (142 thefts, 98 nuisances) and an invented trend
 * per row, numbers no officer had filed. Copying that into the VAWC module
 * would have doubled the problem, so this reads the real counts instead, and
 * the trend is this month's filings against last month's.
 *
 * A category with nothing filed against it is still listed, greyed, because
 * "we have had none of these" is information an officer wants.
 */

interface TypeCount {
  caseType: string;
  count: number;
  last30: number;
  prev30: number;
}

interface Stats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  byCaseType: TypeCount[];
}

const RISK_COLOR: Record<string, string> = {
  Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e',
};

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(d => d?.data ?? null);

/** Change between two equal windows, as a share of the earlier one. */
function trendOf(row: { last30: number; prev30: number }): number | null {
  if (row.prev30 === 0) return row.last30 === 0 ? 0 : null; // null = "new", not "+infinity"
  return ((row.last30 - row.prev30) / row.prev30) * 100;
}

function TrendCell({ row }: { row: { last30: number; prev30: number } }) {
  const t = trendOf(row);
  if (t === null) {
    return (
      <Tooltip title={`${row.last30} in the last 30 days, none in the 30 before`}>
        <Chip label="New" size="small"
          sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#fef3c7', color: '#b45309' }} />
      </Tooltip>
    );
  }
  if (t === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: '#94a3b8' }}>
        <TrendingFlat sx={{ fontSize: 15 }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>No change</Typography>
      </Box>
    );
  }
  const up = t > 0;
  return (
    <Tooltip title={`${row.last30} in the last 30 days vs ${row.prev30} in the 30 before`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: up ? '#ef4444' : '#22c55e' }}>
        {up ? <TrendingUp sx={{ fontSize: 15 }} /> : <TrendingDown sx={{ fontSize: 15 }} />}
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
          {up ? '+' : ''}{Math.round(t)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

export interface CaseClassificationProps {
  /** 'vawc' asks the API for this desk's caseload only. */
  scope: 'all' | 'vawc';
  /** The categories this desk works in, in the office's own order. */
  categories: CategoryMeta[];
  accent: string;
  /** This desk's case list, so a category can be opened against it. */
  basePath: string;
  title?: string;
  subtitle?: string;
}

export default function CaseClassification({
  scope, categories, accent, basePath, title, subtitle,
}: CaseClassificationProps) {
  const router = useRouter();
  const [view, setView] = useState<'bar' | 'pie'>('bar');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: stats, isLoading } = useSWR<Stats | null>(
    `/api/cases/stats${scope === 'vawc' ? '?scope=vawc' : ''}`,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: true },
  );

  /**
   * Every category the desk works in, plus any type that actually appears in
   * the data but is not on the list - a case filed under an old label still
   * has to be counted somewhere an officer can see it.
   */
  const rows = useMemo(() => {
    const counts = new Map(stats?.byCaseType.map(t => [t.caseType, t]) ?? []);
    const known = categories.map(c => ({
      meta: c,
      ...(counts.get(c.category) ?? { caseType: c.category, count: 0, last30: 0, prev30: 0 }),
    }));
    const extra = (stats?.byCaseType ?? [])
      .filter(t => !categories.some(c => c.category === t.caseType))
      .map(t => ({ meta: metaFor(t.caseType, categories), ...t }));
    return [...known, ...extra].sort((a, b) => b.count - a.count);
  }, [stats, categories]);

  const total = rows.reduce((s, r) => s + r.count, 0);
  const charted = rows.filter(r => r.count > 0);
  const shown = selected ? rows.filter(r => r.meta.category === selected) : rows;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={280} height={36} />
        <Skeleton variant="rounded" height={320} sx={{ my: 2, borderRadius: 3 }} />
        <Skeleton variant="rounded" height={260} sx={{ borderRadius: 3 }} />
      </Box>
    );
  }

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <Box sx={{
          width: 42, height: 42, borderRadius: 2.5, bgcolor: `${accent}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Category sx={{ color: accent, fontSize: 22 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1.2 }}>
            {title ?? 'Case Classification'}
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
            {subtitle ?? 'How this desk’s cases break down, from the barangay’s own filings'}
          </Typography>
        </Box>
        <Chip
          label={`${total} case${total === 1 ? '' : 's'} on record`}
          sx={{ ml: { sm: 'auto' }, bgcolor: '#f1f5f9', color: '#334155', fontWeight: 700, fontSize: '0.8rem' }}
        />
      </Box>

      {total === 0 && (
        <Alert severity="info" sx={{ mb: 2.5, borderRadius: 2 }}>
          No cases have been filed under these categories yet. The breakdown fills in as reports come in.
        </Alert>
      )}

      {/* ── Distribution ── */}
      <Card sx={{ borderRadius: 3, border: '1px solid #e8edf2', boxShadow: 'none', mb: 2.5 }}>
        <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
              Distribution by category
            </Typography>
            <ToggleButtonGroup
              value={view} exclusive size="small"
              onChange={(_, v) => { if (v) setView(v); }}
              sx={{
                ml: 'auto',
                '& .MuiToggleButton-root': {
                  minHeight: 36, px: 1.5, textTransform: 'none', fontWeight: 700, fontSize: '0.8rem',
                  '&.Mui-selected': { bgcolor: `${accent}18`, color: accent },
                },
              }}
            >
              <ToggleButton value="bar">Bar</ToggleButton>
              <ToggleButton value="pie">Share</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {charted.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography sx={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                Nothing to chart yet.
              </Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              {view === 'bar' ? (
                <BarChart
                  data={charted.map(r => ({ name: r.meta.category, count: r.count, color: r.meta.color }))}
                  barSize={30} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-18} textAnchor="end" height={64} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <ChartTooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
                    formatter={(v) => [`${Number(v)} case${Number(v) === 1 ? '' : 's'}`, 'Filed'] as [string, string]}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} onClick={(d: { name?: string }) => setSelected(s => (s === d.name ? null : d.name ?? null))}>
                    {charted.map((r, i) => <Cell key={i} fill={r.meta.color} cursor="pointer" />)}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <ChartTooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
                    formatter={(v, n) => [`${Number(v)} case${Number(v) === 1 ? '' : 's'}`, String(n)] as [string, string]}
                  />
                  <Pie
                    data={charted.map(r => ({ name: r.meta.category, count: r.count }))}
                    cx="50%" cy="50%" outerRadius={100} dataKey="count" nameKey="name"
                    label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`}
                    labelLine={false} stroke="none"
                  >
                    {charted.map((r, i) => <Cell key={i} fill={r.meta.color} />)}
                  </Pie>
                </PieChart>
              )}
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── The categories themselves ── */}
      <Card sx={{ borderRadius: 3, border: '1px solid #e8edf2', boxShadow: 'none' }}>
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.75, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
            Categories this desk handles
          </Typography>
          {selected && (
            <Button size="small" onClick={() => setSelected(null)}
              sx={{ ml: 'auto', textTransform: 'none', fontWeight: 700, color: accent }}>
              Show all {rows.length}
            </Button>
          )}
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{
                '& th': {
                  bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#64748b', py: 1.2, borderBottom: '1px solid #f1f5f9',
                },
              }}>
                {['Category', 'Filed', 'Share', 'Last 30 days', 'Trend', 'Starting risk', ''].map(h => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r, i) => (
                <motion.tr
                  key={r.meta.category}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  style={{ opacity: r.count === 0 ? 0.55 : 1 }}
                >
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc', py: 1.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: r.meta.color, flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: '#0c1e46' }}>
                          {r.meta.category}
                        </Typography>
                        <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                          {r.meta.code} &middot; {r.meta.description}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc' }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: '#0c1e46', fontVariantNumeric: 'tabular-nums' }}>
                      {r.count}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc', minWidth: 110 }}>
                    <LinearProgress
                      variant="determinate"
                      value={total ? (r.count / total) * 100 : 0}
                      sx={{
                        height: 6, borderRadius: 3, bgcolor: '#f1f5f9',
                        '& .MuiLinearProgress-bar': { bgcolor: r.meta.color, borderRadius: 3 },
                      }}
                    />
                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.3, fontVariantNumeric: 'tabular-nums' }}>
                      {total ? Math.round((r.count / total) * 100) : 0}%
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc' }}>
                    <Typography sx={{ fontSize: '0.88rem', color: '#334155', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {r.last30}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc' }}>
                    <TrendCell row={r} />
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid #f8fafc' }}>
                    <Chip label={r.meta.riskBias} size="small" sx={{
                      height: 21, fontSize: '0.72rem', fontWeight: 700,
                      bgcolor: `${RISK_COLOR[r.meta.riskBias]}18`, color: RISK_COLOR[r.meta.riskBias],
                    }} />
                  </TableCell>
                  <TableCell align="right" sx={{ borderBottom: '1px solid #f8fafc' }}>
                    {r.count > 0 && (
                      <Tooltip title={`Open the ${r.meta.category} cases`}>
                        <Button
                          size="small"
                          endIcon={<OpenInNew sx={{ fontSize: 14 }} />}
                          onClick={() => router.push(`${basePath}?type=${encodeURIComponent(r.meta.category)}`)}
                          sx={{ textTransform: 'none', fontWeight: 700, color: accent, fontSize: '0.8rem' }}
                        >
                          Open
                        </Button>
                      </Tooltip>
                    )}
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, borderTop: '1px solid #f1f5f9' }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6 }}>
            Counts are the barangay&apos;s own filings. &ldquo;Starting risk&rdquo; is where the office opens a
            case of this kind; the assessment may raise or lower it on the evidence, and an officer
            can set it themselves on the case itself.
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}
