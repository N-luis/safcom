'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Button,
  Skeleton, Divider,
} from '@mui/material';
import { Notifications, Assessment, Shield, Refresh, Update, Warning, Info } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import { RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY } from '@/lib/notifications';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface UpdateItem {
  id: string; source: 'case' | 'alert'; title: string; message: string;
  color: string; createdAt: string; caseType?: string;
}

const SOURCE_ICON: Record<string, typeof Shield> = {
  case: Assessment,
  alert: Shield,
};

const SOURCE_LABEL: Record<string, string> = {
  case: 'Case Update',
  alert: 'Barangay Alert',
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (Math.floor(h / 24) < 7) return `${Math.floor(h / 24)}d ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ResidentNotificationsPage() {
  const [typeFilter, setTypeFilter] = useState<'all' | 'case' | 'alert'>('all');

  // Capture the "last seen" timestamp before this visit marks everything as read,
  // so items newer than it can be highlighted as new.
  const [lastSeen] = useState(() =>
    typeof window === 'undefined' ? 0 : Number(localStorage.getItem(RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY) ?? 0));

  const { data: updates, isLoading, mutate } = useSWR<UpdateItem[]>('/api/resident/updates?limit=20', fetcher, { refreshInterval: 30000 });

  const displayed = (updates ?? []).filter(u => typeFilter === 'all' || u.source === typeFilter);
  const newCount = (updates ?? []).filter(u => new Date(u.createdAt).getTime() > lastSeen).length;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Notifications</Typography>
            {(updates ?? []).length > 0 && (
              <Chip label={`${(updates ?? []).length} updates`} size="small" sx={{ bgcolor: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
            )}
            {newCount > 0 && (
              <Chip label={`${newCount} new`} size="small" sx={{ bgcolor: '#fef2f2', color: '#dc2626', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
            Case status updates and barangay announcements
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => mutate()} size="small"
          sx={{ borderColor: '#e2e8f0', color: '#64748b', '&:hover': { borderColor: '#14b8a6', color: '#14b8a6' } }}>
          Refresh
        </Button>
      </Box>

      {/* Filter */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
        {[
          { label: 'All', value: 'all', color: '#0c1e46' },
          { label: 'Case Updates', value: 'case', color: '#14b8a6' },
          { label: 'Barangay Alerts', value: 'alert', color: '#f97316' },
        ].map(f => (
          <Chip
            key={f.value}
            label={f.label}
            onClick={() => setTypeFilter(f.value as 'all' | 'case' | 'alert')}
            sx={{
              bgcolor: typeFilter === f.value ? `${f.color}15` : '#f1f5f9',
              color: typeFilter === f.value ? f.color : '#64748b',
              fontWeight: typeFilter === f.value ? 700 : 400,
              border: typeFilter === f.value ? `1px solid ${f.color}30` : '1px solid transparent',
              cursor: 'pointer', fontSize: '0.86rem', transition: 'all 0.15s',
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
                  <Skeleton variant="text" width="35%" height={14} />
                </Box>
              </Box>
            ))}
          </Box>
        ) : displayed.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 7 }}>
            <Notifications sx={{ fontSize: 44, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.98rem' }}>No notifications</Typography>
            <Typography sx={{ fontSize: '0.86rem', color: '#cbd5e1', mt: 0.5 }}>
              {typeFilter !== 'all' ? 'Try a different filter' : 'Updates will appear here once you have active cases'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ divide: 1 }}>
            <AnimatePresence>
              {displayed.map((u, i) => {
                const IconComp = SOURCE_ICON[u.source] ?? Info;
                return (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Box sx={{
                      display: 'flex', gap: 1.75, px: 2.5, py: 2,
                      borderBottom: i < displayed.length - 1 ? '1px solid #f1f5f9' : 'none',
                      '&:hover': { bgcolor: '#fafbfc' }, transition: 'background 0.15s',
                      alignItems: 'flex-start',
                    }}>
                      <Box sx={{
                        width: 40, height: 40, borderRadius: 2.5,
                        bgcolor: `${u.color}14`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <IconComp sx={{ fontSize: 20, color: u.color }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.3 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            {new Date(u.createdAt).getTime() > lastSeen && (
                              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
                            )}
                            <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, color: '#0c1e46', lineHeight: 1.3 }}>
                              {u.title}
                            </Typography>
                          </Box>
                          <Chip
                            label={SOURCE_LABEL[u.source]}
                            size="small"
                            sx={{ bgcolor: `${u.color}12`, color: u.color, fontWeight: 600, fontSize: '0.72rem', height: 22, flexShrink: 0 }}
                          />
                        </Box>
                        <Typography sx={{ fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5 }}>
                          {u.message}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.5 }}>
                          {timeAgo(u.createdAt)}
                        </Typography>
                      </Box>
                    </Box>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Box>
        )}
      </Card>
    </Box>
  );
}
