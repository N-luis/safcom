'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import AuthShell, { authField, authPrimaryButton } from '@/components/auth/AuthShell';

/**
 * Forgot password - and the way back in for an account from before the new
 * sign-in. Without a link: ask for one by email. With the emailed link
 * (?token_hash=...&type=recovery|invite): choose the password, then signed in.
 */
const RULE = 'At least 8 characters, with a letter and a number';

function AskForLink() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setDone('');
    try {
      const res = await fetch('/api/auth/resident-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        // Email to residents not set up on the server: said plainly (the same for every address).
        if (json.data.deliveryWarning) setError(json.data.deliveryWarning); else setDone(json.data.message);
      } else setError(json.error ?? 'Try again in a moment.');
    } catch { setError('Network error. Please try again.'); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Forgot password or set up" subtitle="Enter the email of your resident account. We will email you a link to choose a password. If your account was made before SafeComm's new sign-in, this sets up your password for it - your profile and reports are kept.">
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2 }} data-testid="ask-link">
        {done && <Alert severity="success" sx={{ borderRadius: 2 }} role="status">{done}</Alert>}
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
        <TextField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" sx={authField} />
        <Button type="submit" variant="contained" disabled={busy || !email.trim()} sx={authPrimaryButton}>{busy ? <CircularProgress size={22} color="inherit" /> : 'Email me a link'}</Button>
        <Button onClick={() => router.push('/resident-login')} sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none' }}>Back to sign in</Button>
      </Box>
    </AuthShell>
  );
}

function ChoosePassword({ tokenHash, type }: { tokenHash: string; type: 'recovery' | 'invite' }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ signedIn: boolean } | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/resident-password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ token_hash: tokenHash, type, password, confirmPassword: confirm }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) setDone({ signedIn: Boolean(json.data.signedIn) }); else setError(json.error ?? 'Your password could not be set.');
    } catch { setError('Network error. Please try again.'); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <AuthShell title="Password saved">
        <Box role="status" sx={{ display: 'grid', gap: 2 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.8)' }}>{done.signedIn ? 'Your new password is saved and you are signed in.' : 'Your new password is saved. Sign in with it.'}</Typography>
          <Button variant="contained" onClick={() => router.push(done.signedIn ? '/resident' : '/resident-login')} sx={authPrimaryButton}>{done.signedIn ? 'Go to my dashboard' : 'Go to sign in'}</Button>
        </Box>
      </AuthShell>
    );
  }
  const eye = (
    <InputAdornment position="end">
      <IconButton onClick={() => setShow(s => !s)} edge="end" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton>
    </InputAdornment>
  );
  return (
    <AuthShell title={type === 'invite' ? 'Set up your password' : 'Choose a new password'} subtitle={type === 'invite' ? "SafeComm has a new sign-in. Choose a password for your account - your profile and reports are kept." : undefined}>
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2 }} data-testid="choose-password">
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}{/expired|used/i.test(error) && <Box sx={{ mt: 0.5 }}><Button size="small" onClick={() => router.push('/reset-password')}>Ask for a new link</Button></Box>}</Alert>}
        <TextField label="New password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password"
          helperText={RULE} sx={authField} slotProps={{ input: { endAdornment: eye } }} />
        <TextField label="Confirm new password" type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password"
          error={mismatch} helperText={mismatch ? 'The passwords do not match' : ' '} sx={authField} />
        <Button type="submit" variant="contained" disabled={busy || !password || mismatch} sx={authPrimaryButton}>{busy ? <CircularProgress size={22} color="inherit" /> : 'Save password'}</Button>
      </Box>
    </AuthShell>
  );
}

function ResetPassword() {
  const params = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = params.get('type') === 'invite' ? 'invite' : 'recovery';
  return tokenHash ? <ChoosePassword tokenHash={tokenHash} type={type} /> : <AskForLink />;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPassword /></Suspense>;
}
