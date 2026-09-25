'use client';

import { useState, useEffect, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Box, Drawer, ListItemButton, ListItemIcon, ListItemText,
  Typography, Avatar, IconButton, Tooltip, Divider,
  useMediaQuery, useTheme, Badge,
} from '@mui/material';
import {
  Dashboard, Assessment, FolderOpen, Notifications, Person,
  Shield, Logout, Menu as MenuIcon,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import { useClerk } from '@clerk/nextjs';
import { RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY } from '@/lib/notifications';

const SIDEBAR_W = 230;

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => r.json().then(d => d.data));

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: Dashboard, path: '/resident', exact: true },
  { id: 'report', label: 'File a Report', icon: Assessment, path: '/resident/report-case' },
  { id: 'cases', label: 'My Cases', icon: FolderOpen, path: '/resident/my-cases' },
  { id: 'notifications', label: 'Notifications', icon: Notifications, path: '/resident/notifications' },
  { id: 'profile', label: 'Profile', icon: Person, path: '/resident/profile' },
];

interface SidebarProps {
  onClose: () => void;
  residentName: string;
  residentStatus: string;
  unreadCount: number;
}

function SidebarContent({ onClose, residentName, residentStatus, unreadCount }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useClerk();

  const isActive = (path: string, exact?: boolean) =>
    exact ? pathname === path : pathname === path || pathname.startsWith(path + '/');

  const go = (path: string) => { router.push(path); onClose(); };

  const logout = async () => {
    // Clear the app's own resident_token first.
    await fetch('/api/auth/resident-logout', { method: 'POST', credentials: 'include' });
    // Clerk owns resident identity now, so end that session too — otherwise the
    // next person on this device is silently signed back in.
    try {
      await signOut({ redirectUrl: '/login' });
    } catch {
      /* no Clerk session to end — the cookie above was the only one */
    }
    router.replace('/login');
  };

  const initials = residentName
    ? residentName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'R';

  return (
    <Box sx={{
      width: SIDEBAR_W, height: '100%',
      background: 'linear-gradient(180deg, #071739 0%, #0c1e46 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Logo */}
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px',
          background: 'linear-gradient(135deg, #14b8a6, #0891b2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 4px 14px rgba(20,184,166,0.35)',
        }}>
          <Shield sx={{ fontSize: 20, color: 'white' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.02rem', color: '#fff', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            SafeComm
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Barangay Management
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
        {NAV.map(item => {
          const active = isActive(item.path, item.exact);
          return (
            <ListItemButton
              key={item.id}
              onClick={() => go(item.path)}
              sx={{
                borderRadius: '10px', mb: 0.5,
                pl: active ? '13px' : '16px', pr: 1.5, py: 0.9,
                color: active ? '#fff' : 'rgba(255,255,255,0.52)',
                bgcolor: active ? 'rgba(20,184,166,0.18)' : 'transparent',
                borderLeft: active ? '3px solid #14b8a6' : '3px solid transparent',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff' },
                transition: 'all 0.15s ease',
              }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                {item.id === 'notifications' && unreadCount > 0 ? (
                  <Badge
                    badgeContent={unreadCount > 9 ? '9+' : unreadCount}
                    color="error"
                    sx={{ '& .MuiBadge-badge': { fontSize: '0.72rem', height: 22, minWidth: 16 } }}
                  >
                    <item.icon sx={{ fontSize: 19 }} />
                  </Badge>
                ) : (
                  <item.icon sx={{ fontSize: 19 }} />
                )}
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
      <Box sx={{ px: 2, py: 1.75, display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: '#0891b2', border: '2px solid rgba(20,184,166,0.4)', fontSize: '0.82rem', fontWeight: 700 }}>
          {initials}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#fff', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {residentName || 'Resident'}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)' }}>
            {residentStatus || 'Verified Resident'}
          </Typography>
        </Box>
        <Tooltip title="Sign Out">
          <IconButton size="small" onClick={logout} sx={{ color: 'rgba(255,255,255,0.38)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, borderRadius: 1.5 }}>
            <Logout sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function ResidentLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [residentName, setResidentName] = useState('');
  const [residentStatus, setResidentStatus] = useState('');
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const { data: updates } = useSWR<{ id: string; createdAt: string }[]>(
    '/api/resident/updates?limit=20', fetcher, { refreshInterval: 30000 },
  );

  useEffect(() => {
    setLastSeen(Number(localStorage.getItem(RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY) ?? 0));
  }, []);

  // Mark notifications as read while the resident is viewing the notifications page
  useEffect(() => {
    if (!pathname.startsWith('/resident/notifications')) return;
    const now = Date.now();
    localStorage.setItem(RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY, String(now));
    setLastSeen(now);
  }, [pathname]);

  const unreadCount = lastSeen === null
    ? 0
    : (updates ?? []).filter(u => new Date(u.createdAt).getTime() > lastSeen).length;

  useEffect(() => {
    fetch('/api/auth/resident-me', { credentials: 'include' })
      .then(r => {
        if (!r.ok) { router.push('/resident-login'); return null; }
        return r.json();
      })
      .then(json => {
        if (!json?.data) return;
        const d = json.data;
        setResidentName(`${d.firstName} ${d.lastName}`);
        setResidentStatus(d.status === 'Active' ? 'Verified Resident' : d.status);
      })
      .catch(() => router.push('/resident-login'));
  }, [router]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f4f7fb' }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_W, flexShrink: 0 }}>
          <Box sx={{ position: 'fixed', top: 0, left: 0, width: SIDEBAR_W, height: '100vh', zIndex: 100 }}>
            <SidebarContent onClose={() => {}} residentName={residentName} residentStatus={residentStatus} unreadCount={unreadCount} />
          </Box>
        </Box>
      )}

      {/* Mobile drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_W, border: 'none' } }}
        ModalProps={{ keepMounted: true }}
      >
        <SidebarContent onClose={() => setDrawerOpen(false)} residentName={residentName} residentStatus={residentStatus} unreadCount={unreadCount} />
      </Drawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}>
        {/* Mobile topbar */}
        {isMobile && (
          <Box sx={{
            position: 'sticky', top: 0, zIndex: 99,
            bgcolor: '#071739', px: 2, py: 1.5,
            display: 'flex', alignItems: 'center', gap: 1.5,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <IconButton size="small" onClick={() => setDrawerOpen(true)} sx={{ color: 'white' }}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Shield sx={{ fontSize: 18, color: '#14b8a6' }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: 'white' }}>SafeComm</Typography>
            </Box>
          </Box>
        )}

        <Box
          component={motion.div}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          sx={{ flex: 1, overflow: 'auto' }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
