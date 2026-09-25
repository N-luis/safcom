'use client';

import { Box, Grid, Typography, Card, CardContent } from '@mui/material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { MonthlyTrendChart, BarangayIncidentsChart, CaseTypeDonutChart, RiskAreaChart } from '@/components/dashboard/AnalyticsChart';
import { TrendingUp, TrendingDown } from '@mui/icons-material';
import { motion } from 'framer-motion';

const kpiData = [
  { label: 'Resolution Rate', value: '73%', change: '+4.2%', up: true, desc: 'Cases resolved this month' },
  { label: 'Avg Response Time', value: '2.4h', change: '-12%', up: true, desc: 'Average case response time' },
  { label: 'Risk Index', value: '6.2', change: '+0.8', up: false, desc: 'Community risk score (1-10)' },
  { label: 'Cases per Officer', value: '14.6', change: '+2.1', up: false, desc: 'Average caseload per officer' },
];

export default function AnalyticsPage() {
  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>Analytics</Typography>
          <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>In-depth data analysis and trends</Typography>
        </Box>

        {/* KPI Cards */}
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          {kpiData.map((kpi, i) => (
            <Grid size={{ xs: 6, md: 3 }} key={kpi.label}>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider',
                  cursor: 'pointer', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' } }}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary" gutterBottom>{kpi.label}</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 900, mb: 0.5 }}>{kpi.value}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {kpi.up ? <TrendingUp sx={{ fontSize: 14, color: '#22c55e' }} /> : <TrendingDown sx={{ fontSize: 14, color: '#ef4444' }} />}
                      <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: kpi.up ? '#22c55e' : '#ef4444' }}>{kpi.change}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.78rem' }} color="text.disabled">{kpi.desc}</Typography>
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 12, md: 8 }}><MonthlyTrendChart /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><CaseTypeDonutChart /></Grid>
        </Grid>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 6 }}><BarangayIncidentsChart /></Grid>
          <Grid size={{ xs: 12, md: 6 }}><RiskAreaChart /></Grid>
        </Grid>
      </Box>
    </DashboardLayout>
  );
}
