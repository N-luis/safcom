'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { Gavel } from '@mui/icons-material';
import ResidentHearings from './ResidentHearings';
import ResidentAppointments from '@/components/vawcAppointments/ResidentAppointments';

const NAVY = '#0c1e46';
const TEAL = '#0f766e';
type TabKey = 'hearings' | 'appointments';

/**
 * My Hearings & Notices - the resident's one entry for everything scheduled
 * with the barangay: the hearings they are a party to with their notices, and
 * the appointments set with them on their own reports. Each tab is the page
 * it always was, reading its own records (/api/resident/hearings and
 * /api/resident/appointments); ?tab=appointments opens the second, so a
 * notification can link straight to it.
 */
export default function ResidentHearingsModule() {
  const router = useRouter();
  const tab: TabKey = useSearchParams().get('tab') === 'appointments' ? 'appointments' : 'hearings';
  const go = (t: TabKey) => router.replace(t === 'appointments' ? '/resident/hearings?tab=appointments' : '/resident/hearings', { scroll: false });
  return (
    <Box sx={{ maxWidth: 1760, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 }, boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Gavel sx={{ color: TEAL }} />
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.25rem', md: '1.5rem' }, color: NAVY }}>My Hearings &amp; Notices</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, v) => go(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: '1px solid #e2e8f0' }}>
        <Tab value="hearings" label="Hearings & Notices" sx={{ textTransform: 'none', fontWeight: 700 }} />
        <Tab value="appointments" label="Appointments" sx={{ textTransform: 'none', fontWeight: 700 }} />
      </Tabs>
      {tab === 'hearings' ? <ResidentHearings embedded /> : <ResidentAppointments embedded />}
    </Box>
  );
}
