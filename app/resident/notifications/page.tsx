'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Button,
  Skeleton, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { Notifications, Assessment, Shield, Refresh, Update, Warning, Info, ArrowForward, ChevronRight } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY } from '@/lib/notifications';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface UpdateItem {
  id: string; source: 'case' | 'alert'; title: string; message: string;
  color: string; createdAt: string; caseType?: string;
  /** Present on case updates, and what makes the notification navigable. */
  caseId?: string | null;
  caseNumber?: string | null;
  caseStatus?: string | null;
  caseRiskLevel?: string | null;
  /** Urgency of a barangay announcement. */
  level?: string | null;
}

const ACCENT = '#14b8a6';

const LEVEL_LABEL: Record<string, string> = {
  info: 'General notice', warning: 'Advisory', critical: 'Emergency',
};

const RISK_COLOR: Record<string, string> = {
  Low: '#22c55e', Medium: '#f97316', High: '#ef4444', Critical: '#8b5cf6',
};

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

/**
 * The full notification, and a way out of it.
 *
 * The list has to truncate; this does not. For a case update it also carries
 * the case itself - number, type, status and current risk - and a button that
 * opens that case, because a notification about a case that cannot reach the
 * case is a dead end.
 */
function NotificationDialog({ u, onClose, onOpenCase }: {
  u: UpdateItem;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const IconComp = SOURCE_ICON[u.source] ?? Info;
  const isCase = u.source === 'case';
  const facts: [string, string][] = isCase
    ? [
        ...(u.caseNumber ? [['Case number', `#${u.caseNumber}`] as [string, string]] : []),
        ...(u.caseType ? [['Case type', u.caseType] as [string, string]] : []),
        ...(u.caseStatus ? [['Status', u.caseStatus] as [string, string]] : []),
      ]
    : [...(u.level ? [['Urgency', LEVEL_LABEL[u.level] ?? u.level] as [string, string]] : [])];

  return (
    <Dialog
      open onClose={onClose} maxWidth="xs" fullWidth
      aria-labelledby="notification-title"
      sx={{ '& .MuiDialog-paper': { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'auto' }, borderRadius: 3 } }}
    >
      <DialogTitle id="notification-title" sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: 2.5, bgcolor: `${u.color}14`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <IconComp sx={{ fontSize: 19, color: u.color }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46', lineHeight: 1.3 }}>
              {u.title}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {new Date(u.createdAt).toLocaleString('en-PH', {
                year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Chip
          label={SOURCE_LABEL[u.source]}
          size="small"
          sx={{ bgcolor: `${u.color}14`, color: u.color, fontWeight: 700, fontSize: '0.72rem', mb: 1.5 }}
        />
        <Typography sx={{ fontSize: '0.92rem', color: '#475569', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {u.message}
        </Typography>

        {facts.length > 0 && (
          <>
            <Divider sx={{ my: 1.75 }} />
            {facts.map(([label, value]) => (
              <Box key={label} sx={{ display: 'flex', gap: 1, mb: 0.6, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', minWidth: 104 }}>{label}</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46', fontWeight: 700 }}>{value}</Typography>
              </Box>
            ))}
            {isCase && u.caseRiskLevel && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', minWidth: 104 }}>Risk level</Typography>
                <Chip
                  label={u.caseRiskLevel}
                  size="small"
                  sx={{
                    bgcolor: `${RISK_COLOR[u.caseRiskLevel] ?? '#64748b'}18`,
                    color: RISK_COLOR[u.caseRiskLevel] ?? '#64748b',
                    fontWeight: 800, fontSize: '0.74rem', height: 22,
                  }}
                />
              </Box>
            )}
          </>
        )}

        {isCase && !u.caseId && (
          <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mt: 1.75 }}>
            This case is no longer available to open.
          </Typography>
        )}
      </DialogContent>

      {/* Stacked on a phone so both stay reachable with a thumb. */}
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
        <Button
          onClick={onClose}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, color: '#64748b', textTransform: 'none' }}
        >
          Close
        </Button>
        {isCase && u.caseId && (
          <Button
            variant="contained"
            onClick={() => onOpenCase(u.caseId as string)}
            endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
            sx={{
              minHeight: 44, width: { xs: '100%', sm: 'auto' }, borderRadius: 2,
              bgcolor: ACCENT, fontWeight: 700, textTransform: 'none',
              '&:hover': { bgcolor: '#0d9488' },
            }}
          >
            View this case
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default function ResidentNotificationsPage() {
  const [typeFilter, setTypeFilter] = useState<'all' | 'case' | 'alert'>('all');

  // Capture the "last seen" timestamp before this visit marks everything as read,
  // so items newer than it can be highlighted as new.
  const [lastSeen] = useState(() =>
    typeof window === 'undefined' ? 0 : Number(localStorage.getItem(RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY) ?? 0));

  const router = useRouter();
  const [opened, setOpened] = useState<UpdateItem | null>(null);

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
                    {/* A button, not a div with a click handler: it is reachable
                        by keyboard and announced as actionable. */}
                    <Box
                      component="button"
                      type="button"
                      onClick={() => setOpened(u)}
                      aria-label={`Open notification: ${u.title}`}
                      sx={{
                        display: 'flex', gap: 1.75, px: { xs: 1.75, sm: 2.5 }, py: 2,
                        borderBottom: i < displayed.length - 1 ? '1px solid #f1f5f9' : 'none',
                        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                        bgcolor: 'transparent', width: '100%', textAlign: 'left',
                        font: 'inherit', color: 'inherit', cursor: 'pointer', minHeight: 44,
                        '&:hover': { bgcolor: '#fafbfc' }, transition: 'background 0.15s',
                        '&:focus-visible': { outline: `3px solid ${ACCENT}55`, outlineOffset: -3 },
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
                        <Typography sx={{
                          fontSize: '0.9rem', color: '#64748b', lineHeight: 1.5,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {u.message}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.5 }}>
                          {timeAgo(u.createdAt)}
                        </Typography>
                      </Box>
                      <ChevronRight sx={{ fontSize: 18, color: '#cbd5e1', alignSelf: 'center', flexShrink: 0 }} />
                    </Box>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Box>
        )}
      </Card>

      {opened && (
        <NotificationDialog
          u={opened}
          onClose={() => setOpened(null)}
          onOpenCase={id => {
            setOpened(null);
            router.push(`/resident/my-cases?case=${id}`);
          }}
        />
      )}
    </Box>
  );
}
