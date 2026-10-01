'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Grid, Typography, Card, CardContent, Avatar, Chip, TextField,
  InputAdornment, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Skeleton, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
  Select, MenuItem, FormControl, InputLabel, Divider, Menu,
  MenuItem as MuiMenuItem, Badge, FormHelperText,
} from '@mui/material';
import {
  Search, Add, GridView, TableRows, MoreVert, Visibility, Edit,
  Delete, Phone, Email, Home, Person, FileDownload, Warning,
  FolderOpen, CalendarToday, LocationOn,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useResidents, useUsers } from '@/hooks/useApi';
import { getRiskColor, getRiskBgColor } from '@/utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';
import { mutate } from 'swr';
import toast from 'react-hot-toast';
import { GENDER_OPTIONS } from '@/lib/safecommConfig';

const BARANGAYS = ['Biñang 2nd'];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const GENDERS = GENDER_OPTIONS;
const CASE_TYPES = ['Domestic Violence', 'Child Neglect', 'Elder Abuse', 'Substance Abuse', 'Mental Health', 'Community Conflict', 'Economic Crisis', 'Child Abuse', 'Senior Welfare', 'Other'];
const CASE_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

function getAvatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

interface ResidentCase {
  id: string; caseNumber: string; caseType: string; status: string;
  riskLevel: string; description: string; filedAt: string;
}

interface Resident {
  id: string; residentNumber: string; firstName: string; lastName: string;
  age: number; gender: string; barangay: string; address: string;
  contactNumber: string | null; email: string | null;
  status: string; riskLevel: string; notes: string | null;
  registeredAt: string; _count?: { cases: number };
  cases?: ResidentCase[];
}

interface ResidentFormData {
  firstName: string; lastName: string; age: string; gender: string;
  barangay: string; address: string; contactNumber: string; email: string;
  status: string; riskLevel: string; notes: string;
}

const emptyForm: ResidentFormData = {
  firstName: '', lastName: '', age: '', gender: 'Male',
  barangay: '', address: '', contactNumber: '', email: '',
  status: 'Active', riskLevel: 'Low', notes: '',
};

function residentToForm(r: Resident): ResidentFormData {
  return {
    firstName: r.firstName, lastName: r.lastName, age: String(r.age),
    gender: r.gender, barangay: r.barangay, address: r.address,
    contactNumber: r.contactNumber ?? '', email: r.email ?? '',
    status: r.status, riskLevel: r.riskLevel, notes: r.notes ?? '',
  };
}

function refreshResidents() {
  mutate((key: string) => typeof key === 'string' && key.startsWith('/api/residents'), undefined, { revalidate: true });
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function ResidentsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [statusFilter, setStatusFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [editResident, setEditResident] = useState<Resident | null>(null);
  const [viewResident, setViewResident] = useState<Resident | null>(null);
  const [deleteResident, setDeleteResident] = useState<Resident | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuResident, setMenuResident] = useState<Resident | null>(null);

  const queryParams: Record<string, string | number> = {
    page: page + 1, limit: rowsPerPage,
    sortBy: 'registeredAt', sortDir: 'desc',
  };
  if (search) queryParams.search = search;
  if (statusFilter) queryParams.status = statusFilter;
  if (riskFilter) queryParams.riskLevel = riskFilter;

  const { data, isLoading, mutate: mutateResidents } = useResidents(queryParams);

  const residents: Resident[] = data?.residents ?? [];
  const total: number = data?.pagination?.total ?? 0;

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch('/api/residents?limit=1000&sortBy=lastName&sortDir=asc');
      const json = await res.json();
      const all: Resident[] = json.data?.residents ?? [];
      const headers = ['Resident #', 'First Name', 'Last Name', 'Age', 'Gender', 'Barangay', 'Address', 'Contact', 'Email', 'Risk Level', 'Status', 'Registered'];
      const rows = all.map(r => [
        r.residentNumber, r.firstName, r.lastName, r.age, r.gender,
        r.barangay, `"${r.address}"`, r.contactNumber ?? '', r.email ?? '',
        r.riskLevel, r.status, new Date(r.registeredAt).toLocaleDateString(),
      ]);
      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `residents-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success('Residents exported as CSV');
    } catch { toast.error('Export failed'); }
  }, []);

  function openMenu(e: React.MouseEvent<HTMLElement>, resident: Resident) {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuResident(resident);
  }

  async function handleDelete(resident: Resident) {
    const res = await fetch(`/api/residents/${resident.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`${resident.firstName} ${resident.lastName} removed`);
      mutateResidents();
      refreshResidents();
    } else {
      const e = await res.json();
      toast.error(e.error ?? 'Failed to delete resident');
    }
    setDeleteResident(null);
  }

  return (
    <DashboardLayout>
      <Box>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>Residents</Typography>
            <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>
              {isLoading ? 'Loading...' : `${total} registered resident${total !== 1 ? 's' : ''} in the system`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tooltip title="Export CSV">
              <Button variant="outlined" startIcon={<FileDownload />} onClick={handleExport} sx={{ borderRadius: 2.5, textTransform: 'none' }}>Export</Button>
            </Tooltip>
            <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Tooltip title="Table view">
                <IconButton size="small" onClick={() => setViewMode('table')} sx={{ borderRadius: 0, bgcolor: viewMode === 'table' ? 'primary.main' : 'transparent', color: viewMode === 'table' ? 'white' : 'inherit', px: 1.5 }}>
                  <TableRows fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Grid view">
                <IconButton size="small" onClick={() => setViewMode('grid')} sx={{ borderRadius: 0, bgcolor: viewMode === 'grid' ? 'primary.main' : 'transparent', color: viewMode === 'grid' ? 'white' : 'inherit', px: 1.5 }}>
                  <GridView fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Button variant="contained" startIcon={<Add />} sx={{ borderRadius: 2.5, textTransform: 'none' }} onClick={() => setAddOpen(true)}>
              Add Resident
            </Button>
          </Box>
        </Box>

        {/* Search + Filters */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
          <TextField
            sx={{ flex: 1, minWidth: 240 }} size="small"
            placeholder="Search by name, barangay, or resident number..."
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>, sx: { borderRadius: 2.5 } } }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }} label="Status" sx={{ borderRadius: 2 }}>
              <MenuItem value="">All Status</MenuItem>
              <MenuItem value="Active">Active</MenuItem>
              <MenuItem value="Inactive">Inactive</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Risk Level</InputLabel>
            <Select value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(0); }} label="Risk Level" sx={{ borderRadius: 2 }}>
              <MenuItem value="">All Risks</MenuItem>
              {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        {/* Grid view */}
        {viewMode === 'grid' ? (
          <Grid container spacing={2.5}>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={i}>
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 2.5 }}>
                      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Skeleton variant="circular" width={48} height={48} />
                        <Box sx={{ flex: 1 }}><Skeleton width="80%" /><Skeleton width="60%" /></Box>
                      </Box>
                      <Skeleton width="40%" height={24} />
                    </CardContent>
                  </Card>
                </Grid>
              ))
            ) : residents.length === 0 ? (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ py: 12, textAlign: 'center' }}>
                  <Person sx={{ fontSize: 64, opacity: 0.2, mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">No residents found</Typography>
                </Box>
              </Grid>
            ) : (
              <AnimatePresence>
                {residents.map((r, i) => {
                  const color = getAvatarColor(`${r.firstName}${r.lastName}`);
                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={r.id}>
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
                        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', cursor: 'pointer',
                          '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 10px 24px ${color}25`, borderColor: color },
                          transition: 'all 0.2s' }}
                          onClick={() => setViewResident(r)}>
                          <CardContent sx={{ p: 2.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar sx={{ bgcolor: color, width: 46, height: 46, fontWeight: 700, fontSize: '0.98rem' }}>
                                  {getInitials(r.firstName, r.lastName)}
                                </Avatar>
                                <Box>
                                  <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', lineHeight: 1.2 }}>{r.firstName} {r.lastName}</Typography>
                                  <Typography sx={{ fontSize: '0.82rem' }} color="text.secondary">{r.residentNumber}</Typography>
                                </Box>
                              </Box>
                              <IconButton size="small" onClick={e => openMenu(e, r)} sx={{ mt: -0.5 }}>
                                <MoreVert fontSize="small" />
                              </IconButton>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                              <Chip label={r.riskLevel} size="small"
                                sx={{ bgcolor: getRiskBgColor(r.riskLevel), color: getRiskColor(r.riskLevel), fontWeight: 700, fontSize: '0.78rem' }} />
                              <Chip label={r.status} size="small"
                                sx={{ bgcolor: r.status === 'Active' ? '#dcfce7' : '#f3f4f6', color: r.status === 'Active' ? '#15803d' : '#6b7280', fontWeight: 700, fontSize: '0.78rem' }} />
                            </Box>

                            <Divider sx={{ mb: 1.5 }} />
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              <Typography sx={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 0.75 }} color="text.secondary">
                                <Person sx={{ fontSize: 13 }} />{r.age} yrs · {r.gender}
                              </Typography>
                              <Typography sx={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 0.75 }} color="text.secondary">
                                <LocationOn sx={{ fontSize: 13 }} />{r.barangay}
                              </Typography>
                              {r.contactNumber && (
                                <Typography sx={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 0.75 }} color="text.secondary">
                                  <Phone sx={{ fontSize: 13 }} />{r.contactNumber}
                                </Typography>
                              )}
                            </Box>

                            {(r._count?.cases ?? 0) > 0 && (
                              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Badge badgeContent={r._count?.cases} color="warning">
                                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600 }} color="text.secondary">
                                    <FolderOpen sx={{ fontSize: 13, mr: 0.5, verticalAlign: 'middle' }} />
                                    Active Cases
                                  </Typography>
                                </Badge>
                              </Box>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    </Grid>
                  );
                })}
              </AnimatePresence>
            )}

            {/* Grid pagination */}
            {!isLoading && total > rowsPerPage && (
              <Grid size={{ xs: 12 }}>
                <TablePagination component="div" count={total} page={page}
                  onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
                  rowsPerPageOptions={[8, 16, 32]} />
              </Grid>
            )}
          </Grid>
        ) : (
          /* Table view */
          <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
            <CardContent sx={{ p: 3 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', bgcolor: 'action.hover', py: 1.2 } }}>
                      <TableCell>Resident</TableCell>
                      <TableCell>Age / Gender</TableCell>
                      <TableCell>Barangay</TableCell>
                      <TableCell>Contact</TableCell>
                      <TableCell>Risk Level</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Cases</TableCell>
                      <TableCell>Registered</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {isLoading ? (
                      [...Array(8)].map((_, i) => (
                        <TableRow key={i}>
                          {[...Array(9)].map((_, j) => <TableCell key={j}><Skeleton height={30} /></TableCell>)}
                        </TableRow>
                      ))
                    ) : residents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} sx={{ textAlign: 'center', py: 8 }}>
                          <Person sx={{ fontSize: 48, opacity: 0.2, mb: 1, display: 'block', mx: 'auto' }} />
                          <Typography color="text.secondary">No residents found</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      residents.map((r) => {
                        const color = getAvatarColor(`${r.firstName}${r.lastName}`);
                        return (
                          <TableRow key={r.id} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, '& td': { py: 1.4, fontSize: '0.9rem' } }}
                            onClick={() => setViewResident(r)}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar sx={{ bgcolor: color, width: 34, height: 34, fontSize: '0.82rem', fontWeight: 700, flexShrink: 0 }}>
                                  {getInitials(r.firstName, r.lastName)}
                                </Avatar>
                                <Box>
                                  <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.firstName} {r.lastName}</Typography>
                                  <Typography sx={{ fontSize: '0.78rem' }} color="text.secondary">{r.residentNumber}</Typography>
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell>{r.age} / {r.gender}</TableCell>
                            <TableCell>{r.barangay}</TableCell>
                            <TableCell sx={{ maxWidth: 160 }}>
                              <Box>
                                {r.contactNumber && <Typography sx={{ fontSize: '0.86rem' }}>{r.contactNumber}</Typography>}
                                {r.email && <Typography sx={{ fontSize: '0.82rem' }} color="text.secondary">{r.email}</Typography>}
                                {!r.contactNumber && !r.email && <Typography color="text.disabled" sx={{ fontSize: '0.86rem' }}>—</Typography>}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip label={r.riskLevel} size="small"
                                sx={{ bgcolor: getRiskBgColor(r.riskLevel), color: getRiskColor(r.riskLevel), fontWeight: 700, fontSize: '0.78rem' }} />
                            </TableCell>
                            <TableCell>
                              <Chip label={r.status} size="small"
                                sx={{ bgcolor: r.status === 'Active' ? '#dcfce7' : '#f3f4f6', color: r.status === 'Active' ? '#15803d' : '#6b7280', fontWeight: 700, fontSize: '0.78rem' }} />
                            </TableCell>
                            <TableCell>
                              {(r._count?.cases ?? 0) > 0 ? (
                                <Chip icon={<FolderOpen sx={{ fontSize: '12px !important' }} />} label={r._count?.cases} size="small"
                                  color="warning" variant="outlined" sx={{ fontSize: '0.78rem' }} />
                              ) : <Typography color="text.disabled" sx={{ fontSize: '0.86rem' }}>0</Typography>}
                            </TableCell>
                            <TableCell>{new Date(r.registeredAt).toLocaleDateString()}</TableCell>
                            <TableCell align="right" onClick={e => e.stopPropagation()}>
                              <IconButton size="small" onClick={e => openMenu(e, r)}>
                                <MoreVert fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination component="div" count={total} page={page}
                onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
                onRowsPerPageChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
                rowsPerPageOptions={[5, 10, 25, 50]} />
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Row action menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { elevation: 4, sx: { borderRadius: 2, minWidth: 160 } } }}>
        <MuiMenuItem onClick={() => { setViewResident(menuResident); setMenuAnchor(null); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Visibility fontSize="small" /> View Profile
        </MuiMenuItem>
        <MuiMenuItem onClick={() => { setEditResident(menuResident); setMenuAnchor(null); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Edit fontSize="small" /> Edit
        </MuiMenuItem>
        <Divider />
        <MuiMenuItem onClick={() => { setDeleteResident(menuResident); setMenuAnchor(null); }} sx={{ gap: 1.5, fontSize: '0.94rem', color: 'error.main' }}>
          <Delete fontSize="small" /> Delete
        </MuiMenuItem>
      </Menu>

      {/* Dialogs */}
      <ResidentFormDialog
        open={addOpen} mode="add"
        onClose={() => setAddOpen(false)}
        onSaved={() => { mutateResidents(); refreshResidents(); }}
      />
      <ResidentFormDialog
        open={Boolean(editResident)} mode="edit" initialData={editResident ?? undefined}
        onClose={() => setEditResident(null)}
        onSaved={() => { mutateResidents(); refreshResidents(); }}
      />
      <ViewResidentDialog
        resident={viewResident}
        onClose={() => setViewResident(null)}
        onEdit={r => { setViewResident(null); setEditResident(r); }}
        onDelete={r => { setViewResident(null); setDeleteResident(r); }}
      />
      <DeleteConfirmDialog
        resident={deleteResident}
        onClose={() => setDeleteResident(null)}
        onConfirm={() => deleteResident && handleDelete(deleteResident)}
      />
    </DashboardLayout>
  );
}

// ─── Add / Edit form dialog ─────────────────────────────────────────────────
function ResidentFormDialog({
  open, mode, initialData, onClose, onSaved,
}: {
  open: boolean; mode: 'add' | 'edit';
  initialData?: Resident | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<ResidentFormData>(emptyForm);
  const [errors, setErrors] = useState<Partial<ResidentFormData>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialData ? residentToForm(initialData) : emptyForm);
      setErrors({});
    }
  }, [open, initialData]);

  function setField(key: keyof ResidentFormData, val: string) {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: '' }));
  }

  function validate(): boolean {
    const e: Partial<ResidentFormData> = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    if (!form.age || isNaN(Number(form.age)) || Number(form.age) < 0 || Number(form.age) > 130) e.age = 'Valid age required (0–130)';
    if (!form.gender) e.gender = 'Gender is required';
    if (!form.barangay) e.barangay = 'Barangay is required';
    if (!form.address.trim()) e.address = 'Address is required';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email address';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        age: Number(form.age),
        gender: form.gender,
        barangay: form.barangay,
        address: form.address.trim(),
        contactNumber: form.contactNumber.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
        riskLevel: form.riskLevel,
        notes: form.notes.trim() || null,
        ...(mode === 'add' ? { residentNumber: `RES-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}` } : {}),
      };

      const url = mode === 'add' ? '/api/residents' : `/api/residents/${initialData?.id}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        toast.success(mode === 'add' ? `${form.firstName} ${form.lastName} registered!` : 'Resident updated!');
        onSaved();
        onClose();
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        {mode === 'add' ? 'Register New Resident' : 'Edit Resident'}
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {/* Personal Information */}
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2, mt: 1 }} color="primary">
          Personal Information
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth label="First Name" size="small" required
              value={form.firstName} onChange={e => setField('firstName', e.target.value)}
              error={Boolean(errors.firstName)} helperText={errors.firstName}
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth label="Last Name" size="small" required
              value={form.lastName} onChange={e => setField('lastName', e.target.value)}
              error={Boolean(errors.lastName)} helperText={errors.lastName}
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField fullWidth label="Age" size="small" type="number" required
              value={form.age} onChange={e => setField('age', e.target.value)}
              error={Boolean(errors.age)} helperText={errors.age}
              slotProps={{ input: { sx: { borderRadius: 2 }, inputProps: { min: 0, max: 130 } } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small" required error={Boolean(errors.gender)}>
              <InputLabel>Gender</InputLabel>
              <Select value={form.gender} onChange={e => setField('gender', e.target.value)} label="Gender" sx={{ borderRadius: 2 }}>
                {GENDERS.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
              </Select>
              {errors.gender && <FormHelperText>{errors.gender}</FormHelperText>}
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small" required error={Boolean(errors.barangay)}>
              <InputLabel>Barangay</InputLabel>
              <Select value={form.barangay} onChange={e => setField('barangay', e.target.value)} label="Barangay" sx={{ borderRadius: 2 }}>
                {BARANGAYS.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
              </Select>
              {errors.barangay && <FormHelperText>{errors.barangay}</FormHelperText>}
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Complete Address" size="small" required
              value={form.address} onChange={e => setField('address', e.target.value)}
              error={Boolean(errors.address)} helperText={errors.address}
              placeholder="House/Unit #, Street, Purok..."
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
        </Grid>

        <Divider sx={{ mb: 2.5 }} />

        {/* Contact Information */}
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2 }} color="primary">
          Contact Information
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth label="Contact Number" size="small"
              value={form.contactNumber} onChange={e => setField('contactNumber', e.target.value)}
              placeholder="09XX XXX XXXX"
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Phone sx={{ fontSize: 16 }} /></InputAdornment>, sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth label="Email Address" size="small" type="email"
              value={form.email} onChange={e => setField('email', e.target.value)}
              error={Boolean(errors.email)} helperText={errors.email}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Email sx={{ fontSize: 16 }} /></InputAdornment>, sx: { borderRadius: 2 } } }} />
          </Grid>
        </Grid>

        <Divider sx={{ mb: 2.5 }} />

        {/* Classification */}
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2 }} color="primary">
          Classification
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={form.status} onChange={e => setField('status', e.target.value)} label="Status" sx={{ borderRadius: 2 }}>
                <MenuItem value="Active">Active</MenuItem>
                <MenuItem value="Inactive">Inactive</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Risk Level</InputLabel>
              <Select value={form.riskLevel} onChange={e => setField('riskLevel', e.target.value)} label="Risk Level" sx={{ borderRadius: 2 }}>
                {RISK_LEVELS.map(r => (
                  <MenuItem key={r} value={r}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: getRiskColor(r) }} />
                      {r}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Notes / Remarks" size="small" multiline rows={3}
              value={form.notes} onChange={e => setField('notes', e.target.value)}
              placeholder="Additional observations, case background, special conditions..."
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}
          sx={{ borderRadius: 2, textTransform: 'none', minWidth: 130 }}>
          {saving ? (mode === 'add' ? 'Registering...' : 'Saving...') : (mode === 'add' ? 'Register Resident' : 'Save Changes')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── View profile dialog ────────────────────────────────────────────────────
function ViewResidentDialog({
  resident, onClose, onEdit, onDelete,
}: {
  resident: Resident | null; onClose: () => void;
  onEdit: (r: Resident) => void; onDelete: (r: Resident) => void;
}) {
  const [cases, setCases] = useState<ResidentCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [caseRefresh, setCaseRefresh] = useState(0);
  const [addCaseOpen, setAddCaseOpen] = useState(false);

  useEffect(() => {
    if (!resident) { setCases([]); return; }
    setCasesLoading(true);
    fetch(`/api/residents/${resident.id}`)
      .then(r => r.json())
      .then(d => setCases(d.data?.cases ?? []))
      .catch(() => {})
      .finally(() => setCasesLoading(false));
  }, [resident?.id, caseRefresh]);

  if (!resident) return null;
  const color = getAvatarColor(`${resident.firstName}${resident.lastName}`);
  const fullName = `${resident.firstName} ${resident.lastName}`;

  function caseStatusColor(status: string) {
    if (status === 'Open') return { bg: '#dbeafe', text: '#1d4ed8' };
    if (status === 'Resolved') return { bg: '#dcfce7', text: '#15803d' };
    if (status === 'Closed') return { bg: '#f3f4f6', text: '#6b7280' };
    return { bg: '#fef3c7', text: '#92400e' };
  }

  return (
    <>
    <Dialog open={Boolean(resident)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogContent sx={{ p: 0 }}>
        {/* Header banner */}
        <Box sx={{ background: `linear-gradient(135deg, ${color}dd, ${color}88)`, p: 3, pb: 2, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', width: 64, height: 64, fontWeight: 700, fontSize: '1.2rem', border: '3px solid rgba(255,255,255,0.4)' }}>
            {getInitials(resident.firstName, resident.lastName)}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: 'white', lineHeight: 1.2 }}>
              {resident.firstName} {resident.lastName}
            </Typography>
            <Typography sx={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.8)', mt: 0.25 }}>{resident.residentNumber}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
              <Chip label={resident.riskLevel} size="small"
                sx={{ bgcolor: getRiskBgColor(resident.riskLevel), color: getRiskColor(resident.riskLevel), fontWeight: 700, fontSize: '0.78rem' }} />
              <Chip label={resident.status} size="small"
                sx={{ bgcolor: resident.status === 'Active' ? '#dcfce7' : '#f3f4f6', color: resident.status === 'Active' ? '#15803d' : '#6b7280', fontWeight: 700, fontSize: '0.78rem' }} />
              {(resident._count?.cases ?? 0) > 0 && (
                <Chip icon={<Warning sx={{ fontSize: '12px !important', color: '#92400e !important' }} />}
                  label={`${resident._count?.cases} case${resident._count?.cases !== 1 ? 's' : ''}`} size="small"
                  sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 700, fontSize: '0.78rem' }} />
              )}
            </Box>
          </Box>
        </Box>

        <Box sx={{ p: 3 }}>
          {/* Info grid */}
          <Grid container spacing={2}>
            {[
              { icon: Person, label: 'Age & Gender', value: `${resident.age} years old · ${resident.gender}` },
              { icon: LocationOn, label: 'Barangay', value: resident.barangay },
              { icon: Home, label: 'Address', value: resident.address },
              ...(resident.contactNumber ? [{ icon: Phone, label: 'Contact Number', value: resident.contactNumber }] : []),
              ...(resident.email ? [{ icon: Email, label: 'Email', value: resident.email }] : []),
              { icon: CalendarToday, label: 'Registered', value: new Date(resident.registeredAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) },
            ].map(({ icon: Icon, label, value }) => (
              <Grid size={{ xs: 12, sm: 6 }} key={label}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon sx={{ fontSize: 16, color }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }} color="text.secondary">{label}</Typography>
                    <Typography sx={{ fontSize: '0.94rem' }}>{value}</Typography>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>

          {resident.notes && (
            <Box sx={{ mt: 2.5, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }} color="text.secondary">Notes</Typography>
              <Typography sx={{ fontSize: '0.94rem', lineHeight: 1.7 }}>{resident.notes}</Typography>
            </Box>
          )}

          {/* ── Cases section ── */}
          <Box sx={{ mt: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <FolderOpen sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }} color="text.secondary">
                Case Records
              </Typography>
              {cases.length > 0 && (
                <Chip label={cases.length} size="small" color="warning" sx={{ height: 22, fontSize: '0.72rem', '& .MuiChip-label': { px: 0.75 } }} />
              )}
              <Box sx={{ ml: 'auto' }}>
                <Button size="small" startIcon={<Add sx={{ fontSize: '14px !important' }} />} variant="outlined"
                  onClick={() => setAddCaseOpen(true)}
                  sx={{ borderRadius: 2, textTransform: 'none', fontSize: '0.82rem', py: 0.4, px: 1 }}>
                  Add Case
                </Button>
              </Box>
            </Box>

            {casesLoading ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...Array(2)].map((_, i) => <Skeleton key={i} height={64} sx={{ borderRadius: 2 }} />)}
              </Box>
            ) : cases.length === 0 ? (
              <Box sx={{ py: 2.5, textAlign: 'center', bgcolor: 'action.hover', borderRadius: 2 }}>
                <FolderOpen sx={{ fontSize: 28, opacity: 0.25, mb: 0.5, display: 'block', mx: 'auto' }} />
                <Typography sx={{ fontSize: '0.9rem' }} color="text.secondary">No cases on record for this resident</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {cases.map(c => {
                  const sc = caseStatusColor(c.status);
                  return (
                    <Box key={c.id} sx={{ p: 1.75, border: '1px solid', borderColor: 'divider', borderRadius: 2, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>{c.caseNumber}</Typography>
                          <Typography sx={{ fontSize: '0.82rem' }} color="text.secondary">·</Typography>
                          <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">{c.caseType}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} color="text.secondary">
                          {c.description}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', mt: 0.25 }} color="text.disabled">
                          Filed: {new Date(c.filedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flexShrink: 0 }}>
                        <Chip label={c.status} size="small" sx={{ height: 24, fontSize: '0.72rem', fontWeight: 700, bgcolor: sc.bg, color: sc.text, '& .MuiChip-label': { px: 0.75 } }} />
                        <Chip label={c.riskLevel} size="small" sx={{ height: 24, fontSize: '0.72rem', fontWeight: 700, bgcolor: getRiskBgColor(c.riskLevel), color: getRiskColor(c.riskLevel), '& .MuiChip-label': { px: 0.75 } }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Close</Button>
        <Button variant="outlined" color="error" startIcon={<Delete />} onClick={() => onDelete(resident)} sx={{ borderRadius: 2, textTransform: 'none' }}>Delete</Button>
        <Button variant="contained" startIcon={<Edit />} onClick={() => onEdit(resident)} sx={{ borderRadius: 2, textTransform: 'none' }}>Edit Profile</Button>
      </DialogActions>
    </Dialog>
    <AddResidentCaseDialog
      open={addCaseOpen}
      onClose={() => setAddCaseOpen(false)}
      residentId={resident.id}
      residentName={fullName}
      onCreated={() => {
        setCaseRefresh(r => r + 1);
        refreshResidents();
      }}
    />
    </>
  );
}

// ─── Add case from resident dialog ─────────────────────────────────────────
function AddResidentCaseDialog({
  open, onClose, residentId, residentName, onCreated,
}: {
  open: boolean; onClose: () => void;
  residentId: string; residentName: string;
  onCreated: () => void;
}) {
  const { data: users } = useUsers();
  const [form, setForm] = useState({
    caseType: '', riskLevel: 'Medium', status: 'Open',
    address: '', description: '', assignedToId: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ caseType: '', riskLevel: 'Medium', status: 'Open', address: '', description: '', assignedToId: '' });
  }, [open]);

  function setField(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function submit() {
    if (!form.caseType || !form.address.trim() || !form.description.trim()) {
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
          residentName,
          residentId,
          caseType: form.caseType,
          riskLevel: form.riskLevel,
          status: form.status,
          barangay: form.address,
          description: form.description,
          ...(form.assignedToId ? { assignedToId: form.assignedToId } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Case created!');
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
      <DialogTitle sx={{ fontWeight: 700 }}>New Case — {residentName}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small" required>
            <InputLabel>Case Type</InputLabel>
            <Select value={form.caseType} onChange={e => setField('caseType', e.target.value)} label="Case Type" sx={{ borderRadius: 2 }} disabled={saving}>
              {CASE_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Risk Level</InputLabel>
            <Select value={form.riskLevel} onChange={e => setField('riskLevel', e.target.value)} label="Risk Level" sx={{ borderRadius: 2 }} disabled={saving}>
              {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select value={form.status} onChange={e => setField('status', e.target.value)} label="Status" sx={{ borderRadius: 2 }} disabled={saving}>
              {CASE_STATUSES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Assigned Officer</InputLabel>
            <Select value={form.assignedToId} onChange={e => setField('assignedToId', e.target.value)} label="Assigned Officer" sx={{ borderRadius: 2 }} disabled={saving}>
              <MenuItem value="">Unassigned</MenuItem>
              {(users ?? []).map((u: { id: string; name: string }) => (
                <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <TextField label="Address" fullWidth size="small" required value={form.address} onChange={e => setField('address', e.target.value)}
          placeholder="House/Unit #, Street, Purok, Biñang 2nd..." disabled={saving}
          slotProps={{ input: { sx: { borderRadius: 2 } } }} />
        <TextField label="Case Description" fullWidth multiline rows={4} size="small" required value={form.description} onChange={e => setField('description', e.target.value)}
          placeholder="Describe the incident, observations, and immediate actions taken..." disabled={saving}
          slotProps={{ input: { sx: { borderRadius: 2 } } }} />
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

// ─── Delete confirm dialog ──────────────────────────────────────────────────
function DeleteConfirmDialog({
  resident, onClose, onConfirm,
}: {
  resident: Resident | null; onClose: () => void; onConfirm: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  }

  return (
    <Dialog open={Boolean(resident)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Delete sx={{ color: '#ef4444', fontSize: 20 }} />
        </Box>
        Remove Resident
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ fontSize: '0.94rem' }}>
          Are you sure you want to remove <strong>{resident?.firstName} {resident?.lastName}</strong> ({resident?.residentNumber}) from the system? This action cannot be undone.
        </DialogContentText>
        {(resident?._count?.cases ?? 0) > 0 && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 2, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Warning sx={{ color: '#f97316', fontSize: 18, flexShrink: 0, mt: 0.1 }} />
            <Typography sx={{ fontSize: '0.9rem', color: '#9a3412' }}>
              This resident has {resident?._count?.cases} associated case{resident?._count?.cases !== 1 ? 's' : ''}. The cases will remain but will be unlinked.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" color="error" onClick={confirm} disabled={deleting} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {deleting ? 'Removing...' : 'Remove Resident'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
