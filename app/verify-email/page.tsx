'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import AuthShell, { authPrimaryButton } from '@/components/auth/AuthShell';

/**
 * Where the confirmation email's link lands: /verify-email?token_hash=...&type=signup
 * (or type=magiclink, for a resent link). Supabase Auth confirms the email on
 * the server and the resident is signed in. The residency still waits for an
 * official - this page says so.
 */
type State = 'loading' | 'confirmed' | 'error' | 'missing' | 'old';

function VerifyEmail() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = params.get('type') === 'magiclink' ? 'magiclink' : 'signup';
  const old = !tokenHash && Boolean(params.get('token'));
  const [state, setState] = useState<State>(tokenHash ? 'loading' : old ? 'old' : 'missing');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    // Once only: a token can be used one time, and React may run an effect twice in development.
    if (!tokenHash || ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ token_hash: tokenHash, type }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) { setName(json.data.name ?? ''); setState('confirmed'); return; }
        setError(json.error ?? 'This link could not be used.');
        setState('error');
      } catch {
        setError('Network error. Open the link again.');
        setState('error');
      }
    })();
  }, [tokenHash, type]);

  return (
    <AuthShell title={state === 'confirmed' ? 'Email confirmed' : 'Confirm your email'}>
      <Box role="status" aria-live="polite" sx={{ display: 'grid', gap: 2 }}>
        {state === 'loading' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'rgba(255,255,255,0.75)' }}><CircularProgress size={20} sx={{ color: '#2dd4bf' }} /> Confirming your email…</Box>}
        {state === 'confirmed' && (
          <>
            <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
              <CheckCircle sx={{ color: '#34d399', mt: '2px' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', lineHeight: 1.6 }}>
                Thank you{name ? `, ${name}` : ''}. Your email is confirmed and you are signed in.
              </Typography>
            </Box>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem', lineHeight: 1.6 }}>
              Your residency is currently awaiting verification by an authorized barangay official. You can follow it on your dashboard.
            </Typography>
            <Button variant="contained" size="large" onClick={() => router.push('/resident')} sx={authPrimaryButton}>Go to my dashboard</Button>
          </>
        )}
        {state === 'error' && (
          <>
            <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem' }}>Already confirmed? Sign in. Otherwise sign in once to get a new link sent.</Typography>
            <Button variant="contained" onClick={() => router.push('/resident-login')} sx={authPrimaryButton}>Go to sign in</Button>
          </>
        )}
        {state === 'old' && (
          <>
            <Alert severity="info" sx={{ borderRadius: 2 }}>This link is from SafeComm&apos;s old sign-in and no longer works.</Alert>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem' }}>Choose a password for the new sign-in - your profile and reports are kept.</Typography>
            <Button variant="contained" onClick={() => router.push('/reset-password')} sx={authPrimaryButton}>Set up my password</Button>
          </>
        )}
        {state === 'missing' && (
          <>
            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.92rem' }}>Open the link in the email we sent you. No link? Sign in and we will offer to send a new one.</Typography>
            <Button variant="contained" onClick={() => router.push('/resident-login')} sx={authPrimaryButton}>Go to sign in</Button>
          </>
        )}
      </Box>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={null}><VerifyEmail /></Suspense>;
}
