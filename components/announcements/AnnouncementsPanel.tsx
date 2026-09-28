'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Chip, IconButton, Tooltip,
  Skeleton, Divider, Switch, FormControlLabel,
} from '@mui/material';
import {
  Campaign, Add, DeleteOutlined, VisibilityOff, Visibility,
  Schedule, Person, Public,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import ComposeAnnouncementDialog, {
  type Announcement, levelOf, MODULE_LABEL, timeAgo, audienceLabel,
} from './ComposeAnnouncementDialog';

/**
 * Barangay announcements board, shown at the bottom of the Blotter and VAWC
 * Reports pages. Composing is delegated to ComposeAnnouncementDialog, which the
 * dashboard "Announce" buttons use too.
 */

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

// ─── Panel ───────────────────────────────────────────────────────────────────
export default function AnnouncementsPanel({ accent = '#0ea5e9' }: { accent?: string }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<Announcement[]>(
    '/api/alerts?all=true', fetcher, { refreshInterval: 30000 },
  );
  const { data: me } = useSWR<{ role?: string }>('/api/auth/me', fetcher);
  const canDelete = me?.role === 'admin' || me?.role === 'system_admin';

  const all = data ?? [];
  const live = all.filter(a => a.active && !a.expired);
  const shown = showInactive ? all : live;

  async function setActive(a: Announcement, active: boolean) {
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/alerts/${a.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (res.ok) {
        toast.success(active ? 'Announcement is live again' : 'Announcement taken down');
        mutate();
      } else {
        toast.error((await res.json()).error ?? 'Could not update the announcement');
      }
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: Announcement) {
    if (!confirm(`Permanently delete "${a.title}"? Residents will no longer see it.`)) return;
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/alerts/${a.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { toast.success('Announcement deleted'); mutate(); }
      else toast.error((await res.json()).error ?? 'Could not delete the announcement');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{
              width: 26, height: 26, borderRadius: 1.5, bgcolor: `${accent}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Campaign sx={{ fontSize: 15, color: accent }} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
              Barangay Announcements
            </Typography>
            <Chip label={`${live.length} live`} size="small"
              sx={{ bgcolor: live.length ? '#dcfce7' : '#f1f5f9', color: live.length ? '#15803d' : '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FormControlLabel
              control={<Switch size="small" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />}
              label={<Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Show past</Typography>}
              sx={{ mr: 0 }}
            />
            <Button
              variant="contained" startIcon={<Add />} onClick={() => setComposeOpen(true)}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.9)' } }}
            >
              New Announcement
            </Button>
          </Box>
        </Box>

        <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 2 }}>
          Published announcements appear in every resident&apos;s Notifications feed under <strong>Barangay Alerts</strong> — use them for typhoon warnings, evacuations and barangay-wide notices.
        </Typography>

        <Divider sx={{ mb: 1.5 }} />

        {/* List */}
        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} variant="rounded" height={76} />)}
          </Box>
        ) : shown.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Campaign sx={{ fontSize: 34, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
            <Typography sx={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>
              {showInactive ? 'No announcements yet' : 'No live announcements'}
            </Typography>
            <Typography sx={{ color: '#cbd5e1', fontSize: '0.82rem', mt: 0.25 }}>
              Publish one and it reaches every resident immediately.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {shown.map(a => {
              const lvl = levelOf(a.level);
              const LIcon = lvl.icon;
              const down = !a.active || Boolean(a.expired);
              const busy = busyId === a.id;
              return (
                <Box
                  key={a.id}
                  sx={{
                    display: 'flex', gap: 1.5, p: 1.75, borderRadius: 2.5,
                    border: `1px solid ${down ? '#e8edf2' : `${lvl.color}33`}`,
                    bgcolor: down ? '#fafbfc' : `${lvl.color}08`,
                    opacity: down ? 0.72 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <Box sx={{
                    width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
                    bgcolor: down ? '#eef2f6' : `${lvl.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <LIcon sx={{ fontSize: 17, color: down ? '#94a3b8' : lvl.color }} />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.25 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', color: '#0c1e46' }}>{a.title}</Typography>
                      <Chip label={lvl.label} size="small"
                        sx={{ bgcolor: `${lvl.color}16`, color: lvl.color, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                      {a.audience === 'officers' && (
                        <Chip label="Officers only" size="small"
                          sx={{ bgcolor: '#eef2ff', color: '#4338ca', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                      )}
                      {a.audience === 'everyone' && (
                        <Chip label="Everyone" size="small"
                          sx={{ bgcolor: '#ecfeff', color: '#0e7490', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                      )}
                      {a.expired && <Chip label="Expired" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />}
                      {!a.active && <Chip label="Taken down" size="small" sx={{ bgcolor: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />}
                    </Box>

                    <Typography sx={{ fontSize: '0.86rem', color: '#475569', whiteSpace: 'pre-wrap', mb: 0.6 }}>
                      {a.message}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', color: '#94a3b8', fontSize: '0.75rem' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                        <Public sx={{ fontSize: 13 }} />
                        {audienceLabel(a)}
                      </Box>
                      {a.createdBy && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                          <Person sx={{ fontSize: 13 }} />
                          {a.createdBy}{a.module ? ` · ${MODULE_LABEL[a.module] ?? a.module}` : ''}
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                        <Schedule sx={{ fontSize: 13 }} />
                        {timeAgo(a.createdAt)}
                        {a.expiresAt && ` · expires ${new Date(a.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </Box>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25, flexShrink: 0 }}>
                    <Tooltip title={a.active ? 'Take down — residents stop seeing it' : 'Publish again'}>
                      <span>
                        <IconButton size="small" disabled={busy} onClick={() => setActive(a, !a.active)}
                          sx={{ color: '#94a3b8', '&:hover': { color: accent } }}>
                          {a.active ? <VisibilityOff sx={{ fontSize: 17 }} /> : <Visibility sx={{ fontSize: 17 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    {canDelete && (
                      <Tooltip title="Delete permanently">
                        <span>
                          <IconButton size="small" disabled={busy} onClick={() => remove(a)}
                            sx={{ color: '#cbd5e1', '&:hover': { color: '#ef4444', bgcolor: '#fef2f2' } }}>
                            <DeleteOutlined sx={{ fontSize: 17 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>

      <ComposeAnnouncementDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPublished={() => mutate()}
        accent={accent}
      />
    </Card>
  );
}
