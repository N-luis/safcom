'use client';

import { useState, ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Box, Drawer, ListItemButton, ListItemIcon, ListItemText,
  Typography, Avatar, IconButton, Tooltip, Divider,
  useMediaQuery, useTheme,
} from '@mui/material';
import {
  Dashboard, FolderOpen, Category, Psychology, Campaign,
  Notifications, Search, RecordVoiceOver, Menu as MenuIcon,
  Shield, Logout, Message, ArrowBack,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import useSWR from 'swr';

const apiFetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json().then(d => d.data) : null);

const SIDEBAR_W = 260;

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Dashboard, path: '/blotter-officer', exact: true },
  { id: 'cases', label: 'Case Management', icon: FolderOpen, path: '/blotter-officer/case-management' },
  { id: 'classify', label: 'Case Classification', icon: Category, path: '/blotter-officer/case-classification' },
  { id: 'ai', label: 'AI Risk Prediction', icon: Psychology, path: '/blotter-officer/ai-risk-prediction' },
  // Path kept as /reports so existing links still resolve; the page behind it
  // is now purely announcements.
  { id: 'announcements', label: 'Announcements', icon: Campaign, path: '/blotter-officer/reports' },
  { id: 'messages', label: 'Messages', icon: Message, path: '/blotter-officer/messages' },
  { id: 'notifs', label: 'Notifications', icon: Notifications, path: '/blotter-officer/notifications' },
  { id: 'search', label: 'Search', icon: Search, path: '/blotter-officer/search' },
  { id: 'walkin', label: 'Walk-in Report', icon: RecordVoiceOver, path: '/blotter-officer/walk-in-report' },
];

function SidebarContent({ onClose, userName, badgeNo, isCaptain }: {
  onClose: () => void; userName: string; badgeNo: string; isCaptain: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: msgData }   = useSWR('/api/messages?folder=inbox&limit=1',    apiFetcher, { refreshInterval: 30000 });
  const { data: notifData } = useSWR('/api/notifications?limit=1',             apiFetcher, { refreshInterval: 30000 });
  const unreadMsgCount: number   = msgData?.unreadCount   ?? 0;
  const unreadNotifCount: number = notifData?.unreadCount ?? 0;

  const isActive = (path: string, exact?: boolean) =>
    exact ? pathname === path : (pathname === path || pathname.startsWith(path + '/'));

  const go = (path: string) => { router.push(path); onClose(); };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  return (
    <Box sx={{
      width: SIDEBAR_W, height: '100%',
      background: 'linear-gradient(180deg, #0c1e46 0%, #071739 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Logo */}
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px',
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Shield sx={{ fontSize: 20, color: 'white' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            SafeComm
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
            Blotter Administration
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: 2 }} />

      {/* Nav */}
      <Box sx={{
        flex: 1, overflowY: 'auto', px: 1.5, pt: 1.5, pb: 1,
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 2 },
      }}>
        {/* The Barangay Captain oversees this module from their own dashboard,
            so they get a way back. Blotter officers belong here and don't. */}
        {isCaptain && (
          <>
            <ListItemButton
              onClick={() => go('/dashboard')}
              sx={{
                borderRadius: '10px', mb: 1, pl: '16px', pr: 1.5, py: 0.85,
                color: '#5eead4',
                bgcolor: 'rgba(20,184,166,0.12)',
                border: '1px solid rgba(20,184,166,0.32)',
                '&:hover': { bgcolor: 'rgba(20,184,166,0.22)', color: '#fff' },
                transition: 'all 0.15s ease',
              }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                <ArrowBack sx={{ fontSize: 19 }} />
              </ListItemIcon>
              <ListItemText primary={
                <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.4, display: 'block' }}>
                  Captain Dashboard
                </Box>
              } />
            </ListItemButton>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mb: 1.5, mx: 0.5 }} />
          </>
        )}

        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path, (item as { exact?: boolean }).exact);
          return (
            <ListItemButton
              key={item.id}
              onClick={() => go(item.path)}
              sx={{
                borderRadius: '10px', mb: 0.5,
                pl: active ? '13px' : '16px', pr: 1.5, py: 0.85,
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                bgcolor: active ? 'rgba(59,130,246,0.2)' : 'transparent',
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
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
              {item.id === 'messages' && unreadMsgCount > 0 ? (
                <Box sx={{ minWidth: 18, height: 18, borderRadius: 9, bgcolor: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, px: 0.5, color: 'white', flexShrink: 0 }}>
                  {unreadMsgCount > 9 ? '9+' : unreadMsgCount}
                </Box>
              ) : item.id === 'notifs' && unreadNotifCount > 0 ? (
                <Box sx={{ minWidth: 18, height: 18, borderRadius: 9, bgcolor: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, px: 0.5, color: 'white', flexShrink: 0 }}>
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </Box>
              ) : null}
            </ListItemButton>
          );
        })}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: 2 }} />

      {/* User footer */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: '#1d4ed8', border: '2px solid rgba(59,130,246,0.4)', fontSize: '0.82rem', fontWeight: 700 }}>
          {userName ? userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'OF'}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#fff', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName || 'Officer Profile'}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
            {badgeNo || 'Badge #—'}
          </Typography>
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

export default function BlotterLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [badgeNo, setBadgeNo] = useState('');
  // Only the Barangay Captain ('admin') gets the link back to /dashboard —
  // not officers, and not system_admin, whose home is /admin.
  const [isCaptain, setIsCaptain] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then(r => {
      if (!r.ok) { router.push('/login'); return; }
      return r.json();
    }).then(data => {
      if (data?.data) {
        setUserName(data.data.name || '');
        setBadgeNo(data.data.id ? `Badge #${data.data.id.slice(-5).toUpperCase()}` : 'Officer');
        setIsCaptain(data.data.role === 'admin');
      }
    }).catch(() => router.push('/login'));
  }, [router]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f1f5f9' }}>
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_W, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', top: 0, left: 0, width: SIDEBAR_W, height: '100vh', zIndex: 100 }}>
            <SidebarContent onClose={() => {}} userName={userName} badgeNo={badgeNo} isCaptain={isCaptain} />
          </Box>
        </Box>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_W, border: 'none' } }}
        ModalProps={{ keepMounted: true }}
      >
        <SidebarContent onClose={() => setDrawerOpen(false)} userName={userName} badgeNo={badgeNo} isCaptain={isCaptain} />
      </Drawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}>
        {isMobile && (
          <Box sx={{
            position: 'sticky', top: 0, zIndex: 99,
            bgcolor: '#0c1e46', px: 2, py: 1.5,
            display: 'flex', alignItems: 'center', gap: 1.5,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <IconButton size="small" onClick={() => setDrawerOpen(true)} sx={{ color: 'white' }}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Shield sx={{ fontSize: 18, color: '#3b82f6' }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: 'white' }}>SafeComm Blotter</Typography>
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
