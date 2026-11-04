'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton } from '@mui/material';
import { Gavel, Add, OpenInNew } from '@mui/icons-material';
import { HEARING_STATUSES, KP_STAGES, KP_STAGE_KEYS, formatHearingWhen, outcomeLabel } from '@/lib/hearings';
import CreateHearingDialog from '@/components/hearings/CreateHearingDialog';
import HearingDetailsDialog from '@/components/hearings/HearingDetailsDialog';
import KpReviewForm from '@/components/hearings/KpReviewForm';
import { NAVY, STATUS_COLOR, chipSx, getJson, type CaseHearingsData } from '@/components/hearings/hearingUi';

/**
 * The case's Katarungang Pambarangay proceedings, on the case page: whether
 * the case may have one (and the eligibility review when it is due), where
 * it stands among the stages - mediation, constitution of the Pangkat,
 * conciliation - each proceeding at a glance, and the full record in
 * Hearing Management. Not mounted on VAWC cases, and the server refuses them
 * in any case.
 */
export default function HearingsPanel({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<CaseHearingsData>(`/api/cases/${caseId}/hearings`, getJson);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const changed = () => { void mutate(); onChanged?.(); };
  const latest = data?.hearings.filter(h => h.status === 'COMPLETED').at(-1);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Gavel sx={{ fontSize: 17, color: '#0369a1' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Hearings (Katarungang Pambarangay)</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Button size="small" href="/blotter-officer/hearings" endIcon={<OpenInNew sx={{ fontSize: 14 }} />} sx={{ textTransform: 'none', minHeight: 32 }}>Hearing Management</Button>
            {data?.canEdit && data.next && !data.blocked && data.eligibility.eligible && (
              <Button size="small" variant="contained" startIcon={<Add sx={{ fontSize: 15 }} />} onClick={() => setCreate(true)} sx={{ textTransform: 'none', minHeight: 32, bgcolor: NAVY }}>
                Create: {data.next.title}
              </Button>
            )}
          </Box>
        </Box>
        {isLoading && <Skeleton height={60} />}
        {error && !data && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{error.message}</Alert>}
        {data && (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {data.eligibility.warnings.map(w => <Alert key={w} severity="warning" sx={{ borderRadius: 2, fontSize: '0.78rem', py: 0 }}>{w}</Alert>)}
            {!data.eligibility.eligible && data.hearings.length === 0 && (
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{data.eligibility.reasons.join(' ')}</Typography>
            )}
            {data.canEdit && data.eligibility.categoryVerified && data.eligibility.needsReview && !data.hearings.some(h => h.status !== 'CANCELLED') && (
              <KpReviewForm key={data.eligibility.review ? String(data.eligibility.review.at) : 'new'} caseId={caseId} caseType={data.case.caseType}
                initial={data.eligibility.answers} onSaved={changed} />
            )}
            {data.eligibility.eligible && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }} aria-label="Stages">
                {KP_STAGE_KEYS.map(s => {
                  const held = data.hearings.some(h => h.stage === s && h.status === 'COMPLETED');
                  const open = data.hearings.some(h => h.stage === s && !['COMPLETED', 'CANCELLED'].includes(h.status));
                  const color = held ? '#15803d' : open ? '#0369a1' : data.next?.stage === s ? '#b45309' : '#94a3b8';
                  return <Chip key={s} size="small" label={`${KP_STAGES[s].letter}. ${KP_STAGES[s].short}${held ? ' - held' : open ? ' - open' : data.next?.stage === s ? ' - next' : ''}`} sx={chipSx(color)} />;
                })}
                {data.pangkat?.constitutedAt && <Chip size="small" label="Pangkat constituted" sx={chipSx('#4f46e5')} />}
              </Box>
            )}
            {data.hearings.length === 0 && data.eligibility.eligible && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No proceeding yet - it starts with mediation before the Punong Barangay.</Typography>}
            {data.hearings.map(h => (
              <Box key={h.id} component="button" onClick={() => setOpen(h.id)}
                sx={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 2, p: 1, bgcolor: '#fff', cursor: 'pointer', fontFamily: 'inherit', '&:hover': { borderColor: '#93c5fd' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: NAVY }}>{h.title}</Typography>
                  <Chip size="small" label={HEARING_STATUSES[h.status]} sx={chipSx(STATUS_COLOR[h.status])} />
                  <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{formatHearingWhen(h.scheduledAt)} · {h.venue ?? 'Barangay Hall'}</Typography>
                  {h.requests.some(r => r.status === 'PENDING') && <Chip size="small" label="New date requested" sx={chipSx('#b45309')} />}
                </Box>
                {h.outcome && <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.25 }}>Outcome: {outcomeLabel(h.outcome)}</Typography>}
              </Box>
            ))}
            {latest?.nextAction && <Typography sx={{ fontSize: '0.8rem', color: '#334155' }}><b>Next action:</b> {latest.nextAction}</Typography>}
            {data.blocked && data.hearings.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{data.blocked}</Typography>}
          </Box>
        )}
      </CardContent>
      {create && <CreateHearingDialog caseId={caseId} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); changed(); }} />}
      {open && <HearingDetailsDialog caseId={caseId} hearingId={open} onClose={() => setOpen(null)} onChanged={changed}
        onScheduleNext={() => { setOpen(null); setCreate(true); }} />}
    </Card>
  );
}
