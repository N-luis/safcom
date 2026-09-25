'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Alert, CircularProgress, LinearProgress, Typography } from '@mui/material';
import { Refresh, MarkEmailRead } from '@mui/icons-material';

type Notice = { type: 'success' | 'error' | 'warning'; text: string } | null;

interface Props {
  email: string;
  /** Rendered above the button when the caller has no email to work with. */
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'contained' | 'outlined';
  fullWidth?: boolean;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export default function ResendVerification({
  email, disabled = false, size = 'medium', variant = 'outlined', fullWidth = true,
}: Props) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    setTotal(seconds);
    setCooldown(seconds);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [cooldown]);

  const send = useCallback(async () => {
    if (!email) { setNotice({ type: 'error', text: 'No email address available.' }); return; }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();

      if (res.ok) {
        const { delivered, reason } = json.data ?? {};
        setNotice(
          delivered
            ? { type: 'success', text: `Verification email sent to ${email}. Check your inbox and spam folder.` }
            : {
                type: 'warning',
                text: reason === 'sandbox_recipient_blocked'
                  ? 'The mail provider is still in test mode and can only deliver to the administrator’s own address. Ask your barangay administrator to verify your account manually.'
                  : reason === 'not_configured'
                    ? 'Email delivery isn’t set up on the server yet — contact your barangay administrator.'
                    : 'The email could not be delivered right now. Please try again or contact your barangay administrator.',
              },
        );
        startCooldown(Number(json.data?.cooldownSeconds ?? 60));
      } else if (res.status === 429) {
        setNotice({ type: 'error', text: json.error ?? 'Please wait before requesting another email.' });
        if (json.retryAfterSeconds > 0) startCooldown(Number(json.retryAfterSeconds));
      } else {
        setNotice({ type: 'error', text: json.error ?? 'Could not send the email. Please try again.' });
      }
    } catch {
      setNotice({ type: 'error', text: 'Network error. Please check your connection and try again.' });
    } finally {
      setSending(false);
    }
  }, [email, startCooldown]);

  const waiting = cooldown > 0;
  const progress = total > 0 ? ((total - cooldown) / total) * 100 : 0;

  return (
    <Box sx={{ width: fullWidth ? '100%' : 'auto' }}>
      {notice && (
        <Alert severity={notice.type} sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.9rem', textAlign: 'left' }}>
          {notice.text}
        </Alert>
      )}

      <Button
        fullWidth={fullWidth}
        size={size}
        variant={variant}
        disabled={disabled || sending || waiting}
        onClick={send}
        startIcon={
          sending ? <CircularProgress size={15} color="inherit" />
            : waiting ? undefined
              : <Refresh sx={{ fontSize: 17 }} />
        }
        sx={{
          borderColor: '#14b8a6', color: '#0a7c6b', fontWeight: 700,
          borderRadius: 2.5, textTransform: 'none',
          '&:hover': { borderColor: '#0d9488', bgcolor: 'rgba(20,184,166,0.06)' },
          '&:disabled': { borderColor: '#e2e8f0', color: '#94a3b8' },
        }}
      >
        {sending ? 'Sending…' : waiting ? `Resend available in ${mmss(cooldown)}` : 'Resend Verification Email'}
      </Button>

      {waiting && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 4, borderRadius: 2, bgcolor: '#e2e8f0',
              '& .MuiLinearProgress-bar': { bgcolor: '#14b8a6', borderRadius: 2 },
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75, justifyContent: 'center' }}>
            <MarkEmailRead sx={{ fontSize: 13, color: '#94a3b8' }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              You can request another email in {mmss(cooldown)}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}
