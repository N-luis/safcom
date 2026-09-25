'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Card, CardContent, Typography, Button, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import {
  Add, BarChart, FileDownload, NotificationsActive, Warning, Check,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { mutate } from 'swr';
import toast from 'react-hot-toast';

export default function QuickActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  function markDone(key: string) {
    setDone(key);
    setTimeout(() => setDone(null), 2500);
  }

  async function handleExport() {
    setBusy('export');
    try {
      const [casesRes, reportsRes, residentsRes] = await Promise.all([
        fetch('/api/cases?limit=1000').then(r => r.json()),
        fetch('/api/reports?limit=1000').then(r => r.json()),
        fetch('/api/residents?limit=1000').then(r => r.json()),
      ]);

      const cases = casesRes.data?.cases ?? [];
      const reports = reportsRes.data?.reports ?? [];
      const residents = residentsRes.data?.residents ?? [];

      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

      const casesCsv = [
        'Case Number,Resident,Type,Status,Risk Level,Barangay,Filed Date',
        ...cases.map((c: Record<string, unknown>) =>
          [c.caseNumber, c.residentName, c.caseType, c.status, c.riskLevel, c.barangay,
            new Date(c.filedAt as string).toLocaleDateString()].map(esc).join(',')
        ),
      ].join('\n');

      const reportsCsv = [
        'Report Number,Title,Category,Status,Priority,Date',
        ...reports.map((r: Record<string, unknown>) =>
          [r.reportNumber, r.title, r.category, r.status, r.priority,
            new Date(r.createdAt as string).toLocaleDateString()].map(esc).join(',')
        ),
      ].join('\n');

      const residentsCsv = [
        'Resident Number,Name,Age,Gender,Barangay,Status,Risk Level',
        ...residents.map((r: Record<string, unknown>) =>
          [r.residentNumber, `${r.firstName} ${r.lastName}`, r.age, r.gender, r.barangay, r.status, r.riskLevel].map(esc).join(',')
        ),
      ].join('\n');

      const combined = `CASES (${cases.length})\n${casesCsv}\n\n\nREPORTS (${reports.length})\n${reportsCsv}\n\n\nRESIDENTS (${residents.length})\n${residentsCsv}`;
      const blob = new Blob([combined], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `safcom-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${cases.length} cases, ${reports.length} reports, ${residents.length} residents`);
      markDone('export');
    } catch {
      toast.error('Export failed — please try again');
    } finally {
      setBusy(null);
    }
  }

  const actions = [
    {
      key: 'report', label: 'Add Report', icon: Add, color: '#3b82f6',
      onClick: () => setReportOpen(true),
    },
    {
      key: 'analytics', label: 'View Analytics', icon: BarChart, color: '#8b5cf6',
      onClick: () => router.push('/analytics'),
    },
    {
      key: 'export', label: 'Export All Data', icon: FileDownload, color: '#22c55e',
      onClick: handleExport,
    },
    {
      key: 'notification', label: 'Send Notification', icon: NotificationsActive, color: '#f97316',
      onClick: () => setNotifOpen(true),
    },
    {
      key: 'alert', label: 'Create Alert', icon: Warning, color: '#ef4444',
      onClick: () => setAlertOpen(true),
    },
  ];

  return (
    <>
      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Quick Actions</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, fontSize: '0.86rem' }}>
            Common management tasks
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {actions.map((action, i) => {
              const Icon = action.icon;
              const isLoading = busy === action.key;
              const isDone = done === action.key;
              return (
                <motion.div
                  key={action.key}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                >
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={
                      isLoading ? (
                        <CircularProgress size={16} sx={{ color: action.color }} />
                      ) : isDone ? (
                        <Check sx={{ fontSize: 18, color: '#22c55e' }} />
                      ) : (
                        <Icon sx={{ fontSize: 18 }} />
                      )
                    }
                    onClick={action.onClick}
                    disabled={busy !== null}
                    sx={{
                      justifyContent: 'flex-start',
                      px: 2, py: 1.2,
                      borderRadius: 2.5,
                      borderColor: isDone ? '#22c55e' : `${action.color}40`,
                      color: isDone ? '#22c55e' : action.color,
                      fontWeight: 600, fontSize: '0.9rem',
                      textTransform: 'none',
                      '&:hover': {
                        borderColor: isDone ? '#22c55e' : action.color,
                        bgcolor: isDone ? 'rgba(34,197,94,0.06)' : `${action.color}0d`,
                        transform: 'translateX(4px)',
                      },
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {isLoading ? 'Processing...' : isDone ? 'Done!' : action.label}
                  </Button>
                </motion.div>
              );
            })}
          </Box>
        </CardContent>
      </Card>

      <AddReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSuccess={() => {
          markDone('report');
          mutate((k: unknown) => typeof k === 'string' && k.startsWith('/api/reports'));
          mutate('/api/dashboard/stats');
        }}
      />
      <SendNotificationDialog
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onSuccess={() => {
          markDone('notification');
          mutate('/api/notifications?limit=50');
        }}
      />
      <CreateAlertDialog
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        onSuccess={() => {
          markDone('alert');
          mutate('/api/alerts');
          mutate('/api/dashboard/stats');
        }}
      />
    </>
  );
}

/* ─── Add Report Dialog ─── */
function AddReportDialog({
  open, onClose, onSuccess,
}: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', category: '', priority: 'Medium', content: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm({ title: '', category: '', priority: 'Medium', content: '' }); setErrors({}); }
  }, [open]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Title is required';
    if (!form.category) e.category = 'Category is required';
    if (!form.content.trim()) e.content = 'Content is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const reportNumber = `RPT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, reportNumber }),
      });
      if (res.ok) {
        toast.success('Report created successfully!');
        onSuccess();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to create report');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Add sx={{ color: 'white', fontSize: 16 }} />
          </Box>
          New Report
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <TextField
          label="Report Title" fullWidth size="small" value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          error={!!errors.title} helperText={errors.title}
          disabled={saving}
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small" error={!!errors.category}>
            <InputLabel>Category</InputLabel>
            <Select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              label="Category" sx={{ borderRadius: 2 }} disabled={saving}
            >
              {['Incident', 'Update', 'Request', 'Compliance', 'Health', 'Safety', 'Other'].map(c =>
                <MenuItem key={c} value={c}>{c}</MenuItem>
              )}
            </Select>
            {errors.category && <Typography sx={{ fontSize: '0.82rem', color: 'error.main', mt: 0.5, ml: 1.75 }}>{errors.category}</Typography>}
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Priority</InputLabel>
            <Select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              label="Priority" sx={{ borderRadius: 2 }} disabled={saving}
            >
              {['Low', 'Medium', 'High', 'Critical'].map(p =>
                <MenuItem key={p} value={p}>{p}</MenuItem>
              )}
            </Select>
          </FormControl>
        </Box>
        <TextField
          label="Content / Details" fullWidth multiline rows={5} size="small"
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          error={!!errors.content} helperText={errors.content}
          disabled={saving}
          placeholder="Describe the report details..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" onClick={handleSubmit} disabled={saving}
          startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <Add />}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 140 }}
        >
          {saving ? 'Creating...' : 'Create Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── Send Notification Dialog ─── */
function SendNotificationDialog({
  open, onClose, onSuccess,
}: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', message: '', type: 'info', broadcast: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm({ title: '', message: '', type: 'info', broadcast: true }); }
  }, [open]);

  const canSend = form.title.trim().length > 0 && form.message.trim().length > 0;

  async function handleSend() {
    if (!canSend) { toast.error('Please fill in title and message'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          message: form.message.trim(),
          type: form.type,
          broadcast: form.broadcast,
        }),
      });
      if (res.ok) {
        toast.success('Notification sent to all users!');
        onSuccess();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to send notification');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  const typeColors: Record<string, string> = { info: '#3b82f6', warning: '#f97316', success: '#22c55e', error: '#ef4444' };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <NotificationsActive sx={{ color: 'white', fontSize: 16 }} />
          </Box>
          Send Notification
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <TextField
          label="Notification Title" fullWidth size="small" value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          disabled={saving}
          placeholder="e.g. System Maintenance Scheduled"
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
        <FormControl fullWidth size="small">
          <InputLabel>Type</InputLabel>
          <Select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            label="Type" sx={{ borderRadius: 2 }} disabled={saving}
          >
            {[
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'success', label: 'Success' },
              { value: 'error', label: 'Error / Alert' },
            ].map(opt => (
              <MenuItem key={opt.value} value={opt.value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: typeColors[opt.value] }} />
                  {opt.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Message" fullWidth multiline rows={4} size="small" value={form.message}
          onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          disabled={saving}
          placeholder="Write the notification message..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
          <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">
            This notification will be sent as a broadcast and visible to all users in the system.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" onClick={handleSend} disabled={saving || !canSend}
          startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <NotificationsActive />}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 165 }}
        >
          {saving ? 'Sending...' : 'Send Notification'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── Create Alert Dialog ─── */
function CreateAlertDialog({
  open, onClose, onSuccess,
}: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', message: '', level: 'warning', barangay: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm({ title: '', message: '', level: 'warning', barangay: '' }); }
  }, [open]);

  const canCreate = form.title.trim().length > 0 && form.message.trim().length > 0;

  async function handleCreate() {
    if (!canCreate) { toast.error('Please fill in title and message'); return; }
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        title: form.title.trim(),
        message: form.message.trim(),
        level: form.level,
      };
      if (form.barangay.trim()) payload.barangay = form.barangay.trim();

      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success('Alert created and is now active!');
        onSuccess();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Failed to create alert');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  const levelColors: Record<string, string> = { info: '#3b82f6', warning: '#f97316', critical: '#ef4444' };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Warning sx={{ color: 'white', fontSize: 16 }} />
          </Box>
          Create Alert
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <TextField
          label="Alert Title" fullWidth size="small" value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          disabled={saving}
          placeholder="e.g. Typhoon Warning — Category 3"
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Alert Level</InputLabel>
            <Select
              value={form.level}
              onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
              label="Alert Level" sx={{ borderRadius: 2 }} disabled={saving}
            >
              {[
                { value: 'info', label: 'Info' },
                { value: 'warning', label: 'Warning' },
                { value: 'critical', label: 'Critical' },
              ].map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: levelColors[opt.value] }} />
                    {opt.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Barangay</InputLabel>
            <Select
              value={form.barangay}
              onChange={e => setForm(f => ({ ...f, barangay: e.target.value }))}
              label="Barangay" sx={{ borderRadius: 2 }} disabled={saving}
            >
              <MenuItem value="">All Barangays</MenuItem>
              <MenuItem value="Binan 2nd">Binan 2nd</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <TextField
          label="Alert Message" fullWidth multiline rows={4} size="small" value={form.message}
          onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          disabled={saving}
          placeholder="Describe the alert in detail..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
        {form.level === 'critical' && (
          <Box sx={{ p: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid', borderColor: 'rgba(239,68,68,0.3)', borderRadius: 2 }}>
            <Typography sx={{ fontSize: '0.86rem', color: '#ef4444', fontWeight: 600 }}>
              Critical alert — this will appear prominently for all users.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" color="error" onClick={handleCreate} disabled={saving || !canCreate}
          startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <Warning />}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 140 }}
        >
          {saving ? 'Creating...' : 'Create Alert'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
