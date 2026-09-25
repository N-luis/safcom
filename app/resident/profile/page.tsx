'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button,
  Avatar, Skeleton, Divider, TextField, Alert, IconButton,
  CircularProgress, LinearProgress,
} from '@mui/material';
import {
  Person, Edit, Save, Cancel, CheckCircle, Shield, Phone, Home,
  Email, Badge, CalendarToday, CloudUpload, Close, InsertDriveFile,
  VerifiedUser, Schedule, Refresh,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import toast from 'react-hot-toast';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

interface ResidentProfile {
  id: string; residentNumber: string; firstName: string; lastName: string;
  age: number; gender: string; barangay: string; address: string;
  contactNumber: string; email: string; status: string; riskLevel: string;
  idDocument: string | null; registeredAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  Active: '#22c55e', Pending: '#f97316', Inactive: '#94a3b8', Rejected: '#ef4444',
};

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  Active: CheckCircle, Pending: Schedule, Inactive: Cancel, Rejected: Cancel,
};

const STATUS_MSG: Record<string, string> = {
  Active: 'Your identity has been verified by the barangay.',
  Pending: 'Your account is under review. A barangay officer will verify your ID within 24 hours.',
  Rejected: 'Your registration was rejected. Please upload a clearer, valid government ID and resubmit.',
  Inactive: 'Your account is currently inactive. Contact your barangay office for assistance.',
};

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|webp)$/i.test(url) || url.startsWith('/uploads/');
}

export default function ResidentProfilePage() {
  const { data: profile, isLoading, mutate } = useSWR<ResidentProfile>('/api/auth/resident-me', fetcher);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ contactNumber: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ID upload state
  const [idFile, setIdFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setForm({ contactNumber: profile?.contactNumber ?? '', address: profile?.address ?? '' });
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

  const validateFile = useCallback((f: File) => {
    if (f.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type)) {
      toast.error('Accepted: JPG, PNG, WEBP, PDF'); return;
    }
    setIdFile(f);
  }, []);

  const submitIdUpload = async () => {
    if (!idFile) return;
    setUploading(true);
    try {
      // 1. Upload file
      const form = new globalThis.FormData();
      form.append('file', idFile);
      const uploadRes = await fetch('/api/upload/id', { method: 'POST', body: form });
      if (!uploadRes.ok) { const e = await uploadRes.json(); toast.error(e.error ?? 'Upload failed'); return; }
      const { data: { url } } = await uploadRes.json();

      // 2. Update profile
      const patchRes = await fetch('/api/auth/resident-me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ idDocument: url }),
      });
      if (!patchRes.ok) { const e = await patchRes.json(); toast.error(e.error ?? 'Failed to save'); return; }

      await mutate();
      setIdFile(null);
      toast.success('ID submitted! Your account is now pending verification.');
    } catch { toast.error('Network error. Please try again.'); }
    finally { setUploading(false); }
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

  const StatusIcon = STATUS_ICON[profile?.status ?? 'Pending'] ?? CheckCircle;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>My Profile</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Your resident account information</Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Profile card */}
        <Grid size={{ xs: 12, md: 4 }}>
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
                  <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: '#0c1e46', mb: 0.5 }}>{fullName}</Typography>
                  <Chip
                    icon={<StatusIcon sx={{ fontSize: '14px !important' }} />}
                    label={profile?.status ?? 'Resident'}
                    size="small"
                    sx={{ bgcolor: `${STATUS_COLOR[profile?.status ?? 'Active']}15`, color: STATUS_COLOR[profile?.status ?? 'Active'], fontWeight: 700, fontSize: '0.82rem', mb: 2 }}
                  />
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

          {/* Verification status card */}
          {!isLoading && profile && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <Card sx={{ mt: 2, border: `1.5px solid ${STATUS_COLOR[profile.status] ?? '#94a3b8'}30` }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <VerifiedUser sx={{ fontSize: 18, color: STATUS_COLOR[profile.status] ?? '#94a3b8' }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>Verification Status</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#64748b', lineHeight: 1.6 }}>
                    {STATUS_MSG[profile.status] ?? ''}
                  </Typography>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </Grid>

        {/* Info / edit */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ mb: 2.5 }}>
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

              {infoFields.map(f => (
                <Box key={f.label} sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px' }}>
                    <f.icon sx={{ fontSize: 16, color: '#64748b' }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</Typography>
                    {isLoading ? <Skeleton variant="text" width={180} height={20} />
                      : <Typography sx={{ fontSize: '0.94rem', color: '#0c1e46', fontWeight: 500 }}>{f.value}</Typography>}
                  </Box>
                </Box>
              ))}

              <Divider sx={{ my: 2 }} />

              {editing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField label="Contact Number" value={form.contactNumber}
                    onChange={e => setForm(p => ({ ...p, contactNumber: e.target.value }))} fullWidth size="small" />
                  <TextField label="Home Address" value={form.address}
                    onChange={e => setForm(p => ({ ...p, address: e.target.value }))} fullWidth size="small" multiline rows={2} />
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
                    { icon: Home, label: 'Home Address', value: profile?.address ?? '—' },
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

          {/* ── ID Document Upload Card ── */}
          <Card sx={{
            border: profile?.idDocument
              ? `1.5px solid ${STATUS_COLOR[profile.status] ?? '#14b8a6'}30`
              : '1.5px dashed #e2e8f0',
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <VerifiedUser sx={{ fontSize: 16, color: '#22c55e' }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Government ID</Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>Required for account verification</Typography>
                  </Box>
                </Box>
                {profile?.idDocument && (
                  <Chip
                    label={profile.status === 'Active' ? 'Verified' : profile.status === 'Rejected' ? 'Rejected' : 'Under Review'}
                    size="small"
                    sx={{
                      bgcolor: `${STATUS_COLOR[profile.status] ?? '#94a3b8'}15`,
                      color: STATUS_COLOR[profile.status] ?? '#94a3b8',
                      fontWeight: 700, fontSize: '0.78rem', height: 24,
                    }}
                  />
                )}
              </Box>

              {/* Current ID display */}
              {isLoading ? (
                <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
              ) : profile?.idDocument ? (
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid #e2e8f0', bgcolor: '#f8fafc', p: 1.5, display: 'flex', gap: 2, alignItems: 'center' }}>
                    {isImageUrl(profile.idDocument) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.idDocument}
                        alt="Submitted ID"
                        style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #e2e8f0' }}
                      />
                    ) : (
                      <Box sx={{ width: 80, height: 60, borderRadius: 1.5, bgcolor: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <InsertDriveFile sx={{ color: '#3b82f6', fontSize: 28 }} />
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46', mb: 0.25 }}>
                        {isImageUrl(profile.idDocument) ? 'ID Document (Image)' : 'ID Document (PDF)'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', wordBreak: 'break-all' }}>
                        {profile.idDocument.split('/').pop()}
                      </Typography>
                      <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STATUS_COLOR[profile.status] ?? '#94a3b8' }} />
                        <Typography sx={{ fontSize: '0.78rem', color: STATUS_COLOR[profile.status] ?? '#94a3b8', fontWeight: 600 }}>
                          {profile.status === 'Active' ? 'ID Verified ✓' : profile.status === 'Rejected' ? 'Rejected — please resubmit' : 'Awaiting admin review'}
                        </Typography>
                      </Box>
                    </Box>
                    {isImageUrl(profile.idDocument) && (
                      <Button size="small" href={profile.idDocument} target="_blank" rel="noopener noreferrer"
                        sx={{ color: '#14b8a6', fontWeight: 600, fontSize: '0.86rem', flexShrink: 0 }}>
                        View
                      </Button>
                    )}
                  </Box>
                </Box>
              ) : null}

              {/* Upload area — show when no ID OR rejected */}
              {!isLoading && (profile?.status === 'Pending' && !profile.idDocument
                || profile?.status === 'Rejected'
                || !profile?.idDocument) && (
                <Box>
                  {profile?.status === 'Rejected' && (
                    <Alert severity="error" sx={{ mb: 2, borderRadius: 2, fontSize: '0.9rem' }}>
                      Your previous ID was rejected. Please upload a clearer, valid government-issued ID.
                    </Alert>
                  )}

                  <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) validateFile(f); }} />

                  <AnimatePresence mode="wait">
                    {idFile ? (
                      <motion.div key="preview" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, border: '2px solid #14b8a6', borderRadius: 2.5, bgcolor: 'rgba(20,184,166,0.04)', mb: 2 }}>
                          <Box sx={{ width: 48, height: 48, borderRadius: 1.5, overflow: 'hidden', flexShrink: 0, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {idFile.type.startsWith('image/')
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={URL.createObjectURL(idFile)} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover' }} />
                              : <InsertDriveFile sx={{ color: '#14b8a6', fontSize: 24 }} />}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idFile.name}</Typography>
                            <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{(idFile.size / 1024).toFixed(0)} KB · {idFile.type.split('/')[1]?.toUpperCase()}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CheckCircle sx={{ color: '#14b8a6', fontSize: 18 }} />
                            <IconButton size="small" onClick={() => setIdFile(null)} sx={{ color: '#9ca3af', '&:hover': { color: '#ef4444' } }}>
                              <Close fontSize="small" />
                            </IconButton>
                          </Box>
                        </Box>
                      </motion.div>
                    ) : (
                      <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <Box
                          onDragOver={e => { e.preventDefault(); setDrag(true); }}
                          onDragLeave={() => setDrag(false)}
                          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) validateFile(f); }}
                          onClick={() => fileRef.current?.click()}
                          sx={{
                            border: `2px dashed ${drag ? '#14b8a6' : '#d1d5db'}`,
                            borderRadius: 2.5, p: 3, textAlign: 'center', cursor: 'pointer',
                            bgcolor: drag ? 'rgba(20,184,166,0.04)' : '#fafafa',
                            '&:hover': { borderColor: '#14b8a6', bgcolor: 'rgba(20,184,166,0.04)' },
                            transition: 'all 0.2s', mb: 2,
                          }}
                        >
                          <CloudUpload sx={{ color: '#14b8a6', fontSize: 28, mb: 1 }} />
                          <Typography sx={{ fontWeight: 600, color: '#374151', fontSize: '0.94rem', mb: 0.5 }}>
                            {profile?.idDocument ? 'Replace ID Document' : 'Upload Government ID'}
                          </Typography>
                          <Typography sx={{ fontSize: '0.82rem', color: '#9ca3af' }}>
                            Drag & drop or click · JPG, PNG, PDF · max 5 MB
                          </Typography>
                        </Box>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {uploading && (
                    <Box sx={{ mb: 1.5 }}>
                      <LinearProgress sx={{ borderRadius: 4, height: 5, bgcolor: '#e2e8f0', '& .MuiLinearProgress-bar': { bgcolor: '#14b8a6' } }} />
                      <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mt: 0.5, textAlign: 'center' }}>Uploading…</Typography>
                    </Box>
                  )}

                  <Button variant="contained" fullWidth disabled={!idFile || uploading} onClick={submitIdUpload}
                    startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <Refresh sx={{ fontSize: 18 }} />}
                    sx={{ bgcolor: '#14b8a6', fontWeight: 600, borderRadius: 2, '&:hover': { bgcolor: '#0d9488' }, '&:disabled': { opacity: 0.6 } }}>
                    {uploading ? 'Uploading…' : profile?.idDocument ? 'Resubmit ID for Verification' : 'Submit ID for Verification'}
                  </Button>

                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mt: 1.5, textAlign: 'center', lineHeight: 1.6 }}>
                    Accepted: Passport · Driver&apos;s License · PhilSys ID · Voter&apos;s ID · UMID
                  </Typography>
                </Box>
              )}

              {/* Already verified — show resubmit option */}
              {!isLoading && profile?.status === 'Active' && profile.idDocument && (
                <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8', mt: 1, textAlign: 'center' }}>
                  Your ID is verified. Contact the barangay office to update your ID document.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
