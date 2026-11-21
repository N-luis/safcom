'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Box, Typography, Card, CardContent, Button, Chip, Collapse } from '@mui/material';
import { HomeWork, ArrowForward } from '@mui/icons-material';
import ReferralForm from './ReferralForm';
import ResidentHotlines from '@/components/dashboard/ResidentHotlines';

const NAVY = '#0c1e46';
const TEAL = '#0f766e';

/**
 * What the portal shows in place of the dashboard and the report form until
 * the resident is verified: where their residency stands and what to do
 * next, the emergency numbers, and a way to keep an urgent or unverified
 * report as a referral record so it is not lost. The server refuses the
 * standard report either way - this only says so first.
 */
export default function ResidencyGate({ status, label, page }: { status: string; label: string; page: 'dashboard' | 'report' }) {
  const [refer, setRefer] = useState(page === 'report');
  const next = status === 'PENDING_VERIFICATION'
    ? 'Your residency is waiting for an official of the barangay to verify it.'
    : status === 'REJECTED' ? 'Your residency was not approved. See the reason, correct your details and submit again.'
      : status === 'NEEDS_INFO' ? 'The barangay asked for more information about your residency.'
        : 'Complete your residential address and your home location, then submit them for verification.';
  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 }, boxSizing: 'border-box', display: 'grid', gap: 2 }}>
      <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
        <CardContent sx={{ display: 'grid', gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <HomeWork sx={{ color: TEAL }} />
            <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.2rem', color: NAVY }}>
              {page === 'report' ? 'Filing a report needs a verified residency' : 'Welcome to SafeComm'}
            </Typography>
            <Chip label={label} size="small" sx={{ fontWeight: 700 }} />
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: '#334155' }}>
            Ang standard na pag-uulat sa Resident Portal ay para lamang sa mga na-verify na residente ng sakop ng SafeComm.
            (Standard reporting through the Resident Portal is limited to verified residents within SafeComm&apos;s jurisdiction.) {next}
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
            Your cases, hearings and notifications stay open to you meanwhile.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button component={Link} href="/resident/residency" variant="contained" endIcon={<ArrowForward />} sx={{ textTransform: 'none', bgcolor: TEAL }}>
              {status === 'PENDING_VERIFICATION' ? 'View my residency' : 'Complete my residency'}
            </Button>
            <Button variant="outlined" onClick={() => setRefer(r => !r)} sx={{ textTransform: 'none' }}>
              {refer ? 'Hide' : 'Report something urgent or keep a report for the barangay'}
            </Button>
          </Box>
        </CardContent>
      </Card>
      {/* The hotlines are on the dashboard whatever the residency. */}
      {page === 'dashboard' && <ResidentHotlines />}
      <Collapse in={refer} unmountOnExit>
        <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
          <CardContent>
            <ReferralForm reason="Until your residency is verified, a report cannot be filed as a SafeComm case - but it is not lost: save it as a referral record and the barangay reviews it." />
          </CardContent>
        </Card>
      </Collapse>
    </Box>
  );
}
