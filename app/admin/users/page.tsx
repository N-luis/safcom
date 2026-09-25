'use client';

import { useState, useEffect, ReactNode } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Avatar, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem,
  Chip, IconButton, InputAdornment, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Switch, FormControlLabel, CircularProgress, Alert, Skeleton,
  Tabs, Tab,
} from '@mui/material';
import {
  Add, Search, Edit, PersonOff, PersonAdd, AdminPanelSettings, Badge, Security, Shield,
  People, Groups, Cancel, Schedule, CheckCircle, InsertDriveFile,
  Close, OpenInNew, Person, LocationOn, CalendarToday, FolderOpen, Refresh,
  Visibility, VisibilityOff, DeleteOutlined,
  Email, Phone, Home, Cake, Wc, AlternateEmail, VerifiedUser, Lock, Update,
  HowToReg, Gavel, WarningAmber, Notes, FactCheck,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';

const ACCENT = '#0ea5e9';

const RESIDENT_STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: typeof CheckCircle }> = {
  Pending:  { color: '#f97316', bg: '#fff7ed', label: 'Pending',  icon: Schedule },
  Active:   { color: '#22c55e', bg: '#f0fdf4', label: 'Verified', icon: CheckCircle },
  Rejected: { color: '#ef4444', bg: '#fef2f2', label: 'Rejected', icon: Cancel },
  Inactive: { color: '#94a3b8', bg: '#f8fafc', label: 'Inactive', icon: Cancel },
};

interface Resident {
  id: string; residentNumber: string; firstName: string; lastName: string;
  age: number; gender: string; barangay: string; address: string;
  contactNumber: string | null; email: string | null; emailVerified?: boolean;
  idDocument: string | null; status: string; registeredAt: string;
}

/** Extra fields the single-resident endpoint returns on top of the list row. */
interface ResidentCase {
  id: string; caseNumber: string; caseType: string; status: string;
  riskLevel: string; barangay: string; filedAt: string; resolvedAt: string | null;
  assignedTo: { name: string; role: string } | null;
}

interface ResidentDetail extends Resident {
  username: string | null;
  riskLevel: string;
  notes: string | null;
  updatedAt: string;
  openCases: number;
  resolvedCases: number;
  signInMethod: 'clerk' | 'password' | 'none';
  cases: ResidentCase[];
  _count: { cases: number };
}

const CASE_STATUS_COLOR: Record<string, string> = {
  Open: '#f97316', 'In Progress': '#3b82f6', Resolved: '#22c55e', Closed: '#64748b',
};

const RISK_COLOR: Record<string, string> = {
  Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444',
};

const SIGN_IN_METHOD: Record<string, { label: string; detail: string }> = {
  clerk:    { label: 'Clerk',           detail: 'Identity and email verification handled by Clerk' },
  password: { label: 'Password',        detail: 'Legacy account with a local password' },
  none:     { label: 'No credentials',  detail: 'Created by staff — this resident cannot sign in yet' },
};

function isImageDoc(url: string | null): boolean {
  if (!url) return false;
  return /\.(jpg|jpeg|png|webp)$/i.test(url) || url.includes('/uploads/');
}

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

const ROLES = [
  { value: 'admin', label: 'Barangay Captain', color: '#8b5cf6', icon: AdminPanelSettings },
  { value: 'officer', label: 'Blotter Officer', color: '#3b82f6', icon: Badge },
  { value: 'vawc_officer', label: 'VAWC Officer', color: '#7c3aed', icon: Security },
  { value: 'system_admin', label: 'System Admin', color: '#0ea5e9', icon: Shield },
];

const ASSIGNABLE_ROLES = ROLES.filter(r => r.value !== 'system_admin');

function getRoleConfig(role: string) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: '#6b7280', icon: Badge };
}

interface User {
  id: string; name: string; email: string; username?: string | null; role: string;
  barangay: string | null; phone: string | null; active: boolean;
  createdAt: string; _count: { assignedCases: number };
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const MotionTableRow = motion(TableRow);

export default function AdminUsersPage() {
  const [tab, setTab] = useState<'officials' | 'residents'>('officials');
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
  const { data: residentsData } = useSWR<{ residents: Resident[] }>('/api/residents?limit=100', fetcher, { refreshInterval: 30000 });
  const allResidents = residentsData?.residents ?? [];
  const pendingResidentCount = allResidents.filter(r => r.status === 'Pending').length;

  const roleStats = ROLES.map(r => ({ ...r, count: users?.filter(u => u.role === r.value && u.active).length ?? 0 }));

  async function handleDeactivate(user: User) {
    if (!confirm(`Deactivate ${user.name}?`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toast.success(`${user.name} deactivated`); mutate(key); }
    else { const e = await res.json(); toast.error(e.error ?? 'Failed'); }
  }

  async function handleReactivate(user: User) {
    const res = await fetch(`/api/users/${user.id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
    if (res.ok) { toast.success(`${user.name} reactivated`); mutate(key); }
    else toast.error('Failed to reactivate');
  }

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>User Management</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>Manage official accounts and resident accounts in one place</Typography>
        </Box>
        {tab === 'officials' && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setAddOpen(true)}
            sx={{ borderRadius: 2.5, textTransform: 'none', bgcolor: ACCENT, '&:hover': { bgcolor: '#0284c7' }, fontWeight: 600 }}>
            Add User
          </Button>
        )}
      </Box>

      {/* Tabs: Officials vs Residents */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 3, minHeight: 0,
          '& .MuiTabs-indicator': { height: 3, borderRadius: 1.5, bgcolor: ACCENT },
          '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, fontSize: '0.94rem', minHeight: 0, py: 1.25, px: 2, color: '#64748b' },
          '& .Mui-selected': { color: `${ACCENT} !important` },
        }}
      >
        <Tab value="officials" icon={<Groups sx={{ fontSize: 18 }} />} iconPosition="start" label="Officials" />
        <Tab
          value="residents"
          icon={<People sx={{ fontSize: 18 }} />}
          iconPosition="start"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              User (Resident)
              {pendingResidentCount > 0 && (
                <Chip label={pendingResidentCount} size="small"
                  sx={{ height: 18, minWidth: 18, fontSize: '0.72rem', fontWeight: 800, bgcolor: '#fff7ed', color: '#f97316' }} />
              )}
            </Box>
          }
        />
      </Tabs>

      {tab === 'residents' ? (
        <ResidentsPanel residents={allResidents} />
      ) : (
      <>
      {/* Role stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {roleStats.map((r, i) => (
          <Grid key={r.value} size={{ xs: 6, sm: 3 }}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
              <Card sx={{ border: `1.5px solid ${r.color}22` }}>
                <CardContent sx={{ py: 2, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '1.8rem', fontWeight: 900, color: r.color, lineHeight: 1 }}>
                    {isLoading ? '—' : r.count}
                  </Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: '#64748b', mt: 0.25 }}>{r.label}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* Filters */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" placeholder="Search name or email..." value={search} onChange={e => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>, sx: { borderRadius: 2 } } }}
            sx={{ minWidth: 240 }} />
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
          />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', bgcolor: '#f8fafc', py: 1.5 } }}>
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
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton variant="text" width={70} /></TableCell>)}
                  </TableRow>
                ))
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
                    <MotionTableRow key={user.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar sx={{ width: 36, height: 36, background: `${rc.color}30`, color: rc.color, fontSize: '0.9rem', fontWeight: 700, opacity: user.active ? 1 : 0.5 }}>
                            {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, opacity: user.active ? 1 : 0.5 }}>{user.name}</Typography>
                            <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{user.email}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip label={rc.label} size="small" sx={{ bgcolor: `${rc.color}18`, color: rc.color, fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: '0.9rem' }}>{user.phone ?? '—'}</Typography>
                        {user.barangay && <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{user.barangay}</Typography>}
                      </TableCell>
                      <TableCell><Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>{user._count.assignedCases}</Typography></TableCell>
                      <TableCell>
                        <Chip label={user.active ? 'Active' : 'Inactive'} size="small"
                          sx={{ bgcolor: user.active ? '#22c55e18' : '#ef444418', color: user.active ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                      </TableCell>
                      <TableCell><Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>{new Date(user.createdAt).toLocaleDateString()}</Typography></TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditUser(user)} sx={{ mr: 0.5 }}><Edit sx={{ fontSize: 17 }} /></IconButton></Tooltip>
                        {user.active
                          ? <Tooltip title="Deactivate"><IconButton size="small" color="error" onClick={() => handleDeactivate(user)}><PersonOff sx={{ fontSize: 17 }} /></IconButton></Tooltip>
                          : <Tooltip title="Reactivate"><IconButton size="small" color="success" onClick={() => handleReactivate(user)}><PersonAdd sx={{ fontSize: 17 }} /></IconButton></Tooltip>}
                      </TableCell>
                    </MotionTableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <UserFormDialog
        open={addOpen || Boolean(editUser)} mode={editUser ? 'edit' : 'add'} user={editUser}
        onClose={() => { setAddOpen(false); setEditUser(null); }}
        onSaved={() => mutate(key)}
      />
      </>
      )}
    </Box>
  );
}

// ─── Resident accounts panel (with inline ID verification) ──────────────────
function ResidentsPanel({ residents }: { residents: Resident[] }) {
  const [filter, setFilter] = useState<'Pending' | 'Active' | 'Rejected' | 'all'>('Pending');
  const [preview, setPreview] = useState<Resident | null>(null);
  const [rejectDialog, setRejectDialog] = useState<Resident | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<Resident | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  async function handleDelete(r: Resident) {
    setActing(r.id);
    try {
      const res = await fetch(`/api/residents/${r.id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json();
      if (res.ok) {
        const n = j.data?.casesUnlinked ?? 0;
        toast.success(
          `Account deleted — ${r.email ?? 'the email'} can be used again${n ? `. ${n} case(s) kept.` : '.'}`,
        );
        mutate('/api/residents?limit=100');
        setDeleteDialog(null);
        setPreview(null);
      } else {
        toast.error(j.error ?? 'Could not delete this account');
      }
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setActing(null);
    }
  }

  const visible = filter === 'all' ? residents : residents.filter(r => r.status === filter);
  const statusStats = (['Pending', 'Active', 'Rejected'] as const).map(s => ({
    status: s, ...RESIDENT_STATUS_CONFIG[s], count: residents.filter(r => r.status === s).length,
  }));

  async function handleAction(id: string, action: 'approve' | 'reject' | 'verify_email', reason?: string) {
    setActing(id);
    try {
      const res = await fetch(`/api/admin/residents/${id}/verify`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? '✓ Resident verified and activated!' : action === 'verify_email' ? '✓ Email marked as verified — they can log in now' : 'Resident registration rejected');
        mutate('/api/residents?limit=100');
        setPreview(null);
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Action failed');
      }
    } finally {
      setActing(null);
      setRejectDialog(null);
      setRejectReason('');
    }
  }

  const tabs = [
    { value: 'Pending' as const, label: 'Pending Review', color: '#f97316' },
    { value: 'Active' as const, label: 'Verified', color: '#22c55e' },
    { value: 'Rejected' as const, label: 'Rejected', color: '#ef4444' },
    { value: 'all' as const, label: 'All Residents', color: '#64748b' },
  ];

  return (
    <Box>
      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {statusStats.map((s, i) => {
          const StatIcon = s.icon;
          return (
            <Grid key={s.status} size={{ xs: 6, sm: 4 }}>
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
                <Card sx={{ border: `1.5px solid ${s.color}22` }}>
                  <CardContent sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: `${s.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <StatIcon sx={{ fontSize: 19, color: s.color }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.count}</Typography>
                      <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{s.label}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            </Grid>
          );
        })}
      </Grid>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <Chip key={t.value} label={t.value === 'Pending' && filter === 'Pending' ? `${t.label} (${visible.length})` : t.label}
              onClick={() => setFilter(t.value)}
              sx={{
                bgcolor: filter === t.value ? `${t.color}15` : '#f1f5f9',
                color: filter === t.value ? t.color : '#64748b',
                fontWeight: filter === t.value ? 700 : 400,
                border: filter === t.value ? `1px solid ${t.color}30` : '1px solid transparent',
                cursor: 'pointer', fontSize: '0.86rem',
              }} />
          ))}
        </Box>
        <Button variant="outlined" size="small" startIcon={<Refresh />} onClick={() => mutate('/api/residents?limit=100')}
          sx={{ borderColor: '#e2e8f0', color: '#64748b', '&:hover': { borderColor: ACCENT, color: ACCENT } }}>
          Refresh
        </Button>
      </Box>

      {filter === 'Pending' && visible.length > 0 && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: 2, fontSize: '0.9rem' }}>
          Click the ID thumbnail or <strong>View</strong> to inspect the submitted document. Approving activates the resident&apos;s account so they can sign in.
        </Alert>
      )}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', bgcolor: '#f8fafc', py: 1.5 } }}>
                <TableCell>Resident</TableCell>
                <TableCell>Details</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <FolderOpen sx={{ fontSize: 38, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 1 }} />
                    <Typography sx={{ color: '#94a3b8', fontSize: '0.94rem', fontWeight: 600 }}>
                      {filter === 'Pending' ? 'No pending verifications — all caught up!' : 'No residents in this category'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                <AnimatePresence>
                  {visible.map((r, i) => {
                    const sCfg = RESIDENT_STATUS_CONFIG[r.status] ?? RESIDENT_STATUS_CONFIG.Pending;
                    const StatusIcon = sCfg.icon;
                    const isActing = acting === r.id;
                    return (
                      <MotionTableRow key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -16 }} transition={{ delay: i * 0.04 }}
                        sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                        <TableCell>
                          <Tooltip title="View full details">
                            <Box onClick={() => setPreview(r)}
                              sx={{
                                display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer',
                                width: 'fit-content', borderRadius: 2, p: 0.5, m: -0.5,
                                '&:hover': { bgcolor: `${ACCENT}0f` },
                              }}>
                              <Avatar sx={{ width: 36, height: 36, bgcolor: `${ACCENT}22`, color: ACCENT, fontSize: '0.86rem', fontWeight: 700 }}>
                                {`${r.firstName[0]}${r.lastName[0]}`}
                              </Avatar>
                              <Box>
                                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>{r.firstName} {r.lastName}</Typography>
                                <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: 'monospace' }}>{r.residentNumber}</Typography>
                              </Box>
                            </Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                            <Typography sx={{ fontSize: '0.86rem', color: '#374151' }}>{r.age}y · {r.gender} · {r.barangay}</Typography>
                            {r.email && <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{r.email}</Typography>}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip icon={<StatusIcon sx={{ fontSize: '13px !important' }} />} label={sCfg.label} size="small"
                            sx={{ bgcolor: sCfg.bg, color: sCfg.color, fontWeight: 700, fontSize: '0.82rem', height: 24 }} />
                        </TableCell>
                        <TableCell align="center">
                          {r.status === 'Pending' ? (
                            <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center', alignItems: 'center' }}>
                              <Tooltip title="View full details">
                                <Button size="small" onClick={() => setPreview(r)}
                                  sx={{ color: ACCENT, fontSize: '0.82rem', textTransform: 'none', fontWeight: 600, minWidth: 0, px: 1 }}>
                                  View
                                </Button>
                              </Tooltip>
                              <Tooltip title="Approve — activate account">
                                <Button size="small" variant="contained" disabled={isActing}
                                  startIcon={<CheckCircle sx={{ fontSize: 14 }} />}
                                  onClick={() => handleAction(r.id, 'approve')}
                                  sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, borderRadius: 1.5, textTransform: 'none', fontSize: '0.86rem', py: 0.5, px: 1.25, minWidth: 72 }}>
                                  Verify
                                </Button>
                              </Tooltip>
                              <Tooltip title="Reject registration">
                                <Button size="small" variant="outlined" disabled={isActing}
                                  startIcon={<Cancel sx={{ fontSize: 14 }} />}
                                  onClick={() => { setRejectDialog(r); setRejectReason(''); }}
                                  sx={{ borderColor: '#ef4444', color: '#ef4444', '&:hover': { bgcolor: '#fef2f2' }, borderRadius: 1.5, textTransform: 'none', fontSize: '0.86rem', py: 0.5, px: 1.25, minWidth: 72 }}>
                                  Reject
                                </Button>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', alignItems: 'center' }}>
                              {r.emailVerified === false && (
                                <Tooltip title="Their email provider can't reach this inbox — mark the email verified so they can log in">
                                  <Button size="small" variant="outlined" disabled={isActing}
                                    startIcon={<CheckCircle sx={{ fontSize: 14 }} />}
                                    onClick={() => handleAction(r.id, 'verify_email')}
                                    sx={{ borderColor: '#14b8a6', color: '#0a7c6b', '&:hover': { bgcolor: 'rgba(20,184,166,0.06)' }, borderRadius: 1.5, textTransform: 'none', fontSize: '0.82rem', py: 0.4, px: 1 }}>
                                    Verify Email
                                  </Button>
                                </Tooltip>
                              )}
                              <Button size="small" onClick={() => setPreview(r)}
                                sx={{ color: ACCENT, fontSize: '0.82rem', textTransform: 'none', fontWeight: 600 }}>
                                View
                              </Button>
                              <Tooltip title="Delete account — frees the email for re-registration">
                                <IconButton size="small" disabled={isActing}
                                  onClick={() => { setDeleteDialog(r); setDeleteConfirm(''); }}
                                  sx={{ color: '#cbd5e1', '&:hover': { color: '#ef4444', bgcolor: '#fef2f2' } }}>
                                  <DeleteOutlined sx={{ fontSize: 17 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </TableCell>
                      </MotionTableRow>
                    );
                  })}
                </AnimatePresence>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Full resident details */}
      <ResidentDetailDialog
        resident={preview}
        acting={Boolean(acting)}
        onClose={() => setPreview(null)}
        onAction={handleAction}
        onReject={r => { setRejectDialog(r); setRejectReason(''); setPreview(null); }}
        onDelete={r => { setDeleteDialog(r); setDeleteConfirm(''); }}
      />

      {/* Delete account dialog */}
      <Dialog open={Boolean(deleteDialog)} onClose={() => setDeleteDialog(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
        <DialogTitle sx={{ fontWeight: 800, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 1 }}>
          <DeleteOutlined sx={{ fontSize: 21 }} /> Delete Resident Account
        </DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          {deleteDialog && (
            <>
              <Alert severity="error" sx={{ mb: 2, borderRadius: 2, fontSize: '0.9rem' }}>
                This permanently deletes <strong>{deleteDialog.firstName} {deleteDialog.lastName}</strong> ({deleteDialog.residentNumber}). It cannot be undone.
              </Alert>
              <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 1.75, mb: 2 }}>
                {[
                  `The account and its login are removed`,
                  `${deleteDialog.email ?? 'The email'} becomes free to register again`,
                  'Pending email-verification links are invalidated',
                  'Any blotter or VAWC cases are kept, just unlinked',
                ].map(line => (
                  <Box key={line} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 0.75 }}>
                    <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#94a3b8', mt: '7px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.86rem', color: '#475569' }}>{line}</Typography>
                  </Box>
                ))}
              </Box>
              <Typography sx={{ fontSize: '0.86rem', color: '#64748b', mb: 1 }}>
                Type <strong>DELETE</strong> to confirm:
              </Typography>
              <TextField fullWidth size="small" value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="DELETE" autoComplete="off"
                slotProps={{ input: { sx: { borderRadius: 2 } } }} />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteDialog(null)} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained"
            disabled={deleteConfirm !== 'DELETE' || Boolean(acting)}
            onClick={() => deleteDialog && handleDelete(deleteDialog)}
            startIcon={acting ? <CircularProgress size={15} color="inherit" /> : <DeleteOutlined sx={{ fontSize: 17 }} />}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>
            {acting ? 'Deleting…' : 'Delete Account'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={Boolean(rejectDialog)} onClose={() => setRejectDialog(null)} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
        <DialogTitle sx={{ fontWeight: 700, color: '#0c1e46' }}>Reject Registration</DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          {rejectDialog && (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: 2, fontSize: '0.9rem' }}>
              Rejecting <strong>{rejectDialog.firstName} {rejectDialog.lastName}</strong> will prevent them from logging in. They can resubmit a clearer ID.
            </Alert>
          )}
          <TextField fullWidth size="small" multiline rows={3}
            label="Reason for rejection (shown to resident)"
            value={rejectReason} onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g. ID image is blurry or unclear, invalid/expired document…"
            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRejectDialog(null)} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => rejectDialog && handleAction(rejectDialog.id, 'reject', rejectReason || undefined)}
            sx={{ borderRadius: 2, textTransform: 'none', bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>
            Confirm Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function UserFormDialog({ open, mode, user, onClose, onSaved }: {
  open: boolean; mode: 'add' | 'edit'; user: User | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', username: '', password: '', role: 'officer', barangay: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && mode === 'edit') setForm({ name: user.name, email: user.email, username: user.username ?? '', password: '', role: user.role, barangay: user.barangay ?? '', phone: user.phone ?? '' });
    else setForm({ name: '', email: '', username: '', password: '', role: 'officer', barangay: '', phone: '' });
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
      if (form.username) payload.username = form.username;
      if (form.phone) payload.phone = form.phone;
      if (form.barangay) payload.barangay = form.barangay;
      if (mode === 'add') payload.password = form.password;
      if (mode === 'edit' && form.password) payload.password = form.password;

      const res = await fetch(mode === 'add' ? '/api/users' : `/api/users/${user!.id}`, {
        method: mode === 'add' ? 'POST' : 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (res.ok) { toast.success(mode === 'add' ? 'User created!' : 'User updated!'); onSaved(); onClose(); }
      else { const e = await res.json(); setError(e.error ?? 'Failed'); }
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{mode === 'add' ? 'Add New User' : `Edit — ${user?.name}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Full Name" fullWidth size="small" required value={form.name} onChange={e => set('name', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          <TextField label="Email" fullWidth size="small" required value={form.email} onChange={e => set('email', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label={mode === 'add' ? 'Password' : 'New Password (optional)'}
            type={showPw ? 'text' : 'password'} fullWidth size="small"
            required={mode === 'add'} value={form.password} onChange={e => set('password', e.target.value)}
            helperText="Min 8 characters"
            slotProps={{
              input: {
                sx: { borderRadius: 2 },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" edge="end" onClick={() => setShowPw(p => !p)}
                      aria-label={showPw ? 'Hide password' : 'Show password'}>
                      {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }} />
          <FormControl fullWidth size="small" required>
            <InputLabel>Role</InputLabel>
            <Select value={form.role} onChange={e => set('role', e.target.value)} label="Role" sx={{ borderRadius: 2 }}>
              {(mode === 'edit' && user?.role === 'system_admin' ? ROLES : ASSIGNABLE_ROLES).map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Username" fullWidth size="small" value={form.username}
            onChange={e => set('username', e.target.value)}
            helperText="Optional — lets them sign in without their email"
            slotProps={{ htmlInput: { maxLength: 20, autoCapitalize: 'none', spellCheck: false }, input: { sx: { borderRadius: 2 } } }} />
          <TextField label="Phone" fullWidth size="small" value={form.phone} onChange={e => set('phone', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Area / Barangay" fullWidth size="small" value={form.barangay} onChange={e => set('barangay', e.target.value)} slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}
          sx={{ borderRadius: 2, textTransform: 'none', bgcolor: ACCENT, '&:hover': { bgcolor: '#0284c7' } }}>
          {saving ? <CircularProgress size={20} color="inherit" /> : mode === 'add' ? 'Create User' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Full resident details ──────────────────────────────────────────────────
// The list row only carries a summary, so the dialog fetches the full record
// (profile, account/credential state and case history) when it opens.
function Field({ icon: Icon, label, value, mono, chip }: {
  icon: typeof Person; label: string; value: string | null | undefined;
  mono?: boolean; chip?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 0.9 }}>
      <Icon sx={{ fontSize: 16, color: '#94a3b8', mt: '3px', flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{
            fontSize: '0.9rem', color: value ? '#0c1e46' : '#cbd5e1', fontWeight: 500,
            fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word',
          }}>
            {value || '—'}
          </Typography>
          {chip}
        </Box>
      </Box>
    </Box>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Person; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2.5, p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, mb: 0.5 }}>
        <Icon sx={{ fontSize: 17, color: ACCENT }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

function MiniStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <Box sx={{ flex: 1, textAlign: 'center', py: 1.25, borderRadius: 2, bgcolor: `${color}0f` }}>
      <Typography sx={{ fontSize: '1.35rem', fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, mt: 0.25 }}>{label}</Typography>
    </Box>
  );
}

function ResidentDetailDialog({ resident, acting, onClose, onAction, onReject, onDelete }: {
  resident: Resident | null;
  acting: boolean;
  onClose: () => void;
  onAction: (id: string, action: 'approve' | 'reject' | 'verify_email', reason?: string) => void;
  onReject: (r: Resident) => void;
  onDelete: (r: Resident) => void;
}) {
  const { data, isLoading, error } = useSWR<ResidentDetail>(
    resident ? `/api/residents/${resident.id}` : null,
    fetcher,
  );

  // Fall back to the list row while the full record loads, so the header never
  // flashes empty.
  const r = data ?? (resident as ResidentDetail | null);
  if (!resident || !r) return null;

  const s = RESIDENT_STATUS_CONFIG[r.status] ?? RESIDENT_STATUS_CONFIG.Pending;
  const StatusIcon = s.icon;
  const verified = r.emailVerified !== false;
  // Only known once the full record arrives — don't claim "no credentials" while loading.
  const method = data ? SIGN_IN_METHOD[data.signInMethod] : null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
            <Avatar sx={{ width: 52, height: 52, bgcolor: `${ACCENT}1f`, color: ACCENT, fontWeight: 800, fontSize: '1.05rem' }}>
              {`${r.firstName[0]}${r.lastName[0]}`}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, color: '#0c1e46', fontSize: '1.15rem', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                {r.firstName} {r.lastName}
              </Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                {r.residentNumber}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.6, mt: 0.75, flexWrap: 'wrap' }}>
                <Chip icon={<StatusIcon sx={{ fontSize: '13px !important' }} />} label={s.label} size="small"
                  sx={{ bgcolor: s.bg, color: s.color, fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                <Chip
                  icon={verified ? <VerifiedUser sx={{ fontSize: '12px !important' }} /> : <WarningAmber sx={{ fontSize: '12px !important' }} />}
                  label={verified ? 'Email verified' : 'Email unverified'} size="small"
                  sx={{
                    bgcolor: verified ? '#f0fdfa' : '#fff7ed', color: verified ? '#0f766e' : '#c2410c',
                    fontWeight: 700, fontSize: '0.78rem', height: 24,
                  }} />
                {data && (
                  <Chip label={`Risk: ${r.riskLevel}`} size="small"
                    sx={{
                      bgcolor: `${RISK_COLOR[r.riskLevel] ?? '#64748b'}14`,
                      color: RISK_COLOR[r.riskLevel] ?? '#64748b',
                      fontWeight: 700, fontSize: '0.78rem', height: 24,
                    }} />
                )}
              </Box>
            </Box>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close"><Close fontSize="small" /></IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2, fontSize: '0.9rem' }}>
            Couldn&apos;t load the full record. The summary below is from the list.
          </Alert>
        )}

        {/* Case history summary */}
        <Box sx={{ display: 'flex', gap: 1.25, mb: 2.25 }}>
          {isLoading && !data ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={62} sx={{ flex: 1, borderRadius: 2 }} />
            ))
          ) : (
            <>
              <MiniStat value={data?._count.cases ?? 0} label="Total cases" color="#0ea5e9" />
              <MiniStat value={data?.openCases ?? 0} label="Open" color="#f97316" />
              <MiniStat value={data?.resolvedCases ?? 0} label="Resolved" color="#22c55e" />
            </>
          )}
        </Box>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Personal Information" icon={Person}>
              <Field icon={Person} label="Full name" value={`${r.firstName} ${r.lastName}`} />
              <Field icon={Cake} label="Age" value={`${r.age} years old`} />
              <Field icon={Wc} label="Gender" value={r.gender} />
              <Field icon={Badge} label="Resident number" value={r.residentNumber} mono />
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Contact" icon={Email}>
              <Field
                icon={Email} label="Email address" value={r.email}
                chip={r.email ? (
                  <Chip label={verified ? 'Verified' : 'Unverified'} size="small"
                    sx={{
                      height: 22, fontSize: '0.72rem', fontWeight: 700,
                      bgcolor: verified ? '#dcfce7' : '#ffedd5', color: verified ? '#15803d' : '#c2410c',
                    }} />
                ) : undefined}
              />
              <Field icon={Phone} label="Contact number" value={r.contactNumber} mono />
              <Field icon={AlternateEmail} label="Username" value={data?.username} mono />
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Address" icon={LocationOn}>
              <Field icon={Home} label="Street address" value={r.address} />
              <Field icon={LocationOn} label="Barangay" value={r.barangay} />
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Account" icon={Lock}>
              <Field
                icon={Lock} label="Sign-in method" value={method?.label}
                chip={method
                  ? <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{method.detail}</Typography>
                  : undefined}
              />
              <Field icon={CalendarToday} label="Registered" value={fullDate(r.registeredAt)} />
              <Field icon={Update} label="Last updated" value={data ? fullDate(data.updatedAt) : null} />
              {/* Legacy accounts only — ID upload was removed from registration. */}
              {r.idDocument && (
                <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 0.9 }}>
                  <InsertDriveFile sx={{ fontSize: 16, color: '#94a3b8', mt: '3px' }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      Submitted ID (archived)
                    </Typography>
                    <Button size="small" href={r.idDocument} target="_blank" rel="noopener noreferrer"
                      endIcon={<OpenInNew sx={{ fontSize: 13 }} />}
                      sx={{ p: 0, minWidth: 0, color: ACCENT, fontSize: '0.9rem', textTransform: 'none', fontWeight: 600 }}>
                      {isImageDoc(r.idDocument) ? 'View image' : 'Open document'}
                    </Button>
                  </Box>
                </Box>
              )}
            </Section>
          </Grid>

          {data?.notes && (
            <Grid size={12}>
              <Section title="Admin Notes" icon={Notes}>
                <Typography sx={{ fontSize: '0.9rem', color: '#374151', whiteSpace: 'pre-wrap', pt: 0.5 }}>
                  {data.notes}
                </Typography>
              </Section>
            </Grid>
          )}

          {/* Case history */}
          <Grid size={12}>
            <Section title="Case History" icon={Gavel}>
              {isLoading && !data ? (
                <Box sx={{ pt: 1 }}>
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={34} />)}
                </Box>
              ) : !data?.cases.length ? (
                <Box sx={{ py: 3, textAlign: 'center' }}>
                  <FolderOpen sx={{ fontSize: 32, color: '#e2e8f0', display: 'block', mx: 'auto', mb: 0.75 }} />
                  <Typography sx={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    This resident has never filed a case
                  </Typography>
                </Box>
              ) : (
                <TableContainer sx={{ mt: 0.5 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', borderBottom: '1px solid #e2e8f0', py: 0.75 } }}>
                        <TableCell>Case</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Officer</TableCell>
                        <TableCell align="right">Filed</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.cases.map(c => (
                        <TableRow key={c.id} sx={{ '& td': { borderBottom: '1px solid #f1f5f9', py: 1 } }}>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.82rem', fontFamily: 'monospace', color: '#0c1e46', fontWeight: 600 }}>
                              {c.caseNumber}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.86rem', color: '#374151' }}>{c.caseType}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={c.status} size="small"
                              sx={{
                                height: 22, fontSize: '0.72rem', fontWeight: 700,
                                bgcolor: `${CASE_STATUS_COLOR[c.status] ?? '#64748b'}15`,
                                color: CASE_STATUS_COLOR[c.status] ?? '#64748b',
                              }} />
                          </TableCell>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.86rem', color: c.assignedTo ? '#475569' : '#cbd5e1' }}>
                              {c.assignedTo?.name ?? 'Unassigned'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.82rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                              {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              {data && data._count.cases > data.cases.length && (
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mt: 1, textAlign: 'center' }}>
                  Showing the {data.cases.length} most recent of {data._count.cases} cases
                </Typography>
              )}
            </Section>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid #f1f5f9', gap: 1, flexWrap: 'wrap' }}>
        {r.status === 'Pending' ? (
          <>
            <Button variant="contained" disabled={acting} startIcon={<HowToReg />}
              onClick={() => onAction(r.id, 'approve')}
              sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
              Verify &amp; Activate
            </Button>
            <Button variant="outlined" disabled={acting} startIcon={<Cancel />}
              onClick={() => onReject(resident)}
              sx={{ borderColor: '#ef4444', color: '#ef4444', '&:hover': { bgcolor: '#fef2f2' }, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
              Reject
            </Button>
          </>
        ) : (
          <>
            {!verified && (
              <Button variant="outlined" disabled={acting} startIcon={<FactCheck />}
                onClick={() => onAction(r.id, 'verify_email')}
                sx={{ borderColor: '#14b8a6', color: '#0a7c6b', '&:hover': { bgcolor: 'rgba(20,184,166,0.06)' }, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
                Mark Email Verified
              </Button>
            )}
            <Button variant="outlined" disabled={acting} startIcon={<DeleteOutlined />}
              onClick={() => onDelete(resident)}
              sx={{ borderColor: '#fecaca', color: '#ef4444', '&:hover': { bgcolor: '#fef2f2', borderColor: '#ef4444' }, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
              Delete Account
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none', color: '#64748b' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
