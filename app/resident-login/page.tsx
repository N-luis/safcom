'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Button, Typography, TextField, InputAdornment, IconButton, CircularProgress, Alert, Divider } from '@mui/material';
import { Visibility, VisibilityOff, Person, Lock, ArrowForward } from '@mui/icons-material';
import toast from 'react-hot-toast';
import AuthShell, { authField, authPrimaryButton } from '@/components/auth/AuthShell';
import ResendVerification from '@/components/auth/ResendVerification';

/**
 * Resident sign-in (Supabase Auth, checked on the server by
 * /api/auth/resident-login, which sets SafeComm's own session cookie).
 * Where the portal sends a resident whose session ended.
 */
const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email'),
  password: z.string().min(1, 'Enter your password'),
});
type LoginForm = z.infer<typeof schema>;

export default function ResidentLoginPage() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [apiError, setApiError] = useState('');
  const [hint, setHint] = useState('');
  const [unverified, setUnverified] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: LoginForm) => {
    setApiError(''); setHint(''); setUnverified('');
    try {
      const res = await fetch('/api/auth/resident-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        toast.success(`Welcome back, ${json.data.resident.name}!`);
        router.push('/resident');
        return;
      }
      if (json.code === 'EMAIL_NOT_VERIFIED') { setUnverified(data.email); return; }
      setApiError(json.error || 'Sign-in failed');
      if (json.hint) setHint(json.hint);
    } catch {
      setApiError('Network error. Please try again.');
    }
  };

  return (
    <AuthShell title="Sign in to your account" subtitle="Access your reports, hearings and residency status.">
      {apiError && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.9rem' }}>
          {apiError}
          {hint && <Typography sx={{ fontSize: '0.82rem', mt: 0.5 }}>{hint}</Typography>}
        </Alert>
      )}
      {unverified && (
        <Alert severity="warning" sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.9rem' }}>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, mb: 0.5 }}>Confirm your email before signing in - open the link we sent you.</Typography>
          <ResendVerification email={unverified} size="small" />
        </Alert>
      )}
      <Box component="form" onSubmit={handleSubmit(onSubmit)} data-testid="resident-signin" sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        <TextField label="Email" type="text" {...register('email')} error={!!errors.email} helperText={errors.email?.message} fullWidth autoComplete="email"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Person sx={{ fontSize: 18 }} /></InputAdornment> } }} sx={authField} />
        <TextField label="Password" type={showPw ? 'text' : 'password'} {...register('password')} error={!!errors.password} helperText={errors.password?.message}
          fullWidth autoComplete="current-password" sx={authField}
          slotProps={{ input: {
            startAdornment: <InputAdornment position="start"><Lock sx={{ fontSize: 18 }} /></InputAdornment>,
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPw(p => !p)} edge="end" aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          } }} />
        <Button type="submit" variant="contained" size="large" fullWidth disabled={isSubmitting} endIcon={!isSubmitting && <ArrowForward />} sx={{ mt: 0.5, ...authPrimaryButton }}>
          {isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
        </Button>
      </Box>

      <Box sx={{ mt: 1.5, textAlign: 'center' }}>
        <Button size="small" onClick={() => router.push('/reset-password')} data-testid="forgot-password" sx={{ fontSize: '0.86rem', color: '#5eead4', textTransform: 'none' }}>
          Forgot password or set up
        </Button>
        <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
          Had an account before the new sign-in? Use this to choose a password - your profile and reports are kept.
        </Typography>
      </Box>

      <Divider sx={{ my: 3, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.86rem', px: 1 }}>New here?</Typography>
      </Divider>
      <Button fullWidth variant="outlined" onClick={() => router.push('/register')}
        sx={{ borderColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.8)', fontWeight: 600, py: 1.25, textTransform: 'none',
          '&:hover': { borderColor: '#14b8a6', color: '#2dd4bf', bgcolor: 'rgba(20,184,166,0.06)' } }}>
        Create a Resident Account
      </Button>
      <Box sx={{ mt: 2.5, textAlign: 'center' }}>
        <Button size="small" onClick={() => router.push('/login')} sx={{ fontSize: '0.86rem', color: 'rgba(255,255,255,0.45)', textTransform: 'none' }}>
          Officer / Admin? Sign in here →
        </Button>
      </Box>
    </AuthShell>
  );
}
