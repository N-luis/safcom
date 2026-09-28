'use client';

import { useState } from 'react';
import {
  Box, Typography, Button, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, ListSubheader,
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
  /** 'residents' | 'officers' | 'everyone' - who the post was addressed to. */
  audience?: string | null;
  /** When officers are included, limits it to one module; null = all officers. */
  audienceModule?: string | null;
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

export interface AudienceOption {
  key: string;
  label: string;
  group: string;
  audience: 'residents' | 'officers' | 'everyone';
  audienceModule: string | null;
  barangay: string | null;
  /** Spelled out under the field, so nobody has to guess who gets it. */
  hint: string;
  /** Wording for the publish button and the dialog subtitle. */
  action: string;
  subtitle: string;
}

/**
 * Every option carries a non-empty `key`. The old field used '' for
 * "All residents", which MUI reads as no-value: the label never shrank and the
 * box rendered blank, so the default looked unset even though it was selected.
 */
export const AUDIENCES: AudienceOption[] = [
  {
    key: 'residents-all', label: 'All residents', group: 'Residents',
    audience: 'residents', audienceModule: null, barangay: null,
    hint: 'Every resident sees it in their Notifications feed',
    action: 'Publish to Residents',
    subtitle: "Goes straight to every resident's Notifications feed",
  },
  ...BARANGAYS.map(b => ({
    key: `residents-${b}`, label: `${b} residents only`, group: 'Residents',
    audience: 'residents' as const, audienceModule: null, barangay: b,
    hint: `Only residents registered in ${b}`,
    action: 'Publish to Residents',
    subtitle: `Goes to residents registered in ${b}`,
  })),
  {
    key: 'officers-all', label: 'All officers', group: 'Officers',
    audience: 'officers', audienceModule: null, barangay: null,
    hint: 'Blotter, VAWC and the Barangay Captain — residents do not see it',
    action: 'Publish to Officers',
    subtitle: "Goes to the officers' Notifications — not to residents",
  },
  {
    key: 'officers-blotter', label: 'Blotter officers', group: 'Officers',
    audience: 'officers', audienceModule: 'blotter', barangay: null,
    hint: 'Only the blotter desk — residents do not see it',
    action: 'Publish to Officers',
    subtitle: "Goes to the blotter officers' Notifications — not to residents",
  },
  {
    key: 'officers-vawc', label: 'VAWC officers', group: 'Officers',
    audience: 'officers', audienceModule: 'vawc', barangay: null,
    hint: 'Only the VAWC desk — residents do not see it',
    action: 'Publish to Officers',
    subtitle: "Goes to the VAWC officers' Notifications — not to residents",
  },
  {
    key: 'officers-captain', label: 'Barangay Captain', group: 'Officers',
    audience: 'officers', audienceModule: 'captain', barangay: null,
    hint: 'Only the Barangay Captain — residents do not see it',
    action: 'Publish to the Captain',
    subtitle: "Goes to the Barangay Captain's Notifications — not to residents",
  },
  {
    key: 'everyone', label: 'Everyone (residents + officers)', group: 'Everyone',
    audience: 'everyone', audienceModule: null, barangay: null,
    hint: 'Residents and every officer',
    action: 'Publish to Everyone',
    subtitle: 'Goes to every resident and every officer',
  },
];

export const DEFAULT_AUDIENCE = AUDIENCES[0].key;

export const audienceOf = (key: string) =>
  AUDIENCES.find(a => a.key === key) ?? AUDIENCES[0];

/** Short label for the board, reconstructed from what was stored on the row. */
export function audienceLabel(a: Pick<Announcement, 'audience' | 'audienceModule' | 'barangay'>): string {
  if (a.audience === 'everyone') return 'Everyone';
  if (a.audience === 'officers') {
    const m = a.audienceModule;
    return m ? `${MODULE_LABEL[m] ?? m} officers` : 'All officers';
  }
  return a.barangay ? `${a.barangay} residents` : 'All residents';
}

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
  const [audienceKey, setAudienceKey] = useState(DEFAULT_AUDIENCE);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Computed once — reading the clock during render is non-deterministic.
  const [minExpiry] = useState(() => localIso(new Date(Date.now() + 60_000)));

  const reset = () => {
    setTitle(''); setMessage(''); setLevel('warning');
    setAudienceKey(DEFAULT_AUDIENCE); setExpiresAt(''); setError('');
  };

  const close = () => { if (!saving) { reset(); onClose(); } };

  const aud = audienceOf(audienceKey);

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
          // The three stored fields are derived from the one picked option, so
          // the form can never send a combination the server would reject.
          audience: aud.audience,
          audienceModule: aud.audienceModule ?? undefined,
          barangay: aud.barangay ?? undefined,
          // Sent as an ISO instant so the server stores a real point in time.
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Could not publish the announcement'); return; }
      toast.success(`Announcement published to ${aud.label.toLowerCase()}`);
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
                {aud.subtitle}
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
            select label="Audience" value={audienceKey} onChange={e => setAudienceKey(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            slotProps={{ input: { sx: { borderRadius: 2 } } }}
            helperText={aud.hint}
          >
            {AUDIENCES.reduce<React.ReactNode[]>((acc, a, i) => {
              // A subheader whenever the group changes, so residents and
              // officers never get picked by mistake for one another.
              if (i === 0 || a.group !== AUDIENCES[i - 1].group) {
                acc.push(
                  <ListSubheader key={`h-${a.group}`} sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', lineHeight: 2.2 }}>
                    {a.group}
                  </ListSubheader>,
                );
              }
              acc.push(<MenuItem key={a.key} value={a.key}>{a.label}</MenuItem>);
              return acc;
            }, [])}
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
            {aud.audience === 'officers' ? 'Officer preview' : 'Resident preview'}
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
            <Chip label={aud.audience === 'officers' ? 'Officer Notice' : 'Barangay Alert'} size="small"
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
          {saving ? 'Publishing…' : aud.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
