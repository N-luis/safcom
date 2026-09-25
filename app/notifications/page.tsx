'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Button, IconButton,
  Skeleton, Tabs, Tab, Divider, Tooltip,
} from '@mui/material';
import {
  Notifications, CheckCircle, Delete, DoneAll,
  InfoOutlined, WarningAmber, ErrorOutlined, CheckCircleOutlined,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useNotifications, refreshNotifications } from '@/hooks/useApi';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

const typeConfig = {
  info: { icon: InfoOutlined, color: '#3b82f6', bg: '#3b82f620', label: 'Info' },
  warning: { icon: WarningAmber, color: '#f97316', bg: '#f9731620', label: 'Warning' },
  error: { icon: ErrorOutlined, color: '#ef4444', bg: '#ef444420', label: 'Critical' },
  success: { icon: CheckCircleOutlined, color: '#22c55e', bg: '#22c55e20', label: 'Success' },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function groupByDate(notifications: Record<string, unknown>[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const groups: Record<string, Record<string, unknown>[]> = { Today: [], Yesterday: [], Older: [] };
  for (const n of notifications) {
    const d = new Date(n.createdAt as string); d.setHours(0, 0, 0, 0);
    if (d >= today) groups.Today.push(n);
    else if (d >= yesterday) groups.Yesterday.push(n);
    else groups.Older.push(n);
  }
  return groups;
}

export default function NotificationsPage() {
  const { data, mutate, isLoading } = useNotifications(100);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const allNotifications: Record<string, unknown>[] = data?.notifications ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;

  const filtered = allNotifications.filter(n => {
    if (tab === 'unread' && n.read) return false;
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    return true;
  });

  const groups = groupByDate(filtered);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
    mutate();
    refreshNotifications();
  }

  async function deleteNotif(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    mutate();
    refreshNotifications();
    toast.success('Notification deleted');
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH' });
    mutate();
    refreshNotifications();
    toast.success('All notifications marked as read');
  }

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Notifications sx={{ color: 'white', fontSize: 20 }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>Notifications</Typography>
              <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>
                {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
              </Typography>
            </Box>
          </Box>
          {unreadCount > 0 && (
            <Button variant="outlined" startIcon={<DoneAll />} onClick={markAllRead} sx={{ borderRadius: 2.5, textTransform: 'none' }}>
              Mark all as read
            </Button>
          )}
        </Box>

        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <CardContent sx={{ p: 0 }}>
            {/* Tabs + filters */}
            <Box sx={{ px: 3, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }}>
                <Tab value="all" label="All" sx={{ textTransform: 'none', minHeight: 36, fontSize: '0.94rem' }} />
                <Tab
                  value="unread"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      Unread
                      {unreadCount > 0 && (
                        <Chip label={unreadCount} size="small" color="error" sx={{ height: 22, fontSize: '0.78rem', '& .MuiChip-label': { px: 0.75 } }} />
                      )}
                    </Box>
                  }
                  sx={{ textTransform: 'none', minHeight: 36, fontSize: '0.94rem' }}
                />
              </Tabs>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {['all', 'info', 'warning', 'error', 'success'].map((t) => (
                  <Chip
                    key={t}
                    label={t === 'all' ? 'All types' : t === 'error' ? 'Critical' : t.charAt(0).toUpperCase() + t.slice(1)}
                    size="small"
                    onClick={() => setTypeFilter(t)}
                    variant={typeFilter === t ? 'filled' : 'outlined'}
                    color={typeFilter === t ? 'primary' : 'default'}
                    sx={{ fontSize: '0.82rem', cursor: 'pointer' }}
                  />
                ))}
              </Box>
            </Box>
            <Divider />

            {isLoading ? (
              <Box sx={{ p: 3 }}>
                {[...Array(5)].map((_, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <Skeleton variant="circular" width={40} height={40} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton width="60%" height={20} />
                      <Skeleton width="90%" height={16} />
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : filtered.length === 0 ? (
              <Box sx={{ py: 10, textAlign: 'center' }}>
                <CheckCircle sx={{ fontSize: 56, color: '#22c55e', mb: 2, opacity: 0.7 }} />
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>All caught up!</Typography>
                <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>No notifications to show.</Typography>
              </Box>
            ) : (
              <Box>
                {Object.entries(groups).map(([label, items]) => {
                  if (items.length === 0) return null;
                  return (
                    <Box key={label}>
                      <Box sx={{ px: 3, py: 1, bgcolor: 'action.hover' }}>
                        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }} color="text.secondary">
                          {label}
                        </Typography>
                      </Box>
                      <AnimatePresence>
                        {items.map((n, i) => {
                          const cfg = typeConfig[(n.type as string) as keyof typeof typeConfig] ?? typeConfig.info;
                          const Icon = cfg.icon;
                          return (
                            <motion.div
                              key={n.id as string}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 8 }}
                              transition={{ delay: i * 0.03 }}
                            >
                              <Box
                                sx={{
                                  display: 'flex', alignItems: 'flex-start', gap: 2, px: 3, py: 2,
                                  borderLeft: n.read ? '3px solid transparent' : `3px solid ${cfg.color}`,
                                  bgcolor: n.read ? 'transparent' : `${cfg.color}08`,
                                  '&:hover': { bgcolor: 'action.hover' },
                                  transition: 'background 0.15s',
                                  cursor: 'pointer',
                                }}
                                onClick={() => !n.read && markRead(n.id as string)}
                              >
                                <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Icon sx={{ fontSize: 20, color: cfg.color }} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                                    <Typography sx={{ fontSize: '0.94rem', fontWeight: n.read ? 500 : 700, lineHeight: 1.3 }}>
                                      {n.title as string}
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                      <Typography sx={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }} color="text.disabled">
                                        {timeAgo(n.createdAt as string)}
                                      </Typography>
                                      {!n.read && (
                                        <Tooltip title="Mark as read">
                                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); markRead(n.id as string); }}>
                                            <CheckCircle sx={{ fontSize: 16, color: cfg.color }} />
                                          </IconButton>
                                        </Tooltip>
                                      )}
                                      <Tooltip title="Delete">
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteNotif(n.id as string); }}>
                                          <Delete sx={{ fontSize: 16 }} />
                                        </IconButton>
                                      </Tooltip>
                                    </Box>
                                  </Box>
                                  <Typography sx={{ fontSize: '0.9rem', mt: 0.3 }} color="text.secondary">
                                    {n.message as string}
                                  </Typography>
                                  <Chip label={cfg.label} size="small" sx={{ mt: 0.75, height: 22, fontSize: '0.78rem', bgcolor: cfg.bg, color: cfg.color, '& .MuiChip-label': { px: 0.75 } }} />
                                </Box>
                              </Box>
                              <Divider />
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </Box>
                  );
                })}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </DashboardLayout>
  );
}
