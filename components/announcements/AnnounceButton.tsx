'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { Button, Tooltip } from '@mui/material';
import { Campaign } from '@mui/icons-material';
import ComposeAnnouncementDialog from './ComposeAnnouncementDialog';

/**
 * "Announce" action for a module's dashboard header, so an officer can push a
 * barangay-wide advisory without first navigating to Reports. It opens the same
 * compose dialog the announcements board uses, so there is one form and one
 * code path for publishing.
 */
export default function AnnounceButton({
  accent = '#0ea5e9',
  label = 'Announce',
  variant = 'contained',
}: {
  accent?: string;
  label?: string;
  variant?: 'contained' | 'outlined';
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Publish a barangay announcement to every resident">
        <Button
          variant={variant}
          startIcon={<Campaign />}
          onClick={() => setOpen(true)}
          sx={{
            borderRadius: 2, textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap',
            ...(variant === 'contained'
              ? { bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.9)' } }
              : { borderColor: accent, color: accent, '&:hover': { borderColor: accent, bgcolor: `${accent}0f` } }),
          }}
        >
          {label}
        </Button>
      </Tooltip>

      <ComposeAnnouncementDialog
        open={open}
        onClose={() => setOpen(false)}
        accent={accent}
        // Refresh both announcement views so a post made here shows up on the
        // Reports board and the dashboard alert list without a reload.
        onPublished={() => {
          mutate('/api/alerts?all=true');
          mutate('/api/alerts');
        }}
      />
    </>
  );
}
