'use client';

import { useState, useEffect } from 'react';
import {
  Box, Grid, Typography, Card, CardContent, Button, Avatar,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem,
  Chip, IconButton, InputAdornment, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Switch, FormControlLabel, CircularProgress, Alert,
} from '@mui/material';
import {
  Add, Search, Edit, PersonOff, PersonAdd,
  AdminPanelSettings, Badge, Security,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';

const ROLES = [
  { value: 'admin', label: 'Admin', color: '#8b5cf6', icon: AdminPanelSettings },
  { value: 'officer', label: 'Officer', color: '#22c55e', icon: Badge },
  { value: 'vawc_officer', label: 'VAWC Officer', color: '#f97316', icon: Security },
];

function getRoleConfig(role: string) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: '#6b7280', icon: Badge };
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  barangay: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
  _count: { assignedCases: number };
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json()).then(d => d.data);

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (roleFilter) params.set('role', roleFilter);
  if (showInactive) params.set('all', 'true');
  const key = `/api/users?${params.toString()}`;

  const { data: users, isLoading } = useSWR<User[]>(key, fetcher, { refreshInterval: 30000 });

  const stats = [
    { label: 'Total Users', count: users?.length ?? 0, color: '#3b82f6' },
    { label: 'VAWC Officers', count: users?.filter(u => u.role === 'vawc_officer').length ?? 0, color: '#f97316' },
    { label: 'Active', count: users?.filter(u => u.active).length ?? 0, color: '#22c55e' },
    { label: 'Inactive', count: users?.filter(u => !u.active).length ?? 0, color: '#ef4444' },
  ];

  async function handleDeactivate(user: User) {
    if (!confirm(`Deactivate ${user.name}?`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      toast.success(`${user.name} deactivated`);
      mutate(key);
    } else {
      const e = await res.json();
      toast.error(e.error ?? 'Failed');
    }
  }

  async function handleReactivate(user: User) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (res.ok) {
      toast.success(`${user.name} reactivated`);
      mutate(key);
    } else {
      toast.error('Failed to reactivate');
    }
  }

  return (
    <DashboardLayout>
      <Box>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>User Management</Typography>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>
              Manage VAWC officers and admin accounts
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<Add />} onClick={() => setAddOpen(true)}
            sx={{ borderRadius: 2.5, textTransform: 'none' }}>
            Add User
          </Button>
        </Box>

        {/* Stats */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {stats.map((s, i) => (
            <Grid size={{ xs: 6, sm: 3 }} key={s.label}>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
                <Card elevation={0} sx={{ borderRadius: 3, border: `2px solid ${s.color}25`, textAlign: 'center' }}>
                  <CardContent sx={{ py: 2 }}>
                    <Typography variant="h3" sx={{ fontWeight: 900, color: s.color }}>
                      {isLoading ? '—' : s.count}
                    </Typography>
                    <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">{s.label}</Typography>
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          ))}
        </Grid>

        {/* Filters */}
        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <CardContent sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small" placeholder="Search name or email..." value={search}
              onChange={e => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>,
                  sx: { borderRadius: 2 },
                },
              }}
              sx={{ minWidth: 240 }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Role</InputLabel>
              <Select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} label="Role" sx={{ borderRadius: 2 }}>
                <MenuItem value="">All Roles</MenuItem>
                {ROLES.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControlLabel
              control={<Switch checked={showInactive} onChange={e => setShowInactive(e.target.checked)} size="small" />}
              label={<Typography sx={{ fontSize: '0.94rem' }}>Show Inactive</Typography>}
              sx={{ ml: 1 }}
            />
          </CardContent>
        </Card>

        {/* Table */}
        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', bgcolor: 'action.hover', py: 1.5 } }}>
                  <TableCell>User</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Contact</TableCell>
                  <TableCell>Cases</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Joined</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : !users?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">No users found</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user, i) => {
                    const rc = getRoleConfig(user.role);
                    return (
                      <motion.tr
                        key={user.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        style={{ display: 'table-row' }}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar sx={{ width: 36, height: 36, background: `linear-gradient(135deg, ${rc.color}90, ${rc.color}50)`, fontSize: '0.9rem', fontWeight: 700, opacity: user.active ? 1 : 0.5 }}>
                              {getInitials(user.name)}
                            </Avatar>
                            <Box>
                              <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, opacity: user.active ? 1 : 0.5 }}>{user.name}</Typography>
                              <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">{user.email}</Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip label={rc.label} size="small"
                            sx={{ bgcolor: `${rc.color}18`, color: rc.color, fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                        </TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.9rem' }}>{user.phone ?? '—'}</Typography>
                          {user.barangay && <Typography sx={{ fontSize: '0.82rem' }} color="text.secondary">{user.barangay}</Typography>}
                        </TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>{user._count.assignedCases}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={user.active ? 'Active' : 'Inactive'} size="small"
                            sx={{ bgcolor: user.active ? '#22c55e18' : '#ef444418', color: user.active ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                        </TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => setEditUser(user)} sx={{ mr: 0.5 }}>
                              <Edit sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>
                          {user.active ? (
                            <Tooltip title="Deactivate">
                              <IconButton size="small" color="error" onClick={() => handleDeactivate(user)}>
                                <PersonOff sx={{ fontSize: 17 }} />
                              </IconButton>
                            </Tooltip>
                          ) : (
                            <Tooltip title="Reactivate">
                              <IconButton size="small" color="success" onClick={() => handleReactivate(user)}>
                                <PersonAdd sx={{ fontSize: 17 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </motion.tr>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      </Box>

      <UserFormDialog
        open={addOpen || Boolean(editUser)}
        mode={editUser ? 'edit' : 'add'}
        user={editUser}
        onClose={() => { setAddOpen(false); setEditUser(null); }}
        onSaved={() => mutate(key)}
      />
    </DashboardLayout>
  );
}

function UserFormDialog({
  open, mode, user, onClose, onSaved,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'vawc_officer',
    barangay: '', phone: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && mode === 'edit') {
      setForm({ name: user.name, email: user.email, password: '', role: user.role, barangay: user.barangay ?? '', phone: user.phone ?? '' });
    } else {
      setForm({ name: '', email: '', password: '', role: 'vawc_officer', barangay: '', phone: '' });
    }
    setError('');
  }, [open, user, mode]);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    setError('');
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email are required'); return; }
    if (mode === 'add' && form.password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setSaving(true);
    try {
      const payload: Record<string, string> = { name: form.name, email: form.email, role: form.role };
      if (form.phone) payload.phone = form.phone;
      if (form.barangay) payload.barangay = form.barangay;
      if (mode === 'add') payload.password = form.password;
      if (mode === 'edit' && form.password) payload.password = form.password;

      const url = mode === 'add' ? '/api/users' : `/api/users/${user!.id}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(mode === 'add' ? 'User created!' : 'User updated!');
        onSaved();
        onClose();
      } else {
        const e = await res.json();
        setError(e.error ?? 'Failed');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {mode === 'add' ? 'Add New User' : `Edit — ${user?.name}`}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Full Name" fullWidth size="small" required value={form.name} onChange={e => set('name', e.target.value)}
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          <TextField label="Email" fullWidth size="small" required value={form.email} onChange={e => set('email', e.target.value)}
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label={mode === 'add' ? 'Password' : 'New Password (optional)'} type="password"
            fullWidth size="small" required={mode === 'add'} value={form.password}
            onChange={e => set('password', e.target.value)}
            helperText="Min 8 characters"
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          <FormControl fullWidth size="small" required>
            <InputLabel>Role</InputLabel>
            <Select value={form.role} onChange={e => set('role', e.target.value)} label="Role" sx={{ borderRadius: 2 }}>
              {ROLES.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Phone" fullWidth size="small" value={form.phone} onChange={e => set('phone', e.target.value)}
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          <TextField label="Area / Barangay" fullWidth size="small" value={form.barangay} onChange={e => set('barangay', e.target.value)}
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </Box>

        {/* Role info cards */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {ROLES.map(r => (
            <Chip key={r.value} label={r.label} size="small"
              onClick={() => set('role', r.value)}
              sx={{ bgcolor: form.role === r.value ? `${r.color}20` : 'transparent',
                color: form.role === r.value ? r.color : 'text.secondary',
                border: `1px solid ${form.role === r.value ? r.color : 'transparent'}`,
                fontWeight: form.role === r.value ? 700 : 400, cursor: 'pointer',
                transition: 'all 0.15s' }} />
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {saving ? 'Saving...' : mode === 'add' ? 'Create User' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
