'use client';

import { useState } from 'react';
import { Box, Typography, Card, TextField, InputAdornment, Chip, Skeleton, Button } from '@mui/material';
import { Search, FolderOpen, LocationOn, CalendarToday } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';

const ACCENT = '#7c3aed';
const STATUS_COLOR: Record<string, string> = { Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#94a3b8' };
const STATUS_BG: Record<string, string> = { Open: '#fff7ed', 'In Progress': '#eff6ff', Resolved: '#f0fdf4', Closed: '#f8fafc' };
const RISK_COLOR: Record<string, string> = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' };

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface CaseRow {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; filedAt: string;
}

export default function VawcSearchPage() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading } = useSWR<{ cases: CaseRow[]; total: number }>(
    submitted ? `/api/vawc/cases?search=${encodeURIComponent(submitted)}&limit=20` : null,
    fetcher
  );

  const handleSearch = () => { if (q.trim()) setSubmitted(q.trim()); };

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', mb: 0.5 }}>Search</Typography>
      <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mb: 3 }}>Search VAWC cases by subject name, case number, or description</Typography>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
        <TextField
          fullWidth size="small"
          placeholder="Search by name, case number (VC-2025-…), or keywords…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18, color: '#94a3b8' }} /></InputAdornment> } }}
        />
        <Button variant="contained" onClick={handleSearch}
          sx={{ px: 3, bgcolor: ACCENT, fontWeight: 600, flexShrink: 0, '&:hover': { bgcolor: '#6d28d9' } }}>
          Search
        </Button>
      </Box>

      {!submitted ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Search sx={{ fontSize: 56, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 2 }} />
          <Typography sx={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.98rem' }}>Enter a name or case number to begin</Typography>
        </Box>
      ) : isLoading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rectangular" height={72} sx={{ borderRadius: 2 }} />)}
        </Box>
      ) : !data?.cases?.length ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <FolderOpen sx={{ fontSize: 40, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
          <Typography sx={{ fontSize: '0.98rem', color: '#94a3b8' }}>No results for &quot;{submitted}&quot;</Typography>
        </Box>
      ) : (
        <>
          <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8', mb: 1.5 }}>
            Found <Box component="span" sx={{ fontWeight: 700, color: ACCENT }}>{data.total}</Box> case{data.total !== 1 ? 's' : ''}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <AnimatePresence>
              {data.cases.map((c, i) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card sx={{ '&:hover': { boxShadow: `0 4px 20px ${ACCENT}14` }, transition: 'box-shadow 0.2s', cursor: 'pointer' }}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography>
                          <Chip label={c.status} size="small" sx={{ bgcolor: STATUS_BG[c.status], color: STATUS_COLOR[c.status] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                          <Chip label={c.riskLevel} size="small" sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}14`, color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                        </Box>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.94rem', color: '#374151', mb: 0.3 }}>{c.residentName}</Typography>
                        <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8' }}>{c.caseType}</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', mb: 0.5 }}>
                          <LocationOn sx={{ fontSize: 12, color: '#94a3b8' }} />
                          <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{c.barangay}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                          <CalendarToday sx={{ fontSize: 12, color: '#94a3b8' }} />
                          <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                            {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </Box>
        </>
      )}
    </Box>
  );
}
