'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton } from '@mui/material';
import { EventAvailable, Add, OpenInNew } from '@mui/icons-material';
import { formatHearingWhen } from '@/lib/hearings';
import { APPOINTMENT_STATUSES } from '@/lib/vawcAppointments';
import CreateAppointmentDialog from './CreateAppointmentDialog';
import AppointmentDetailsDialog from './AppointmentDetailsDialog';
import { NAVY, VIOLET, APPT_STATUS_COLOR, chipSx, getJson, type AppointmentList } from './appointmentUi';

/** The case's VAWC appointments, on the VAWC case page - never mounted on a blotter case. */
export default function VawcAppointmentsPanel({ caseId }: { caseId: string }) {
  const { data, error, isLoading, mutate } = useSWR<AppointmentList>(`/api/vawc/appointments?caseId=${encodeURIComponent(caseId)}`, getJson);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...(data?.rows ?? [])].reverse();
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <EventAvailable sx={{ fontSize: 17, color: VIOLET }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Appointments &amp; Follow-ups</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Button size="small" href="/vawc/appointments" endIcon={<OpenInNew sx={{ fontSize: 14 }} />} sx={{ textTransform: 'none', minHeight: 32 }}>All appointments</Button>
            {data && (
              <Button size="small" variant="contained" startIcon={<Add sx={{ fontSize: 15 }} />} onClick={() => setCreate(true)} sx={{ textTransform: 'none', minHeight: 32, bgcolor: NAVY }}>
                Create appointment
              </Button>
            )}
          </Box>
        </Box>
        {isLoading && <Skeleton height={60} />}
        {error && !data && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{error.message}</Alert>}
        {data && rows.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No appointment on this case yet.</Typography>}
        <Box sx={{ display: 'grid', gap: 1 }}>
          {rows.map(r => (
            <Box key={r.id} component="button" type="button" onClick={() => setOpen(r.id)}
              sx={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 2, p: 1, bgcolor: '#fff', cursor: 'pointer', fontFamily: 'inherit', '&:hover': { borderColor: '#c4b5fd' } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: NAVY }}>{r.typeLabel}</Typography>
                <Chip size="small" label={APPOINTMENT_STATUSES[r.status]} sx={chipSx(APPT_STATUS_COLOR[r.status])} />
                <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{formatHearingWhen(r.scheduledAt)} · {r.venue}</Typography>
                {r.pendingRequests > 0 && <Chip size="small" label="New date requested" sx={chipSx('#b45309')} />}
                {r.overdue && <Chip size="small" label="Record the outcome" sx={chipSx('#b91c1c')} />}
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>
      {create && <CreateAppointmentDialog caseId={caseId} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); void mutate(); }} />}
      {open && <AppointmentDetailsDialog id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />}
    </Card>
  );
}
