'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Typography } from '@mui/material';
import { Gavel } from '@mui/icons-material';
import ResidentHearings from './ResidentHearings';

const NAVY = '#0c1e46';
const TEAL = '#0f766e';

/**
 * My Hearings & Notices - the resident's one page for every hearing they are
 * a party to, blotter and VAWC alike, with their notices, calendar and
 * history (/api/resident/hearings). There are no tabs: the former
 * Appointments were merged into these hearings, so an old
 * ?tab=appointments link lands on this page, without the parameter.
 */
export default function ResidentHearingsModule() {
  const router = useRouter();
  const params = useSearchParams();
  const oldTab = params.get('tab');
  useEffect(() => {
    if (!oldTab) return;
    const keep = new URLSearchParams(params.toString());
    keep.delete('tab');
    const rest = keep.toString();
    router.replace(rest ? `/resident/hearings?${rest}` : '/resident/hearings', { scroll: false });
  }, [oldTab, params, router]);
  return (
    <Box sx={{ maxWidth: 1760, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 }, boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Gavel sx={{ color: TEAL }} />
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.25rem', md: '1.5rem' }, color: NAVY }}>My Hearings &amp; Notices</Typography>
      </Box>
      <ResidentHearings embedded />
    </Box>
  );
}
