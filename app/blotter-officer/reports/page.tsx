'use client';

import { Box, Typography } from '@mui/material';
import AnnouncementsPanel from '@/components/announcements/AnnouncementsPanel';

/**
 * Blotter announcements.
 *
 * This route used to be the blotter Reports page - a stats row, a searchable
 * table of RPT-#### records, CSV export and a New Report dialog - with the
 * announcements panel bolted on at the bottom. The officers only used the
 * announcements, so everything else is gone; the report records themselves are
 * untouched and still managed from the Captain's own Reports page.
 *
 * The URL stays /blotter-officer/reports so existing links keep working; only
 * what it shows and what the sidebar calls it have changed.
 */
export default function BlotterAnnouncementsPage() {
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
      <AnnouncementsPanel accent="#3b82f6" />
    </Box>
  );
}
