'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Skeleton, IconButton, Tooltip, Button,
} from '@mui/material';
import { Category, TrendingUp, TrendingDown, Info, FilterList } from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { motion } from 'framer-motion';
import { useCases } from '@/hooks/useApi';

const CLASSIFICATION_SCHEMA = [
  { category: 'Theft & Robbery', code: 'TRB', color: '#14b8a6', riskBias: 'High', description: 'Includes larceny, burglary, robbery, and motor vehicle theft', trend: +8.2 },
  { category: 'Public Nuisance', code: 'PNS', color: '#3b82f6', riskBias: 'Medium', description: 'Noise complaints, illegal dumping, obstruction of public areas', trend: -3.1 },
  { category: 'Domestic Dispute', code: 'DDS', color: '#f97316', riskBias: 'High', description: 'Family conflicts, spousal disputes, child custody incidents', trend: +2.4 },
  { category: 'Assault', code: 'AST', color: '#ef4444', riskBias: 'Critical', description: 'Physical altercations, threats, battery cases', trend: +1.7 },
  { category: 'Cybercrime', code: 'CYB', color: '#8b5cf6', riskBias: 'High', description: 'Online fraud, identity theft, cyberbullying, data breaches', trend: +14.3 },
  { category: 'Vandalism', code: 'VAN', color: '#f59e0b', riskBias: 'Low', description: 'Property damage, graffiti, destruction of public property', trend: -1.9 },
  { category: 'Drug-Related', code: 'DRG', color: '#ec4899', riskBias: 'Critical', description: 'Drug possession, distribution, paraphernalia cases', trend: +0.8 },
];

const RISK_COLOR: Record<string, string> = { Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e' };

const MOCK_DISTRIBUTION = [
  { name: 'Theft & Robbery', count: 142 },
  { name: 'Public Nuisance', count: 98 },
  { name: 'Domestic Dispute', count: 74 },
  { name: 'Assault', count: 58 },
  { name: 'Cybercrime', count: 43 },
  { name: 'Vandalism', count: 31 },
  { name: 'Drug-Related', count: 22 },
];

const total = MOCK_DISTRIBUTION.reduce((a, b) => a + b.count, 0);

export default function CaseClassificationPage() {
  const [view, setView] = useState<'bar' | 'pie'>('bar');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const catData = MOCK_DISTRIBUTION.map((d, i) => ({
    ...d,
    color: CLASSIFICATION_SCHEMA[i]?.color ?? '#94a3b8',
    pct: Math.round((d.count / total) * 100),
  }));

  const filtered = selectedCat ? catData.filter(c => c.name === selectedCat) : catData;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Case Classification</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
          Classification schema and distribution analysis for all blotter entries
        </Typography>
      </Box>

      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        {['Critical', 'High', 'Medium', 'Low'].map(r => (
          <Chip
            key={r}
            label={`${r} Risk: ${CLASSIFICATION_SCHEMA.filter(c => c.riskBias === r).length} types`}
            size="small"
            sx={{ bgcolor: `${RISK_COLOR[r]}15`, color: RISK_COLOR[r], fontWeight: 700, fontSize: '0.86rem' }}
          />
        ))}
        <Chip label={`${total} total cases`} size="small" sx={{ bgcolor: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: '0.86rem', ml: 'auto' }} />
      </Box>

      {/* Chart */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Case Count by Category</Typography>
            <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
              <ToggleButton value="bar" sx={{ fontSize: '0.82rem', px: 1.5, borderRadius: '8px 0 0 8px !important' }}>Bar</ToggleButton>
              <ToggleButton value="pie" sx={{ fontSize: '0.82rem', px: 1.5, borderRadius: '0 8px 8px 0 !important' }}>Pie</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {view === 'bar' ? (
            <Box sx={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={catData} barSize={32} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
                    tickFormatter={n => n.split(' ')[0]} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <ChartTooltip
                    formatter={(v: unknown) => [String(v), '']}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {catData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={catData} cx="45%" cy="50%" outerRadius={100} dataKey="count" nameKey="name" label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`} labelLine={false} stroke="none">
                    {catData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Legend iconSize={10} wrapperStyle={{ fontSize: '0.86rem' }} />
                  <ChartTooltip formatter={(v: unknown) => [String(v), '']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Distribution + Schema table */}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 2 }}>
                Distribution Breakdown
              </Typography>
              {catData.map((cat, i) => (
                <motion.div key={cat.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <Box
                    sx={{ mb: 2, cursor: 'pointer', p: 1, borderRadius: 2, transition: 'all 0.15s', '&:hover': { bgcolor: '#f8fafc' }, bgcolor: selectedCat === cat.name ? '#f8fafc' : 'transparent' }}
                    onClick={() => setSelectedCat(prev => prev === cat.name ? null : cat.name)}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cat.color }} />
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 500, color: '#374151' }}>{cat.name}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>{cat.count}</Typography>
                        <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{cat.pct}%</Typography>
                      </Box>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={cat.pct}
                      sx={{ height: 5, borderRadius: 5, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: cat.color, borderRadius: 5 } }}
                    />
                  </Box>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent sx={{ p: 2.5, pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Classification Schema</Typography>
                {selectedCat && (
                  <Chip label={`Filtered: ${selectedCat}`} size="small" onDelete={() => setSelectedCat(null)} sx={{ fontSize: '0.82rem' }} />
                )}
              </Box>
            </CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.25, borderBottom: '1px solid #f1f5f9' } }}>
                    {['Code', 'Category', 'Risk Bias', 'Trend', 'Description'].map(h => <TableCell key={h}>{h}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {CLASSIFICATION_SCHEMA
                    .filter(s => !selectedCat || s.category === selectedCat)
                    .map((s) => (
                      <TableRow key={s.code} sx={{ '& td': { py: 1.25, borderBottom: '1px solid #f8fafc' }, '&:hover': { bgcolor: '#f8fafc' } }}>
                        <TableCell>
                          <Chip label={s.code} size="small" sx={{ bgcolor: `${s.color}18`, color: s.color, fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
                            <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{s.category}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: RISK_COLOR[s.riskBias] }}>{s.riskBias}</Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {s.trend >= 0
                              ? <TrendingUp sx={{ fontSize: 14, color: '#ef4444' }} />
                              : <TrendingDown sx={{ fontSize: 14, color: '#22c55e' }} />}
                            <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: s.trend >= 0 ? '#ef4444' : '#22c55e' }}>
                              {s.trend >= 0 ? '+' : ''}{s.trend}%
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.86rem', color: '#64748b', maxWidth: 200 }}>{s.description}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
