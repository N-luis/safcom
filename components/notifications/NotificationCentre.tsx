'use client';

import {
  useState,
} from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, IconButton, List, ListItem, ListItemText, ListItemIcon, Skeleton, ToggleButton, ToggleButtonGroup, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from '@mui/material';
import {
  Warning, Info, CheckCircle, Error, MarkEmailRead, Notifications, ArrowForward,
} from '@mui/icons-material';
import {
  motion, AnimatePresence,
} from 'framer-motion';
import {
  useNotifications,
} from '@/hooks/useApi';
import {
  mutate,
} from 'swr';
import {
  useRouter,
} from 'next/navigation';
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
  /** The case it is about, when it is about one. */
  case?: {
    id: string; caseNumber: string; caseType: string; status: string; riskLevel: string;
  } | null;
}

const RISK_COLOR: Record<string, string> = {
  Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e',
};

/**
 * The whole notification, and a way into the case it is about.
 *
 * The list truncates and the row only marked itself read; a notice naming a
 * case that cannot reach that case leaves the officer to go and find it by
 * hand, which is the slowest moment in the queue.
 */
function NotificationDialog({ n, onClose, onOpenCase }: {
  n: Notif;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
  const Icon = cfg.icon;
  const c = n.case;

  return (
    <Dialog
      open onClose={onClose} maxWidth="xs" fullWidth
      aria-labelledby="notification-title"
      sx={{ '& .MuiDialog-paper': { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'auto' }, borderRadius: 3 } }}
    >
      <DialogTitle id="notification-title" sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: 2.5, bgcolor: `${cfg.color}18`, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon sx={{ fontSize: 19, color: cfg.color }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46', lineHeight: 1.3 }}>
              {n.title}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {new Date(n.createdAt).toLocaleString('en-PH', {
                year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Chip label={cfg.label} size="small"
          sx={{ bgcolor: `${cfg.color}18`, color: cfg.color, fontWeight: 700, fontSize: '0.72rem', mb: 1.5 }} />
        <Typography sx={{ fontSize: '0.92rem', color: '#475569', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {n.message}
        </Typography>

        {c && (
          <>
            <Divider sx={{ my: 1.75 }} />
            {([['Case number', `#${c.caseNumber}`], ['Case type', c.caseType], ['Status', c.status]] as [string, string][])
              .map(([k, v]) => (
                <Box key={k} sx={{ display: 'flex', gap: 1, mb: 0.6, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', minWidth: 104 }}>{k}</Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46', fontWeight: 700 }}>{v}</Typography>
                </Box>
              ))}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', minWidth: 104 }}>Risk level</Typography>
              <Chip label={c.riskLevel ?? 'Undetermined'} size="small" sx={{
                bgcolor: `${RISK_COLOR[c.riskLevel] ?? '#64748b'}18`,
                color: RISK_COLOR[c.riskLevel] ?? '#64748b', fontWeight: 800, fontSize: '0.74rem', height: 22,
              }} />
            </Box>
          </>
        )}

        {!c && (
          <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mt: 1.75 }}>
            This notice is not about a particular case.
          </Typography>
        )}
      </DialogContent>

      {/* Stacked on a phone so both stay reachable with a thumb. */}
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
        <Button onClick={onClose}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, color: '#64748b', textTransform: 'none' }}>
          Close
        </Button>
        {c && (
          <Button
            variant="contained"
            onClick={() => onOpenCase(c.id)}
            endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
            sx={{
              minHeight: 44, width: { xs: '100%', sm: 'auto' }, borderRadius: 2,
              fontWeight: 700, textTransform: 'none',
            }}
          >
            View this case
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * The notification centre, for whichever desk is looking at it.
 *
 * Both desks mount this. The blotter had the clickable version - open a
 * notice, read it in full, go straight to the case it is about - while the
 * VAWC desk had a list that could only be marked read. The list itself is
 * already filtered by role server-side, so a notice about a VAWC case never
 * reaches the blotter and this component never has to think about it.
 */
export interface NotificationCentreProps {
  /** Where this desk's cases live, so "View this case" lands in the right module. */
  caseBasePath: string;
}

export default function NotificationCentre({ caseBasePath }: NotificationCentreProps) {
  const { data, isLoading } = useNotifications(50);
  const router = useRouter();
  const [opened, setOpened] = useState<Notif | null>(null);
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
                      component="button"
                      aria-label={`Open notification: ${n.title}`}
                      onClick={() => { setOpened(n); if (!n.read) markRead(n.id); }}
                      sx={{
                        px: { xs: 1.75, sm: 2.5 }, py: { xs: 1.25, sm: 1.75 },
                        bgcolor: n.read ? 'transparent' : `${cfg.color}06`,
                        borderBottom: '1px solid #f1f5f9',
                        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                        width: '100%', textAlign: 'left', font: 'inherit',
                        cursor: 'pointer', minHeight: 44,
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: '#f8fafc' },
                        '&:focus-visible': { outline: `3px solid ${cfg.color}55`, outlineOffset: -3 },
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
                        // MUI wraps these in <span> and <p>; a Chip renders a
                        // <div>, and a <div> inside a <p> is invalid markup
                        // that React reports as a hydration error.
                        slotProps={{ primary: { component: 'div' }, secondary: { component: 'div' } }}
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

      {opened && (
        <NotificationDialog
          n={opened}
          onClose={() => setOpened(null)}
          onOpenCase={id => {
            setOpened(null);
            router.push(`${caseBasePath}/${id}`);
          }}
        />
      )}
    </Box>
  );
}
