'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box, Button, Typography, CircularProgress, TextField, Divider,
} from '@mui/material';
import {
  CheckCircle, ErrorOutlined, ScheduleOutlined, Shield, ArrowForward,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import ResendVerification from '@/components/auth/ResendVerification';

type State = 'loading' | 'success' | 'already_verified' | 'expired' | 'invalid' | 'missing';

const ACCENT = '#0a7c6b';

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  // Derived at first render — setting this inside the effect would cause a
  // cascading re-render before the first paint.
  const [state, setState] = useState<State>(token ? 'loading' : 'missing');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (cancelled) return;

        if (res.ok && json.success) {
          setState(json.data?.status === 'already_verified' ? 'already_verified' : 'success');
        } else if (res.status === 410) {
          setState('expired');
        } else {
          setState('invalid');
        }
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  const copy: Record<Exclude<State, 'loading'>, { icon: typeof CheckCircle; color: string; title: string; body: string; resend: boolean }> = {
    success: {
      icon: CheckCircle, color: '#22c55e', title: 'Email Verified!',
      body: 'Your SafeComm email address has been successfully verified. You can now log in to your account.',
      resend: false,
    },
    already_verified: {
      icon: CheckCircle, color: '#22c55e', title: 'Already Verified',
      body: 'This email address has already been verified. You can log in to your account.',
      resend: false,
    },
    expired: {
      icon: ScheduleOutlined, color: '#f97316', title: 'Verification Link Expired',
      body: 'This verification link has expired. Request a new one below.',
      resend: true,
    },
    invalid: {
      icon: ErrorOutlined, color: '#ef4444', title: 'Invalid Verification Link',
      body: 'This verification link is invalid or has already been used. Request a new one below.',
      resend: true,
    },
    missing: {
      icon: ErrorOutlined, color: '#ef4444', title: 'Missing Verification Link',
      body: 'No verification token was found in this link. Request a new one below.',
      resend: true,
    },
  };

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      px: 2, py: 6, background: 'linear-gradient(135deg, #071739 0%, #0c2461 60%, #1a3a6b 100%)',
    }}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ width: '100%', maxWidth: 480 }}>
        <Box sx={{ bgcolor: 'white', borderRadius: 4, p: { xs: 3, sm: 4.5 }, boxShadow: '0 30px 70px rgba(0,0,0,0.4)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25, mb: 3 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: '9px',
              background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield sx={{ fontSize: 18, color: 'white' }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#0c1e46' }}>SafeComm</Typography>
          </Box>

          {state === 'loading' ? (
            <Box sx={{ textAlign: 'center', py: 5 }}>
              <CircularProgress sx={{ color: ACCENT, mb: 2 }} />
              <Typography sx={{ fontSize: '0.98rem', color: '#64748b' }}>Verifying your email…</Typography>
            </Box>
          ) : (() => {
            const c = copy[state];
            const Icon = c.icon;
            return (
              <>
                <Box sx={{ textAlign: 'center' }}>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.12, type: 'spring', damping: 14 }}>
                    <Box sx={{
                      width: 76, height: 76, borderRadius: '50%', mx: 'auto', mb: 2.5,
                      bgcolor: `${c.color}14`, border: `2px solid ${c.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon sx={{ fontSize: 40, color: c.color }} />
                    </Box>
                  </motion.div>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', color: '#0c1e46', mb: 1 }}>{c.title}</Typography>
                  <Typography sx={{ fontSize: '0.94rem', color: '#64748b', lineHeight: 1.7, mb: 3 }}>{c.body}</Typography>
                </Box>

                {!c.resend && (
                  <Button fullWidth variant="contained" endIcon={<ArrowForward />}
                    onClick={() => router.push('/resident-login')}
                    sx={{ py: 1.4, borderRadius: 2.5, fontWeight: 700, textTransform: 'none',
                      background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`,
                      '&:hover': { background: 'linear-gradient(135deg, #065f50, #0d9488)' } }}>
                    Go to Login
                  </Button>
                )}

                {c.resend && (
                  <>
                    <Divider sx={{ mb: 2.5 }} />
                    <TextField
                      fullWidth size="small" type="email" label="Your email address"
                      value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" sx={{ mb: 1.75 }}
                      slotProps={{ input: { sx: { borderRadius: 2 } } }}
                    />
                    <ResendVerification email={email.trim()} disabled={!email.trim()} variant="contained" />
                    <Button fullWidth onClick={() => router.push('/resident-login')}
                      sx={{ mt: 1, textTransform: 'none', color: '#64748b', fontSize: '0.9rem' }}>
                      Back to login
                    </Button>
                  </>
                )}
              </>
            );
          })()}
        </Box>
      </motion.div>
    </Box>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #071739 0%, #0c2461 60%, #1a3a6b 100%)' }}>
        <CircularProgress sx={{ color: '#14b8a6' }} />
      </Box>
    }>
      <VerifyEmailInner />
    </Suspense>
  );
}
