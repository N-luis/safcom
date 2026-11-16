'use client';

import { Box, Typography } from '@mui/material';
import AnnouncementsPanel from '@/components/announcements/AnnouncementsPanel';

/**
 * VAWC announcements - the same board as the Blotter desk's, in this module's colour. */
export default function VawcAnnouncementsPage() {
  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
          Announcements
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
          Publish barangay alerts straight to residents&apos; notifications
        </Typography>
      </Box>

      {/* Self-contained: composing, the live/past list and activation all live
          inside the panel, so this page is only a heading around it. */}
      <AnnouncementsPanel accent="#7c3aed" />
    </Box>
  );
}
