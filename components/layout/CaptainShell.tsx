'use client';

import { useState, type ReactNode } from 'react';
import { Box, Drawer, IconButton, useMediaQuery, useTheme } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import CaptainSidebar, { CAPTAIN_SIDEBAR_WIDTH } from './CaptainSidebar';

/**
 * The frame every Barangay Captain page sits in.
 *
 * Deliberately has no top bar. The captain's design puts its actions in the
 * page header - the module filter, Announce, refresh - rather than in a global
 * strip with search and notification badges, and a page that brings that strip
 * back reads as a different product.
 */
export default function CaptainShell({ userName, children }: {
  userName: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f5f7fb' }}>
      {!isMobile && (
        <Box sx={{ width: CAPTAIN_SIDEBAR_WIDTH, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', top: 0, left: 0, width: CAPTAIN_SIDEBAR_WIDTH, height: '100vh', zIndex: 100 }}>
            <CaptainSidebar onClose={() => {}} userName={userName} />
          </Box>
        </Box>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: CAPTAIN_SIDEBAR_WIDTH, border: 'none' } }}
        ModalProps={{ keepMounted: true }}
      >
        <CaptainSidebar onClose={() => setDrawerOpen(false)} userName={userName} />
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3 } }}>
        {/* The only chrome the shell adds: a way back to the nav on a phone. */}
        {isMobile && (
          <IconButton
            size="small"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            sx={{ mb: 1.5, minWidth: 44, minHeight: 44 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        {children}
      </Box>
    </Box>
  );
}
