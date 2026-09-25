'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, CircularProgress, Typography } from '@mui/material';
import { Shield } from '@mui/icons-material';

/**
 * Account creation now runs through Clerk, which owns the credentials and
 * sends the verification email. The barangay profile is collected afterwards
 * at /complete-profile. This route is kept so existing links still work.
 */
export default function RegisterRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/sign-up');
  }, [router]);

  return (
    <Box sx={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: 'linear-gradient(135deg, #071739 0%, #0c2461 60%, #1a3a6b 100%)',
    }}>
      <Box sx={{ textAlign: 'center' }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: '12px', mx: 'auto', mb: 2,
          background: 'linear-gradient(135deg, #0a7c6b, #14b8a6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield sx={{ fontSize: 22, color: 'white' }} />
        </Box>
        <CircularProgress size={22} sx={{ color: '#14b8a6', mb: 1.5 }} />
        <Typography sx={{ fontSize: '0.94rem', color: 'rgba(255,255,255,0.7)' }}>
          Taking you to sign up…
        </Typography>
      </Box>
    </Box>
  );
}
