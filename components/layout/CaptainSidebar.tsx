'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  Box, Typography, Avatar, Divider, IconButton, Tooltip,
  ListItemButton, ListItemIcon, ListItemText,
} from '@mui/material';
import {
  Dashboard as DashboardIcon, Groups, FolderOpen, Security,
  Logout, Gavel, Shield, AssignmentInd,
} from '@mui/icons-material';

/**
 * The Barangay Captain's navigation.
 *
 * Lives here rather than inside the Command Overview page because the captain
 * does not stay on that page: Residents, Reports and Staff are separate routes
 * that used to render the staff shell instead, so following a link in this
 * sidebar swapped the whole frame - different sidebar, and a top bar with
 * search and notifications that the captain's own design does not have.
 */

export const CAPTAIN_SIDEBAR_WIDTH = 260;
const ACCENT = '#0f766e';

export const CAPTAIN_NAV = [
  { id: 'overview', label: 'Command Overview', icon: DashboardIcon, path: '/dashboard', exact: true },
  { id: 'blotter', label: 'Blotter Module', icon: Gavel, path: '/blotter-officer' },
  { id: 'vawc', label: 'VAWC Module', icon: Shield, path: '/vawc' },
  { id: 'residents', label: 'Residents', icon: Groups, path: '/residents' },
  { id: 'reports', label: 'Reports', icon: FolderOpen, path: '/reports' },
  { id: 'users', label: 'Staff & Users', icon: AssignmentInd, path: '/users' },
];

export default function CaptainSidebar({ onClose, userName }: {
  onClose: () => void;
  userName: string;
}) {
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
      width: CAPTAIN_SIDEBAR_WIDTH, height: '100%',
      background: 'linear-gradient(180deg, #0c1e46 0%, #071739 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Logo */}
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px',
          background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 4px 14px rgba(15,118,110,0.4)',
        }}>
          <Security sx={{ fontSize: 20, color: 'white' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            SafeComm
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
            Barangay Captain
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
        {CAPTAIN_NAV.map(item => {
          const active = isActive(item.path, item.exact);
          return (
            <ListItemButton key={item.id} onClick={() => go(item.path)}
              sx={{
                borderRadius: '10px', mb: 0.5,
                pl: active ? '13px' : '16px', pr: 1.5, py: 0.85,
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                bgcolor: active ? 'rgba(15,118,110,0.22)' : 'transparent',
                borderLeft: active ? '3px solid #14b8a6' : '3px solid transparent',
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
        <Avatar sx={{
          width: 34, height: 34,
          background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`,
          border: '2px solid rgba(15,118,110,0.4)',
          fontSize: '0.82rem', fontWeight: 700,
        }}>
          {userName ? userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'BC'}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#fff', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName || 'Barangay Captain'}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>Barangay Captain</Typography>
        </Box>
        <Tooltip title="Logout">
          <IconButton size="small" onClick={logout}
            sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, borderRadius: 1.5 }}>
            <Logout sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
