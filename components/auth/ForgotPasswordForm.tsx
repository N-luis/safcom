'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, TextField } from '@mui/material';
import AuthShell, { authField, authPrimaryButton } from '@/components/auth/AuthShell';

/**
 * Forgot Password: ask for a recovery email. Works for every resident account -
 * one made with SafeComm's current sign-in, and one from before it (Clerk or the
 * old SafeComm password), which gets a link to set up its password instead.
 *
 * The answer is the same for every address, so this page never tells anyone
 * whether an email has an account. When the server cannot send email at all,
 * that is said plainly (also the same for every address).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COOLDOWN = 60;

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const sent = Boolean(done || warning);
  const invalid = touched && !EMAIL_RE.test(email.trim());

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setTouched(true);
    if (!EMAIL_RE.test(email.trim()) || busy || wait > 0) return;
    setBusy(true); setError(''); setDone(''); setWarning('');
    try {
      const res = await fetch('/api/auth/resident-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        if (json.data.deliveryWarning) setWarning(json.data.deliveryWarning); else setDone(json.data.message);
        setWait(COOLDOWN);
      } else if (res.status === 429) {
        setError(json.error ?? 'Too many requests - wait a while before asking again.');
      } else setError(json.error ?? 'The recovery email could not be requested. Try again in a moment.');
    } catch { setError('Network error. Check your connection and try again.'); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Forgot password" subtitle="Enter the email address of your resident account. We will email you a link to choose a new password. Had an account before SafeComm's new sign-in? The same link sets up your password - your profile and reports are kept.">
      <Box component="form" onSubmit={e => { e.preventDefault(); send(); }} noValidate sx={{ display: 'grid', gap: 2 }} data-testid="ask-link">
        {done && <Alert severity="success" sx={{ borderRadius: 2 }} role="status">{done}</Alert>}
        {warning && <Alert severity="warning" sx={{ borderRadius: 2 }} role="status">{warning}</Alert>}
        {error && <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" type="submit" disabled={busy || wait > 0}>Retry</Button>}>{error}</Alert>}
        <TextField label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(true)} autoComplete="email"
          error={invalid} helperText={invalid ? 'Enter a valid email address' : ' '} sx={authField} slotProps={{ htmlInput: { maxLength: 254, inputMode: 'email' } }} />
        <Button type="submit" variant="contained" disabled={busy || wait > 0} sx={authPrimaryButton}>
          {busy ? <CircularProgress size={22} color="inherit" /> : wait > 0 ? `Send again in ${wait}s` : sent ? 'Send Again' : 'Send Recovery Email'}
        </Button>
        <Button onClick={() => router.push('/resident-login')} sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'none' }}>Return to Sign In</Button>
      </Box>
    </AuthShell>
  );
}
