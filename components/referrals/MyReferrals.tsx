'use client';

import useSWR from 'swr';
import { Box, Typography, Card, CardContent, Chip } from '@mui/material';
import { ForwardToInbox, WhereToVote } from '@mui/icons-material';

/**
 * The resident's own referrals on My Cases, kept apart from their cases: the
 * reference number, where, why, the status and the updates an official chose
 * to share. Never internal notes, the receiving office record, or anyone
 * else's details (the server sends only these - /api/resident/referrals).
 */

interface MyReferral {
  id: string; referenceNumber: string | null; kind: string; kindLabel: string; status: string; statusLabel: string; statusMeaning: string;
  urgent: boolean; reason: string | null; location: string; createdAt: string; caseNumber: string | null;
  updates: { at: string; message: string; status: string | null }[];
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json().then(d => d.data) : []));
const day = (d: string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });
const STATUS_COLOR: Record<string, string> = {
  PENDING_REVIEW: '#0369a1', FOR_VERIFICATION: '#b45309', READY_FOR_REFERRAL: '#4338ca', REFERRED: '#7c3aed',
  ACKNOWLEDGED: '#15803d', FOLLOW_UP_REQUIRED: '#c2410c', CLOSED: '#64748b',
};

export default function MyReferrals() {
  const { data } = useSWR<MyReferral[]>('/api/resident/referrals', fetcher);
  if (!data?.length) return null;
  return (
    <Box data-testid="my-referrals" sx={{ mb: 3, display: 'grid', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontWeight: 800, color: '#0c1e46', fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <ForwardToInbox sx={{ color: '#c2410c', fontSize: 20 }} />Referrals ({data.length})
        </Typography>
        <Typography sx={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
          These are not SafeComm cases. An incident outside the barangay&apos;s authorized jurisdiction is handled as a referral, so the barangay can direct your concern to the right jurisdiction.
          No other barangay or agency has accepted a referral unless it shows &ldquo;Acknowledged by Receiving Office&rdquo;.
        </Typography>
      </Box>
      {data.map(r => {
        const c = STATUS_COLOR[r.status] ?? '#64748b';
        const verifying = r.kind === 'LOCATION_VERIFICATION';
        return (
          <Card key={r.id} sx={{ borderRadius: 2, border: '1px solid #fed7aa', boxShadow: 'none', bgcolor: '#fffbf5' }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } }, display: 'grid', gap: 0.75 }}>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 800, color: '#9a3412', fontVariantNumeric: 'tabular-nums' }}>{r.referenceNumber ?? 'Referral'}</Typography>
                <Chip size="small" icon={verifying ? <WhereToVote sx={{ fontSize: 14 }} /> : <ForwardToInbox sx={{ fontSize: 14 }} />}
                  label={verifying ? 'Location being verified' : r.kind === 'OUTSIDE_JURISDICTION' ? 'Referral' : r.kindLabel}
                  sx={{ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: '#ffedd5', color: '#9a3412' }} />
                <Chip size="small" label={r.statusLabel} sx={{ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: `${c}14`, color: c, border: `1px solid ${c}33` }} />
                <Typography sx={{ fontSize: '0.76rem', color: '#64748b', ml: 'auto' }}>Submitted {day(r.createdAt)}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.82rem', color: '#334155' }}><b>Where:</b> {r.location || 'Not given'}</Typography>
              {r.reason && <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}><b>Reason:</b> {r.reason}</Typography>}
              <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{r.statusMeaning}</Typography>
              {r.caseNumber && <Typography sx={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 700 }}>Filed as SafeComm case {r.caseNumber} - see it in the list below.</Typography>}
              {r.updates.length > 0 && (
                <Box sx={{ display: 'grid', gap: 0.5, borderTop: '1px dashed #fed7aa', pt: 0.75 }}>
                  {r.updates.map((u, i) => (
                    <Typography key={i} sx={{ fontSize: '0.8rem', color: '#334155' }}>
                      <Box component="span" sx={{ color: '#94a3b8', mr: 0.75 }}>{day(u.at)}</Box>{u.message}
                    </Typography>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}
