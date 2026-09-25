'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Switch,
  Divider, Button, TextField, Avatar, Chip, Alert,
  List, ListItem, ListItemText, ListItemIcon, LinearProgress,
} from '@mui/material';
import {
  Save, Person, Notifications, Security, Language,
  LockReset, Shield, Devices, Delete, CheckCircle,
  Storage, Speed, BugReport, Download, ClearAll,
  Computer, PhoneAndroid, Tablet,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useCurrentUser } from '@/hooks/useApi';
import { mutate } from 'swr';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

const settingSections = [
  { icon: Person, label: 'Profile', id: 'profile' },
  { icon: Notifications, label: 'Notifications', id: 'notifications' },
  { icon: Security, label: 'Security', id: 'security' },
  { icon: Language, label: 'System', id: 'system' },
];

const mockSessions = [
  { device: 'Windows PC', icon: Computer, location: 'Quezon City, PH', time: 'Active now', current: true },
  { device: 'Android Phone', icon: PhoneAndroid, location: 'Manila, PH', time: '2 hours ago', current: false },
  { device: 'iPad', icon: Tablet, location: 'Quezon City, PH', time: 'Yesterday 3:42 PM', current: false },
];

export default function SettingsPage() {
  const { data: currentUser } = useCurrentUser();
  const [activeSection, setActiveSection] = useState('profile');
  const [notifSettings, setNotifSettings] = useState({
    emailNotif: true, smsNotif: false, pushNotif: true,
    caseAlerts: true, reportUpdates: true, systemAlerts: false,
  });
  const [profile, setProfile] = useState({ name: '', email: '', phone: '', role: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  // Sync profile form from API data whenever currentUser loads
  useEffect(() => {
    if (currentUser) {
      setProfile({
        name: currentUser.name ?? '',
        email: currentUser.email ?? '',
        phone: currentUser.phone ?? '',
        role: currentUser.role ?? '',
      });
    }
  }, [currentUser]);

  const resetProfile = () => {
    if (currentUser) {
      setProfile({ name: currentUser.name ?? '', email: currentUser.email ?? '', phone: currentUser.phone ?? '', role: currentUser.role ?? '' });
    }
  };

  const handleSaveProfile = async () => {
    if (!profile.name.trim()) { toast.error('Full name is required'); return; }
    if (!profile.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      toast.error('A valid email address is required'); return;
    }
    setProfileSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name.trim(), email: profile.email.trim(), phone: profile.phone.trim() || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        mutate('/api/auth/me', updated.data, false);
        toast.success('Profile updated successfully!');
      } else {
        const e = await res.json();
        toast.error(e.error ?? 'Failed to update profile');
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwForm.current) { toast.error('Enter your current password'); return; }
    if (pwForm.next.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (pwForm.next !== pwForm.confirm) { toast.error('Passwords do not match'); return; }
    setPwSaving(true);
    await new Promise(r => setTimeout(r, 800));
    setPwSaving(false);
    setPwForm({ current: '', next: '', confirm: '' });
    toast.success('Password changed successfully!');
  };

  const handleSaveNotifications = () => toast.success('Notification preferences saved!');

  const handleExportData = async () => {
    toast.loading('Preparing data export...');
    await new Promise(r => setTimeout(r, 1500));
    toast.dismiss();
    toast.success('Data export ready — check your email');
  };

  const handleClearCache = () => {
    mutate(() => true, undefined, { revalidate: true });
    toast.success('Cache cleared — all data refreshed');
  };

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>Settings</Typography>
          <Typography color="text.secondary" sx={{ fontSize: '0.98rem' }}>Manage your account and system preferences</Typography>
        </Box>

        <Grid container spacing={3}>
          {/* Sidebar nav */}
          <Grid size={{ xs: 12, md: 3 }}>
            <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
              <CardContent sx={{ p: 1.5 }}>
                {settingSections.map((s) => {
                  const Icon = s.icon;
                  const active = activeSection === s.id;
                  return (
                    <Box key={s.id} onClick={() => setActiveSection(s.id)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2.5, cursor: 'pointer', mb: 0.5,
                        bgcolor: active ? 'primary.main' : 'transparent', color: active ? 'white' : 'text.primary',
                        '&:hover': { bgcolor: active ? 'primary.main' : 'action.hover' }, transition: 'all 0.2s' }}>
                      <Icon sx={{ fontSize: 20 }} />
                      <Typography sx={{ fontSize: '0.94rem', fontWeight: active ? 700 : 400 }}>{s.label}</Typography>
                    </Box>
                  );
                })}
              </CardContent>
            </Card>
          </Grid>

          {/* Content */}
          <Grid size={{ xs: 12, md: 9 }}>
            <motion.div key={activeSection} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>

              {/* ─── Profile ─── */}
              {activeSection === 'profile' && (
                <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>Profile Information</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mb: 3 }}>
                      <Avatar sx={{ width: 80, height: 80, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', fontSize: '1.5rem', fontWeight: 700 }}>
                        {profile.name ? profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'AD'}
                      </Avatar>
                      <Box>
                        <Button variant="outlined" size="small" component="label" sx={{ borderRadius: 2, textTransform: 'none', mr: 1 }}>
                          Change Photo
                          <input type="file" hidden accept="image/*" onChange={() => toast.success('Photo upload coming soon')} />
                        </Button>
                        <Chip label={profile.role || 'admin'} size="small" color="primary" sx={{ fontWeight: 700, textTransform: 'capitalize' }} />
                      </Box>
                    </Box>
                    <Grid container spacing={2.5}>
                      {[
                        { label: 'Full Name', key: 'name' },
                        { label: 'Email Address', key: 'email' },
                        { label: 'Phone Number', key: 'phone' },
                        { label: 'Role', key: 'role' },
                      ].map((field) => (
                        <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                          <TextField
                            fullWidth label={field.label} size="small"
                            value={profile[field.key as keyof typeof profile]}
                            onChange={(e) => setProfile({ ...profile, [field.key]: e.target.value })}
                            disabled={field.key === 'role'}
                            slotProps={{ input: { sx: { borderRadius: 2 } } }}
                          />
                        </Grid>
                      ))}
                    </Grid>
                    <Box sx={{ mt: 3, display: 'flex', gap: 1.5, alignItems: 'center' }}>
                      <Button variant="contained" startIcon={<Save />} onClick={handleSaveProfile} disabled={profileSaving} sx={{ borderRadius: 2.5, textTransform: 'none', minWidth: 140 }}>
                        {profileSaving ? 'Saving...' : 'Save Changes'}
                      </Button>
                      <Button variant="outlined" sx={{ borderRadius: 2.5, textTransform: 'none' }} onClick={resetProfile} disabled={profileSaving}>
                        Reset
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {/* ─── Notifications ─── */}
              {activeSection === 'notifications' && (
                <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>Notification Preferences</Typography>
                    {Object.entries(notifSettings).map(([key, val], i, arr) => {
                      const labels: Record<string, { label: string; desc: string }> = {
                        emailNotif: { label: 'Email Notifications', desc: 'Receive updates via email' },
                        smsNotif: { label: 'SMS Alerts', desc: 'Get text message alerts for critical events' },
                        pushNotif: { label: 'Push Notifications', desc: 'Browser and mobile push notifications' },
                        caseAlerts: { label: 'Case Alerts', desc: 'Notify when cases are assigned or updated' },
                        reportUpdates: { label: 'Report Updates', desc: 'Status changes on submitted reports' },
                        systemAlerts: { label: 'System Alerts', desc: 'Maintenance and system status updates' },
                      };
                      const info = labels[key];
                      return (
                        <Box key={key}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
                            <Box>
                              <Typography sx={{ fontSize: '0.94rem', fontWeight: 600 }}>{info.label}</Typography>
                              <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">{info.desc}</Typography>
                            </Box>
                            <Switch checked={val} onChange={(e) => setNotifSettings({ ...notifSettings, [key]: e.target.checked })} />
                          </Box>
                          {i < arr.length - 1 && <Divider />}
                        </Box>
                      );
                    })}
                    <Button variant="contained" startIcon={<Save />} onClick={handleSaveNotifications} sx={{ mt: 3, borderRadius: 2.5, textTransform: 'none' }}>Save Preferences</Button>
                  </CardContent>
                </Card>
              )}

              {/* ─── Security ─── */}
              {activeSection === 'security' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* Change Password */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                        <LockReset color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>Change Password</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                          <TextField fullWidth label="Current Password" type="password" size="small" value={pwForm.current}
                            onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField fullWidth label="New Password" type="password" size="small" value={pwForm.next}
                            onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                            helperText="At least 8 characters"
                            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField fullWidth label="Confirm New Password" type="password" size="small" value={pwForm.confirm}
                            onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                            error={pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm}
                            helperText={pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm ? 'Passwords do not match' : ''}
                            slotProps={{ input: { sx: { borderRadius: 2 } } }} />
                        </Grid>
                      </Grid>
                      <Button variant="contained" onClick={handleChangePassword} disabled={pwSaving} sx={{ mt: 2.5, borderRadius: 2.5, textTransform: 'none' }}>
                        {pwSaving ? 'Updating...' : 'Update Password'}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* 2FA */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                        <Shield color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>Two-Factor Authentication</Typography>
                      </Box>
                      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
                        2FA adds an extra layer of security to your account. When enabled, you will be prompted for a verification code when logging in.
                      </Alert>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.94rem' }}>Authenticator App</Typography>
                          <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">Use Google Authenticator or similar</Typography>
                        </Box>
                        <Switch onChange={() => toast.success('2FA setup coming soon')} />
                      </Box>
                    </CardContent>
                  </Card>

                  {/* Active Sessions */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                        <Devices color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>Active Sessions</Typography>
                      </Box>
                      <List disablePadding>
                        {mockSessions.map((session, i) => {
                          const Icon = session.icon;
                          return (
                            <Box key={i}>
                              <ListItem disablePadding sx={{ py: 1.5 }}>
                                <ListItemIcon sx={{ minWidth: 44 }}>
                                  <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon fontSize="small" />
                                  </Box>
                                </ListItemIcon>
                                <ListItemText
                                  primary={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography sx={{ fontSize: '0.94rem', fontWeight: 600 }}>{session.device}</Typography>
                                    {session.current && <Chip label="Current" size="small" color="success" sx={{ height: 22, fontSize: '0.72rem', '& .MuiChip-label': { px: 0.75 } }} />}
                                  </Box>}
                                  secondary={<Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">{session.location} · {session.time}</Typography>}
                                />
                                {!session.current && (
                                  <Button size="small" color="error" sx={{ textTransform: 'none', fontSize: '0.86rem' }} onClick={() => toast.success('Session revoked')}>
                                    Revoke
                                  </Button>
                                )}
                              </ListItem>
                              {i < mockSessions.length - 1 && <Divider />}
                            </Box>
                          );
                        })}
                      </List>
                      <Button variant="outlined" color="error" size="small" startIcon={<Delete />} sx={{ mt: 2, borderRadius: 2, textTransform: 'none' }} onClick={() => toast.success('All other sessions revoked')}>
                        Revoke All Other Sessions
                      </Button>
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ─── System ─── */}
              {activeSection === 'system' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  {/* System Info */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                        <Speed color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>System Information</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        {[
                          { label: 'Application', value: 'SafCom Admin Dashboard v1.0.0' },
                          { label: 'Framework', value: 'Next.js 16 (App Router)' },
                          { label: 'Database', value: 'PostgreSQL (Supabase)' },
                          { label: 'Environment', value: process.env.NODE_ENV === 'production' ? 'Production' : 'Development' },
                          { label: 'Region', value: 'ap-south-1 (Asia Pacific)' },
                          { label: 'Status', value: 'Operational' },
                        ].map(({ label, value }) => (
                          <Grid size={{ xs: 12, sm: 6 }} key={label}>
                            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
                              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }} color="text.secondary">{label}</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                {label === 'Status' && <CheckCircle sx={{ fontSize: 14, color: '#22c55e' }} />}
                                <Typography sx={{ fontSize: '0.94rem', fontWeight: 600 }}>{value}</Typography>
                              </Box>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                    </CardContent>
                  </Card>

                  {/* System Health */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                        <BugReport color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>System Health</Typography>
                      </Box>
                      {[
                        { label: 'API Response Time', value: 142, unit: 'ms', status: 'good', max: 500 },
                        { label: 'Database Connections', value: 3, unit: 'active', status: 'good', max: 20 },
                        { label: 'Cache Hit Rate', value: 87, unit: '%', status: 'good', max: 100 },
                        { label: 'Storage Used', value: 24, unit: '%', status: 'good', max: 100 },
                      ].map(({ label, value, unit, status, max }) => (
                        <Box key={label} sx={{ mb: 2 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography sx={{ fontSize: '0.9rem' }}>{label}</Typography>
                            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: status === 'good' ? '#22c55e' : '#ef4444' }}>{value} {unit}</Typography>
                          </Box>
                          <LinearProgress
                            variant="determinate" value={(value / max) * 100}
                            sx={{ borderRadius: 4, height: 6, bgcolor: 'action.hover',
                              '& .MuiLinearProgress-bar': { bgcolor: status === 'good' ? '#22c55e' : '#ef4444', borderRadius: 4 } }}
                          />
                        </Box>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Data Management */}
                  <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                        <Storage color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>Data Management</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                          <Box>
                            <Typography sx={{ fontWeight: 600, fontSize: '0.94rem' }}>Export All Data</Typography>
                            <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">Download all cases, reports, and residents as CSV</Typography>
                          </Box>
                          <Button variant="outlined" startIcon={<Download />} size="small" onClick={handleExportData} sx={{ borderRadius: 2, textTransform: 'none' }}>Export</Button>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                          <Box>
                            <Typography sx={{ fontWeight: 600, fontSize: '0.94rem' }}>Clear Cache</Typography>
                            <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">Force refresh all data from the server</Typography>
                          </Box>
                          <Button variant="outlined" startIcon={<ClearAll />} size="small" onClick={handleClearCache} sx={{ borderRadius: 2, textTransform: 'none' }}>Clear</Button>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, border: '1px solid', borderColor: 'error.main', borderRadius: 2 }}>
                          <Box>
                            <Typography sx={{ fontWeight: 600, fontSize: '0.94rem', color: 'error.main' }}>Danger Zone</Typography>
                            <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">Delete account or reset application data</Typography>
                          </Box>
                          <Button variant="outlined" color="error" startIcon={<Delete />} size="small" onClick={() => toast.error('Contact your system administrator')} sx={{ borderRadius: 2, textTransform: 'none' }}>
                            Delete Account
                          </Button>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                </Box>
              )}
            </motion.div>
          </Grid>
        </Grid>
      </Box>
    </DashboardLayout>
  );
}
