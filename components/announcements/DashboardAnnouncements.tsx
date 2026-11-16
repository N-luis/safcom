'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Box, Button, Card, CardContent, Chip, Skeleton, Typography } from '@mui/material';
import { ArrowForward, Campaign } from '@mui/icons-material';
import { type Announcement, levelOf, timeAgo, audienceLabel } from './ComposeAnnouncementDialog';

/**
 * The live announcements on a module's dashboard - the newest few, side by
 * side. Reads the same list the board does (/api/alerts, live only), so a
 * post published anywhere shows here; "View all" opens the module's board.
 */

const SHOWN = 3;
const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json().then(d => d.data) : []));

export default function DashboardAnnouncements({ accent, boardPath }: { accent: string; boardPath: string }) {
  const { data, error } = useSWR<Announcement[]>('/api/alerts', fetcher, { refreshInterval: 30000 });
  const loading = !data && !error;
  const live = (data ?? []).filter(a => a.active && !a.expired);

  return (
    <Card sx={{ mb: 3 }} data-testid="dashboard-announcements">
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
          <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Campaign sx={{ fontSize: 16, color: accent }} />
          </Box>
          <Typography component="h2" sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Announcements</Typography>
          {data && (
            <Chip label={`${live.length} live`} size="small"
              sx={{ bgcolor: live.length ? '#dcfce7' : '#f1f5f9', color: live.length ? '#15803d' : '#64748b', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          )}
          <Button size="small" component={Link} href={boardPath} endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
            sx={{ ml: 'auto', textTransform: 'none', fontWeight: 600, color: accent }}>
            View all
          </Button>
        </Box>

        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            {Array.from({ length: SHOWN }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} />)}
          </Box>
        ) : live.length === 0 ? (
          <Typography sx={{ fontSize: '0.88rem', color: '#94a3b8', py: 1 }}>No live announcements</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            {live.slice(0, SHOWN).map(a => {
              const lvl = levelOf(a.level);
              const LIcon = lvl.icon;
              return (
                <Box key={a.id} component={Link} href={boardPath} data-announcement
                  sx={{
                    display: 'block', p: 1.5, borderRadius: 2.5, minWidth: 0, textDecoration: 'none',
                    border: `1px solid ${lvl.color}33`, bgcolor: `${lvl.color}08`,
                    transition: 'border-color 0.15s', '&:hover': { borderColor: `${lvl.color}80` },
                    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
                  }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minWidth: 0 }}>
                    <LIcon sx={{ fontSize: 17, color: lvl.color, flexShrink: 0 }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {a.title}
                    </Typography>
                    <Chip label={lvl.label} size="small" sx={{ bgcolor: `${lvl.color}16`, color: lvl.color, fontWeight: 700, fontSize: '0.7rem', height: 20, flexShrink: 0 }} />
                  </Box>
                  <Typography sx={{ fontSize: '0.84rem', color: '#475569', mb: 0.75, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
                    {a.message}
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {timeAgo(a.createdAt)} · {audienceLabel(a)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
