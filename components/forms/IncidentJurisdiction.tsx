'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { Box, Typography } from '@mui/material';
import { CheckCircleOutlined, ForwardToInbox, WhereToVote } from '@mui/icons-material';
import {
  DEFAULT_JURISDICTION, LOCATION_FLAGS, checkLocation, incidentOutcome, referralReason, validationSummary, sameName,
  type IncidentOutcome, type JurisdictionConfig, type LocationCheck, type LocationInput, type BoundaryGeometry,
} from '@/lib/jurisdiction';

/**
 * The incident's place, checked as the resident fills it in - the same rules
 * the server runs (lib/jurisdiction.ts checkLocation) against the same
 * configured jurisdiction and boundary, so the form can switch to a referral
 * the moment the place is outside. The server checks everything again on
 * submit and decides; nothing computed here is sent as a result.
 */

interface PublicJurisdiction { barangay: string; barangayAliases?: string[]; municipality: string; province: string; boundary: BoundaryGeometry | null }

export function useJurisdictionConfig(): JurisdictionConfig {
  const { data } = useSWR<PublicJurisdiction | null>('/api/registration/jurisdiction',
    (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).then(j => j?.data ?? null).catch(() => null),
    { revalidateOnFocus: false });
  return useMemo(() => data ? {
    barangay: data.barangay, barangayAliases: data.barangayAliases ?? DEFAULT_JURISDICTION.barangayAliases,
    municipality: data.municipality, province: data.province, boundary: data.boundary, boundarySource: null,
  } : DEFAULT_JURISDICTION, [data]);
}

/**
 * The check as the form stands. When the place named is another barangay,
 * town or province, the barangay's own maps are not shown - so a pin left
 * from earlier is not used (or sent): `usePin` says whether it counts.
 */
export function useIncidentCheck(input: LocationInput): { check: LocationCheck; outcome: IncidentOutcome; namedElsewhere: boolean; usePin: boolean } {
  const cfg = useJurisdictionConfig();
  const { province, municipality, barangay, street, details, latitude, longitude } = input;
  return useMemo(() => {
    const byName = checkLocation({ province, municipality, barangay, street, details }, cfg, 'incident');
    // Another province or town is outside even before its barangay is filled in.
    const otherTown = Boolean((province?.trim() && !sameName(province, cfg.province)) || (municipality?.trim() && !sameName(municipality, cfg.municipality)));
    const namedElsewhere = otherTown || (byName.selection !== 'MATCH' && byName.selection !== 'INCOMPLETE');
    const check = namedElsewhere ? byName : checkLocation({ province, municipality, barangay, street, details, latitude, longitude }, cfg, 'incident');
    return { check, outcome: incidentOutcome(check), namedElsewhere, usePin: !namedElsewhere };
  }, [cfg, province, municipality, barangay, street, details, latitude, longitude]);
}

const place = (c: LocationCheck) => `Barangay ${c.jurisdiction.barangay}, ${c.jurisdiction.municipality}, ${c.jurisdiction.province}`;
const named = (c: LocationCheck) => c.destination ? [c.destination.barangay, c.destination.municipality, c.destination.province].filter(Boolean).join(', ') : null;

/** Said under "Where did this happen?" as soon as the place is known to be outside, or cannot be confirmed. */
export function JurisdictionNotice({ check, outcome, namedElsewhere = false }: { check: LocationCheck; outcome: IncidentOutcome; namedElsewhere?: boolean }) {
  if (outcome === 'INCOMPLETE') {
    if (!namedElsewhere) return null;
    // Another town or province chosen, its barangay not yet: say where this is going, and what is still needed.
    return (
      <Box role="status" aria-live="polite" data-testid="jurisdiction-referral-pending"
        sx={{ border: '1px solid #fdba74', bgcolor: '#fff7ed', borderRadius: 2, p: { xs: 1.5, sm: 2 }, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <ForwardToInbox sx={{ color: '#c2410c', mt: 0.25 }} />
        <Typography sx={{ fontSize: '0.84rem', color: '#7c2d12', lineHeight: 1.55 }}>
          <b>This place is outside the jurisdiction of {place(check)}</b>, so the report will be submitted as a referral, not an ordinary SafeComm case.
          {check.missing.length ? ` Add the ${check.missing.map(m => m.toLowerCase()).join(' and ')} where it happened.` : ''}
        </Typography>
      </Box>
    );
  }
  if (outcome === 'CASE') {
    return (
      <Box role="status" data-testid="jurisdiction-inside" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', color: '#15803d', fontSize: '0.8rem' }}>
        <CheckCircleOutlined sx={{ fontSize: 17 }} />
        <Typography sx={{ fontSize: '0.8rem' }}>Inside {place(check)} - this will be filed as a SafeComm report.</Typography>
      </Box>
    );
  }
  const referral = outcome === 'REFERRAL';
  const flags = check.flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED' && f !== 'NO_PIN');
  return (
    <Box role="status" aria-live="polite" data-testid={referral ? 'jurisdiction-referral' : 'jurisdiction-verification'}
      sx={{ border: '1px solid', borderColor: referral ? '#fdba74' : '#fcd34d', bgcolor: referral ? '#fff7ed' : '#fffbeb', borderRadius: 2, p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {referral ? <ForwardToInbox sx={{ color: '#c2410c' }} /> : <WhereToVote sx={{ color: '#b45309' }} />}
        <Typography sx={{ fontWeight: 800, color: referral ? '#9a3412' : '#92400e', fontSize: '0.92rem' }}>
          {referral ? `This incident is outside the jurisdiction of ${place(check)}` : 'SafeComm cannot confirm this location yet'}
        </Typography>
      </Box>
      {referral ? (<>
        <Typography sx={{ fontSize: '0.84rem', color: '#7c2d12', lineHeight: 1.55 }}>
          It will be submitted as a <b>referral</b>, not an ordinary SafeComm case. Everything you have entered stays as it is - you do not have to start again.
          Before you submit, you will see the referral details to check.
        </Typography>
        {named(check) && <Typography sx={{ fontSize: '0.8rem', color: '#7c2d12' }}>The place you named: <b>{named(check)}</b>. You may also contact that barangay or local authority directly.</Typography>}
      </>) : (<>
        <Typography sx={{ fontSize: '0.84rem', color: '#78350f', lineHeight: 1.55 }}>
          {flags.map(f => LOCATION_FLAGS[f]).join(' ') || 'The location could not be checked.'}
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: '#78350f' }}>
          You can fix it - pick your street from the list or move the pin - or submit as it is: an official will verify where it happened, and it then becomes a SafeComm case or a referral.
        </Typography>
      </>)}
      <Typography sx={{ fontSize: '0.74rem', color: '#a16207' }}>If anyone is in danger now, call the emergency numbers on this page. SafeComm is not an emergency response service.</Typography>
    </Box>
  );
}

/** The referral, as it will be saved - shown in "Before you submit" so the resident can check it first. */
export function ReferralReview({ check, outcome, locationLine }: { check: LocationCheck; outcome: IncidentOutcome; locationLine: string }) {
  if (outcome !== 'REFERRAL' && outcome !== 'LOCATION_VERIFICATION') return null;
  const rows: [string, string][] = [
    ['Submitted as', outcome === 'REFERRAL' ? 'Referral (not an ordinary SafeComm case)' : 'For location verification'],
    ['Incident location', locationLine || 'Not given'],
    [outcome === 'REFERRAL' ? 'Reason for referral' : 'Why it is checked', referralReason(check)],
    ['Location check', validationSummary(check)],
    ...(named(check) ? [['Jurisdiction you named', `${named(check)} (as you gave it - not yet verified by an official)`] as [string, string]] : []),
    ['Status after submitting', outcome === 'REFERRAL' ? 'Pending Review' : 'For Verification'],
  ];
  return (
    <Box data-testid="referral-review" sx={{ border: '1px solid #fdba74', bgcolor: '#fff7ed', borderRadius: 2, p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: '0.78rem', color: '#9a3412', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {outcome === 'REFERRAL' ? 'Referral details' : 'Location verification'}
      </Typography>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.8rem', color: '#9a3412', minWidth: 130 }}>{k}</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#431407', fontWeight: 600, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{v}</Typography>
        </Box>
      ))}
      <Typography sx={{ fontSize: '0.74rem', color: '#9a3412' }}>
        The description, date and time, people, photos and organized narrative you entered are kept with it. SafeComm checks the location again when you submit.
      </Typography>
    </Box>
  );
}
