'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Button, Typography, TextField, InputAdornment, IconButton,
  CircularProgress, Alert, Divider,
} from '@mui/material';
import { Shield, Visibility, VisibilityOff, Person, Lock, ArrowForward } from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useAuth } from '@clerk/nextjs';
import toast from 'react-hot-toast';

const schema = z.object({
  email: z.string().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof schema>;

export default function ResidentLoginPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: LoginForm) => {
    setApiError('');
    try {
      const res = await fetch('/api/auth/resident-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) { setApiError(json.error || 'Login failed'); return; }
      toast.success(`Welcome back, ${json.data.resident.name}!`);
      router.push('/resident');
    } catch {
      setApiError('Network error. Please try again.');
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #071739 0%, #0c2461 60%, #1a3a6b 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      px: 2, position: 'relative', overflow: 'hidden',
    }}>
      {/* Background blobs */}
      {[0, 1].map(i => (
        <Box key={i} component={motion.div}
          animate={{ scale: [1, 1.1, 1], opacity: [0.05, 0.1, 0.05] }}
          transition={{ duration: 8 + i * 2, repeat: Infinity, delay: i * 3 }}
          sx={{
            position: 'absolute',
            width: 400 + i * 200, height: 400 + i * 200,
            borderRadius: '50%',
            background: i === 0
              ? 'radial-gradient(circle, rgba(59,130,246,1) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(20,184,166,1) 0%, transparent 70%)',
            top: i === 0 ? '-20%' : '60%',
            left: i === 0 ? '-10%' : '70%',
            pointerEvents: 'none',
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}
      >
        {/* Card */}
        <Box sx={{
          bgcolor: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 4,
          p: { xs: 3, sm: 4.5 },
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}>
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 3.5 }}>
            <Box sx={{
              width: 60, height: 60, borderRadius: 3, mx: 'auto', mb: 2,
              background: 'linear-gradient(135deg, #14b8a6, #0891b2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 10px 28px rgba(20,184,166,0.4)',
            }}>
              <Shield sx={{ color: 'white', fontSize: 30 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, color: 'white', fontSize: '1.4rem', mb: 0.25 }}>
              SafeComm
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', letterSpacing: 2, textTransform: 'uppercase' }}>
              Resident Portal
            </Typography>
          </Box>

          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.1rem', mb: 0.5 }}>
            Sign in to your account
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', mb: 3 }}>
            Access your reports and case status
          </Typography>

          {apiError && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.9rem' }}>
              {apiError}
            </Alert>
          )}

          {/* Residents authenticate with Clerk. Residents sent here by an expired
              session need this route back in; the password form below only
              serves accounts created before the Clerk migration. */}
          <Button
            fullWidth
            variant="contained"
            size="large"
            disabled={!isLoaded}
            onClick={() => router.push(isSignedIn ? '/complete-profile' : '/sign-in')}
            endIcon={isLoaded ? <ArrowForward /> : undefined}
            sx={{
              py: 1.5, fontWeight: 700, fontSize: '0.98rem',
              background: 'linear-gradient(135deg, #14b8a6, #0891b2)',
              boxShadow: '0 8px 24px rgba(20,184,166,0.4)',
              '&:hover': { background: 'linear-gradient(135deg, #0d9488, #0e7490)' },
            }}
          >
            {!isLoaded
              ? <CircularProgress size={22} color="inherit" />
              : isSignedIn ? 'Continue to My Portal' : 'Sign In as Resident'}
          </Button>

          <Divider sx={{ my: 2.5, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem', px: 1 }}>
              REGISTERED BEFORE?
            </Typography>
          </Divider>

          <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            <TextField
              label="Email or Username"
              type="text"
              {...register('email')}
              error={!!errors.email}
              helperText={errors.email?.message}
              fullWidth
              autoComplete="email"
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start"><Person sx={{ fontSize: 18, color: 'rgba(255,255,255,0.35)' }} /></InputAdornment>,
                },
              }}
              sx={{
                '& .MuiOutlinedInput-root': { color: 'white', '& fieldset': { borderColor: 'rgba(255,255,255,0.18)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused fieldset': { borderColor: '#14b8a6' } },
                '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.45)' },
                '& .MuiInputLabel-root.Mui-focused': { color: '#2dd4bf' },
                '& .MuiFormHelperText-root': { color: '#f87171' },
                '& .MuiInputAdornment-root': { color: 'rgba(255,255,255,0.35)' },
              }}
            />
            <TextField
              label="Password"
              type={showPw ? 'text' : 'password'}
              {...register('password')}
              error={!!errors.password}
              helperText={errors.password?.message}
              fullWidth
              autoComplete="current-password"
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start"><Lock sx={{ fontSize: 18, color: 'rgba(255,255,255,0.35)' }} /></InputAdornment>,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPw(p => !p)} edge="end" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                        {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                '& .MuiOutlinedInput-root': { color: 'white', '& fieldset': { borderColor: 'rgba(255,255,255,0.18)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused fieldset': { borderColor: '#14b8a6' } },
                '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.45)' },
                '& .MuiInputLabel-root.Mui-focused': { color: '#2dd4bf' },
                '& .MuiFormHelperText-root': { color: '#f87171' },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={isSubmitting}
              endIcon={!isSubmitting && <ArrowForward />}
              sx={{
                mt: 0.5, py: 1.5, fontWeight: 700, fontSize: '0.98rem',
                background: 'linear-gradient(135deg, #14b8a6, #0891b2)',
                boxShadow: '0 8px 24px rgba(20,184,166,0.4)',
                '&:hover': { background: 'linear-gradient(135deg, #0d9488, #0e7490)' },
                transition: 'all 0.2s',
              }}
            >
              {isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
            </Button>
          </Box>

          <Divider sx={{ my: 3, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.86rem', px: 1 }}>New here?</Typography>
          </Divider>

          <Button
            fullWidth
            variant="outlined"
            onClick={() => router.push('/register')}
            sx={{
              borderColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)',
              fontWeight: 600, py: 1.25,
              '&:hover': { borderColor: '#14b8a6', color: '#2dd4bf', bgcolor: 'rgba(20,184,166,0.06)' },
            }}
          >
            Create a Resident Account
          </Button>

          <Box sx={{ mt: 2.5, textAlign: 'center' }}>
            <Typography
              component="span"
              onClick={() => router.push('/login')}
              sx={{ fontSize: '0.86rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', '&:hover': { color: 'rgba(255,255,255,0.6)' }, transition: 'color 0.15s' }}
            >
              Officer / Admin? Sign in here →
            </Typography>
          </Box>
        </Box>
      </motion.div>
    </Box>
  );
}
