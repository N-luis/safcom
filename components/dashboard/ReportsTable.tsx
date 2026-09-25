'use client';

import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TablePagination, Chip, IconButton,
  Menu, MenuItem, TextField, InputAdornment, TableSortLabel, Divider,
  Button, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions,
  DialogContentText, Select, FormControl, InputLabel, Grid, Avatar,
} from '@mui/material';
import {
  Search, MoreVert, Visibility, Edit, Delete, Close,
  Person, LocationOn, CalendarToday, FolderOpen, Assignment,
} from '@mui/icons-material';
import { useCases, useUsers } from '@/hooks/useApi';
import { getStatusColor, getStatusBgColor, getRiskColor, getRiskBgColor } from '@/utils/helpers';
import toast from 'react-hot-toast';
import { mutate } from 'swr';

type SortDir = 'asc' | 'desc';

const CASE_TYPES = [
  'Domestic Violence', 'Child Neglect', 'Elder Abuse', 'Substance Abuse',
  'Mental Health', 'Community Conflict', 'Economic Crisis', 'Child Abuse',
  'Senior Welfare', 'Other',
];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

interface CaseData {
  id: string; caseNumber: string; residentName: string; caseType: string;
  status: string; riskLevel: string; barangay: string; description: string;
  notes: string | null; filedAt: string; resolvedAt: string | null;
  assignedTo: { id: string; name: string } | null;
}

interface EditForm {
  residentName: string; caseType: string; status: string; riskLevel: string;
  barangay: string; description: string; notes: string; assignedToId: string;
}

function getAvatarColor(name: string) {
  const colors = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#06b6d4'];
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function refreshCases() {
  mutate((k: unknown) => typeof k === 'string' && k.startsWith('/api/cases'), undefined, { revalidate: true });
}

export default function ReportsTable() {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState('filedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterStatus, setFilterStatus] = useState('All');

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [activeCase, setActiveCase] = useState<CaseData | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const statuses = ['All', ...STATUSES];

  const params: Record<string, string | number> = {
    page: page + 1, limit: rowsPerPage, sortBy: sortField, sortDir,
  };
  if (debouncedSearch) params.search = debouncedSearch;
  if (filterStatus !== 'All') params.status = filterStatus;

  const { data, isLoading } = useCases(params);
  const { data: users } = useUsers();
  const cases: CaseData[] = data?.cases ?? [];
  const total: number = data?.pagination?.total ?? 0;

  let searchTimer: ReturnType<typeof setTimeout>;
  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { setDebouncedSearch(val); setPage(0); }, 400);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(0);
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, c: CaseData) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setActiveCase(c);
  };

  const handleDeleteConfirmed = async () => {
    if (!activeCase) return;
    const res = await fetch(`/api/cases/${activeCase.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Case deleted');
      refreshCases();
    } else {
      toast.error('Delete failed — admin access required');
    }
    setDeleteOpen(false);
    setViewOpen(false);
  };

  const columns = [
    { id: 'residentName', label: 'Resident' },
    { id: 'caseType', label: 'Case Type' },
    { id: 'status', label: 'Status' },
    { id: 'riskLevel', label: 'Risk Level' },
    { id: 'filedAt', label: 'Date Filed' },
    { id: 'barangay', label: 'Address' },
  ];

  return (
    <>
      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Case Records</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.86rem' }}>{total} cases found</Typography>
            </Box>
            <TextField size="small" placeholder="Search cases..." value={search}
              onChange={e => handleSearch(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment>, sx: { borderRadius: 2.5, fontSize: '0.94rem' } } }}
              sx={{ width: 220 }} />
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            {statuses.map(s => (
              <Chip key={s} label={s} size="small" clickable
                onClick={() => { setFilterStatus(s); setPage(0); }}
                variant={filterStatus === s ? 'filled' : 'outlined'}
                color={filterStatus === s ? 'primary' : 'default'}
                sx={{ fontSize: '0.86rem', fontWeight: filterStatus === s ? 700 : 400 }} />
            ))}
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.86rem', bgcolor: 'action.hover', py: 1.2 } }}>
                  {columns.map(col => (
                    <TableCell key={col.id}>
                      <TableSortLabel active={sortField === col.id} direction={sortField === col.id ? sortDir : 'asc'} onClick={() => handleSort(col.id)}>
                        {col.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading
                  ? Array.from({ length: rowsPerPage }).map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(7)].map((_, j) => <TableCell key={j}><Skeleton /></TableCell>)}
                      </TableRow>
                    ))
                  : cases.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                          <FolderOpen sx={{ fontSize: 40, opacity: 0.2, display: 'block', mx: 'auto', mb: 1 }} />
                          <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>No cases match your filters</Typography>
                        </TableCell>
                      </TableRow>
                    )
                  : cases.map(c => (
                      <TableRow key={c.id}
                        onClick={() => { setActiveCase(c); setViewOpen(true); }}
                        sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, transition: 'background 0.15s', '& td': { py: 1.3, fontSize: '0.9rem' } }}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar sx={{ width: 30, height: 30, bgcolor: getAvatarColor(c.residentName), fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
                              {c.residentName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </Avatar>
                            <Box>
                              <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.residentName}</Typography>
                              <Typography sx={{ fontSize: '0.78rem' }} color="text.secondary">{c.caseNumber}</Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>{c.caseType}</TableCell>
                        <TableCell>
                          <Chip label={c.status} size="small"
                            sx={{ bgcolor: getStatusBgColor(c.status), color: getStatusColor(c.status), fontWeight: 700, fontSize: '0.78rem' }} />
                        </TableCell>
                        <TableCell>
                          <Chip label={c.riskLevel} size="small"
                            sx={{ bgcolor: getRiskBgColor(c.riskLevel), color: getRiskColor(c.riskLevel), fontWeight: 700, fontSize: '0.78rem' }} />
                        </TableCell>
                        <TableCell>{new Date(c.filedAt).toLocaleDateString()}</TableCell>
                        <TableCell>{c.barangay}</TableCell>
                        <TableCell align="center" onClick={e => e.stopPropagation()}>
                          <IconButton size="small" onClick={e => openMenu(e, c)}><MoreVert fontSize="small" /></IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination component="div" count={total} page={page}
            onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(+e.target.value); setPage(0); }}
            rowsPerPageOptions={[5, 10, 25]} />
        </CardContent>
      </Card>

      {/* Row action menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { elevation: 4, sx: { borderRadius: 2.5, minWidth: 160 } } }}>
        <MenuItem onClick={() => { setMenuAnchor(null); setViewOpen(true); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Visibility fontSize="small" color="primary" /> View Details
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); setEditOpen(true); }} sx={{ gap: 1.5, fontSize: '0.94rem' }}>
          <Edit fontSize="small" /> Edit Case
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); setDeleteOpen(true); }} sx={{ gap: 1.5, fontSize: '0.94rem', color: 'error.main' }}>
          <Delete fontSize="small" color="error" /> Delete
        </MenuItem>
      </Menu>

      {/* View dialog */}
      <ViewCaseDialog
        caseData={activeCase}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        onEdit={() => { setViewOpen(false); setEditOpen(true); }}
        onDelete={() => { setViewOpen(false); setDeleteOpen(true); }}
      />

      {/* Edit dialog */}
      <EditCaseDialog
        caseData={activeCase}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        users={users ?? []}
        onSaved={() => { setEditOpen(false); refreshCases(); }}
      />

      {/* Delete confirm */}
      <DeleteCaseDialog
        caseData={activeCase}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteConfirmed}
      />
    </>
  );
}

// ─── View Case Dialog ────────────────────────────────────────────────────────
function ViewCaseDialog({ caseData, open, onClose, onEdit, onDelete }: {
  caseData: CaseData | null; open: boolean;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  if (!caseData) return null;
  const color = getAvatarColor(caseData.residentName);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogContent sx={{ p: 0 }}>
        {/* Banner */}
        <Box sx={{ background: `linear-gradient(135deg, ${color}dd, ${color}88)`, p: 3, pb: 2.5, display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', width: 56, height: 56, fontWeight: 700, fontSize: '1.1rem', border: '2px solid rgba(255,255,255,0.4)', flexShrink: 0 }}>
            {caseData.residentName.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: 'white', lineHeight: 1.2 }}>{caseData.residentName}</Typography>
            <Typography sx={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.8)', mt: 0.25 }}>{caseData.caseNumber} · {caseData.caseType}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
              <Chip label={caseData.status} size="small" sx={{ bgcolor: getStatusBgColor(caseData.status), color: getStatusColor(caseData.status), fontWeight: 700, fontSize: '0.78rem' }} />
              <Chip label={caseData.riskLevel} size="small" sx={{ bgcolor: getRiskBgColor(caseData.riskLevel), color: getRiskColor(caseData.riskLevel), fontWeight: 700, fontSize: '0.78rem' }} />
            </Box>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.8)', mt: -0.5 }}><Close fontSize="small" /></IconButton>
        </Box>

        <Box sx={{ p: 3 }}>
          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            {[
              { icon: LocationOn, label: 'Address', value: caseData.barangay },
              { icon: Person, label: 'Assigned Officer', value: caseData.assignedTo?.name ?? 'Unassigned' },
              { icon: CalendarToday, label: 'Date Filed', value: new Date(caseData.filedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) },
              { icon: Assignment, label: 'Resolved', value: caseData.resolvedAt ? new Date(caseData.resolvedAt).toLocaleDateString() : '—' },
            ].map(({ icon: Icon, label, value }) => (
              <Grid size={{ xs: 12, sm: 6 }} key={label}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon sx={{ fontSize: 15, color }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }} color="text.secondary">{label}</Typography>
                    <Typography sx={{ fontSize: '0.94rem' }}>{value}</Typography>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>

          <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2, mb: caseData.notes ? 2 : 0 }}>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }} color="text.secondary">Description</Typography>
            <Typography sx={{ fontSize: '0.94rem', lineHeight: 1.7 }}>{caseData.description}</Typography>
          </Box>

          {caseData.notes && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }} color="text.secondary">Notes</Typography>
              <Typography sx={{ fontSize: '0.94rem', lineHeight: 1.7 }}>{caseData.notes}</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Close</Button>
        <Button variant="outlined" color="error" startIcon={<Delete />} onClick={onDelete} sx={{ borderRadius: 2, textTransform: 'none' }}>Delete</Button>
        <Button variant="contained" startIcon={<Edit />} onClick={onEdit} sx={{ borderRadius: 2, textTransform: 'none' }}>Edit Case</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Edit Case Dialog ────────────────────────────────────────────────────────
function EditCaseDialog({ caseData, open, onClose, users, onSaved }: {
  caseData: CaseData | null; open: boolean;
  onClose: () => void;
  users: { id: string; name: string; role: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditForm>({
    residentName: '', caseType: '', status: 'Open', riskLevel: 'Low',
    barangay: '', description: '', notes: '', assignedToId: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<EditForm>>({});

  useEffect(() => {
    if (open && caseData) {
      setForm({
        residentName: caseData.residentName,
        caseType: caseData.caseType,
        status: caseData.status,
        riskLevel: caseData.riskLevel,
        barangay: caseData.barangay,
        description: caseData.description,
        notes: caseData.notes ?? '',
        assignedToId: caseData.assignedTo?.id ?? '',
      });
      setErrors({});
    }
  }, [open, caseData]);

  function setField(key: keyof EditForm, val: string) {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: '' }));
  }

  function validate() {
    const e: Partial<EditForm> = {};
    if (!form.residentName.trim()) e.residentName = 'Required';
    if (!form.caseType) e.caseType = 'Required';
    if (!form.status) e.status = 'Required';
    if (!form.riskLevel) e.riskLevel = 'Required';
    if (!form.barangay) e.barangay = 'Required';
    if (!form.description.trim()) e.description = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validate() || !caseData) return;
    setSaving(true);
    try {
      const wasResolved = caseData.status === 'Resolved' || caseData.status === 'Closed';
      const nowResolved = form.status === 'Resolved' || form.status === 'Closed';

      const payload: Record<string, unknown> = {
        residentName: form.residentName.trim(),
        caseType: form.caseType,
        status: form.status,
        riskLevel: form.riskLevel,
        barangay: form.barangay,
        description: form.description.trim(),
        notes: form.notes.trim() || null,
        assignedToId: form.assignedToId || null,
      };

      if (nowResolved && !wasResolved) {
        payload.resolvedAt = new Date().toISOString();
      } else if (!nowResolved && wasResolved) {
        payload.resolvedAt = null;
      }

      const res = await fetch(`/api/cases/${caseData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(`Case ${caseData.caseNumber} updated!`);
        onSaved();
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Update failed');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          Edit Case
          {caseData && <Typography component="span" sx={{ fontSize: '0.9rem', fontWeight: 400, color: 'text.secondary', ml: 1.5 }}>{caseData.caseNumber}</Typography>}
        </Box>
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {/* Case Info */}
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2, mt: 1 }} color="primary">
          Case Information
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField fullWidth label="Resident Name" size="small" required
              value={form.residentName} onChange={e => setField('residentName', e.target.value)}
              error={Boolean(errors.residentName)} helperText={errors.residentName}
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small" required error={Boolean(errors.caseType)}>
              <InputLabel>Case Type</InputLabel>
              <Select value={form.caseType} onChange={e => setField('caseType', e.target.value)} label="Case Type" sx={{ borderRadius: 2 }}>
                {CASE_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small" required error={Boolean(errors.status)}>
              <InputLabel>Status</InputLabel>
              <Select value={form.status} onChange={e => setField('status', e.target.value)} label="Status" sx={{ borderRadius: 2 }}>
                {STATUSES.map(s => (
                  <MenuItem key={s} value={s}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: getStatusColor(s) }} />
                      {s}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small" required error={Boolean(errors.riskLevel)}>
              <InputLabel>Risk Level</InputLabel>
              <Select value={form.riskLevel} onChange={e => setField('riskLevel', e.target.value)} label="Risk Level" sx={{ borderRadius: 2 }}>
                {RISK_LEVELS.map(r => (
                  <MenuItem key={r} value={r}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: getRiskColor(r) }} />
                      {r}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Address" size="small" required
              value={form.barangay} onChange={e => setField('barangay', e.target.value)}
              error={Boolean(errors.barangay)} helperText={errors.barangay}
              placeholder="House/Unit #, Street, Purok, Binan 2nd..."
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Assigned Officer</InputLabel>
              <Select value={form.assignedToId} onChange={e => setField('assignedToId', e.target.value)} label="Assigned Officer" sx={{ borderRadius: 2 }}>
                <MenuItem value="">Unassigned</MenuItem>
                {users.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Divider sx={{ mb: 2.5 }} />

        {/* Description & Notes */}
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2 }} color="primary">
          Case Details
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Description" size="small" required multiline rows={4}
              value={form.description} onChange={e => setField('description', e.target.value)}
              error={Boolean(errors.description)} helperText={errors.description ?? 'Summary of the case, incident details, and immediate actions taken'}
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth label="Notes / Follow-up Remarks" size="small" multiline rows={3}
              value={form.notes} onChange={e => setField('notes', e.target.value)}
              placeholder="Additional observations, follow-up actions, case progress notes..."
              slotProps={{ input: { sx: { borderRadius: 2 } } }} />
          </Grid>
        </Grid>

        {/* Status change notice */}
        {(form.status === 'Resolved' || form.status === 'Closed') && caseData?.status !== 'Resolved' && caseData?.status !== 'Closed' && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: '#dcfce7', border: '1px solid #86efac', borderRadius: 2 }}>
            <Typography sx={{ fontSize: '0.9rem', color: '#15803d' }}>
              Setting status to <strong>{form.status}</strong> will record the resolution date as today.
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ borderRadius: 2, textTransform: 'none', minWidth: 140 }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Delete Confirm Dialog ───────────────────────────────────────────────────
function DeleteCaseDialog({ caseData, open, onClose, onConfirm }: {
  caseData: CaseData | null; open: boolean;
  onClose: () => void; onConfirm: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Delete sx={{ color: '#ef4444', fontSize: 20 }} />
        </Box>
        Delete Case
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ fontSize: '0.94rem' }}>
          Are you sure you want to delete case <strong>{caseData?.caseNumber}</strong> for <strong>{caseData?.residentName}</strong>? All activity logs for this case will also be removed. This cannot be undone.
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" color="error" onClick={confirm} disabled={deleting} sx={{ borderRadius: 2, textTransform: 'none' }}>
          {deleting ? 'Deleting...' : 'Delete Case'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
