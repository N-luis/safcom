'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, InputAdornment,
  TextField, FormControl, InputLabel, Select, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Avatar, CircularProgress, Button, Pagination,
} from '@mui/material';
import { Search, Refresh, History } from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { motion } from 'framer-motion';
import useSWR from 'swr';

interface Activity {
  id: string;
  type: string;
  message: string;
  color: string;
  entityType: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json()).then(d => d.data);

const TYPE_LABELS: Record<string, string> = {
  case_created: 'Case Created',
  case_updated: 'Case Updated',
  case_resolved: 'Case Resolved',
  report_submitted: 'Report Submitted',
  report_updated: 'Report Updated',
  resident_added: 'Resident Added',
  resident_updated: 'Resident Updated',
  user_created: 'User Created',
  user_updated: 'User Updated',
  user_deactivated: 'User Deactivated',
  message_sent: 'Message Sent',
  login: 'Login',
};

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, mutate } = useSWR<Activity[]>(
    `/api/activities?limit=200`,
    fetcher,
    { refreshInterval: 15000 },
  );

  const filtered = (data ?? []).filter(a => {
    const matchSearch = !search || a.message.toLowerCase().includes(search.toLowerCase()) || (a.user?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || a.type === typeFilter;
    return matchSearch && matchType;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const uniqueTypes = [...new Set((data ?? []).map(a => a.type))].sort();

  return (
    <DashboardLayout>
      <Box>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Audit Logs</Typography>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>
              Complete activity history across the system
            </Typography>
          </Box>
          <Button startIcon={<Refresh />} variant="outlined" onClick={() => mutate()}
            sx={{ borderRadius: 2.5, textTransform: 'none' }}>
            Refresh
          </Button>
        </Box>

        {/* Filters */}
        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <CardContent sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small" placeholder="Search logs..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>,
                  sx: { borderRadius: 2 },
                },
              }}
              sx={{ minWidth: 240 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Event Type</InputLabel>
              <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }} label="Event Type" sx={{ borderRadius: 2 }}>
                <MenuItem value="">All Types</MenuItem>
                {uniqueTypes.map(t => (
                  <MenuItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Chip label={`${filtered.length} events`} size="small" sx={{ ml: 'auto', fontWeight: 600 }} />
          </CardContent>
        </Card>

        {/* Table */}
        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', bgcolor: 'action.hover', py: 1.5 } }}>
                  <TableCell>Event</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Timestamp</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : paginated.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                      <History sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                      <Typography color="text.secondary">No activity logs found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((activity, i) => (
                    <motion.tr
                      key={activity.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      style={{ display: 'table-row' }}
                    >
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: activity.color, flexShrink: 0 }} />
                          <Chip
                            label={TYPE_LABELS[activity.type] ?? activity.type}
                            size="small"
                            sx={{ bgcolor: `${activity.color}18`, color: activity.color, fontWeight: 700, fontSize: '0.78rem', height: 24, '& .MuiChip-label': { px: 1 } }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: '0.94rem' }}>{activity.message}</Typography>
                      </TableCell>
                      <TableCell>
                        {activity.user ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ width: 26, height: 26, fontSize: '0.72rem', bgcolor: activity.color + '40', color: activity.color, fontWeight: 700 }}>
                              {activity.user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </Avatar>
                            <Typography sx={{ fontSize: '0.9rem' }}>{activity.user.name}</Typography>
                          </Box>
                        ) : (
                          <Typography sx={{ fontSize: '0.9rem' }} color="text.disabled">System</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">
                          {new Date(activity.createdAt).toLocaleString()}
                        </Typography>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <Pagination count={totalPages} page={page} onChange={(_, v) => setPage(v)} color="primary" size="small" />
            </Box>
          )}
        </Card>
      </Box>
    </DashboardLayout>
  );
}
