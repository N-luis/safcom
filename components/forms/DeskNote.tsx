'use client';

import { Alert, Box, Typography } from '@mui/material';
import type { DeskDecision } from '@/lib/reportDesk';

/** What the resident is told about the desk - never which desk by name: a screen can be seen by someone else. */
export interface ResidentDesk {
  decision: DeskDecision;
  confidentialReview: boolean;
  clarificationNeeded: boolean;
  questions: string[];
  awaitingAi: boolean;
}

/**
 * After filing: whether the report is kept confidential, whether SafeComm
 * is still waiting to read it, and - when more would help - a few neutral
 * questions the resident may answer later in My Cases, or skip.
 */
export default function DeskNote({ desk }: { desk: ResidentDesk }) {
  return (
    <Box sx={{ display: 'grid', gap: 1, textAlign: 'left' }}>
      {desk.confidentialReview && (
        <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.84rem', bgcolor: '#f5f3ff', color: '#4c1d95', '& .MuiAlert-icon': { color: '#7c3aed' } }}>
          Your report will be reviewed confidentially by the barangay officers assigned to it.
        </Alert>
      )}
      {desk.awaitingAi && (
        <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.84rem' }}>
          SafeComm AI could not read your report just now. It is saved, and it will be classified shortly or by a barangay officer.
          If someone is in danger, do not wait - use the emergency contacts.
        </Alert>
      )}
      {desk.clarificationNeeded && desk.questions.length > 0 && (
        <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: '#0c1e46', mb: 0.5 }}>A few details would help the barangay</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 0.75 }}>
            Answer any you can as an update in My Cases. Skip any you cannot or do not want to answer - your report is filed either way.
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.5 }}>
            {desk.questions.map(q => <Typography key={q} component="li" sx={{ fontSize: '0.84rem', color: '#334155' }}>{q}</Typography>)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
