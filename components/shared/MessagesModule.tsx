'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Card, TextField, Button, Avatar,
  Chip, IconButton, Divider, Skeleton, Dialog, DialogTitle,
  DialogContent, DialogActions, Select, MenuItem, FormControl,
  InputLabel, InputAdornment, Tooltip, Badge, CircularProgress, Alert,
} from '@mui/material';
import {
  Edit, Send, Inbox, Send as SendIcon, Delete, Reply,
  Search, Message, Circle, Refresh, Close, MarkEmailRead,
} from '@mui/icons-material';
import { useMessages, useUsers, useCurrentUser, refreshMessages } from '@/hooks/useApi';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin: 'Barangay Captain',
  system_admin: 'System Admin',
  officer: 'Blotter Officer',
  vawc_officer: 'VAWC Officer',
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#8b5cf6',
  system_admin: '#0ea5e9',
  officer: '#3b82f6',
  vawc_officer: '#7c3aed',
};

function roleLabel(role?: string) {
  return role ? (ROLE_LABELS[role] ?? role.replace(/_/g, ' ')) : 'Officer';
}
function roleColor(role?: string) {
  return role ? (ROLE_COLORS[role] ?? '#64748b') : '#64748b';
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function avatarBg(name: string, accent: string) {
  const colors = [accent, '#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#06b6d4'];
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MsgUser { id: string; name: string; email: string; role?: string }
interface MsgReply { id: string; body: string; createdAt: string; sender: MsgUser }
interface ApiMessage {
  id: string; subject: string; body: string; read: boolean; createdAt: string;
  sender: MsgUser; recipient: MsgUser; replies?: MsgReply[];
}

// ─── Compose Dialog ───────────────────────────────────────────────────────────

function ComposeDialog({ open, onClose, users, usersLoading, onSent, accent }: {
  open: boolean; onClose: () => void; accent: string;
  users: MsgUser[]; usersLoading: boolean; onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { if (open) { setTo(''); setSubject(''); setBody(''); } }, [open]);

  const canSend = !!to && subject.trim().length > 0 && body.trim().length > 0;

  async function send() {
    if (!canSend) { toast.error('Please fill in all fields'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), recipientId: to }),
      });
      if (res.ok) {
        toast.success('Message sent!');
        onSent();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to send');
      }
    } catch { toast.error('Network error. Please try again.'); }
    finally { setSending(false); }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Edit sx={{ color: 'white', fontSize: 16 }} />
            </Box>
            New Message
          </Box>
          {!sending && <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        {usersLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={16} sx={{ color: accent }} />
            <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>Loading contacts…</Typography>
          </Box>
        ) : users.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>No other users available.</Alert>
        ) : (
          <FormControl fullWidth size="small">
            <InputLabel>To</InputLabel>
            <Select value={to} onChange={e => setTo(e.target.value)} label="To"
              sx={{ borderRadius: 2, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: accent } }} disabled={sending}>
              {users.map(u => (
                <MenuItem key={u.id} value={u.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                    <Avatar sx={{ width: 30, height: 30, bgcolor: roleColor(u.role), fontSize: '0.78rem', fontWeight: 700 }}>
                      {getInitials(u.name)}
                    </Avatar>
                    <Box>
                      <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, lineHeight: 1.2 }}>{u.name}</Typography>
                      <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.2, color: roleColor(u.role) }}>
                        {roleLabel(u.role)}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <TextField label="Subject" fullWidth size="small" value={subject}
          onChange={e => setSubject(e.target.value)} disabled={sending || users.length === 0}
          placeholder="Enter message subject"
          sx={{ '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: accent }, '& .MuiInputLabel-root.Mui-focused': { color: accent } }}
          slotProps={{ input: { sx: { borderRadius: 2 } } }} />

        <TextField label="Message" fullWidth multiline rows={7} size="small" value={body}
          onChange={e => setBody(e.target.value)} disabled={sending || users.length === 0}
          placeholder="Write your message here…"
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
          sx={{ '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: accent }, '& .MuiInputLabel-root.Mui-focused': { color: accent } }}
          slotProps={{ input: { sx: { borderRadius: 2 } } }} />

        <Typography sx={{ fontSize: '0.82rem' }} color="text.disabled">Ctrl+Enter to send quickly</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} disabled={sending} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={sending || !canSend}
          startIcon={sending ? <CircularProgress size={15} color="inherit" /> : <Send />}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 145, bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.88)' } }}>
          {sending ? 'Sending…' : 'Send Message'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Main Module ──────────────────────────────────────────────────────────────

interface Props { accent: string }

export default function MessagesModule({ accent }: Props) {
  const [folder, setFolder] = useState<'inbox' | 'sent'>('inbox');
  const [selected, setSelected] = useState<ApiMessage | null>(null);
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const { data: msgData, mutate: mutateMsgs, isLoading } = useMessages(folder);
  const { data: users, isLoading: usersLoading } = useUsers();
  const { data: currentUser } = useCurrentUser();

  const messages: ApiMessage[] = msgData?.messages ?? [];
  const unreadCount: number = msgData?.unreadCount ?? 0;

  const filtered = messages.filter(m =>
    m.subject.toLowerCase().includes(search.toLowerCase()) ||
    m.sender.name.toLowerCase().includes(search.toLowerCase()) ||
    m.recipient.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => { setSelected(null); setReplyBody(''); }, [folder]);

  async function selectMessage(msg: ApiMessage) {
    setSelected(msg);
    setReplyBody('');
    if (!msg.read && folder === 'inbox') {
      await fetch(`/api/messages/${msg.id}`, { method: 'PATCH', credentials: 'include' });
      mutateMsgs();
      refreshMessages();
    }
  }

  async function deleteMessage(id: string) {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      if (selected?.id === id) setSelected(null);
      mutateMsgs();
      refreshMessages();
      toast.success('Message deleted');
    } else {
      toast.error('Failed to delete');
    }
  }

  async function sendReply() {
    if (!selected || !replyBody.trim()) return;
    setSendingReply(true);
    try {
      const isFromMe = currentUser ? selected.sender.id === currentUser.id : folder === 'sent';
      const recipientId = isFromMe ? selected.recipient.id : selected.sender.id;
      const res = await fetch('/api/messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Re: ${selected.subject}`,
          body: replyBody.trim(),
          recipientId,
          parentId: selected.id,
        }),
      });
      if (res.ok) {
        toast.success('Reply sent');
        setReplyBody('');
        mutateMsgs();
        refreshMessages();
        const updated = await fetch(`/api/messages/${selected.id}`, { credentials: 'include' })
          .then(r => r.json()).then(d => d.data);
        if (updated) setSelected(updated);
      } else {
        const err = await res.json();
        toast.error(err.error ?? 'Failed to send reply');
      }
    } catch { toast.error('Network error. Please try again.'); }
    finally { setSendingReply(false); }
  }

  const replyTarget = selected
    ? (currentUser && selected.sender.id === currentUser.id ? selected.recipient.name : selected.sender.name)
    : '';

  const otherUsers = (users ?? []).filter((u: MsgUser) => u.id !== currentUser?.id);

  const accentFocusSx = {
    '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: accent },
    '& .MuiInputLabel-root.Mui-focused': { color: accent },
  };

  return (
    <Box sx={{ maxWidth: 1300 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 14px ${accent}40` }}>
            <Message sx={{ color: 'white', fontSize: 20 }} />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Messages</Typography>
              {unreadCount > 0 && (
                <Chip label={`${unreadCount} new`} size="small"
                  sx={{ bgcolor: `${accent}15`, color: accent, fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>Internal cross-portal communication</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => { mutateMsgs(); refreshMessages(); }}
              sx={{ '&:hover': { color: accent } }}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<Edit />} onClick={() => setComposeOpen(true)}
            sx={{ borderRadius: 2.5, textTransform: 'none', bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.88)' }, fontWeight: 600 }}>
            Compose
          </Button>
        </Box>
      </Box>

      {/* Two-panel layout */}
      <Box sx={{ display: 'flex', gap: 2.5, height: 'calc(100vh - 200px)', minHeight: 520 }}>

        {/* ── Left: message list ─────────────────────────────────────────── */}
        <Card sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', border: '1px solid #e2e8f0' }}>
          {/* Folder switcher */}
          <Box sx={{ p: 1.75, display: 'flex', gap: 1 }}>
            <Button fullWidth size="small"
              variant={folder === 'inbox' ? 'contained' : 'outlined'}
              startIcon={<Badge badgeContent={unreadCount || undefined} color="error"><Inbox sx={{ fontSize: 16 }} /></Badge>}
              onClick={() => setFolder('inbox')}
              sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.9rem',
                ...(folder === 'inbox' ? { bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.88)' } } : { borderColor: '#e2e8f0', color: '#475569' }) }}
            >
              Inbox
            </Button>
            <Button fullWidth size="small"
              variant={folder === 'sent' ? 'contained' : 'outlined'}
              startIcon={<SendIcon sx={{ fontSize: 16 }} />}
              onClick={() => setFolder('sent')}
              sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.9rem',
                ...(folder === 'sent' ? { bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.88)' } } : { borderColor: '#e2e8f0', color: '#475569' }) }}
            >
              Sent
            </Button>
          </Box>

          {/* Search */}
          <Box sx={{ px: 1.75, pb: 1.5 }}>
            <TextField fullWidth size="small" placeholder="Search messages…"
              value={search} onChange={e => setSearch(e.target.value)}
              sx={accentFocusSx}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment>, sx: { borderRadius: 2 } } }} />
          </Box>
          <Divider />

          {/* List */}
          <Box sx={{ flex: 1, overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#e2e8f0', borderRadius: 2 } }}>
            {isLoading ? (
              <Box sx={{ p: 2 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                    <Skeleton variant="circular" width={38} height={38} />
                    <Box sx={{ flex: 1 }}><Skeleton width="60%" height={18} /><Skeleton width="85%" height={14} /></Box>
                  </Box>
                ))}
              </Box>
            ) : filtered.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center', px: 2 }}>
                <Message sx={{ fontSize: 40, color: '#e2e8f0', mb: 1, display: 'block', mx: 'auto' }} />
                <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>
                  {search ? 'No messages match your search' : `No messages in ${folder}`}
                </Typography>
                {!search && folder === 'inbox' && (
                  <Button size="small" onClick={() => setComposeOpen(true)} sx={{ mt: 1.5, color: accent, fontWeight: 600, textTransform: 'none' }}>
                    Send first message →
                  </Button>
                )}
              </Box>
            ) : (
              <AnimatePresence>
                {filtered.map((msg, i) => {
                  const other = folder === 'inbox' ? msg.sender : msg.recipient;
                  const isSelected = selected?.id === msg.id;
                  const isUnread = !msg.read && folder === 'inbox';
                  return (
                    <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                      <Box onClick={() => selectMessage(msg)}
                        sx={{
                          px: 2, py: 1.5, cursor: 'pointer',
                          borderBottom: '1px solid #f1f5f9',
                          bgcolor: isSelected ? accent : isUnread ? `${accent}08` : 'transparent',
                          color: isSelected ? 'white' : 'inherit',
                          borderLeft: `3px solid ${isSelected ? accent : isUnread ? accent : 'transparent'}`,
                          '&:hover': { bgcolor: isSelected ? accent : `${accent}10` },
                          transition: 'all 0.15s',
                        }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                          <Avatar sx={{ width: 34, height: 34, bgcolor: avatarBg(other.name, accent), fontSize: '0.82rem', fontWeight: 700, flexShrink: 0 }}>
                            {getInitials(other.name)}
                          </Avatar>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography sx={{ fontSize: '0.9rem', fontWeight: isUnread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit', maxWidth: 140 }}>
                                {other.name}
                              </Typography>
                              <Typography sx={{ fontSize: '0.78rem', flexShrink: 0, ml: 0.75, color: isSelected ? 'rgba(255,255,255,0.7)' : '#94a3b8' }}>
                                {timeAgo(msg.createdAt)}
                              </Typography>
                            </Box>
                            <Typography sx={{ fontSize: '0.82rem', color: isSelected ? 'rgba(255,255,255,0.8)' : roleColor(other.role), fontWeight: 600, mb: 0.2 }}>
                              {roleLabel(other.role)}
                            </Typography>
                            <Typography sx={{ fontSize: '0.86rem', fontWeight: isUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? 'rgba(255,255,255,0.9)' : '#374151' }}>
                              {msg.subject}
                            </Typography>
                            <Typography sx={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? 'rgba(255,255,255,0.6)' : '#94a3b8' }}>
                              {msg.body.slice(0, 55)}{msg.body.length > 55 ? '…' : ''}
                            </Typography>
                          </Box>
                          {isUnread && !isSelected && (
                            <Circle sx={{ fontSize: 8, color: accent, flexShrink: 0, mt: 0.75 }} />
                          )}
                        </Box>
                      </Box>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </Box>
        </Card>

        {/* ── Right: message detail ────────────────────────────────────────── */}
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          {!selected ? (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <Box sx={{ width: 72, height: 72, borderRadius: '50%', bgcolor: `${accent}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                <Message sx={{ fontSize: 36, color: accent, opacity: 0.5 }} />
              </Box>
              <Typography sx={{ fontWeight: 700, color: '#0c1e46', fontSize: '1rem' }}>Select a message</Typography>
              <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>Choose from the list to read it</Typography>
              <Button variant="outlined" startIcon={<Edit />} onClick={() => setComposeOpen(true)}
                sx={{ mt: 2, borderRadius: 2.5, textTransform: 'none', borderColor: accent, color: accent }}>
                Compose New Message
              </Button>
            </Box>
          ) : (
            <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

              {/* Thread header */}
              <Box sx={{ px: 3, py: 2.25, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '1rem', mb: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0c1e46' }}>
                    {selected.subject}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <Avatar sx={{ width: 20, height: 20, bgcolor: avatarBg(selected.sender.name, accent), fontSize: '0.72rem', fontWeight: 700 }}>
                        {getInitials(selected.sender.name)}
                      </Avatar>
                      <Typography component="span" sx={{ fontSize: '0.86rem', color: '#64748b' }}>
                        <strong>From:</strong> {selected.sender.name}
                      </Typography>
                      <Chip label={roleLabel(selected.sender.role)} size="small"
                        sx={{ height: 22, fontSize: '0.72rem', bgcolor: `${roleColor(selected.sender.role)}15`, color: roleColor(selected.sender.role), fontWeight: 600 }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>
                      <strong>To:</strong> {selected.recipient.name}
                    </Typography>
                    <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                      {new Date(selected.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                  <Tooltip title="Focus reply">
                    <IconButton size="small" onClick={() => replyRef.current?.focus()}
                      sx={{ '&:hover': { color: accent } }}>
                      <Reply fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete message">
                    <IconButton size="small" color="error" onClick={() => deleteMessage(selected.id)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Body + replies */}
              <Box sx={{ flex: 1, overflowY: 'auto', p: 3, '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: '#e2e8f0', borderRadius: 2 } }}>
                {/* Original message body */}
                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                  <Avatar sx={{ width: 40, height: 40, bgcolor: avatarBg(selected.sender.name, accent), fontSize: '0.86rem', fontWeight: 700, flexShrink: 0 }}>
                    {getInitials(selected.sender.name)}
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, color: '#0c1e46' }}>{selected.sender.name}</Typography>
                      <Chip label={roleLabel(selected.sender.role)} size="small"
                        sx={{ height: 22, fontSize: '0.72rem', bgcolor: `${roleColor(selected.sender.role)}15`, color: roleColor(selected.sender.role), fontWeight: 700 }} />
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{timeAgo(selected.createdAt)}</Typography>
                    </Box>
                    <Box sx={{ p: 2.5, bgcolor: '#f8fafc', borderRadius: 2.5, border: '1px solid #f1f5f9', lineHeight: 1.8 }}>
                      <Typography sx={{ fontSize: '0.94rem', whiteSpace: 'pre-wrap', color: '#374151' }}>{selected.body}</Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Replies thread */}
                {(selected.replies ?? []).length > 0 && (
                  <Box sx={{ borderLeft: `2px solid ${accent}30`, pl: 2.5, ml: 2.5, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <MarkEmailRead sx={{ fontSize: 14, color: '#94a3b8' }} />
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#94a3b8' }}>
                        {selected.replies!.length} {selected.replies!.length === 1 ? 'Reply' : 'Replies'}
                      </Typography>
                    </Box>
                    {selected.replies!.map((reply) => (
                      <Box key={reply.id} sx={{ mb: 2.5 }}>
                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                          <Avatar sx={{ width: 32, height: 32, bgcolor: avatarBg(reply.sender.name, accent), fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>
                            {getInitials(reply.sender.name)}
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6 }}>
                              <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>{reply.sender.name}</Typography>
                              <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{timeAgo(reply.createdAt)}</Typography>
                            </Box>
                            <Box sx={{ p: 1.75, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: 'white' }}>
                              <Typography sx={{ fontSize: '0.94rem', whiteSpace: 'pre-wrap', color: '#374151', lineHeight: 1.7 }}>{reply.body}</Typography>
                            </Box>
                          </Box>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              {/* Reply input */}
              <Box sx={{ p: 2.5, borderTop: '1px solid #f1f5f9', flexShrink: 0, bgcolor: '#fafbfd' }}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
                  <TextField fullWidth multiline rows={2} size="small"
                    inputRef={replyRef}
                    placeholder={`Reply to ${replyTarget}… (Ctrl+Enter to send)`}
                    value={replyBody} onChange={e => setReplyBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
                    disabled={sendingReply}
                    sx={accentFocusSx}
                    slotProps={{ input: { sx: { borderRadius: 2 } } }}
                  />
                  <Button variant="contained" disabled={!replyBody.trim() || sendingReply}
                    endIcon={sendingReply ? <CircularProgress size={14} color="inherit" /> : <Send />}
                    onClick={sendReply}
                    sx={{ borderRadius: 2.5, textTransform: 'none', minWidth: 96, height: 68, bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.88)' }, fontWeight: 600 }}>
                    {sendingReply ? 'Sending' : 'Send'}
                  </Button>
                </Box>
              </Box>
            </motion.div>
          )}
        </Card>
      </Box>

      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        accent={accent}
        users={otherUsers}
        usersLoading={usersLoading && !users}
        onSent={() => { refreshMessages(); mutateMsgs(); setFolder('sent'); setSelected(null); }}
      />
    </Box>
  );
}
