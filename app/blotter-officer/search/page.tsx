'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, InputAdornment,
  Chip, IconButton, Skeleton, List, ListItem, ListItemText,
  Divider, ToggleButton, ToggleButtonGroup, Button, Tooltip,
} from '@mui/material';
import {
  Search, FolderOpen, Person, Assessment, Close, ArrowForward,
  LocationOn, AccessTime, FilterList,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';

const STATUS_COLOR: Record<string, string> = { Open: '#f97316', 'In Progress': '#22c55e', Resolved: '#3b82f6', Closed: '#94a3b8' };
const RISK_COLOR: Record<string, string> = { High: '#ef4444', Critical: '#8b5cf6', Medium: '#f97316', Low: '#22c55e' };

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString();
}

interface CaseResult {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; filedAt: string; description: string;
}
interface ResidentResult {
  id: string; residentNumber: string; firstName: string; lastName: string;
  barangay: string; status: string; riskLevel: string; contactNumber?: string;
}
interface SearchResults {
  cases: CaseResult[];
  residents: ResidentResult[];
}

const QUICK_FILTERS = ['Theft & Robbery', 'Domestic Dispute', 'Assault', 'High Risk', 'Open Cases'];

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'cases' | 'residents'>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback(async (q: string, s: string) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const [casesRes, residentsRes] = await Promise.all([
        (s === 'all' || s === 'cases') ? fetch(`/api/cases?search=${encodeURIComponent(q)}&limit=6`, { credentials: 'include' }).then(r => r.json()) : Promise.resolve({ data: { cases: [] } }),
        (s === 'all' || s === 'residents') ? fetch(`/api/residents?search=${encodeURIComponent(q)}&limit=6`, { credentials: 'include' }).then(r => r.json()) : Promise.resolve({ data: { residents: [] } }),
      ]);
      setResults({
        cases: casesRes?.data?.cases ?? [],
        residents: residentsRes?.data?.residents ?? [],
      });
    } catch { setResults({ cases: [], residents: [] }); }
    finally { setLoading(false); }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val, scope), 380);
  };

  const handleScopeChange = (val: string) => {
    setScope(val as 'all' | 'cases' | 'residents');
    if (query) doSearch(query, val);
  };

  const totalResults = (results?.cases.length ?? 0) + (results?.residents.length ?? 0);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Search</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Search across cases, residents, and reports</Typography>
      </Box>

      {/* Search bar */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2 }}>
          <TextField
            fullWidth
            autoFocus
            placeholder="Search by name, case ID, type, street…"
            value={query}
            onChange={e => handleInput(e.target.value)}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 20, color: '#94a3b8' }} /></InputAdornment>,
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => { setQuery(''); setResults(null); }}>
                      <Close fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5, fontSize: '0.98rem' } }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5, flexWrap: 'wrap' }}>
            <ToggleButtonGroup value={scope} exclusive onChange={(_, v) => v && handleScopeChange(v)} size="small">
              {[{ value: 'all', label: 'All' }, { value: 'cases', label: 'Cases' }, { value: 'residents', label: 'Residents' }].map(opt => (
                <ToggleButton key={opt.value} value={opt.value} sx={{ fontSize: '0.86rem', px: 1.5, textTransform: 'none' }}>
                  {opt.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {QUICK_FILTERS.map(f => (
                <Chip
                  key={f} label={f} size="small"
                  onClick={() => handleInput(f)}
                  sx={{ fontSize: '0.82rem', cursor: 'pointer', bgcolor: '#f1f5f9', color: '#475569', '&:hover': { bgcolor: '#e2e8f0' } }}
                />
              ))}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Results */}
      {!query && !results && (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Search sx={{ fontSize: 48, color: '#cbd5e1', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 600, color: '#94a3b8', mb: 0.5 }}>Start searching</Typography>
            <Typography sx={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
              Enter a name, case number, type, or street to find records
            </Typography>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent sx={{ p: 2 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                <Skeleton variant="rounded" width={36} height={36} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="50%" />
                  <Skeleton variant="text" width="70%" />
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && results && (
        <AnimatePresence>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {/* Result count */}
            <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
                {totalResults === 0 ? 'No results' : `${totalResults} result${totalResults !== 1 ? 's' : ''}`} for
              </Typography>
              <Chip label={`"${query}"`} size="small" sx={{ fontSize: '0.86rem', fontWeight: 600 }} />
            </Box>

            {/* Cases */}
            {(scope === 'all' || scope === 'cases') && results.cases.length > 0 && (
              <Card sx={{ mb: 2 }}>
                <CardContent sx={{ p: 2, pb: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <FolderOpen sx={{ fontSize: 17, color: '#3b82f6' }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>Cases</Typography>
                    <Chip label={results.cases.length} size="small" sx={{ fontSize: '0.78rem', height: 22, bgcolor: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }} />
                  </Box>
                </CardContent>
                <List disablePadding>
                  {results.cases.map((c, i) => (
                    <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                      <ListItem
                        sx={{ px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}
                        onClick={() => router.push('/blotter-officer/case-management')}
                      >
                        <Box sx={{ width: 34, height: 34, borderRadius: 1.5, bgcolor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5, flexShrink: 0 }}>
                          <FolderOpen sx={{ fontSize: 16, color: '#3b82f6' }} />
                        </Box>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography>
                              <Typography sx={{ fontSize: '0.9rem', color: '#475569' }}>— {c.residentName}</Typography>
                              <Box sx={{ ml: 'auto', display: 'flex', gap: 0.75 }}>
                                <Chip label={c.status} size="small" sx={{ bgcolor: `${STATUS_COLOR[c.status]}18`, color: STATUS_COLOR[c.status], fontWeight: 600, fontSize: '0.78rem', height: 22 }} />
                                <Chip label={c.riskLevel} size="small" sx={{ bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#94a3b8'}18`, color: RISK_COLOR[c.riskLevel] ?? '#94a3b8', fontWeight: 700, fontSize: '0.78rem', height: 22 }} />
                              </Box>
                            </Box>
                          }
                          secondary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.3 }}>
                              <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{c.caseType}</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                                <LocationOn sx={{ fontSize: 11, color: '#94a3b8' }} />
                                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{c.barangay}</Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, ml: 'auto' }}>
                                <AccessTime sx={{ fontSize: 11, color: '#94a3b8' }} />
                                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{timeAgo(c.filedAt)}</Typography>
                              </Box>
                            </Box>
                          }
                        />
                      </ListItem>
                    </motion.div>
                  ))}
                </List>
                {results.cases.length >= 6 && (
                  <Box sx={{ px: 2, py: 1.25, borderTop: '1px solid #f1f5f9' }}>
                    <Button size="small" endIcon={<ArrowForward fontSize="small" />} onClick={() => router.push('/blotter-officer/case-management')} sx={{ fontSize: '0.86rem', color: '#3b82f6', textTransform: 'none' }}>
                      View all case results
                    </Button>
                  </Box>
                )}
              </Card>
            )}

            {/* Residents */}
            {(scope === 'all' || scope === 'residents') && results.residents.length > 0 && (
              <Card sx={{ mb: 2 }}>
                <CardContent sx={{ p: 2, pb: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Person sx={{ fontSize: 17, color: '#14b8a6' }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>Residents</Typography>
                    <Chip label={results.residents.length} size="small" sx={{ fontSize: '0.78rem', height: 22, bgcolor: '#ccfbf1', color: '#0f766e', fontWeight: 700 }} />
                  </Box>
                </CardContent>
                <List disablePadding>
                  {results.residents.map((r, i) => (
                    <motion.div key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                      <ListItem sx={{ px: 2, py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' }, borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                        <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: '#ccfbf1', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5, flexShrink: 0, fontWeight: 700, fontSize: '0.82rem', color: '#0f766e' }}>
                          {`${r.firstName[0]}${r.lastName[0]}`}
                        </Box>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46' }}>{r.firstName} {r.lastName}</Typography>
                              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{r.residentNumber}</Typography>
                              <Box sx={{ ml: 'auto' }}>
                                <Chip label={r.status} size="small" sx={{ bgcolor: r.status === 'Active' ? '#dcfce7' : '#fef9c3', color: r.status === 'Active' ? '#15803d' : '#854d0e', fontWeight: 600, fontSize: '0.78rem', height: 22 }} />
                              </Box>
                            </Box>
                          }
                          secondary={
                            <Box sx={{ display: 'flex', gap: 1.5, mt: 0.3 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                                <LocationOn sx={{ fontSize: 11, color: '#94a3b8' }} />
                                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{r.barangay}</Typography>
                              </Box>
                              {r.contactNumber && (
                                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{r.contactNumber}</Typography>
                              )}
                            </Box>
                          }
                        />
                      </ListItem>
                    </motion.div>
                  ))}
                </List>
              </Card>
            )}

            {totalResults === 0 && (
              <Card>
                <CardContent sx={{ textAlign: 'center', py: 5 }}>
                  <Search sx={{ fontSize: 36, color: '#cbd5e1', mb: 1 }} />
                  <Typography sx={{ fontWeight: 600, color: '#94a3b8' }}>No results for "{query}"</Typography>
                  <Typography sx={{ fontSize: '0.9rem', color: '#cbd5e1', mt: 0.5 }}>Try different keywords or check your spelling</Typography>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Box>
  );
}
