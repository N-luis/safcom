'use client';

import { Box, Typography, Card, CardContent, Chip, Button, Divider } from '@mui/material';
import { PlayArrow, Edit, Visibility, Notes, Search, Shield } from '@mui/icons-material';

/**
 * The official intake on the case page: where it stands, and the button that
 * opens it for this case. The buttons are a convenience only - the intake
 * page and its API check the official's access again, and refuse it.
 *
 * Also the quick actions for the case's other record types, which stay
 * separate: a follow-up report, an investigation update, an intervention.
 */
export default function OfficialIntakeCard({ caseId, basePath, intake, onQuickAction }: {
  caseId: string;
  basePath: string;
  intake: { id: string; status: string; version: number; updatedAt: string; completedAt: string | null } | null;
  onQuickAction: (type: 'note' | 'investigation' | 'intervention') => void;
}) {
  const href = `${basePath}/${caseId}/intake`;
  const when = (d: string) => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const completed = intake?.status === 'COMPLETED';

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>Intake Form</Typography>
          <Chip size="small"
            label={!intake ? 'Not started' : completed ? 'Completed' : 'Draft'}
            sx={{ height: 22, fontWeight: 700, fontSize: '0.72rem',
              bgcolor: !intake ? '#f1f5f9' : completed ? '#dcfce7' : '#fef3c7',
              color: !intake ? '#475569' : completed ? '#15803d' : '#a16207' }} />
        </Box>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1.25 }}>
          {!intake
            ? 'The intake interview has not been started for this case.'
            : completed
              ? `Completed ${intake.completedAt ? when(intake.completedAt) : ''} · version ${intake.version}`
              : `Draft saved ${when(intake.updatedAt)} · version ${intake.version}`}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {!intake && (
            <Button variant="contained" href={`${href}?start=1`} startIcon={<PlayArrow />}
              sx={{ bgcolor: '#0f766e', fontWeight: 800, minHeight: 40, '&:hover': { bgcolor: '#115e59' } }}>
              START INTAKE
            </Button>
          )}
          {intake && !completed && (
            <>
              <Button variant="contained" href={href} startIcon={<PlayArrow />}
                sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 40, '&:hover': { bgcolor: '#115e59' } }}>
                Continue Intake
              </Button>
              <Button variant="outlined" href={`${href}?view=1`} startIcon={<Visibility />} sx={{ minHeight: 40 }}>View Intake Form</Button>
            </>
          )}
          {completed && (
            <>
              <Button variant="contained" href={`${href}?view=1`} startIcon={<Visibility />}
                sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 40, '&:hover': { bgcolor: '#115e59' } }}>
                View Completed Intake
              </Button>
              <Button variant="outlined" href={href} startIcon={<Edit />} sx={{ minHeight: 40 }}>Edit Intake</Button>
            </>
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />
        <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.75 }}>
          Add to the case record
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<Notes />} onClick={() => onQuickAction('note')} sx={{ minHeight: 36 }}>
            Add Follow-up Report
          </Button>
          <Button size="small" variant="outlined" startIcon={<Search />} onClick={() => onQuickAction('investigation')} sx={{ minHeight: 36 }}>
            Record Investigation Update
          </Button>
          <Button size="small" variant="outlined" startIcon={<Shield />} onClick={() => onQuickAction('intervention')} sx={{ minHeight: 36 }}>
            Record Intervention
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
