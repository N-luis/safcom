'use client';

import { useState } from 'react';
import {
  Box, Grid, Typography, Card, CardContent, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Skeleton,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ReportsTable from '@/components/dashboard/ReportsTable';
import { useCaseStats, useUsers, useCurrentUser } from '@/hooks/useApi';
import { mutate } from 'swr';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

const CASE_TYPES = ['Domestic Violence', 'Child Neglect', 'Elder Abuse', 'Substance Abuse', 'Mental Health', 'Community Conflict', 'Economic Crisis', 'Child Abuse', 'Senior Welfare', 'Other'];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

export default function CasesPage() {
  const { data: stats, isLoading } = useCaseStats();
  const { data: currentUser } = useCurrentUser();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const canCreateCase = currentUser?.role !== 'admin';

  const statusSummary = [
    { label: 'Open', count: stats?.open ?? 0, color: '#ef4444' },
    { label: 'In Progress', count: stats?.inProgress ?? 0, color: '#f97316' },
    { label: 'Resolved', count: stats?.resolved ?? 0, color: '#22c55e' },
    { label: 'Closed', count: stats?.closed ?? 0, color: '#6b7280' },
  ];

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Cases</Typography>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>Manage all community cases and interventions</Typography>
          </Box>
          {canCreateCase && (
            <Button variant="contained" startIcon={<Add />} sx={{ borderRadius: 2.5, textTransform: 'none' }} onClick={() => setNewCaseOpen(true)}>
              New Case
            </Button>
          )}
        </Box>

        {/* Status summary */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {statusSummary.map((s, i) => (
            <Grid size={{ xs: 6, sm: 3 }} key={s.label}>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.08 }}>
                <Card elevation={0} sx={{ borderRadius: 3, border: `2px solid ${s.color}30`, textAlign: 'center', cursor: 'pointer',
                  '&:hover': { borderColor: s.color, transform: 'scale(1.03)', boxShadow: `0 8px 24px ${s.color}20` }, transition: 'all 0.2s' }}>
                  <CardContent sx={{ py: 2 }}>
                    {isLoading ? (
                      <Skeleton variant="text" width={60} height={60} sx={{ mx: 'auto' }} />
                    ) : (
                      <Typography variant="h3" sx={{ fontWeight: 900, color: s.color }}>{s.count}</Typography>
                    )}
                    <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">{s.label}</Typography>
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </Grid>

        <ReportsTable />
      </Box>

      <NewCaseDialog
        open={newCaseOpen}
        onClose={() => setNewCaseOpen(false)}
        onCreated={() => {
          mutate('/api/cases/stats');
          mutate((key: string) => typeof key === 'string' && key.startsWith('/api/cases'), undefined, { revalidate: true });
        }}
      />
    </DashboardLayout>
  );
}

function NewCaseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { data: users } = useUsers();
  const [form, setForm] = useState({
    residentName: '', caseType: '', riskLevel: 'Medium', status: 'Open',
    barangay: '', description: '', assignedToId: '',
  });
  const [saving, setSaving] = useState(false);

  function setField(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function submit() {
    if (!form.residentName.trim() || !form.caseType || !form.barangay || !form.description.trim()) {
      toast.error('Please fill all required fields');
      return;
    }
    setSaving(true);
    try {
      const caseNumber = `C-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseNumber,
          residentName: form.residentName,
          caseType: form.caseType,
          riskLevel: form.riskLevel,
          barangay: form.barangay,
          description: form.description,
          status: form.status,
          ...(form.assignedToId ? { assignedToId: form.assignedToId } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Case created successfully!');
        setForm({ residentName: '', caseType: '', riskLevel: 'Medium', status: 'Open', barangay: '', description: '', assignedToId: '' });
        onCreated();
        onClose();
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Failed to create case');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>New Case</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        <TextField label="Resident Name" fullWidth size="small" required value={form.residentName} onChange={e => setField('residentName', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small" required>
            <InputLabel>Case Type</InputLabel>
            <Select value={form.caseType} onChange={e => setField('caseType', e.target.value)} label="Case Type" sx={{ borderRadius: 2 }}>
              {CASE_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small" required>
            <InputLabel>Risk Level</InputLabel>
            <Select value={form.riskLevel} onChange={e => setField('riskLevel', e.target.value)} label="Risk Level" sx={{ borderRadius: 2 }}>
              {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select value={form.status} onChange={e => setField('status', e.target.value)} label="Status" sx={{ borderRadius: 2 }}>
              {STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Assigned Officer</InputLabel>
            <Select value={form.assignedToId} onChange={e => setField('assignedToId', e.target.value)} label="Assigned Officer" sx={{ borderRadius: 2 }}>
              <MenuItem value="">Unassigned</MenuItem>
              {(users ?? []).map((u: { id: string; name: string; role: string }) => (
                <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <TextField label="Address" fullWidth size="small" required value={form.barangay} onChange={e => setField('barangay', e.target.value)} placeholder="House/Unit #, Street, Purok, Binan 2nd..." slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        <TextField
          label="Case Description" fullWidth multiline rows={4} size="small" required
          value={form.description} onChange={e => setField('description', e.target.value)}
          placeholder="Describe the incident, observations, and immediate actions taken..."
          slotProps={{ input: { sx: { borderRadius: 2 } } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {saving ? 'Creating...' : 'Create Case'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
