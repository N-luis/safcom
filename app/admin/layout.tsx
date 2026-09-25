'use client';

import { useState, ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Box, Drawer, ListItemButton, ListItemIcon, ListItemText,
  Typography, Avatar, IconButton, Tooltip, Divider,
  useMediaQuery, useTheme,
} from '@mui/material';
import {
  Dashboard, ManageAccounts,
  Menu as MenuIcon, Logout, AdminPanelSettings,
} from '@mui/icons-material';
import { motion } from 'framer-motion';

const SIDEBAR_W = 240;
const ACCENT = '#0ea5e9';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Dashboard, path: '/admin', exact: true },
  { id: 'users', label: 'User Management', icon: ManageAccounts, path: '/admin/users' },
];

function SidebarContent({ onClose, userName }: { onClose: () => void; userName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (path: string, exact?: boolean) =>
    exact ? pathname === path : pathname === path || pathname.startsWith(path + '/');

  const go = (path: string) => { router.push(path); onClose(); };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  return (
    <Box sx={{
      width: SIDEBAR_W, height: '100%',
      background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Logo */}
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px',
          background: `linear-gradient(135deg, #0284c7, ${ACCENT})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: `0 4px 14px rgba(14,165,233,0.35)`,
        }}>
          <AdminPanelSettings sx={{ fontSize: 20, color: 'white' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em' }}>SafeComm</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>System Admin</Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: 2 }} />

      {/* Nav */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pt: 1.5, pb: 1, '&::-webkit-scrollbar': { width: 3 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 2 } }}>
        <Typography sx={{ px: 1, pt: 1, pb: 0.75, fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Administration</Typography>
        {NAV_ITEMS.map(item => {
          const active = isActive(item.path, item.exact);
          return (
            <ListItemButton key={item.id} onClick={() => go(item.path)}
              sx={{
                borderRadius: '10px', mb: 0.5,
                pl: active ? '13px' : '16px', pr: 1.5, py: 0.85,
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                bgcolor: active ? `rgba(14,165,233,0.18)` : 'transparent',
                borderLeft: active ? `3px solid ${ACCENT}` : '3px solid transparent',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff' },
                transition: 'all 0.15s ease',
              }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                <item.icon sx={{ fontSize: 19 }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: active ? 600 : 400, lineHeight: 1.4, display: 'block' }}>
                    {item.label}
                  </Box>
                }
              />
            </ListItemButton>
          );
        })}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: 2 }} />

      {/* User footer */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Avatar sx={{ width: 34, height: 34, background: `linear-gradient(135deg, #0284c7, ${ACCENT})`, border: `2px solid rgba(14,165,233,0.4)`, fontSize: '0.82rem', fontWeight: 700 }}>
          {userName ? userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'SA'}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#fff', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName || 'System Admin'}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>System Administrator</Typography>
        </Box>
        <Tooltip title="Logout">
          <IconButton size="small" onClick={logout} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, borderRadius: 1.5 }}>
            <Logout sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => { if (!r.ok) { router.push('/login'); return null; } return r.json(); })
      .then(data => {
        if (data?.data) setUserName(data.data.name || '');
      })
      .catch(() => router.push('/login'));
  }, [router]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_W, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', top: 0, left: 0, width: SIDEBAR_W, height: '100vh', zIndex: 100 }}>
            <SidebarContent onClose={() => {}} userName={userName} />
          </Box>
        </Box>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_W, border: 'none' } }} ModalProps={{ keepMounted: true }}>
        <SidebarContent onClose={() => setDrawerOpen(false)} userName={userName} />
      </Drawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}>
        {isMobile && (
          <Box sx={{ position: 'sticky', top: 0, zIndex: 99, bgcolor: '#0f172a', px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <IconButton size="small" onClick={() => setDrawerOpen(true)} sx={{ color: 'white' }}><MenuIcon /></IconButton>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AdminPanelSettings sx={{ fontSize: 18, color: ACCENT }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: 'white' }}>SafeComm Admin</Typography>
            </Box>
          </Box>
        )}

        <Box
          component={motion.div}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          sx={{ flex: 1, p: { xs: 2, sm: 3 }, overflow: 'auto' }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
