'use client';

import { useState } from 'react';
import { Box, Card, CardContent, Typography, Skeleton, useTheme } from '@mui/material';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useAnalytics } from '@/hooks/useApi';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <Box sx={{ bgcolor: 'background.paper', p: 1.5, borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', border: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, mb: 0.5 }}>{label}</Typography>
        {payload.map((entry: any, i: number) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color }} />
            <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">
              {entry.name}: <strong>{entry.value}</strong>
            </Typography>
          </Box>
        ))}
      </Box>
    );
  }
  return null;
};

export function MonthlyTrendChart() {
  const theme = useTheme();
  const { data, isLoading } = useAnalytics();
  const chartData = data?.monthlyData ?? [];

  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Monthly Reports Trend</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, fontSize: '0.86rem' }}>
          Cases & reports over the past 6 months
        </Typography>
        {isLoading ? <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} /> : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="reports" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} name="Reports" />
              <Line type="monotone" dataKey="cases" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4 }} name="Cases" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function BarangayIncidentsChart() {
  const theme = useTheme();
  const { data, isLoading } = useAnalytics();
  const chartData = data?.barangayData ?? [];
  const colors = ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e', '#ef4444', '#eab308', '#06b6d4'];

  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Barangay Incidents</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, fontSize: '0.86rem' }}>
          Incident comparison across barangays
        </Typography>
        {isLoading ? <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} /> : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="incidents" name="Incidents" radius={[6, 6, 0, 0]}>
                {chartData.map((_: unknown, i: number) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function CaseTypeDonutChart() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { data, isLoading } = useAnalytics();
  const chartData = data?.caseTypesData ?? [];

  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return percent > 0.08 ? (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    ) : null;
  };

  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Case Distribution</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '0.86rem' }}>
          Cases by category
        </Typography>
        {isLoading ? <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 2 }} /> : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={chartData} cx="50%" cy="50%"
                  innerRadius={50} outerRadius={80}
                  dataKey="value" labelLine={false} label={renderLabel}
                  onMouseEnter={(_, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {chartData.map((entry: any, i: number) => (
                    <Cell
                      key={i} fill={entry.color}
                      opacity={activeIndex === null || activeIndex === i ? 1 : 0.6}
                      style={{ cursor: 'pointer', filter: activeIndex === i ? 'brightness(1.15)' : 'none', transition: 'opacity 0.2s, filter 0.2s' }}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <Box sx={{ flex: 1, minWidth: 120 }}>
              {chartData.map((item: any, i: number) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.86rem', flex: 1 }}>{item.name}</Typography>
                  <Typography sx={{ fontSize: '0.86rem', fontWeight: 700 }}>{item.value}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function RiskAreaChart() {
  const { data, isLoading } = useAnalytics();
  const chartData = data?.riskData ?? [];

  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Risk Level Distribution</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, fontSize: '0.86rem' }}>
          Current cases by risk category
        </Typography>
        {isLoading ? <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} /> : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} barSize={48}>
              <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Cases" radius={[6, 6, 0, 0]}>
                {chartData.map((entry: any, i: number) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
