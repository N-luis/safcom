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
  Search, Message, Circle, Refresh,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useMessages, useUsers, useCurrentUser, refreshMessages } from '@/hooks/useApi';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : new Date(dateStr).toLocaleDateString();
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(name: string) {
  const colors = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#06b6d4', '#ec4899'];
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface MsgUser { id: string; name: string; email: string; role?: string }
interface MsgReply { id: string; body: string; createdAt: string; sender: MsgUser }
interface ApiMessage {
  id: string; subject: string; body: string; read: boolean; createdAt: string;
  sender: MsgUser; recipient: MsgUser;
  replies?: MsgReply[];
}

export default function MessagesPage() {
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

  // Clear selected when switching folders
  useEffect(() => { setSelected(null); setReplyBody(''); }, [folder]);

  async function selectMessage(msg: ApiMessage) {
    setSelected(msg);
    setReplyBody('');
    if (!msg.read && folder === 'inbox') {
      await fetch(`/api/messages/${msg.id}`, { method: 'PATCH' });
      mutateMsgs();
      refreshMessages();
    }
  }

  async function deleteMessage(id: string) {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (selected?.id === id) setSelected(null);
      mutateMsgs();
      refreshMessages();
      toast.success('Message deleted');
    } else {
      toast.error('Failed to delete message');
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
        // Refresh and reload the selected thread
        mutateMsgs();
        refreshMessages();
        const updated = await fetch(`/api/messages/${selected.id}`)
          .then(r => r.json())
          .then(d => d.data);
        if (updated) setSelected(updated);
      } else {
        const err = await res.json();
        toast.error(err.error ?? 'Failed to send reply');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSendingReply(false);
    }
  }

  const replyTarget = selected
    ? (currentUser && selected.sender.id === currentUser.id ? selected.recipient.name : selected.sender.name)
    : '';

  const otherUsers = (users ?? []).filter((u: MsgUser) => u.id !== currentUser?.id);

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Message sx={{ color: 'white', fontSize: 20 }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>Messages</Typography>
              <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>Internal communication system</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Refresh">
              <IconButton onClick={() => { mutateMsgs(); refreshMessages(); }} size="small">
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button variant="contained" startIcon={<Edit />} onClick={() => setComposeOpen(true)} sx={{ borderRadius: 2.5, textTransform: 'none' }}>
              Compose
            </Button>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 2.5, height: 'calc(100vh - 200px)', minHeight: 500 }}>
          {/* Left panel */}
          <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Folder switcher */}
            <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
              <Button
                fullWidth variant={folder === 'inbox' ? 'contained' : 'outlined'}
                startIcon={<Badge badgeContent={unreadCount || undefined} color="error"><Inbox /></Badge>}
                onClick={() => setFolder('inbox')}
                sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.9rem' }}
              >
                Inbox
              </Button>
              <Button
                fullWidth variant={folder === 'sent' ? 'contained' : 'outlined'}
                startIcon={<SendIcon />}
                onClick={() => setFolder('sent')}
                sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.9rem' }}
              >
                Sent
              </Button>
            </Box>

            {/* Search */}
            <Box sx={{ px: 2, pb: 1.5 }}>
              <TextField
                fullWidth size="small" placeholder="Search messages..."
                value={search} onChange={e => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment>,
                    sx: { borderRadius: 2 },
                  },
                }}
              />
            </Box>
            <Divider />

            {/* Message list */}
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              {isLoading ? (
                <Box sx={{ p: 2 }}>
                  {[...Array(5)].map((_, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                      <Skeleton variant="circular" width={40} height={40} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton width="70%" height={18} />
                        <Skeleton width="90%" height={14} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : filtered.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center', px: 2 }}>
                  <Message sx={{ fontSize: 40, opacity: 0.2, mb: 1 }} />
                  <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>
                    {search ? 'No messages match your search' : `No messages in ${folder}`}
                  </Typography>
                  {!search && folder === 'inbox' && (
                    <Typography color="text.disabled" sx={{ fontSize: '0.86rem', mt: 0.5 }}>
                      Compose a message to get started
                    </Typography>
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
                        <Box
                          onClick={() => selectMessage(msg)}
                          sx={{
                            px: 2, py: 1.5, cursor: 'pointer',
                            borderBottom: '1px solid', borderColor: 'divider',
                            bgcolor: isSelected ? 'primary.main' : isUnread ? 'rgba(59,130,246,0.06)' : 'transparent',
                            color: isSelected ? 'white' : 'inherit',
                            borderLeft: (isUnread && !isSelected) ? '3px solid #3b82f6' : '3px solid transparent',
                            '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
                            transition: 'all 0.15s',
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                            <Avatar sx={{ width: 36, height: 36, bgcolor: avatarColor(other.name), fontSize: '0.86rem', fontWeight: 700, flexShrink: 0 }}>
                              {getInitials(other.name)}
                            </Avatar>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography sx={{ fontSize: '0.9rem', fontWeight: isUnread ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' }}>
                                  {other.name}
                                </Typography>
                                <Typography sx={{ fontSize: '0.78rem', flexShrink: 0, ml: 1, color: isSelected ? 'rgba(255,255,255,0.7)' : 'text.disabled' }}>
                                  {timeAgo(msg.createdAt)}
                                </Typography>
                              </Box>
                              <Typography sx={{ fontSize: '0.86rem', fontWeight: isUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? 'rgba(255,255,255,0.9)' : 'inherit' }}>
                                {msg.subject}
                              </Typography>
                              <Typography sx={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? 'rgba(255,255,255,0.65)' : 'text.secondary' }}>
                                {msg.body.slice(0, 60)}{msg.body.length > 60 ? '...' : ''}
                              </Typography>
                            </Box>
                            {isUnread && !isSelected && (
                              <Circle sx={{ fontSize: 8, color: '#3b82f6', flexShrink: 0, mt: 0.5 }} />
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

          {/* Right panel - message detail */}
          <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selected ? (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Message sx={{ fontSize: 64, opacity: 0.12, mb: 2 }} />
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }} color="text.secondary">Select a message</Typography>
                <Typography color="text.disabled" sx={{ fontSize: '0.94rem' }}>Choose a message from the list to read it</Typography>
                <Button variant="outlined" startIcon={<Edit />} onClick={() => setComposeOpen(true)} sx={{ mt: 3, borderRadius: 2.5, textTransform: 'none' }}>
                  Compose New Message
                </Button>
              </Box>
            ) : (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {/* Header */}
                <Box sx={{ px: 3, py: 2.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selected.subject}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Avatar sx={{ width: 20, height: 20, bgcolor: avatarColor(selected.sender.name), fontSize: '0.72rem', fontWeight: 700 }}>
                          {getInitials(selected.sender.name)}
                        </Avatar>
                        <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">
                          <strong>From:</strong> {selected.sender.name}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">
                        <strong>To:</strong> {selected.recipient.name}
                      </Typography>
                      <Typography sx={{ fontSize: '0.86rem' }} color="text.disabled">
                        {new Date(selected.createdAt).toLocaleString()}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                    <Tooltip title="Reply">
                      <IconButton size="small" onClick={() => replyRef.current?.focus()}>
                        <Reply fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => deleteMessage(selected.id)}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Body + replies */}
                <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
                  {/* Original message */}
                  <Box sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Avatar sx={{ width: 38, height: 38, bgcolor: avatarColor(selected.sender.name), fontSize: '0.86rem', fontWeight: 700, flexShrink: 0 }}>
                        {getInitials(selected.sender.name)}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                          <Typography sx={{ fontSize: '0.94rem', fontWeight: 700 }}>{selected.sender.name}</Typography>
                          {selected.sender.role && (
                            <Chip label={selected.sender.role} size="small" sx={{ height: 22, fontSize: '0.72rem', textTransform: 'capitalize', '& .MuiChip-label': { px: 0.75 } }} />
                          )}
                          <Typography sx={{ fontSize: '0.82rem' }} color="text.disabled">{timeAgo(selected.createdAt)}</Typography>
                        </Box>
                        <Box sx={{ p: 2.5, bgcolor: 'action.hover', borderRadius: 2.5, lineHeight: 1.75 }}>
                          <Typography sx={{ fontSize: '0.94rem', whiteSpace: 'pre-wrap' }}>{selected.body}</Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Box>

                  {/* Replies */}
                  {(selected.replies ?? []).length > 0 && (
                    <Box sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 2, ml: 2.5, mb: 2 }}>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1.5 }} color="text.disabled">
                        {selected.replies!.length} {selected.replies!.length === 1 ? 'Reply' : 'Replies'}
                      </Typography>
                      {(selected.replies ?? []).map((reply) => (
                        <Box key={reply.id} sx={{ mb: 2 }}>
                          <Box sx={{ display: 'flex', gap: 1.5 }}>
                            <Avatar sx={{ width: 30, height: 30, bgcolor: avatarColor(reply.sender.name), fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
                              {getInitials(reply.sender.name)}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>{reply.sender.name}</Typography>
                                <Typography sx={{ fontSize: '0.78rem' }} color="text.disabled">{timeAgo(reply.createdAt)}</Typography>
                              </Box>
                              <Box sx={{ p: 1.75, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                                <Typography sx={{ fontSize: '0.94rem', whiteSpace: 'pre-wrap' }}>{reply.body}</Typography>
                              </Box>
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Reply input */}
                <Box sx={{ p: 2.5, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
                    <TextField
                      inputRef={replyRef}
                      fullWidth multiline rows={2} size="small"
                      placeholder={`Reply to ${replyTarget}…`}
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
                      disabled={sendingReply}
                      slotProps={{ input: { sx: { borderRadius: 2 } } }}
                    />
                    <Button
                      variant="contained"
                      endIcon={sendingReply ? <CircularProgress size={14} color="inherit" /> : <Send />}
                      onClick={sendReply}
                      disabled={!replyBody.trim() || sendingReply}
                      sx={{ borderRadius: 2.5, textTransform: 'none', minWidth: 100, height: 68 }}
                    >
                      {sendingReply ? 'Sending' : 'Send'}
                    </Button>
                  </Box>
                  <Typography sx={{ fontSize: '0.78rem', mt: 0.5 }} color="text.disabled">Ctrl+Enter to send</Typography>
                </Box>
              </motion.div>
            )}
          </Card>
        </Box>
      </Box>

      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        users={otherUsers}
        usersLoading={usersLoading && !users}
        onSent={() => {
          refreshMessages();
          setFolder('sent');
          setSelected(null);
        }}
      />
    </DashboardLayout>
  );
}

function ComposeDialog({ open, onClose, users, usersLoading, onSent }: {
  open: boolean;
  onClose: () => void;
  users: MsgUser[];
  usersLoading?: boolean;
  onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) { setTo(''); setSubject(''); setBody(''); }
  }, [open]);

  const canSend = !!to && subject.trim().length > 0 && body.trim().length > 0;

  async function send() {
    if (!canSend) { toast.error('Please fill in all fields'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), recipientId: to }),
      });
      if (res.ok) {
        toast.success('Message sent successfully!');
        onSent();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to send message');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 1.5, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Edit sx={{ color: 'white', fontSize: 16 }} />
          </Box>
          New Message
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        {usersLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={16} />
            <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>Loading contacts...</Typography>
          </Box>
        ) : users.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            No other users available. Ask an administrator to add other users to the system.
          </Alert>
        ) : (
          <FormControl fullWidth size="small">
            <InputLabel>To</InputLabel>
            <Select value={to} onChange={e => setTo(e.target.value)} label="To" sx={{ borderRadius: 2 }} disabled={sending}>
              {users.map(u => (
                <MenuItem key={u.id} value={u.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                    <Avatar sx={{ width: 30, height: 30, bgcolor: avatarColor(u.name), fontSize: '0.78rem', fontWeight: 700 }}>
                      {getInitials(u.name)}
                    </Avatar>
                    <Box>
                      <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, lineHeight: 1.2 }}>{u.name}</Typography>
                      <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.2 }} color="text.secondary">
                        {u.role ? `${u.role} · ${u.email}` : u.email}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <TextField
          label="Subject"
          fullWidth size="small"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          disabled={sending || users.length === 0}
          placeholder="Enter message subject"
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />

        <TextField
          label="Message"
          fullWidth multiline rows={7} size="small"
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={sending || users.length === 0}
          placeholder="Write your message here..."
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />

        <Typography sx={{ fontSize: '0.82rem' }} color="text.disabled">
          Ctrl+Enter to send quickly
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} disabled={sending} sx={{ borderRadius: 2, textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={send}
          disabled={sending || !canSend}
          startIcon={sending ? <CircularProgress size={15} color="inherit" /> : <Send />}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 145 }}
        >
          {sending ? 'Sending...' : 'Send Message'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
