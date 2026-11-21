'use client';

import { useState } from 'react';
import dynamicImport from 'next/dynamic';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, CircularProgress, Divider, Stepper, Step, StepLabel,
} from '@mui/material';
import { HomeWork, CheckCircle, HourglassTop, ErrorOutlined, Info, Psychology } from '@mui/icons-material';
import toast from 'react-hot-toast';
import AddressFields, { emptyAddress, type AddressValue } from '@/components/forms/AddressFields';
import type { PickedLocation } from '@/components/forms/IncidentLocationMap';
import type { BoundaryGeometry, LocationCheck, EligibilityAnswer } from '@/lib/jurisdiction';
import { BARANGAY_OF_RECORD } from '@/lib/geo';

const NAVY = '#0c1e46';
const TEAL = '#0f766e';
const IncidentLocationMap = dynamicImport(() => import('@/components/forms/IncidentLocationMap'), {
  ssr: false,
  loading: () => <Skeleton variant="rounded" height={320} />,
});

interface ResidencyData {
  residency: { status: string; statusLabel: string; submittedAt: string | null; verifiedAt: string | null; note: string | null };
  address: { province: string | null; municipality: string | null; barangay: string | null; street: string | null; houseNumber: string | null; purok: string | null; line: string; legacyAddress: string };
  location: { latitude: number; longitude: number; source: string | null } | null;
  check: LocationCheck;
  history: { id: string; kind: string; actorType: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }[];
  jurisdiction: { barangay: string; municipality: string; province: string; boundary: BoundaryGeometry | null; boundaryConfigured: boolean };
}

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? 'Could not load your residency');
  return b.data as ResidencyData;
};
const STATUS_TONE: Record<string, { color: string; Icon: typeof CheckCircle }> = {
  VERIFIED: { color: '#15803d', Icon: CheckCircle }, PENDING_VERIFICATION: { color: '#0369a1', Icon: HourglassTop },
  NEEDS_INFO: { color: '#b45309', Icon: Info }, REJECTED: { color: '#b91c1c', Icon: ErrorOutlined }, INCOMPLETE: { color: '#64748b', Icon: Info },
};
const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted for verification', approved: 'Verified by the barangay', rejected: 'Not approved', info_requested: 'More information requested',
  address_changed: 'Address updated', outside_refused: 'Address outside SafeComm\'s coverage - not submitted', backfilled: 'Asked to complete residency verification',
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * Residency: the resident's own residential address, its location on the
 * map, and their verification. Standard reporting opens only once an
 * official has verified it. The server checks everything again on save;
 * nothing here can mark a resident verified.
 */
export default function ResidencyPage() {
  const { data, error, isLoading, mutate } = useSWR<ResidencyData>('/api/resident/residency', fetcher);
  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%', p: { xs: 2, sm: 3 }, boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
        <HomeWork sx={{ color: TEAL }} />
        <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.25rem', md: '1.5rem' }, color: NAVY }}>Residency</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.88rem', color: '#64748b', mb: 2, maxWidth: 860 }}>
        SafeComm is for verified residents of Barangay {data?.jurisdiction.barangay ?? '…'}, {data?.jurisdiction.municipality}, {data?.jurisdiction.province}.
        Give your residential address and your home on the map; an official of the barangay verifies it. Filing a report opens once you are verified.
        Your home location is seen only by the officials who verify it.
      </Typography>

      {isLoading && <Skeleton variant="rounded" height={300} />}
      {error && <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>}

      {/* The form starts from the saved record, and again after each save. */}
      {data && <ResidencyEditor key={`${data.residency.status}|${data.residency.submittedAt}|${data.address.line}|${data.location?.latitude ?? ''}`} data={data} mutate={() => mutate()} />}
    </Box>
  );
}

function initialPin(data: ResidencyData): PickedLocation | null {
  return data.location ? { chosen: true, latitude: data.location.latitude, longitude: data.location.longitude, street: null, barangay: BARANGAY_OF_RECORD,
    mapArea: null, municipality: null, province: null, label: null } : null;
}

function ResidencyEditor({ data, mutate }: { data: ResidencyData; mutate: () => Promise<unknown> }) {
  const [addr, setAddr] = useState<AddressValue>(() => {
    const a = data.address, e = emptyAddress();
    return { province: a.province ?? e.province, municipality: a.municipality ?? e.municipality, barangay: a.barangay ?? e.barangay,
      street: a.street ?? '', houseNumber: a.houseNumber ?? '', purok: a.purok ?? '' };
  });
  const [pin, setPin] = useState<PickedLocation | null>(() => initialPin(data));
  const [manual, setManual] = useState(() => data.location === null && data.history.some(h => h.kind === 'submitted'));
  const [busy, setBusy] = useState<'check' | 'save' | 'submit' | null>(null);
  const [answer, setAnswer] = useState<EligibilityAnswer | null>(null);
  const [problem, setProblem] = useState<{ text: string; destination?: Record<string, string | null> | null } | null>(null);

  const body = (submit: boolean) => ({
    province: addr.province.trim(), municipality: addr.municipality.trim(), barangay: addr.barangay.trim(), street: addr.street.trim(),
    houseNumber: (addr.houseNumber ?? '').trim(), purok: (addr.purok ?? '').trim(),
    ...(manual || !pin ? { locationSource: 'NONE' as const } : { latitude: pin.latitude, longitude: pin.longitude, locationSource: 'MAP' as const }),
    submit,
  });
  const check = async () => {
    setBusy('check'); setProblem(null);
    try {
      const b = body(false);
      const r = await fetch('/api/resident/eligibility', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home: { province: b.province, municipality: b.municipality, barangay: b.barangay, street: b.street, houseNumber: b.houseNumber, purok: b.purok,
          ...(b.locationSource === 'NONE' ? {} : { latitude: b.latitude, longitude: b.longitude }) } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Could not check the address');
      setAnswer(j.data as EligibilityAnswer);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not check the address'); } finally { setBusy(null); }
  };
  const save = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'save'); setProblem(null);
    try {
      const r = await fetch('/api/resident/residency', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(submit)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem({ text: j.error ?? 'Could not save', destination: j.destination ?? null }); return; }
      toast.success(submit ? 'Submitted - an official of the barangay will verify it' : 'Saved');
      setAnswer(null);
      await mutate();
    } catch { setProblem({ text: 'Could not save right now. Please try again.' }); } finally { setBusy(null); }
  };

  const st = data.residency.status;
  const tone = STATUS_TONE[st] ?? STATUS_TONE.INCOMPLETE;
  const step = st === 'VERIFIED' ? 3 : st === 'PENDING_VERIFICATION' ? 2 : pin || manual ? 1 : 0;

  return (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 'none', border: `1px solid ${tone.color}55`, bgcolor: `${tone.color}0d` }}>
            <CardContent sx={{ display: 'grid', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <tone.Icon sx={{ color: tone.color }} />
                <Typography sx={{ fontWeight: 800, color: NAVY }}>Residency status:</Typography>
                <Chip label={data.residency.statusLabel} sx={{ fontWeight: 700, bgcolor: `${tone.color}1a`, color: tone.color }} />
                {data.residency.submittedAt && st === 'PENDING_VERIFICATION' && <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Submitted {when(data.residency.submittedAt)}</Typography>}
                {data.residency.verifiedAt && st === 'VERIFIED' && <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Verified {when(data.residency.verifiedAt)}</Typography>}
              </Box>
              {data.residency.note && (st === 'REJECTED' || st === 'NEEDS_INFO') && (
                <Alert severity={st === 'REJECTED' ? 'error' : 'warning'} sx={{ borderRadius: 2 }}>
                  <b>{st === 'REJECTED' ? 'Reason from the barangay:' : 'The barangay asks:'}</b> {data.residency.note} You may correct your details and submit again.
                </Alert>
              )}
              {st === 'PENDING_VERIFICATION' && <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>Waiting for an official of the barangay to verify your residency. You will see the result here.</Typography>}
              {st === 'VERIFIED' && <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>You can file reports. Changing your address below sends it for verification again.</Typography>}
              <Stepper activeStep={step} alternativeLabel sx={{ mt: 1, '& .MuiStepLabel-label': { fontSize: '0.76rem' } }}>
                {['Residential address', 'Home on the map', 'Submitted for verification', 'Verified'].map(l => <Step key={l}><StepLabel>{l}</StepLabel></Step>)}
              </Stepper>
            </CardContent>
          </Card>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
            <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent sx={{ display: 'grid', gap: 1.5 }}>
                <Typography component="h2" sx={{ fontWeight: 800, color: NAVY }}>1. Residential address</Typography>
                <AddressFields value={addr} onChange={v => { setAddr(v); setAnswer(null); }} mode="residence" disabled={busy !== null} idPrefix="home" />
                {data.address.legacyAddress && !data.address.street && (
                  <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Address on file before: {data.address.legacyAddress}</Typography>
                )}
              </CardContent>
            </Card>
            <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent sx={{ display: 'grid', gap: 1.5 }}>
                <Typography component="h2" sx={{ fontWeight: 800, color: NAVY }}>2. Your home on the map</Typography>
                <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Search your street, use your location, or tap your house; drag the pin to adjust. Being in the barangay does not prove residence - an official checks it.
                  {data.jurisdiction.boundaryConfigured ? ' The dashed line is the barangay\'s official boundary.' : ''}
                </Typography>
                {manual ? (
                  <Alert severity="info" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => setManual(false)}>Use the map</Button>}>
                    No map location: the barangay verifies your address another way (manual verification).
                  </Alert>
                ) : (
                  <>
                    <IncidentLocationMap value={pin} onChange={v => { setPin(v); setAnswer(null); }} variant="residence" boundary={data.jurisdiction.boundary} focusStreet={addr.street} />
                    <Button size="small" onClick={() => { setManual(true); setPin(null); }} sx={{ justifySelf: 'start', textTransform: 'none' }}>I cannot use the map - verify my address manually</Button>
                  </>
                )}
              </CardContent>
            </Card>
          </Box>

          {answer && (
            <Alert severity={answer.residential_address_status === 'OUTSIDE' ? 'error' : answer.residential_address_status === 'INCOMPLETE' ? 'warning' : 'info'}
              sx={{ borderRadius: 2 }} icon={answer.ai_used ? <Psychology /> : undefined}>
              <Typography sx={{ fontSize: '0.86rem' }}>{answer.explanation}</Typography>
              {answer.clarifying_questions.length > 0 && <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: '0.82rem' }}>{answer.clarifying_questions.map(q => <li key={q}>{q}</li>)}</Box>}
              {answer.recommended_destination && <Typography sx={{ fontSize: '0.82rem', mt: 0.5 }}><b>Where to go instead:</b> {answer.recommended_destination}</Typography>}
              <Typography sx={{ fontSize: '0.72rem', color: '#64748b', mt: 0.5 }}>
                {answer.ai_used ? 'Explained with AI assistance; the result itself is SafeComm\'s check.' : 'SafeComm\'s address check.'} An official still verifies every resident.
              </Typography>
            </Alert>
          )}
          {problem && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {problem.text}
              {problem.destination && <Box sx={{ mt: 0.5 }}><b>Your area:</b> {[problem.destination.barangay, problem.destination.municipality, problem.destination.province].filter(Boolean).join(', ')}</Box>}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={check} disabled={busy !== null} sx={{ textTransform: 'none' }}>{busy === 'check' ? <CircularProgress size={16} /> : 'Check my address'}</Button>
            <Button variant="outlined" onClick={() => save(false)} disabled={busy !== null} sx={{ textTransform: 'none' }}>{busy === 'save' ? <CircularProgress size={16} /> : 'Save'}</Button>
            <Button variant="contained" onClick={() => save(true)} disabled={busy !== null || (!pin && !manual)} sx={{ textTransform: 'none', bgcolor: TEAL }}>
              {busy === 'submit' ? <CircularProgress size={16} color="inherit" /> : st === 'VERIFIED' ? 'Submit the new address for verification' : 'Submit for verification'}
            </Button>
          </Box>

          {data.history.length > 0 && (
            <Card sx={{ borderRadius: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <CardContent>
                <Typography component="h2" sx={{ fontWeight: 800, color: NAVY, mb: 1 }}>History</Typography>
                <Divider sx={{ mb: 1 }} />
                {data.history.map(h => (
                  <Box key={h.id} sx={{ display: 'flex', gap: 1, py: 0.5, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: '0.8rem', color: '#64748b', minWidth: 160 }}>{when(h.createdAt)}</Typography>
                    <Typography sx={{ fontSize: '0.84rem', color: NAVY, fontWeight: 600 }}>{EVENT_LABEL[h.kind] ?? h.kind}</Typography>
                    {h.note && h.actorType === 'official' && <Typography sx={{ fontSize: '0.82rem', color: '#475569', width: '100%', pl: { sm: '168px' } }}>{h.note}</Typography>}
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}
        </Box>
  );
}
