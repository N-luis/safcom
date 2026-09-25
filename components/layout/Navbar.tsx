'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppBar, Toolbar, IconButton, InputBase, Box, Avatar, Badge,
  Menu, MenuItem, Typography, Divider, Tooltip, Paper,
  ListItemIcon, ListItemText, Chip,
} from '@mui/material';
import {
  Menu as MenuIcon, Search, Notifications, Message, DarkMode, LightMode,
  AccountCircle, Settings, Logout, NotificationsActive, Circle, OpenInNew,
} from '@mui/icons-material';
import { useDashboardStore } from '@/store/dashboardStore';
import { useNotifications, useMessages, useCurrentUser, refreshNotifications } from '@/hooks/useApi';
import toast from 'react-hot-toast';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/dashboard': 'Dashboard',
  '/reports': 'Reports',
  '/cases': 'Cases',
  '/analytics': 'Analytics',
  '/residents': 'Residents',
  '/settings': 'Settings',
  '/messages': 'Messages',
  '/notifications': 'Notifications',
};

const notifColors: Record<string, string> = {
  error: '#ef4444', success: '#22c55e', warning: '#f97316', info: '#3b82f6',
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface NavbarProps { onMobileMenuOpen: () => void }

export default function Navbar({ onMobileMenuOpen }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, darkMode, toggleDarkMode } = useDashboardStore();
  const [searchValue, setSearchValue] = useState('');
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null);
  const [notifAnchor, setNotifAnchor] = useState<null | HTMLElement>(null);

  const { data: currentUser } = useCurrentUser();
  const { data: notifData, mutate: mutateNotifs } = useNotifications(20);
  const { data: msgData } = useMessages('inbox');

  const notifications: Record<string, unknown>[] = notifData?.notifications ?? [];
  const unreadCount: number = notifData?.unreadCount ?? 0;
  const msgUnreadCount: number = msgData?.unreadCount ?? 0;

  const userName: string = currentUser?.name ?? 'Admin User';
  const userEmail: string = currentUser?.email ?? '';
  const userInitials: string = userName
    ? userName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';
  const userRole: string = currentUser?.role === 'admin'
    ? 'Barangay Captain'
    : currentUser?.role === 'system_admin'
    ? 'System Admin'
    : (currentUser?.role ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'Officer';

  const currentLabel = routeLabels[pathname] || 'Dashboard';
  const sidebarWidth = sidebarCollapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
    mutateNotifs();
    refreshNotifications();
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH' });
    mutateNotifs();
    refreshNotifications();
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    toast.success('Logged out');
  }

  return (
    <AppBar position="fixed" elevation={0}
      sx={{
        left: { xs: 0, md: sidebarWidth },
        width: { xs: '100%', md: `calc(100% - ${sidebarWidth}px)` },
        transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1), width 0.25s cubic-bezier(0.4,0,0.2,1)',
        background: darkMode ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
        color: darkMode ? '#e2e8f0' : '#1e293b',
      }}
    >
      <Toolbar sx={{ gap: 2, minHeight: '64px !important' }}>
        <IconButton sx={{ display: { xs: 'flex', md: 'none' }, color: 'inherit' }} onClick={onMobileMenuOpen}>
          <MenuIcon />
        </IconButton>

        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexDirection: 'column' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, fontSize: '1.1rem' }}>{currentLabel}</Typography>
          <Typography sx={{ fontSize: '0.82rem' }} color="text.secondary">SafeComm · {userRole}</Typography>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        {/* Search */}
        <Paper elevation={0}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75, borderRadius: 3,
            background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            width: { xs: 160, sm: 240 }, transition: 'all 0.2s',
            '&:focus-within': { border: '1px solid #3b82f6', boxShadow: '0 0 0 3px rgba(59,130,246,0.12)' },
          }}
        >
          <Search sx={{ fontSize: 18, color: 'text.secondary' }} />
          <InputBase placeholder="Search..." value={searchValue} onChange={(e) => setSearchValue(e.target.value)}
            sx={{ fontSize: '0.94rem', flex: 1, color: 'inherit' }} />
        </Paper>

        <Tooltip title={darkMode ? 'Light Mode' : 'Dark Mode'}>
          <IconButton onClick={toggleDarkMode} sx={{ color: 'inherit' }}>
            {darkMode ? <LightMode sx={{ fontSize: 20 }} /> : <DarkMode sx={{ fontSize: 20 }} />}
          </IconButton>
        </Tooltip>

        {/* Notifications */}
        <Tooltip title="Notifications">
          <IconButton onClick={(e) => setNotifAnchor(e.currentTarget)} sx={{ color: 'inherit' }}>
            <Badge badgeContent={unreadCount} color="error">
              <Notifications sx={{ fontSize: 22 }} />
            </Badge>
          </IconButton>
        </Tooltip>

        {/* Messages */}
        <Tooltip title="Messages">
          <IconButton sx={{ color: 'inherit' }} onClick={() => router.push('/messages')}>
            <Badge badgeContent={msgUnreadCount} color="primary">
              <Message sx={{ fontSize: 22 }} />
            </Badge>
          </IconButton>
        </Tooltip>

        {/* Profile */}
        <Box onClick={(e) => setProfileAnchor(e.currentTarget)}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', px: 1, py: 0.5, borderRadius: 2.5,
            '&:hover': { background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }, transition: 'background 0.2s' }}>
          <Box sx={{ position: 'relative' }}>
            <Avatar sx={{ width: 36, height: 36, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', fontSize: '0.9rem', fontWeight: 700 }}>{userInitials}</Avatar>
            <Circle sx={{ position: 'absolute', bottom: -1, right: -1, fontSize: 11, color: '#22c55e' }} />
          </Box>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.2 }}>{userName}</Typography>
            <Typography sx={{ fontSize: '0.78rem' }} color="text.secondary">{userRole}</Typography>
          </Box>
        </Box>
      </Toolbar>

      {/* Notifications Menu */}
      <Menu anchorEl={notifAnchor} open={Boolean(notifAnchor)} onClose={() => setNotifAnchor(null)}
        slotProps={{ paper: { elevation: 8, sx: { width: 360, borderRadius: 3, mt: 1, maxHeight: 480 } } }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 700 }}>Notifications</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {unreadCount > 0 && <Chip label={`${unreadCount} new`} size="small" color="primary" sx={{ fontSize: '0.78rem' }} />}
          </Box>
        </Box>
        <Divider />
        {notifications.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography color="text.secondary" sx={{ fontSize: '0.94rem' }}>No notifications</Typography>
          </Box>
        ) : notifications.slice(0, 6).map((n) => (
          <MenuItem key={n.id as string}
            onClick={() => { markRead(n.id as string); setNotifAnchor(null); }}
            sx={{ py: 1.5, px: 2, gap: 1.5, background: n.read ? 'transparent' : 'rgba(59,130,246,0.04)',
              borderLeft: n.read ? '3px solid transparent' : `3px solid ${notifColors[(n.type as string)] ?? '#3b82f6'}` }}
          >
            <NotificationsActive sx={{ fontSize: 18, color: notifColors[(n.type as string)] ?? '#3b82f6', flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: n.read ? 400 : 600 }}>{n.title as string}</Typography>
              <Typography sx={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} color="text.secondary">
                {n.message as string}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', mt: 0.3 }} color="text.disabled">{timeAgo(n.createdAt as string)}</Typography>
            </Box>
          </MenuItem>
        ))}
        <Divider />
        <Box sx={{ display: 'flex' }}>
          {unreadCount > 0 && (
            <MenuItem onClick={() => { markAllRead(); setNotifAnchor(null); }} sx={{ flex: 1, justifyContent: 'center', py: 1.2 }}>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }} color="primary">Mark all as read</Typography>
            </MenuItem>
          )}
          <MenuItem onClick={() => { setNotifAnchor(null); router.push('/notifications'); }} sx={{ flex: 1, justifyContent: 'center', py: 1.2, gap: 0.5 }}>
            <OpenInNew sx={{ fontSize: 14 }} color="action" />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }} color="text.secondary">View all</Typography>
          </MenuItem>
        </Box>
      </Menu>

      {/* Profile Menu */}
      <Menu anchorEl={profileAnchor} open={Boolean(profileAnchor)} onClose={() => setProfileAnchor(null)}
        slotProps={{ paper: { elevation: 8, sx: { width: 220, borderRadius: 3, mt: 1 } } }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.98rem' }}>{userName}</Typography>
          <Typography sx={{ fontSize: '0.86rem' }} color="text.secondary">{userEmail || userRole}</Typography>
        </Box>
        <Divider />
        <MenuItem sx={{ gap: 1.5, py: 1.2 }} onClick={() => { setProfileAnchor(null); router.push('/settings'); }}>
          <ListItemIcon><AccountCircle fontSize="small" /></ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: '0.94rem' } } }}>Profile</ListItemText>
        </MenuItem>
        <MenuItem sx={{ gap: 1.5, py: 1.2 }} onClick={() => { setProfileAnchor(null); router.push('/settings'); }}>
          <ListItemIcon><Settings fontSize="small" /></ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: '0.94rem' } } }}>Settings</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem sx={{ gap: 1.5, py: 1.2, color: '#ef4444' }} onClick={handleLogout}>
          <ListItemIcon><Logout fontSize="small" sx={{ color: '#ef4444' }} /></ListItemIcon>
          <ListItemText slotProps={{ primary: { sx: { fontSize: '0.94rem', color: '#ef4444' } } }}>Logout</ListItemText>
        </MenuItem>
      </Menu>
    </AppBar>
  );
}
