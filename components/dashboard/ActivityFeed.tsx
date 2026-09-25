'use client';

import { Box, Card, CardContent, Typography, Chip, Divider, Skeleton } from '@mui/material';
import { FolderOpen, Assessment, NotificationsActive, Update, Warning } from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useActivities } from '@/hooks/useApi';

const activityIcons: Record<string, React.ElementType> = {
  case: FolderOpen,
  report: Assessment,
  alert: Warning,
  notification: NotificationsActive,
  update: Update,
  resident: NotificationsActive,
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ActivityFeed() {
  const { data: activities, isLoading } = useActivities(8);

  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Recent Activity</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.86rem' }}>
              Latest case updates & alerts
            </Typography>
          </Box>
          <Chip label="Live" size="small" sx={{ bgcolor: '#22c55e', color: 'white', fontWeight: 700, fontSize: '0.78rem',
            animation: 'pulse 2s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } } }} />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1.5, p: 1.5 }}>
                  <Skeleton variant="rounded" width={36} height={36} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="80%" />
                    <Skeleton variant="text" width="40%" />
                  </Box>
                </Box>
              ))
            : (activities ?? []).map((activity: any, index: number) => {
                const Icon = activityIcons[activity.type] || NotificationsActive;
                const color = activity.color || '#3b82f6';
                return (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.06, duration: 0.35 }}
                  >
                    <Box sx={{
                      display: 'flex', gap: 1.5, p: 1.5, borderRadius: 2.5,
                      cursor: 'pointer', transition: 'background 0.2s',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}>
                      <Box sx={{
                        width: 36, height: 36, borderRadius: 2,
                        bgcolor: `${color}18`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, border: `1px solid ${color}30`,
                      }}>
                        <Icon sx={{ fontSize: 18, color }} />
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.4, mb: 0.3 }}>
                          {activity.message}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {activity.user?.name && (
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'primary.main' }}>
                              {activity.user.name}
                            </Typography>
                          )}
                          <Typography sx={{ fontSize: '0.78rem' }} color="text.disabled">
                            {timeAgo(activity.createdAt)}
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{
                        width: 8, height: 8, borderRadius: '50%',
                        bgcolor: color, flexShrink: 0, mt: 0.8,
                        boxShadow: `0 0 6px ${color}80`,
                      }} />
                    </Box>
                    {index < (activities?.length ?? 0) - 1 && (
                      <Divider sx={{ mx: 2, opacity: 0.4 }} />
                    )}
                  </motion.div>
                );
              })}
        </Box>
      </CardContent>
    </Card>
  );
}
