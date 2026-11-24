'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { Visibility, VisibilityOff, CheckCircle, RadioButtonUnchecked } from '@mui/icons-material';
import AuthShell, { authField, authPrimaryButton } from '@/components/auth/AuthShell';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';

/**
 * Reset Password - where the emailed link lands. Without a link: the Forgot
 * Password form (as at /forgot-password). With the emailed link
 * (?token_hash=...&type=recovery|invite): choose the new password - checked
 * by the server with Supabase Auth - then signed in.
 */
/** The password rules, shown as they are met (the server checks them again). */
const RULES = [
  { key: 'len', text: 'At least 8 characters', ok: (p: string) => p.length >= 8 && p.length <= 72 },
  { key: 'letter', text: 'A letter', ok: (p: string) => /[A-Za-z]/.test(p) },
  { key: 'number', text: 'A number', ok: (p: string) => /[0-9]/.test(p) },
];

function ChoosePassword({ tokenHash, type }: { tokenHash: string; type: 'recovery' | 'invite' }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; expired: boolean } | null>(null);
  const [done, setDone] = useState<{ signedIn: boolean } | null>(null);
  const rulesMet = RULES.every(r => r.ok(password));
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = rulesMet && confirm === password && confirm.length > 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/auth/resident-password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ token_hash: tokenHash, type, password, confirmPassword: confirm }) });
      const json = await res.json().catch(() => ({}));
      // Success is shown only when the server says the password was saved.
      if (res.ok && json.success) setDone({ signedIn: Boolean(json.data.signedIn) });
      else setError({ text: json.error ?? 'Your password could not be updated.', expired: json.code === 'LINK_EXPIRED' || json.code === 'INVALID_LINK' });
    } catch { setError({ text: 'Network error. Check your connection and try again.', expired: false }); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <AuthShell title="Password updated">
        <Box role="status" sx={{ display: 'grid', gap: 2 }} data-testid="password-updated">
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
            <CheckCircle sx={{ color: '#34d399', mt: '2px' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
              {done.signedIn ? 'Your new password is saved and you are signed in.' : 'Your new password is saved. Sign in with it now.'}
            </Typography>
          </Box>
          <Button variant="contained" onClick={() => router.push(done.signedIn ? '/resident' : '/resident-login')} sx={authPrimaryButton}>{done.signedIn ? 'Go to my dashboard' : 'Go to Sign In'}</Button>
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
    <AuthShell title={type === 'invite' ? 'Set up your password' : 'Reset your password'}
      subtitle={type === 'invite' ? "SafeComm has a new sign-in. Choose a password for your account - your profile and reports are kept." : 'Choose a new password for your SafeComm account.'}>
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2 }} data-testid="choose-password">
        {error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {error.text}
            {error.expired && <Box sx={{ mt: 0.75 }}><Button size="small" variant="outlined" color="inherit" onClick={() => router.push('/forgot-password')}>Request a new link</Button></Box>}
          </Alert>
        )}
        <TextField label="New Password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password"
          sx={authField} slotProps={{ input: { endAdornment: eye }, htmlInput: { maxLength: 72 } }} />
        <Box component="ul" aria-label="Password requirements" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.25 }} data-testid="password-rules">
          {RULES.map(r => {
            const met = r.ok(password);
            return (
              <Box component="li" key={r.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.82rem', color: met ? '#6ee7b7' : 'rgba(255,255,255,0.6)' }}>
                {met ? <CheckCircle sx={{ fontSize: 16 }} /> : <RadioButtonUnchecked sx={{ fontSize: 16 }} />}{r.text}{met ? <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}> (met)</Box> : null}
              </Box>
            );
          })}
        </Box>
        <TextField label="Confirm New Password" type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
          error={mismatch} helperText={mismatch ? 'The passwords do not match' : ' '} sx={authField} slotProps={{ htmlInput: { maxLength: 72 } }} />
        <Button type="submit" variant="contained" disabled={busy || !ready} sx={authPrimaryButton}>
          {busy ? <CircularProgress size={22} color="inherit" /> : type === 'invite' ? 'Set Password' : 'Update Password'}
        </Button>
        <Button onClick={() => router.push('/resident-login')} sx={{ color: 'rgba(255,255,255,0.7)', textTransform: 'none' }}>Return to Sign In</Button>
      </Box>
    </AuthShell>
  );
}

function ResetPassword() {
  const params = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = params.get('type') === 'invite' ? 'invite' : 'recovery';
  return tokenHash ? <ChoosePassword tokenHash={tokenHash} type={type} /> : <ForgotPasswordForm />;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPassword /></Suspense>;
}
