'use client';

import useSWR from 'swr';
import { Alert, Box, Typography } from '@mui/material';
import type { ScheduleConflict } from '@/lib/hearings';
import { getJson } from './hearingUi';

interface Check { valid: boolean; problem: string | null; conflicts: ScheduleConflict[] }

/**
 * Warns, as the official fills in a schedule, when the date and time are not
 * valid or clash with another hearing of the same official or in the same
 * venue. Advisory only: the save is checked again on the server.
 */
export default function ConflictWarnings({ date, time, venue, officialId, excludeId }: {
  date: string; time: string; venue: string; officialId?: string | null; excludeId?: string | null;
}) {
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  const q = new URLSearchParams({ date, time, venue: venue || 'Barangay Hall' });
  if (officialId) q.set('officialId', officialId);
  if (excludeId) q.set('excludeId', excludeId);
  const { data } = useSWR<Check>(ready ? `/api/hearings/conflicts?${q}` : null, getJson, { keepPreviousData: false });
  if (!data) return null;
  if (!data.valid) return <Alert severity="error" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{data.problem}</Alert>;
  if (!data.conflicts.length) return <Typography role="status" sx={{ fontSize: '0.76rem', color: '#15803d' }}>No clash with the official&apos;s or the venue&apos;s other hearings.</Typography>;
  return <ConflictList conflicts={data.conflicts} />;
}

export function ConflictList({ conflicts, footer }: { conflicts: ScheduleConflict[]; footer?: string }) {
  return (
    <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }} role="alert">
      <Typography sx={{ fontWeight: 700, fontSize: '0.82rem' }}>Scheduling conflict</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
        {conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
      </Box>
      <Typography sx={{ fontSize: '0.76rem', mt: 0.5 }}>{footer ?? 'The other hearing is not changed. Pick another time or venue, or go ahead only if both can really happen.'}</Typography>
    </Alert>
  );
}
