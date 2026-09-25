'use client';

import { useRouter } from 'next/navigation';
import { Box, Typography, Card, CardContent, Grid, Chip, Button, Skeleton } from '@mui/material';
import {
  ManageAccounts, ArrowForward, AdminPanelSettings,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import useSWR from 'swr';

const ACCENT = '#0ea5e9';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface UserStats {
  total: number;
  byRole: { role: string; count: number }[];
  activeCount: number;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: users } = useSWR<UserStats>('/api/admin/stats/users', fetcher, { refreshInterval: 30000 });

  const roleMap: Record<string, { label: string; color: string }> = {
    admin: { label: 'Barangay Captain', color: '#8b5cf6' },
    system_admin: { label: 'System Admin', color: '#0ea5e9' },
    officer: { label: 'Blotter Officer', color: '#3b82f6' },
    vawc_officer: { label: 'VAWC Officer', color: '#7c3aed' },
  };

  const statCards = [
    { icon: ManageAccounts, label: 'Total System Users', value: users?.total ?? null, color: '#3b82f6', sub: `${users?.activeCount ?? 0} active` },
  ];

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <AdminPanelSettings sx={{ color: ACCENT, fontSize: 28 }} />
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>System Admin Dashboard</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>Manage system users and verify resident identities</Typography>
      </Box>

      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statCards.map((card, i) => (
          <Grid key={card.label} size={{ xs: 12, md: 4 }}>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
              <Card sx={{ '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 24px ${card.color}20` }, transition: 'all 0.2s' }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: `${card.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5 }}>
                    <card.icon sx={{ fontSize: 18, color: card.color }} />
                  </Box>
                  <Typography sx={{ fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>{card.label}</Typography>
                  {card.value === null
                    ? <Skeleton variant="text" width={60} height={40} />
                    : <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, color: '#0c1e46', lineHeight: 1 }}>{card.value}</Typography>
                  }
                  <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.75 }}>{card.sub}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Quick Actions */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12 }}>
          <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <Card sx={{ cursor: 'pointer', '&:hover': { boxShadow: `0 8px 24px ${ACCENT}20`, transform: 'translateY(-2px)' }, transition: 'all 0.2s' }}
              onClick={() => router.push('/admin/users')}>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Box sx={{ width: 48, height: 48, borderRadius: 2.5, bgcolor: `${ACCENT}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ManageAccounts sx={{ fontSize: 26, color: ACCENT }} />
                  </Box>
                  <ArrowForward sx={{ color: ACCENT }} />
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: '#0c1e46', mb: 0.5 }}>User Management</Typography>
                <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mb: 2 }}>Create, edit, deactivate, and manage all system user accounts.</Typography>

                {/* Role breakdown */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {users?.byRole?.map(r => {
                    const cfg = roleMap[r.role] ?? { label: r.role, color: '#64748b' };
                    return (
                      <Chip key={r.role} label={`${cfg.label}: ${r.count}`} size="small"
                        sx={{ bgcolor: `${cfg.color}12`, color: cfg.color, fontWeight: 600, fontSize: '0.78rem', height: 24 }} />
                    );
                  }) ?? <Skeleton width={200} height={22} />}
                </Box>
              </CardContent>
            </Card>
          </motion.div>
        </Grid>

      </Grid>

      {/* Quick nav buttons */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<ManageAccounts />} onClick={() => router.push('/admin/users')}
          sx={{ borderRadius: 2.5, textTransform: 'none', bgcolor: ACCENT, '&:hover': { bgcolor: '#0284c7' }, fontWeight: 600 }}>
          Manage Users
        </Button>
      </Box>
    </Box>
  );
}
