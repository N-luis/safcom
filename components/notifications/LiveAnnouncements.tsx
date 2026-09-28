'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import useSWR, { mutate as globalMutate } from 'swr';
import toast from 'react-hot-toast';
import { Box, Typography, IconButton, Button } from '@mui/material';
import { Campaign, Close } from '@mui/icons-material';

/**
 * Pops an announcement onto the screen the moment an official publishes it,
 * wherever the viewer happens to be, instead of leaving it to be discovered on
 * the Notifications page later.
 *
 * Mounted once in the root layout: the Captain's pages build their sidebar
 * inline rather than through a layout, so per-shell mounting would have missed
 * them. The path decides which feed to watch, and public pages watch nothing.
 */

const RESIDENT_FEED = '/api/resident/updates?limit=20';
const STAFF_FEED = '/api/notifications?limit=20';

/** How often we look. Announcements carry typhoon and evacuation notices, so
 *  this is deliberately tighter than the 30s used for dashboard statistics. */
const POLL_MS = 15_000;

const TYPE_COLOR: Record<string, string> = {
  error: '#ef4444', warning: '#f97316', success: '#22c55e', info: '#3b82f6',
};

/** Pages where nobody is signed in yet, so there is nothing to announce. */
const PUBLIC_PREFIXES = [
  '/login', '/register', '/resident-login', '/vawc-login', '/verify-email',
  '/sign-in', '/sign-up', '/complete-profile', '/forgot',
];

type Area = 'off' | 'resident' | 'staff';

interface Item { id: string; title: string; message: string; color: string; createdAt: string }

function areaFor(pathname: string): Area {
  if (pathname === '/' || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return 'off';
  if (pathname.startsWith('/resident')) return 'resident';
  return 'staff';
}

function notificationsHref(pathname: string): string {
  if (pathname.startsWith('/resident')) return '/resident/notifications';
  if (pathname.startsWith('/blotter-officer')) return '/blotter-officer/notifications';
  if (pathname.startsWith('/vawc')) return '/vawc/notifications';
  // No MODULE_ACCESS rule guards /notifications, so it is reachable by any
  // signed-in staff account, Captain and System Admin included.
  return '/notifications';
}

const seenKey = (area: Area) => `safcom_live_seen_${area}`;

function readSeen(area: Area): number {
  try { return Number(localStorage.getItem(seenKey(area)) ?? 0) || 0; } catch { return 0; }
}
function writeSeen(area: Area, ts: number) {
  try { localStorage.setItem(seenKey(area), String(ts)); } catch { /* private mode */ }
}

/**
 * Pushes the watermark past everything published so far. Called right after the
 * user publishes, so the officer who wrote the announcement is not immediately
 * toasted by their own post on top of the success message they already got.
 */
export function markAnnouncementsSeen() {
  const now = Date.now();
  (['resident', 'staff'] as Area[]).forEach(a => writeSeen(a, now));
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(d => d?.data ?? null);

/** Both feeds are flattened to the same shape so one renderer serves them. */
export function normalise(area: Area, data: unknown): Item[] {
  if (!data) return [];
  if (area === 'resident') {
    const rows = data as { id: string; source?: string; title: string; message: string; color?: string; createdAt: string }[];
    return (Array.isArray(rows) ? rows : [])
      // Case activity has its own place in the feed; only announcements pop.
      .filter(u => u.source === 'alert')
      .map(u => ({ id: u.id, title: u.title, message: u.message, color: u.color || '#3b82f6', createdAt: u.createdAt }));
  }
  const rows = (data as { notifications?: { id: string; title: string; message: string; type: string; createdAt: string }[] })?.notifications;
  return (rows ?? []).map(n => ({
    id: n.id, title: n.title, message: n.message,
    color: TYPE_COLOR[n.type] ?? '#3b82f6', createdAt: n.createdAt,
  }));
}

/**
 * Which items deserve a toast: newer than the watermark, not already shown, and
 * capped so a burst during a storm cannot bury the screen. Pure, so the rule
 * can be checked without a browser.
 */
export function pickFresh(items: Item[], watermark: number, alreadyToasted: Set<string>, cap = 3): Item[] {
  return items
    .filter(i => +new Date(i.createdAt) > watermark)
    .filter(i => !alreadyToasted.has(i.id))
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    .slice(-cap);
}

export type { Item };

function AnnouncementToast({ item, href, onDismiss, onOpen }: {
  item: Item; href: string; onDismiss: () => void; onOpen: (href: string) => void;
}) {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex', gap: 1.25, alignItems: 'flex-start',
        width: 360, maxWidth: '92vw', bgcolor: '#fff', borderRadius: 2.5, p: 1.75,
        boxShadow: '0 12px 34px rgba(12,30,70,0.18)',
        borderLeft: `4px solid ${item.color}`,
      }}
    >
      <Box sx={{
        width: 30, height: 30, borderRadius: 1.5, bgcolor: `${item.color}18`, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Campaign sx={{ fontSize: 17, color: item.color }} />
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: item.color, mb: 0.25 }}>
          New announcement
        </Typography>
        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', lineHeight: 1.35 }}>
          {item.title}
        </Typography>
        <Typography sx={{
          fontSize: '0.84rem', color: '#64748b', lineHeight: 1.45, mt: 0.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {item.message}
        </Typography>
        <Button
          size="small" onClick={() => onOpen(href)}
          sx={{ mt: 0.75, px: 0, minWidth: 0, fontWeight: 700, fontSize: '0.82rem', color: item.color, textTransform: 'none' }}
        >
          View in Notifications
        </Button>
      </Box>

      <IconButton size="small" onClick={onDismiss} aria-label="Dismiss" sx={{ color: '#94a3b8', mt: -0.5, mr: -0.5 }}>
        <Close sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

export default function LiveAnnouncements() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const area = areaFor(pathname);

  // The watermark lives in a ref: it has to survive re-renders without
  // re-triggering the effect that reads it.
  const seenRef = useRef<number | null>(null);
  const toastedRef = useRef<Set<string>>(new Set());
  const areaRef = useRef<Area>(area);

  // Switching between the resident portal and a staff module means a different
  // feed and a different watermark.
  useEffect(() => {
    if (areaRef.current !== area) {
      areaRef.current = area;
      seenRef.current = null;
      toastedRef.current = new Set();
    }
  }, [area]);

  const { data } = useSWR(
    area === 'off' ? null : area === 'resident' ? RESIDENT_FEED : STAFF_FEED,
    fetcher,
    { refreshInterval: POLL_MS, revalidateOnFocus: true, shouldRetryOnError: false },
  );

  useEffect(() => {
    if (area === 'off' || !data) return;

    const items = normalise(area, data);
    const newest = items.reduce((max, i) => Math.max(max, +new Date(i.createdAt)), 0);

    // First look: adopt a watermark and stay quiet, so opening a page never
    // replays announcements the viewer has already lived through.
    if (seenRef.current === null) {
      seenRef.current = Math.max(readSeen(area), newest);
      writeSeen(area, seenRef.current);
      return;
    }

    const fresh = pickFresh(items, seenRef.current, toastedRef.current);

    if (!fresh.length) return;

    const href = notificationsHref(pathname);
    fresh.forEach(item => {
      toastedRef.current.add(item.id);
      toast.custom(
        t => (
          <AnnouncementToast
            item={item}
            href={href}
            onDismiss={() => toast.dismiss(t.id)}
            onOpen={h => { toast.dismiss(t.id); router.push(h); }}
          />
        ),
        { duration: 12_000, position: 'top-right', id: item.id },
      );
    });

    seenRef.current = Math.max(seenRef.current, newest);
    writeSeen(area, seenRef.current);

    // The sidebar badges run their own slower poll; nudge them so the count
    // moves at the same moment the toast appears.
    globalMutate(
      key => typeof key === 'string'
        && (key.includes('/api/resident/updates') || key.includes('/api/notifications')),
      undefined,
      { revalidate: true },
    );
  }, [data, area, pathname, router]);

  return null;
}
