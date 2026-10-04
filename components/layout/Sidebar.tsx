'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon,
  ListItemText, Typography, Avatar, Divider, IconButton, Tooltip, Badge,
} from '@mui/material';
import {
  Dashboard, Assessment, FolderOpen, Analytics, People, Message,
  Notifications, ChevronLeft, ChevronRight, Shield,
  Logout, Circle, ManageAccounts, History, Warning, RecordVoiceOver,
  MonitorHeart,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useDashboardStore } from '@/store/dashboardStore';
import { useCurrentUser } from '@/hooks/useApi';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

const mainNavItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Dashboard, path: '/dashboard' },
  { id: 'reports', label: 'Reports', icon: Assessment, path: '/reports' },
  { id: 'cases', label: 'Cases', icon: FolderOpen, path: '/cases' },
  { id: 'analytics', label: 'Analytics', icon: Analytics, path: '/analytics' },
  { id: 'risk', label: 'Risk Prediction', icon: Warning, path: '/risk', hideForRoles: ['admin'] },
  { id: 'residents', label: 'Residents', icon: People, path: '/residents' },
  { id: 'users', label: 'User Management', icon: ManageAccounts, path: '/users', hideForRoles: ['admin'] },
  { id: 'messages', label: 'Messages', icon: Message, path: '/messages' },
  { id: 'notifications', label: 'Notifications', icon: Notifications, path: '/notifications' },
  { id: 'audit-logs', label: 'Audit Logs', icon: History, path: '/audit-logs' },
];

const moduleNavItems = [
  { id: 'blotter-officer', label: 'Blotter Module', icon: RecordVoiceOver, path: '/blotter-officer', accent: '#3b82f6', hideForRoles: ['admin'] },
  { id: 'vawc', label: 'VAWC Module', icon: MonitorHeart, path: '/vawc', accent: '#7c3aed', hideForRoles: ['admin'] },
  { id: 'admin', label: 'System Admin', icon: ManageAccounts, path: '/admin', accent: '#0ea5e9', hideForRoles: ['admin'] },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, setSidebarCollapsed } = useDashboardStore();
  const { data: currentUser } = useCurrentUser();

  const navigate = (path: string) => {
    router.push(path);
    onMobileClose();
  };

  const isActive = (path: string) => pathname === path || (path === '/dashboard' && pathname === '/');

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const role = currentUser?.role ?? '';
  const visibleMainNavItems = mainNavItems.filter((item) => !item.hideForRoles?.includes(role));
  const visibleModuleNavItems = moduleNavItems.filter((item) => !item.hideForRoles?.includes(role));

  const userInitials = currentUser?.name
    ? currentUser.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';
  const roleLabel = currentUser?.role === 'admin'
    ? 'Barangay Captain'
    : currentUser?.role === 'system_admin'
    ? 'System Admin'
    : (currentUser?.role ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'Officer';

  const SidebarContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #071739 0%, #0c2461 50%, #071739 100%)',
        color: 'white',
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: sidebarCollapsed ? 1.5 : 2.5,
          py: 2.5,
          minHeight: 70,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Box
          sx={{
            width: 40, height: 40, borderRadius: 2.5,
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: '0 4px 15px rgba(59,130,246,0.4)',
          }}
        >
          <Shield sx={{ fontSize: 22, color: 'white' }} />
        </Box>
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Typography variant="h6" sx={{ fontWeight: 800, color: 'white', lineHeight: 1.1, fontSize: '1rem' }}>
                SafeComm
              </Typography>
              {/* The signed-in role, not a fixed one: this header sat above a
                  footer naming a different role on the same sidebar. */}
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' }}>
                {roleLabel}
              </Typography>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapse toggle — desktop only */}
        <Box sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>
          <IconButton
            size="small"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            sx={{
              color: 'rgba(255,255,255,0.5)',
              '&:hover': { color: 'white', background: 'rgba(255,255,255,0.1)' },
            }}
          >
            {sidebarCollapsed ? <ChevronRight fontSize="small" /> : <ChevronLeft fontSize="small" />}
          </IconButton>
        </Box>
      </Box>

      {/* Scrollable nav area */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)', borderRadius: 2 },
        '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.3)' },
      }}>

      {/* Nav Section Label */}
      <AnimatePresence>
        {!sidebarCollapsed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Typography
              sx={{ px: 2.5, pt: 2.5, pb: 0.5, fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)',
                letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 }}
            >
              Main Navigation
            </Typography>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Nav Items */}
      <List sx={{ px: sidebarCollapsed ? 0.75 : 1.5, py: 1 }}>
        {visibleMainNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Tooltip key={item.id} title={sidebarCollapsed ? item.label : ''} placement="right">
              <ListItem disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  onClick={() => navigate(item.path)}
                  sx={{
                    borderRadius: 2.5, py: 1.2,
                    px: sidebarCollapsed ? 1.5 : 1.5,
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    background: active ? 'linear-gradient(135deg, rgba(59,130,246,0.3) 0%, rgba(139,92,246,0.2) 100%)' : 'transparent',
                    border: active ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
                    '&:hover': { background: 'rgba(255,255,255,0.08)', '& .nav-icon': { transform: 'scale(1.15)' } },
                    transition: 'all 0.2s ease',
                  }}
                >
                  <ListItemIcon sx={{ minWidth: sidebarCollapsed ? 0 : 38, justifyContent: 'center' }}>
                    <Badge color="error" invisible={true}>
                      <Icon className="nav-icon" sx={{ fontSize: 20, color: active ? '#60a5fa' : 'rgba(255,255,255,0.55)', transition: 'transform 0.2s ease', filter: active ? 'drop-shadow(0 0 6px rgba(96,165,250,0.6))' : 'none' }} />
                    </Badge>
                  </ListItemIcon>
                  <AnimatePresence>
                    {!sidebarCollapsed && (
                      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} style={{ flex: 1 }}>
                        <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: '0.94rem', fontWeight: active ? 600 : 400, color: active ? '#e2e8f0' : 'rgba(255,255,255,0.6)' } } }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {active && !sidebarCollapsed && (
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', boxShadow: '0 0 8px rgba(96,165,250,0.8)' }} />
                  )}
                </ListItemButton>
              </ListItem>
            </Tooltip>
          );
        })}
      </List>

      {/* Other Modules section */}
      {visibleModuleNavItems.length > 0 && (
      <Box sx={{ px: sidebarCollapsed ? 0.75 : 1.5, pb: 1 }}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mb: 1 }} />
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Typography sx={{ px: 1, pb: 0.5, fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 }}>
                Other Modules
              </Typography>
            </motion.div>
          )}
        </AnimatePresence>
        <List disablePadding>
          {visibleModuleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.path);
            return (
              <Tooltip key={item.id} title={sidebarCollapsed ? item.label : ''} placement="right">
                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => navigate(item.path)}
                    sx={{
                      borderRadius: 2.5, py: 1.1,
                      px: sidebarCollapsed ? 1.5 : 1.5,
                      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                      background: active ? `${item.accent}28` : 'transparent',
                      border: active ? `1px solid ${item.accent}40` : '1px solid transparent',
                      '&:hover': { background: `${item.accent}18`, '& .mod-icon': { transform: 'scale(1.15)' } },
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: sidebarCollapsed ? 0 : 38, justifyContent: 'center' }}>
                      <Icon className="mod-icon" sx={{ fontSize: 19, color: active ? item.accent : 'rgba(255,255,255,0.45)', transition: 'transform 0.2s ease', filter: active ? `drop-shadow(0 0 5px ${item.accent}90)` : 'none' }} />
                    </ListItemIcon>
                    <AnimatePresence>
                      {!sidebarCollapsed && (
                        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} style={{ flex: 1 }}>
                          <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: '0.94rem', fontWeight: active ? 600 : 400, color: active ? '#e2e8f0' : 'rgba(255,255,255,0.55)' } } }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {active && !sidebarCollapsed && (
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: item.accent, boxShadow: `0 0 8px ${item.accent}90` }} />
                    )}
                  </ListItemButton>
                </ListItem>
              </Tooltip>
            );
          })}
        </List>
      </Box>
      )}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mx: 2 }} />

      {/* Profile */}
      <Box
        sx={{
          p: sidebarCollapsed ? 1 : 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          cursor: 'pointer',
          '&:hover': { background: 'rgba(255,255,255,0.05)' },
          transition: 'background 0.2s',
        }}
      >
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            sx={{
              width: 38, height: 38,
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              fontSize: '0.94rem', fontWeight: 700,
            }}
          >
            {userInitials}
          </Avatar>
          <Circle sx={{ position: 'absolute', bottom: -1, right: -1, fontSize: 12, color: '#22c55e' }} />
        </Box>
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: 'white', lineHeight: 1.2 }}>
                {currentUser?.name ?? 'Loading...'}
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                {roleLabel}
              </Typography>
            </motion.div>
          )}
        </AnimatePresence>
        {!sidebarCollapsed && (
          <Tooltip title="Logout">
            <IconButton size="small" onClick={handleLogout} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#ef4444' } }}>
              <Logout fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, border: 'none' },
        }}
      >
        {SidebarContent}
      </Drawer>

      {/* Desktop Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': {
            width: sidebarCollapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH,
            border: 'none',
            transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            overflowX: 'hidden',
          },
        }}
        open
      >
        {SidebarContent}
      </Drawer>
    </>
  );
}
