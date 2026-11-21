'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Box, Card, CardContent, Typography, Button, Skeleton } from '@mui/material';
import { HowToReg, ArrowForward } from '@mui/icons-material';

const NAVY = '#0c1e46';
type Counts = Record<'INCOMPLETE' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'NEEDS_INFO', number>;
const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json().then(d => d.data) : null));

/**
 * Resident Verification at a glance, on the captain's Command Overview: the
 * registered residents by residency status and the way to the pending list.
 * Shown only to a role the route answers (the captain).
 */
export default function ResidencySummaryCard() {
  const { data, isLoading } = useSWR<{ counts: Counts; total: number } | null>('/api/residency/applications?status=PENDING_VERIFICATION', fetcher);
  if (!isLoading && !data) return null;
  const items: [string, number | undefined, string][] = [
    ['Registered', data?.total, NAVY], ['Verified', data?.counts.VERIFIED, '#15803d'], ['Pending verification', data?.counts.PENDING_VERIFICATION, '#0369a1'],
    ['Rejected', data?.counts.REJECTED, '#b91c1c'], ['Need more information', data?.counts.NEEDS_INFO, '#b45309'],
  ];
  return (
    <Card sx={{ mb: 2.5, borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
          <HowToReg sx={{ color: '#0f766e' }} />
          <Typography sx={{ fontWeight: 800, color: NAVY }}>Resident Verification</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
          {items.map(([label, v, c]) => (
            <Box key={label}>
              {isLoading ? <Skeleton width={32} height={30} /> : <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', color: v ? c : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{v ?? 0}</Typography>}
              <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{label}</Typography>
            </Box>
          ))}
        </Box>
        <Button component={Link} href="/dashboard/residency" variant="contained" endIcon={<ArrowForward />} sx={{ textTransform: 'none', bgcolor: NAVY, borderRadius: 2 }}>
          Open pending verification
        </Button>
      </CardContent>
    </Card>
  );
}
