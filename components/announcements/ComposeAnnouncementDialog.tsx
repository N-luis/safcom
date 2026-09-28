'use client';

import { useState } from 'react';
import {
  Box, Typography, Button, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Alert as MuiAlert, CircularProgress,
} from '@mui/material';
import { Campaign, Close, Info, WarningAmber, ErrorOutlined } from '@mui/icons-material';
import toast from 'react-hot-toast';

/**
 * The single place an announcement is composed. Shared by the announcements
 * board on the Reports pages and the "Announce" button in each module's
 * dashboard header, so both publish through exactly the same form.
 *
 * Publishing writes an Alert, which every resident then sees in their
 * Notifications feed under "Barangay Alerts" (see /api/resident/updates).
 */

export interface Announcement {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'warning' | 'critical' | string;
  barangay: string | null;
  active: boolean;
  module: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired?: boolean;
}

export const LEVELS = [
  { value: 'info',     label: 'Info',     color: '#3b82f6', icon: Info,           hint: 'General notice — meetings, reminders, schedules' },
  { value: 'warning',  label: 'Warning',  color: '#f97316', icon: WarningAmber,   hint: 'Advisory — incoming typhoon, road closure, brownout' },
  { value: 'critical', label: 'Critical', color: '#ef4444', icon: ErrorOutlined,  hint: 'Emergency — evacuate, immediate danger' },
];

export const levelOf = (v: string) => LEVELS.find(l => l.value === v) ?? LEVELS[1];

export const MODULE_LABEL: Record<string, string> = {
  blotter: 'Blotter', vawc: 'VAWC', captain: 'Barangay Captain', admin: 'System Admin',
};

/** Mirrors the barangay list on the resident registration form. */
const BARANGAYS = ['Biñang 2nd'];

export function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** `datetime-local` needs a local-time string, not the UTC that toISOString gives. */
function localIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Compose dialog ──────────────────────────────────────────────────────────
export default function ComposeAnnouncementDialog({ open, onClose, onPublished, accent }: {
  open: boolean; onClose: () => void; onPublished: () => void; accent: string;
}) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('warning');
  const [barangay, setBarangay] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Computed once — reading the clock during render is non-deterministic.
  const [minExpiry] = useState(() => localIso(new Date(Date.now() + 60_000)));

  const reset = () => {
    setTitle(''); setMessage(''); setLevel('warning');
    setBarangay(''); setExpiresAt(''); setError('');
  };

  const close = () => { if (!saving) { reset(); onClose(); } };

  const publish = async () => {
    setError('');
    if (title.trim().length < 3) { setError('Give the announcement a title of at least 3 characters'); return; }
    if (message.trim().length < 5) { setError('Write a message residents will understand'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          level,
          barangay: barangay || undefined,
          // Sent as an ISO instant so the server stores a real point in time.
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Could not publish the announcement'); return; }
      toast.success('Announcement published — residents can see it now');
      reset();
      onPublished();
      onClose();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const lvl = levelOf(level);

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Campaign sx={{ color: accent }} />
            <Box>
              <Typography sx={{ fontWeight: 800, color: '#0c1e46', fontSize: '1.02rem' }}>New Announcement</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                Goes straight to every resident&apos;s Notifications feed
              </Typography>
            </Box>
          </Box>
          <IconButton size="small" onClick={close}><Close fontSize="small" /></IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, pt: 2 }}>
        {error && <MuiAlert severity="error" sx={{ borderRadius: 2 }}>{error}</MuiAlert>}

        <Box>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1 }}>
            Urgency
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {LEVELS.map(l => {
              const LIcon = l.icon;
              const on = level === l.value;
              return (
                <Chip
                  key={l.value}
                  icon={<LIcon sx={{ fontSize: '16px !important', color: `${on ? l.color : '#94a3b8'} !important` }} />}
                  label={l.label}
                  onClick={() => setLevel(l.value)}
                  sx={{
                    fontWeight: on ? 700 : 500, cursor: 'pointer',
                    bgcolor: on ? `${l.color}16` : '#f8fafc',
                    color: on ? l.color : '#64748b',
                    border: `1.5px solid ${on ? `${l.color}55` : '#e8edf2'}`,
                    '&:hover': { bgcolor: `${l.color}12` },
                  }}
                />
              );
            })}
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.75 }}>{lvl.hint}</Typography>
        </Box>

        <TextField
          label="Title *" fullWidth value={title} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Typhoon Warning — Signal No. 2"
          slotProps={{ htmlInput: { maxLength: 120 }, input: { sx: { borderRadius: 2 } } }}
          helperText={`${title.length}/120`}
        />

        <TextField
          label="Message *" fullWidth multiline rows={4} value={message} onChange={e => setMessage(e.target.value)}
          placeholder="What residents need to know and do — e.g. Classes suspended. Residents near the river are advised to evacuate to the barangay hall."
          slotProps={{ htmlInput: { maxLength: 600 }, input: { sx: { borderRadius: 2 } } }}
          helperText={`${message.length}/600`}
        />

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            select label="Audience" value={barangay} onChange={e => setBarangay(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            slotProps={{ input: { sx: { borderRadius: 2 } } }}
            helperText="Who receives it"
          >
            <MenuItem value="">All residents</MenuItem>
            {BARANGAYS.map(b => <MenuItem key={b} value={b}>{b} only</MenuItem>)}
          </TextField>

          <TextField
            type="datetime-local" label="Expires (optional)" value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: minExpiry },
              input: { sx: { borderRadius: 2 } },
            }}
            helperText="Leave empty to keep it up until taken down"
          />
        </Box>

        {/* What the resident will actually see */}
        <Box>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1 }}>
            Resident preview
          </Typography>
          <Box sx={{ border: '1px solid #e8edf2', borderRadius: 2.5, p: 1.75, display: 'flex', gap: 1.5, bgcolor: '#fafbfc' }}>
            <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: `${lvl.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <lvl.icon sx={{ fontSize: 17, color: lvl.color }} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>
                {title.trim() || 'Announcement title'}
              </Typography>
              <Typography sx={{ fontSize: '0.86rem', color: '#64748b', whiteSpace: 'pre-wrap' }}>
                {message.trim() || 'Your message appears here.'}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: '#94a3b8', mt: 0.4 }}>Just now</Typography>
            </Box>
            <Chip label="Barangay Alert" size="small"
              sx={{ bgcolor: `${lvl.color}14`, color: lvl.color, fontWeight: 700, fontSize: '0.72rem', height: 22, alignSelf: 'flex-start' }} />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={close} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" onClick={publish} disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Campaign />}
          sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.9)' } }}
        >
          {saving ? 'Publishing…' : 'Publish to Residents'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
