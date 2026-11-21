'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Button,
  Avatar, Skeleton, Divider, TextField, Alert, Chip,
} from '@mui/material';
import {
  Edit, Save, Cancel, Shield, Phone, Home,
  Email, Badge, CalendarToday,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import toast from 'react-hot-toast';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface ResidentProfile {
  id: string; residentNumber: string; firstName: string; lastName: string;
  age: number; gender: string; barangay: string; address: string;
  contactNumber: string; email: string; riskLevel: string;
  registeredAt: string;
  addressLine?: string; residencyStatusLabel?: string; verifiedResident?: boolean;
}

export default function ResidentProfilePage() {
  const { data: profile, isLoading, mutate } = useSWR<ResidentProfile>('/api/auth/resident-me', fetcher);
  // The resident's own counts, as on the dashboard (the endpoint returns only their cases).
  const { data: stats } = useSWR<{ total: number; pending: number; ongoing: number; resolved: number }>('/api/resident/cases/stats', fetcher);
  const { data: recentData } = useSWR<{ cases: { id: string; caseNumber: string; caseType: string; status: string; filedAt: string }[] }>('/api/resident/cases?limit=5', fetcher);
  const recent = recentData?.cases;
  const [editing, setEditing] = useState(false);
  // The contact number only: the residential address is changed under Residency, where it is verified again.
  const [form, setForm] = useState({ contactNumber: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setForm({ contactNumber: profile?.contactNumber ?? '' });
    setEditing(true);
    setError('');
  };
  const cancelEdit = () => { setEditing(false); setError(''); };

  const saveEdit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/resident-me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Update failed'); setSaving(false); return; }
      await mutate();
      setEditing(false);
      toast.success('Profile updated');
    } catch { setError('Network error'); }
    setSaving(false);
  };

  const initials = profile ? `${profile.firstName[0]}${profile.lastName[0]}` : 'R';
  const fullName = profile ? `${profile.firstName} ${profile.lastName}` : '';

  const infoFields = [
    { icon: Badge, label: 'Resident Number', value: profile?.residentNumber ?? '—' },
    { icon: Email, label: 'Email Address', value: profile?.email ?? '—' },
    { icon: CalendarToday, label: 'Age / Gender', value: profile ? `${profile.age} years old · ${profile.gender}` : '—' },
    { icon: Home, label: 'Barangay', value: profile?.barangay ?? '—' },
    { icon: CalendarToday, label: 'Registered Since', value: profile ? new Date(profile.registeredAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
  ];

  return (
    // The whole width: it used to stop at 900px and leave most of a large screen empty.
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>My Profile</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Your resident account information</Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Profile card */}
        <Grid size={{ xs: 12, md: 4, xl: 3 }} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Card>
            <CardContent sx={{ p: 3, textAlign: 'center' }}>
              {isLoading ? (
                <>
                  <Skeleton variant="circular" width={80} height={80} sx={{ mx: 'auto', mb: 2 }} />
                  <Skeleton variant="text" width={140} sx={{ mx: 'auto' }} height={26} />
                  <Skeleton variant="text" width={100} sx={{ mx: 'auto' }} height={20} />
                </>
              ) : (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
                  <Avatar sx={{ width: 80, height: 80, bgcolor: '#14b8a6', fontSize: '1.6rem', fontWeight: 700, mx: 'auto', mb: 2, boxShadow: '0 8px 24px rgba(20,184,166,0.35)' }}>
                    {initials}
                  </Avatar>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: '#0c1e46', mb: 2 }}>{fullName}</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifyContent: 'center', mb: 0.75 }}>
                    <Shield sx={{ fontSize: 14, color: '#14b8a6' }} />
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Barangay Management Portal</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                    {profile?.barangay ?? 'Barangay Resident'}
                  </Typography>
                </motion.div>
              )}
            </CardContent>
          </Card>

          {/* The resident's reports at a glance - the same counts as the dashboard. */}
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 1.5 }}>My Reports</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.25 }}>
                {[
                  { label: 'Total', value: stats?.total, color: '#14b8a6' },
                  { label: 'Pending', value: stats?.pending, color: '#f59e0b' },
                  { label: 'Ongoing', value: stats?.ongoing, color: '#3b82f6' },
                  { label: 'Resolved', value: stats?.resolved, color: '#22c55e' },
                ].map(s => (
                  <Box key={s.label} sx={{ border: '1px solid #f1f5f9', borderRadius: 2, p: 1.25 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>{s.label}</Typography>
                    {stats ? <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: s.color, lineHeight: 1.2 }}>{s.value ?? 0}</Typography>
                      : <Skeleton variant="text" width={30} height={30} />}
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" href="/resident/my-cases" sx={{ borderColor: '#99f6e4', color: '#0f766e', fontWeight: 600, flex: 1 }}>My Cases</Button>
                <Button size="small" variant="contained" href="/resident/report-case" sx={{ bgcolor: '#14b8a6', fontWeight: 600, flex: 1, '&:hover': { bgcolor: '#0d9488' } }}>File a Report</Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Info / edit */}
        <Grid size={{ xs: 12, md: 8, xl: 9 }} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Personal Information</Typography>
                {!editing && !isLoading && (
                  <Button startIcon={<Edit sx={{ fontSize: 15 }} />} size="small" onClick={startEdit}
                    sx={{ color: '#14b8a6', fontWeight: 600, fontSize: '0.9rem', '&:hover': { bgcolor: 'rgba(20,184,166,0.06)' } }}>
                    Edit
                  </Button>
                )}
              </Box>

              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

              {/* Side by side on a wide screen, one under another on a phone. */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, columnGap: 3 }}>
              {infoFields.map(f => (
                <Box key={f.label} sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start', minWidth: 0 }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px' }}>
                    <f.icon sx={{ fontSize: 16, color: '#64748b' }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</Typography>
                    {isLoading ? <Skeleton variant="text" width={180} height={20} />
                      : <Typography sx={{ fontSize: '0.94rem', color: '#0c1e46', fontWeight: 500, overflowWrap: 'anywhere' }}>{f.value}</Typography>}
                  </Box>
                </Box>
              ))}
              </Box>

              <Divider sx={{ my: 2 }} />

              {editing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
                  <TextField label="Contact Number" value={form.contactNumber}
                    onChange={e => setForm(p => ({ ...p, contactNumber: e.target.value }))} fullWidth size="small" />
                  <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
                    To change your residential address, go to <a href="/resident/residency" style={{ color: '#0f766e', fontWeight: 700 }}>Residency</a> - a new address is verified again by the barangay.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button variant="contained" onClick={saveEdit} disabled={saving} startIcon={<Save sx={{ fontSize: 16 }} />}
                      sx={{ bgcolor: '#14b8a6', fontWeight: 600, '&:hover': { bgcolor: '#0d9488' }, flex: 1 }}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </Button>
                    <Button variant="outlined" onClick={cancelEdit} startIcon={<Cancel sx={{ fontSize: 16 }} />}
                      sx={{ borderColor: '#e2e8f0', color: '#64748b' }}>
                      Cancel
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Grid container spacing={2}>
                  {[
                    { icon: Phone, label: 'Contact Number', value: profile?.contactNumber ?? '—' },
                    { icon: Home, label: `Home Address${profile?.residencyStatusLabel ? ` (${profile.residencyStatusLabel})` : ''}`, value: profile?.addressLine ?? profile?.address ?? '—' },
                  ].map(f => (
                    <Grid key={f.label} size={{ xs: 12, sm: 6 }}>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px' }}>
                          <f.icon sx={{ fontSize: 16, color: '#64748b' }} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</Typography>
                          {isLoading ? <Skeleton variant="text" width={140} height={20} />
                            : <Typography sx={{ fontSize: '0.94rem', color: '#0c1e46', fontWeight: 500 }}>{f.value}</Typography>}
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>

          {/* Their latest reports, under their details - the same list as the dashboard's, shorter. */}
          <Card>
            <CardContent sx={{ p: 2.5, pb: '12px !important' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>My Latest Reports</Typography>
                <Button size="small" href="/resident/my-cases" sx={{ color: '#0f766e', fontWeight: 600 }}>See all</Button>
              </Box>
              {!recent ? <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
                : recent.length === 0 ? (
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8', py: 2 }}>You have not filed a report yet.</Typography>
                ) : recent.map(c => (
                  <Box key={c.id} component="a" href="/resident/my-cases"
                    sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(150px, auto) 1fr auto auto' }, alignItems: 'center', columnGap: 2, rowGap: 0.25,
                      py: 1.1, borderTop: '1px solid #f1f5f9', color: 'inherit', textDecoration: 'none', '&:hover': { bgcolor: '#f8fafc' } }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: '#0c1e46', whiteSpace: 'nowrap' }}>#{c.caseNumber}</Typography>
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>{c.caseType}</Typography>
                    <Chip size="small" label={c.status} sx={{ height: 22, fontSize: '0.74rem', fontWeight: 700, bgcolor: '#f1f5f9', color: '#475569', justifySelf: 'start' }} />
                    <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>
                      {new Date(c.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Typography>
                  </Box>
                ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
