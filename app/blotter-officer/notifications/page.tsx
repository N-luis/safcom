'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, IconButton,
  List, ListItem, ListItemText, ListItemIcon, Skeleton,
  ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material';
import {
  NotificationsActive, Warning, Info, CheckCircle, Error,
  MarkEmailRead, Notifications,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '@/hooks/useApi';
import { mutate } from 'swr';
import toast from 'react-hot-toast';

const TYPE_CONFIG: Record<string, { color: string; icon: React.ComponentType<{ sx?: object }>; label: string }> = {
  info:    { color: '#3b82f6', icon: Info,          label: 'Info' },
  warning: { color: '#f97316', icon: Warning,        label: 'Warning' },
  success: { color: '#22c55e', icon: CheckCircle,    label: 'Success' },
  error:   { color: '#ef4444', icon: Error,          label: 'Alert' },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString();
}

interface Notif {
  id: string; title: string; message: string; type: string; read: boolean; createdAt: string;
}

export default function NotificationsPage() {
  const { data, isLoading } = useNotifications(50);
  const [filter, setFilter]     = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState('');

  const notifications: Notif[] = data?.notifications ?? (Array.isArray(data) ? data : []);
  // prefer server-side unread count so it matches the sidebar badge
  const unreadCount: number = data?.unreadCount ?? notifications.filter(n => !n.read).length;

  const displayed = notifications.filter(n => {
    if (filter === 'unread' && n.read) return false;
    if (typeFilter && n.type !== typeFilter) return false;
    return true;
  });

  const invalidate = () => mutate((key: unknown) => typeof key === 'string' && key.includes('/api/notifications'));

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    invalidate();
  };

  const markAllRead = async () => {
    await fetch('/api/notifications', { method: 'PATCH', credentials: 'include' });
    toast.success('All marked as read');
    invalidate();
  };

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
              Notifications
            </Typography>
            {unreadCount > 0 && (
              <Chip
                label={`${unreadCount} new`} size="small"
                sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.82rem', height: 24 }}
              />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.2 }}>
            System alerts and case updates for your queue
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<MarkEmailRead />}
          onClick={markAllRead}
          disabled={unreadCount === 0}
          size="small"
          sx={{
            borderRadius: 2, borderColor: '#e2e8f0', color: '#475569', textTransform: 'none',
            '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' },
            '&:disabled': { borderColor: '#f1f5f9', color: '#cbd5e1' },
          }}
        >
          Mark All Read
        </Button>
      </Box>

      {/* ── Filter row ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: { xs: 1.5, sm: 1.75 }, '&:last-child': { pb: { xs: 1.5, sm: 1.75 } } }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <ToggleButtonGroup
              value={filter} exclusive
              onChange={(_, v) => v && setFilter(v)}
              size="small"
            >
              <ToggleButton value="all" sx={{ fontSize: '0.86rem', px: 1.5, borderRadius: '8px 0 0 8px !important', textTransform: 'none' }}>
                All ({notifications.length})
              </ToggleButton>
              <ToggleButton value="unread" sx={{ fontSize: '0.86rem', px: 1.5, borderRadius: '0 8px 8px 0 !important', textTransform: 'none' }}>
                Unread ({unreadCount})
              </ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                <Chip
                  key={key} label={cfg.label} size="small"
                  onClick={() => setTypeFilter(prev => prev === key ? '' : key)}
                  sx={{
                    bgcolor:    typeFilter === key ? `${cfg.color}20` : '#f1f5f9',
                    color:      typeFilter === key ? cfg.color : '#64748b',
                    fontWeight: typeFilter === key ? 700 : 400,
                    fontSize: '0.82rem', cursor: 'pointer',
                    border: typeFilter === key ? `1px solid ${cfg.color}40` : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                />
              ))}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* ── Notification list ── */}
      <Card>
        {isLoading ? (
          <Box sx={{ p: 2 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                <Skeleton variant="circular" width={36} height={36} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="55%" height={20} />
                  <Skeleton variant="text" width="80%" height={16} />
                  <Skeleton variant="text" width="30%" height={14} sx={{ mt: 0.5 }} />
                </Box>
              </Box>
            ))}
          </Box>
        ) : displayed.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: { xs: 5, sm: 7 }, px: 2 }}>
            <Notifications sx={{ fontSize: { xs: 36, sm: 44 }, color: '#cbd5e1', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 600, color: '#475569', fontSize: '0.98rem', mb: 0.5 }}>
              {filter === 'unread' ? 'All caught up!' : 'No notifications'}
            </Typography>
            <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8', maxWidth: 280, mx: 'auto' }}>
              {filter === 'unread'
                ? 'You have no unread notifications at this time.'
                : 'System alerts and case updates will appear here.'}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            <AnimatePresence>
              {displayed.map((n, idx) => {
                const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.04 }}
                  >
                    <ListItem
                      onClick={() => !n.read && markRead(n.id)}
                      sx={{
                        px: { xs: 1.75, sm: 2.5 }, py: { xs: 1.25, sm: 1.75 },
                        bgcolor: n.read ? 'transparent' : `${cfg.color}06`,
                        borderBottom: '1px solid #f1f5f9',
                        cursor: n.read ? 'default' : 'pointer',
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: '#f8fafc' },
                        alignItems: 'flex-start',
                      }}
                    >
                      <ListItemIcon sx={{ mt: 0.25, minWidth: { xs: 36, sm: 42 } }}>
                        <Box sx={{
                          width: { xs: 30, sm: 34 }, height: { xs: 30, sm: 34 },
                          borderRadius: 2, bgcolor: `${cfg.color}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <cfg.icon sx={{ fontSize: { xs: 15, sm: 18 }, color: cfg.color }} />
                        </Box>
                      </ListItemIcon>

                      <ListItemText
                        primary={
                          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.2 }}>
                            <Typography component="span" sx={{
                              fontSize: { xs: '0.9rem', sm: '0.94rem' },
                              fontWeight: n.read ? 500 : 700,
                              color: '#0c1e46', flex: 1,
                            }}>
                              {n.title}
                            </Typography>
                            {!n.read && (
                              <Box component="span" sx={{
                                width: 7, height: 7, borderRadius: '50%',
                                bgcolor: cfg.color, flexShrink: 0, display: 'inline-block',
                              }} />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box component="span" sx={{ display: 'block' }}>
                            <Typography component="span" sx={{
                              fontSize: { xs: '0.86rem', sm: '0.9rem' },
                              color: '#64748b', lineHeight: 1.5, display: 'block', mb: 0.3,
                            }}>
                              {n.message}
                            </Typography>
                            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
                              <Chip
                                label={cfg.label} size="small"
                                sx={{ bgcolor: `${cfg.color}15`, color: cfg.color, fontWeight: 600, fontSize: '0.72rem', height: 22 }}
                              />
                              <Typography component="span" sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                                {timeAgo(n.createdAt)}
                              </Typography>
                            </Box>
                          </Box>
                        }
                      />

                      {!n.read && (
                        <Tooltip title="Mark as read">
                          <IconButton
                            size="small"
                            onClick={e => { e.stopPropagation(); markRead(n.id); }}
                            sx={{ mt: 0.25, ml: 0.5, color: '#cbd5e1', '&:hover': { color: '#22c55e' }, flexShrink: 0 }}
                          >
                            <CheckCircle sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </ListItem>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </List>
        )}

        {displayed.length > 0 && (
          <Box sx={{ px: { xs: 1.75, sm: 2.5 }, py: 1.25, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>
              Showing {displayed.length} of {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
            </Typography>
            {unreadCount > 0 && (
              <Typography sx={{ fontSize: '0.86rem', color: '#ef4444', fontWeight: 600 }}>
                {unreadCount} unread
              </Typography>
            )}
          </Box>
        )}
      </Card>
    </Box>
  );
}
