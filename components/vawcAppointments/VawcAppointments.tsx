'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { Gavel } from '@mui/icons-material';
import HearingManagement from '@/components/hearings/HearingManagement';
import { MODULE_LABEL, MODULE_PATH } from '@/lib/vawcAppointments';
import { NAVY, VIOLET } from './appointmentUi';
import { ProceedingsSection, type ProceedingSection } from './VawcProceedings';

type Section = 'hearings' | ProceedingSection;
const SECTIONS: { value: Section; label: string }[] = [
  { value: 'hearings', label: 'Hearings' }, { value: 'bpo', label: 'Protection orders (BPO)' },
  { value: 'referral', label: 'Referrals' }, { value: 'due', label: 'Due dates' },
];

const CASE_BASE = '/vawc/cases';

/**
 * Hearings for the VAWC desk and the captain: the VAWC cases' hearings on
 * the same workflow - and the same screens - as the Blotter desk's
 * (components/hearings/HearingManagement with track VAWC): scheduling,
 * notices, acknowledgement, requests for a new date, attendance and outcome.
 * Only the hearing types and the notice differ (never mediation or
 * conciliation, never a KP form - RA 9262 sec. 33). Protection orders,
 * referrals and due dates stay here as their own sections. The former
 * Appointments were merged into these hearings.
 */
export default function VawcAppointments() {
  // ?section=bpo|referral|due opens that part (the case page links to due dates).
  const want = useSearchParams().get('section');
  const [section, setSection] = useState<Section>(want && SECTIONS.some(x => x.value === want) ? want as Section : 'hearings');

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
        <Box sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 2, bgcolor: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Gavel sx={{ color: VIOLET }} />
        </Box>
        <Box>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>{MODULE_LABEL}</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>VAWC cases only (RA 9262). Confidential - the VAWC desk and the Punong Barangay only.</Typography>
        </Box>
      </Box>

      <Tabs value={section} onChange={(_, v) => setSection(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: '1px solid #e2e8f0' }}>
        {SECTIONS.map(x => <Tab key={x.value} value={x.value} label={x.label} sx={{ textTransform: 'none', fontWeight: 700 }} />)}
      </Tabs>
      {section === 'hearings'
        ? <HearingManagement track="VAWC" embedded caseBase={CASE_BASE} basePath={MODULE_PATH} />
        : <ProceedingsSection section={section} />}
    </Box>
  );
}
