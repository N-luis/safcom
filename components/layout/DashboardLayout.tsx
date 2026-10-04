'use client';

import { useState, useEffect, useSyncExternalStore, ReactNode } from 'react';
import { Box } from '@mui/material';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { useDashboardStore } from '@/store/dashboardStore';
import { useCurrentUser } from '@/hooks/useApi';
import CaptainShell from './CaptainShell';
import { motion } from 'framer-motion';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * The role decides the frame, and it is remembered between visits.
 *
 * Which shell to draw is only known once /api/auth/me answers, and drawing the
 * staff shell first and swapping it a moment later is exactly the flicker the
 * captain is complaining about. The last known role is kept so the right frame
 * is drawn on the first paint of every visit after the first.
 */
const ROLE_KEY = 'safecomm_shell_role';
const isCaptain = (role: string | undefined) => role === 'admin';

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { sidebarCollapsed } = useDashboardStore();
  const sidebarWidth = sidebarCollapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  const { data: currentUser } = useCurrentUser();
  const role: string | undefined = currentUser?.role;
  const name: string = currentUser?.name ?? '';

  // Read through the store rather than into state: the server has no
  // localStorage, so its snapshot is "unknown" and the client fills it in on
  // hydration without a render loop or a setState inside an effect.
  const rememberedRole = useSyncExternalStore(
    () => () => {},
    () => { try { return localStorage.getItem(ROLE_KEY) ?? undefined; } catch { return undefined; } },
    () => undefined,
  );

  // Writing to localStorage is an update to an external system, which is what
  // an effect is for.
  useEffect(() => {
    if (!role) return;
    try { localStorage.setItem(ROLE_KEY, role); } catch { /* private mode */ }
  }, [role]);

  if (isCaptain(role ?? rememberedRole)) {
    return <CaptainShell userName={name}>{children}</CaptainShell>;
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: { xs: 0, md: `${sidebarWidth}px` },
          transition: 'margin-left 0.25s cubic-bezier(0.4,0,0.2,1)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Navbar onMobileMenuOpen={() => setMobileOpen(true)} />
        <Box
          component={motion.div}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          sx={{
            flexGrow: 1,
            p: { xs: 2, sm: 3 },
            mt: '64px',
            background: 'background.default',
            minHeight: 'calc(100vh - 64px)',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
