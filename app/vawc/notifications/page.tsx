'use client';

import { useState } from 'react';
import { Box, Typography, Card, Chip, Button, Skeleton } from '@mui/material';
import { NotificationsActive, Assessment, Warning, Refresh, Info } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const ACCENT = '#7c3aed';

interface UpdateItem {
  id: string; source: string; title: string; message: string;
  color: string; createdAt: string;
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SOURCE_ICON: Record<string, React.ElementType> = { case: Assessment, alert: Warning };
const SOURCE_LABEL: Record<string, string> = { case: 'Case Update', alert: 'Street/Barangay Alert' };

export default function VawcNotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'case' | 'alert'>('all');
  const { data, isLoading, mutate } = useSWR<UpdateItem[]>('/api/resident/updates?limit=30', fetcher, { refreshInterval: 30000 });

  const displayed = (data ?? []).filter(u => filter === 'all' || u.source === filter);

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Notifications</Typography>
            {(data ?? []).length > 0 && (
              <Chip label={`${(data ?? []).length}`} size="small" sx={{ bgcolor: `${ACCENT}14`, color: ACCENT, fontWeight: 700, height: 20 }} />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>Case activity and street/barangay-wide alerts</Typography>
        </Box>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => mutate()} size="small"
          sx={{ borderColor: '#e2e8f0', color: '#64748b', '&:hover': { borderColor: ACCENT, color: ACCENT } }}>
          Refresh
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
        {[
          { label: 'All', value: 'all', color: '#0c1e46' },
          { label: 'Case Updates', value: 'case', color: ACCENT },
          { label: 'Street/Barangay Alerts', value: 'alert', color: '#f97316' },
        ].map(f => (
          <Chip key={f.value} label={f.label} onClick={() => setFilter(f.value as typeof filter)}
            sx={{
              bgcolor: filter === f.value ? `${f.color}15` : '#f1f5f9',
              color: filter === f.value ? f.color : '#64748b',
              fontWeight: filter === f.value ? 700 : 400,
              border: filter === f.value ? `1px solid ${f.color}30` : '1px solid transparent',
              cursor: 'pointer', fontSize: '0.86rem',
            }}
          />
        ))}
      </Box>

      <Card>
        {isLoading ? (
          <Box sx={{ p: 2.5 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2.5 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="55%" height={20} />
                  <Skeleton variant="text" width="80%" height={16} />
                </Box>
              </Box>
            ))}
          </Box>
        ) : displayed.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 7 }}>
            <NotificationsActive sx={{ fontSize: 44, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.98rem' }}>No notifications</Typography>
            <Typography sx={{ fontSize: '0.86rem', color: '#cbd5e1', mt: 0.5 }}>
              {filter !== 'all' ? 'Try a different filter' : 'Updates will appear here'}
            </Typography>
          </Box>
        ) : (
          <AnimatePresence>
            {displayed.map((u, i) => {
              const IconComp = SOURCE_ICON[u.source] ?? Info;
              return (
                <motion.div key={u.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16 }} transition={{ delay: i * 0.04 }}
                >
                  <Box sx={{
                    display: 'flex', gap: 1.75, px: 2.5, py: 2,
                    borderBottom: i < displayed.length - 1 ? '1px solid #f1f5f9' : 'none',
                    '&:hover': { bgcolor: '#fafbfc' }, transition: 'background 0.15s',
                  }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 2.5, bgcolor: `${u.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <IconComp sx={{ fontSize: 20, color: u.color }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.3 }}>
                        <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, color: '#0c1e46', lineHeight: 1.3 }}>{u.title}</Typography>
                        <Chip label={SOURCE_LABEL[u.source] ?? u.source} size="small"
                          sx={{ bgcolor: `${u.color}12`, color: u.color, fontWeight: 600, fontSize: '0.72rem', height: 22, flexShrink: 0 }} />
                      </Box>
                      <Typography sx={{ fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>{u.message}</Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.5 }}>{timeAgo(u.createdAt)}</Typography>
                    </Box>
                  </Box>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </Card>
    </Box>
  );
}
