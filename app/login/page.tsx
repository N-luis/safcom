'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Button, Typography, Container, Grid,
  Chip, IconButton,
  Dialog, DialogContent, TextField, InputAdornment, CircularProgress,
  Alert, useMediaQuery, useTheme, Tabs, Tab, Collapse, Divider,
} from '@mui/material';
import {
  Shield, ArrowForward,
  Lock, Speed, VerifiedUser,
  MenuOpen, Close,
  Visibility, VisibilityOff,
  Person, AdminPanelSettings, Badge as BadgeIcon, Security,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@clerk/nextjs';
import toast from 'react-hot-toast';
import ResendVerification from '@/components/auth/ResendVerification';

const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Password required'),
});
type LoginForm = z.infer<typeof loginSchema>;

// Shared dark-on-navy field styling for both forms in the dialog.
const darkField = {
  '& .MuiOutlinedInput-root': {
    color: 'white',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.4)' },
    '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#60a5fa' },
  '& .MuiFormHelperText-root': { color: '#f87171' },
};

const STAFF_ROLES = [
  { icon: AdminPanelSettings, label: 'Barangay Captain' },
  { icon: BadgeIcon, label: 'Blotter Officer' },
  { icon: Security, label: 'VAWC Officer' },
  { icon: Shield, label: 'System Admin' },
];

function roleHome(role: string): string {
  if (role === 'vawc_officer' || role === 'vawc' || role === 'vawc_lead') return '/vawc';
  if (role === 'officer' || role === 'blotter_officer') return '/blotter-officer';
  if (role === 'system_admin') return '/admin';
  return '/dashboard';
}

// ─── Resident sign-in (Clerk) ────────────────────────────────────────────────
// Residents authenticate with Clerk. /complete-profile is the landing point:
// it exchanges the Clerk session for the app's resident_token and forwards to
// the portal, or collects the barangay profile if this is their first sign-in.
function ResidentPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [legacyOpen, setLegacyOpen] = useState(false);

  const go = (path: string) => { onClose(); router.push(path); };

  return (
    <Box>
      <Box sx={{
        display: 'flex', gap: 1.25, alignItems: 'flex-start',
        p: 1.75, mb: 2.5, borderRadius: 2.5,
        background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.2)',
      }}>
        <VerifiedUser sx={{ fontSize: 18, color: '#2dd4bf', mt: '1px', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.86rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
          Resident accounts are secured by <strong style={{ color: '#5eead4' }}>Clerk</strong>, which
          verifies your email address before you can file a report.
        </Typography>
      </Box>

      <Button
        variant="contained" size="large" fullWidth
        disabled={!isLoaded}
        onClick={() => go(isSignedIn ? '/complete-profile' : '/sign-in')}
        endIcon={isLoaded ? <ArrowForward /> : undefined}
        sx={{
          py: 1.4, fontWeight: 700,
          background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
          boxShadow: '0 6px 20px rgba(20,184,166,0.35)',
          '&:hover': { background: 'linear-gradient(135deg, #0d9488, #0f766e)' },
        }}
      >
        {!isLoaded
          ? <CircularProgress size={22} color="inherit" />
          : isSignedIn ? 'Continue to My Portal' : 'Sign In as Resident'}
      </Button>

      {isLoaded && isSignedIn && (
        <Typography sx={{ mt: 1.25, textAlign: 'center', fontSize: '0.82rem', color: '#5eead4' }}>
          You&apos;re already signed in with Clerk.
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 2.5 }}>
        <Divider sx={{ flex: 1, borderColor: 'rgba(255,255,255,0.12)' }} />
        <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)' }}>NEW HERE?</Typography>
        <Divider sx={{ flex: 1, borderColor: 'rgba(255,255,255,0.12)' }} />
      </Box>

      <Button
        variant="outlined" fullWidth onClick={() => go('/sign-up')}
        sx={{
          py: 1.1, fontWeight: 600, borderColor: 'rgba(255,255,255,0.25)', color: 'white',
          '&:hover': { borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)' },
        }}
      >
        Create a Resident Account
      </Button>

      {/* Accounts created before the Clerk migration still hold a local password. */}
      <Box sx={{ mt: 2.5, textAlign: 'center' }}>
        <Button
          size="small" onClick={() => setLegacyOpen(o => !o)}
          sx={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)', textTransform: 'none', '&:hover': { color: 'rgba(255,255,255,0.75)' } }}
        >
          {legacyOpen ? 'Hide password sign-in' : 'Registered before? Use your password'}
        </Button>
      </Box>
      <Collapse in={legacyOpen} unmountOnExit>
        <Box sx={{ mt: 1.5, pt: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <LegacyResidentForm />
        </Box>
      </Collapse>
    </Box>
  );
}

// Password sign-in for residents who registered before Clerk. Kept here rather
// than on the staff form so the two account types never share a code path.
function LegacyResidentForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError(''); setUnverifiedEmail('');
    try {
      const res = await fetch('/api/auth/resident-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Welcome back, ${json.data.resident.name}!`);
        router.push('/resident');
        return;
      }
      if (json.code === 'EMAIL_NOT_VERIFIED') { setUnverifiedEmail(data.email); return; }
      setError(json.error || 'Invalid email or password');
    } catch {
      setError('Network error. Please try again.');
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      {error && <Alert severity="error" sx={{ borderRadius: 2, fontSize: '0.9rem' }}>{error}</Alert>}
      {unverifiedEmail && (
        <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.9rem' }}>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, mb: 0.5 }}>
            Verify your email before signing in.
          </Typography>
          <ResendVerification email={unverifiedEmail} size="small" />
        </Alert>
      )}
      <TextField
        label="Email or Username" type="text" size="small" {...register('email')}
        error={!!errors.email} helperText={errors.email?.message}
        fullWidth autoComplete="username" sx={darkField}
      />
      <TextField
        label="Password" type={showPassword ? 'text' : 'password'} size="small" {...register('password')}
        error={!!errors.password} helperText={errors.password?.message}
        fullWidth autoComplete="current-password" sx={darkField}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPassword(p => !p)} edge="end" size="small" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                  {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      <Button
        type="submit" variant="outlined" fullWidth disabled={isSubmitting}
        sx={{ py: 1, fontWeight: 600, borderColor: 'rgba(255,255,255,0.25)', color: 'white', '&:hover': { borderColor: 'rgba(255,255,255,0.5)' } }}
      >
        {isSubmitting ? <CircularProgress size={20} color="inherit" /> : 'Sign In with Password'}
      </Button>
    </Box>
  );
}

// ─── Official sign-in (no Clerk) ─────────────────────────────────────────────
// VAWC, Blotter, Barangay Captain and System Admin accounts are issued by the
// administrator and authenticate against safcom_token only — Clerk is never
// involved, so this form talks to /api/auth/login and nothing else.
function OfficialPanel() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Welcome back, ${json.data.user.name}!`);
        router.push(roleHome((json.data.user.role as string) ?? ''));
        return;
      }
      setError(json.error || 'Invalid credentials for an official account');
    } catch {
      setError('Network error. Please try again.');
    }
  };

  return (
    <Box>
      <Box sx={{
        display: 'flex', gap: 1.25, alignItems: 'flex-start',
        p: 1.75, mb: 2.5, borderRadius: 2.5,
        background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
      }}>
        <Lock sx={{ fontSize: 18, color: '#60a5fa', mt: '1px', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.86rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
          Use the credentials issued by your System Admin. Official accounts
          don&apos;t use Clerk.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
        {STAFF_ROLES.map(({ icon: Icon, label }) => (
          <Chip
            key={label} size="small" icon={<Icon sx={{ fontSize: '13px !important', color: '#93c5fd !important' }} />} label={label}
            sx={{
              height: 24, fontSize: '0.78rem', fontWeight: 600,
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </Box>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error" sx={{ borderRadius: 2, fontSize: '0.9rem' }}>{error}</Alert>}
        <TextField
          label="Email or Username" type="text" {...register('email')}
          error={!!errors.email} helperText={errors.email?.message}
          fullWidth autoComplete="username" sx={darkField}
        />
        <TextField
          label="Password" type={showPassword ? 'text' : 'password'} {...register('password')}
          error={!!errors.password} helperText={errors.password?.message}
          fullWidth autoComplete="current-password" sx={darkField}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword(p => !p)} edge="end" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Button
          type="submit" variant="contained" size="large" fullWidth disabled={isSubmitting}
          sx={{
            mt: 0.5, py: 1.4, fontWeight: 700,
            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            boxShadow: '0 6px 20px rgba(59,130,246,0.4)',
            '&:hover': { background: 'linear-gradient(135deg, #2563eb, #1e40af)' },
          }}
        >
          {isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
        </Button>
      </Box>

      <Typography sx={{ mt: 2.5, textAlign: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
        You&apos;ll be taken to your module automatically based on your role.
      </Typography>
    </Box>
  );
}

// ─── Login Dialog ─────────────────────────────────────────────────────────────
function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'resident' | 'official'>('resident');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(135deg, #0c1e46 0%, #071739 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
          },
        },
      }}
    >
      <DialogContent sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -1 }}>
          <IconButton onClick={onClose} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
            <Close fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ textAlign: 'center', mb: 2.5 }}>
          <Box sx={{
            width: 56, height: 56, borderRadius: 2.5, mx: 'auto', mb: 2,
            background: tab === 'resident'
              ? 'linear-gradient(135deg, #14b8a6, #0d9488)'
              : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: tab === 'resident' ? '0 8px 20px rgba(20,184,166,0.4)' : '0 8px 20px rgba(59,130,246,0.4)',
            transition: 'background 0.3s ease',
          }}>
            <Shield sx={{ color: 'white', fontSize: 28 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, color: 'white', fontSize: '1.3rem' }}>Sign In</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.94rem', mt: 0.5 }}>
            Residents and barangay officials sign in separately
          </Typography>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{
            mb: 3, minHeight: 0,
            borderRadius: 2, background: 'rgba(255,255,255,0.05)', p: 0.5,
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              textTransform: 'none', fontWeight: 700, fontSize: '0.9rem',
              minHeight: 0, py: 1, borderRadius: 1.5, color: 'rgba(255,255,255,0.5)',
              transition: 'all 0.2s ease',
            },
            '& .Mui-selected': {
              color: '#fff !important',
              background: tab === 'resident' ? 'rgba(20,184,166,0.9)' : 'rgba(59,130,246,0.9)',
            },
          }}
        >
          <Tab value="resident" icon={<Person sx={{ fontSize: 17 }} />} iconPosition="start" label="Resident" />
          <Tab value="official" icon={<Shield sx={{ fontSize: 16 }} />} iconPosition="start" label="Official" />
        </Tabs>

        {tab === 'resident' ? <ResidentPanel onClose={onClose} /> : <OfficialPanel />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', background: '#f4f7fb', fontFamily: '"Inter", sans-serif', overflowX: 'hidden' }}>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* ── NAVBAR ──────────────────────────────────────────────────────── */}
      <Box
        component={motion.nav}
        initial={{ y: -80 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        sx={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
          background: scrolled ? 'rgba(7,23,57,0.95)' : 'linear-gradient(180deg, rgba(7,23,57,0.98) 0%, rgba(7,23,57,0.85) 100%)',
          backdropFilter: 'blur(12px)',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.08)' : 'none',
          transition: 'all 0.3s ease',
          px: { xs: 2, md: 4 }, py: 1.5,
        }}
      >
        <Box sx={{ maxWidth: 1280, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(59,130,246,0.4)' }}>
              <Shield sx={{ color: 'white', fontSize: 22 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, color: 'white', fontSize: '1.1rem', lineHeight: 1.1 }}>SafCom</Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {!isMobile && (
              <Button
                variant="outlined"
                onClick={() => router.push('/register')}
                sx={{ borderColor: 'rgba(255,255,255,0.3)', color: 'white', borderRadius: 2, fontWeight: 600, px: 2, py: 0.9, '&:hover': { borderColor: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.07)' }, transition: 'all 0.2s ease' }}
              >
                Create Account
              </Button>
            )}
            {isMobile && (
              <IconButton onClick={() => setMobileMenuOpen(o => !o)} sx={{ color: 'white' }}>
                {mobileMenuOpen ? <Close /> : <MenuOpen />}
              </IconButton>
            )}
          </Box>
        </Box>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
              <Box sx={{ py: 2, borderTop: '1px solid rgba(255,255,255,0.1)', mt: 1.5 }}>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Button fullWidth variant="outlined" onClick={() => router.push('/register')} sx={{ borderColor: 'rgba(255,255,255,0.3)', color: 'white', fontWeight: 600 }}>Create Account</Button>
                  <Button fullWidth variant="contained" onClick={() => { setLoginOpen(true); setMobileMenuOpen(false); }} sx={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', fontWeight: 600 }}>Sign In</Button>
                </Box>
              </Box>
            </motion.div>
          )}
        </AnimatePresence>
      </Box>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #071739 0%, #0c2461 50%, #1a3a6b 100%)', display: 'flex', alignItems: 'center', pt: { xs: 10, md: 0 }, position: 'relative', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {[...Array(3)].map((_, i) => (
            <Box key={i} component={motion.div} animate={{ scale: [1, 1.1, 1], opacity: [0.03, 0.07, 0.03] }} transition={{ duration: 8 + i * 2, repeat: Infinity, delay: i * 2 }}
              sx={{ position: 'absolute', width: { xs: 300 + i * 100, md: 500 + i * 150 }, height: { xs: 300 + i * 100, md: 500 + i * 150 }, borderRadius: '50%', background: i === 0 ? 'radial-gradient(circle, rgba(59,130,246,1) 0%, transparent 70%)' : i === 1 ? 'radial-gradient(circle, rgba(139,92,246,1) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(6,182,212,1) 0%, transparent 70%)', top: i === 0 ? '-10%' : i === 1 ? '40%' : '60%', left: i === 0 ? '-5%' : i === 1 ? '60%' : '20%' }} />
          ))}
          <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        </Box>

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1, py: { xs: 6, md: 8 } }}>
          <Grid container spacing={6} sx={{ alignItems: 'center' }}>
            <Grid size={12}>
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}>
                <Chip icon={<Shield sx={{ fontSize: 14, color: '#60a5fa !important' }} />} label="Barangay Biñang 2nd Public Safety Office"
                  sx={{ mb: 3, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', fontWeight: 600, fontSize: '0.86rem', '& .MuiChip-icon': { color: '#60a5fa' } }} />
                <Typography variant="h2" sx={{ fontWeight: 800, color: 'white', lineHeight: 1.15, fontSize: { xs: '2.2rem', md: '3rem', lg: '3.5rem' }, mb: 2 }}>
                  Community Safety{' '}
                  <Box component="span" sx={{ background: 'linear-gradient(135deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Management</Box>{' '}
                  System
                </Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: { xs: '1rem', md: '1.15rem' }, lineHeight: 1.75, mb: 4, maxWidth: 520 }}>
                  SafCom centralizes incident reporting, case tracking, VAWC management, and AI-powered risk analytics for Barangay Biñang 2nd&apos;s public safety officers — all in one secure platform.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 5 }}>
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                    <Button variant="contained" size="large" onClick={() => setLoginOpen(true)} endIcon={<ArrowForward />}
                      sx={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', px: 3.5, py: 1.5, fontWeight: 700, fontSize: '1rem', boxShadow: '0 8px 30px rgba(59,130,246,0.4)', '&:hover': { background: 'linear-gradient(135deg, #2563eb, #1e40af)' } }}>
                      Sign In
                    </Button>
                  </motion.div>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                  {[{ icon: Lock, text: 'Secure & Encrypted' }, { icon: VerifiedUser, text: 'Role-Based Access' }, { icon: Speed, text: 'Real-Time Updates' }].map(item => (
                    <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                      <item.icon sx={{ fontSize: 16, color: '#60a5fa' }} />
                      <Typography sx={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>{item.text}</Typography>
                    </Box>
                  ))}
                </Box>
              </motion.div>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <Box sx={{ background: '#040f24', py: 5 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 3, textAlign: { xs: 'center', sm: 'left' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 34, height: 34, borderRadius: 2, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield sx={{ color: 'white', fontSize: 18 }} />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 700, color: 'white', fontSize: '0.98rem' }}>SafCom</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, textTransform: 'uppercase' }}>Community Safety Platform</Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.86rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>© 2025 Barangay Biñang 2nd Public Safety Office. All rights reserved.</Typography>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
