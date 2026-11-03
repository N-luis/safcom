'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, ToggleButton, ToggleButtonGroup, IconButton, TextField, MenuItem, Chip, Alert, Skeleton, Tooltip,
} from '@mui/material';
import { ChevronLeft, ChevronRight, Add, CalendarMonth, Refresh, Place, Person } from '@mui/icons-material';
import { HEARING_STATUSES, CALENDAR_STATUS_GROUPS, phDay, formatHearingTime, formatHearingDate, type HearingStatus, type CalendarStatusGroup } from '@/lib/hearings';
import CreateHearingDialog from './CreateHearingDialog';
import HearingDetailsDialog from './HearingDetailsDialog';
import { NAVY, STATUS_COLOR, chipSx, getJson } from './hearingUi';

interface Event {
  id: string; reference: string; hearingNumber: number; scheduledAt: string; venue: string | null; status: HearingStatus;
  case: { id: string; caseNumber: string; caseType: string };
  official: { id: string; name: string } | null; pendingRequests: number; overdue: boolean;
}
interface ListData { rows: Event[]; canCreate: boolean; filters: { categories: string[]; officials: { id: string; name: string }[] } }

type View = 'month' | 'week' | 'day' | 'upcoming';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86_400_000;

// Calendar arithmetic on Philippine dates, held as YYYY-MM-DD.
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromDate(new Date(toDate(d).getTime() + n * DAY));
const weekStart = (d: string) => addDays(d, -toDate(d).getUTCDay());
const monthGridStart = (d: string) => weekStart(`${d.slice(0, 7)}-01`);
const label = (d: string, o: Intl.DateTimeFormatOptions) => toDate(d).toLocaleDateString('en-PH', { ...o, timeZone: 'UTC' });

/**
 * The officials' Hearing Calendar: the hearings they may see, by month, week
 * or day, or as a list of what is coming. Filters by hearing number, status,
 * blotter category and assigned officer. Clicking a hearing opens its full
 * record and actions; clicking a day (for officials who schedule) starts a
 * new hearing on it. Only real hearing records appear - VAWC cases are never
 * on this calendar.
 */
export default function HearingCalendar({ caseBase }: { caseBase: string }) {
  const today = phDay(new Date());
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [groups, setGroups] = useState<CalendarStatusGroup[]>([]);
  const [category, setCategory] = useState('');
  const [official, setOfficial] = useState('');
  const [open, setOpen] = useState<{ caseId: string; hearingId: string } | null>(null);
  const [create, setCreate] = useState<{ date?: string; caseId?: string } | null>(null);

  // The days on screen.
  const range = useMemo(() => {
    if (view === 'month') { const s = monthGridStart(anchor); return { from: s, to: addDays(s, 41) }; }
    if (view === 'week') { const s = weekStart(anchor); return { from: s, to: addDays(s, 6) }; }
    if (view === 'day') return { from: anchor, to: anchor };
    return { from: today, to: addDays(today, 90) };
  }, [view, anchor, today]);

  const q = new URLSearchParams({ from: range.from, to: range.to });
  if (numbers.length) q.set('number', numbers.join(','));
  // The upcoming list is what is still to happen, unless the official chose statuses.
  const statusGroups = groups.length ? groups : view === 'upcoming' ? (['scheduled', 'rescheduled'] as CalendarStatusGroup[]) : [];
  if (statusGroups.length) q.set('status', statusGroups.join(','));
  if (category) q.set('category', category);
  if (official) q.set('official', official);
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/hearings?${q}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;

  const byDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of data?.rows ?? []) { const d = phDay(e.scheduledAt); map.set(d, [...(map.get(d) ?? []), e]); }
    return map;
  }, [data]);

  const shift = (dir: number) => setAnchor(a => view === 'month'
    ? fromDate(new Date(Date.UTC(toDate(a).getUTCFullYear(), toDate(a).getUTCMonth() + dir, 1)))
    : addDays(a, dir * (view === 'week' ? 7 : 1)));
  const title = view === 'month' ? label(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${label(range.from, { month: 'short', day: 'numeric' })} - ${label(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : view === 'day' ? label(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Next 90 days';
  const openEvent = (e: Event) => setOpen({ caseId: e.case.id, hearingId: e.id });
  const pickDay = (d: string) => { if (data?.canCreate && d >= today) setCreate({ date: d }); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarMonth sx={{ color: '#0369a1' }} />
          </Box>
          <Box>
            <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>Hearing Calendar</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Katarungang Pambarangay hearings you may see. VAWC cases and their appointments are never shown here.</Typography>
          </Box>
        </Box>
        {data?.canCreate && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreate({})} sx={{ ml: { sm: 'auto' }, textTransform: 'none', bgcolor: NAVY, borderRadius: 2, minHeight: 40 }}>
            Create Hearing
          </Button>
        )}
      </Box>

      {forbidden && <Alert severity="info" sx={{ borderRadius: 2 }}>{error?.message}</Alert>}
      {error && !forbidden && !data && (
        <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>
      )}

      {!forbidden && (
        <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            {/* Toolbar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="Calendar view">
                <ToggleButton value="month" sx={{ textTransform: 'none', px: 1.5 }}>Month</ToggleButton>
                <ToggleButton value="week" sx={{ textTransform: 'none', px: 1.5 }}>Week</ToggleButton>
                <ToggleButton value="day" sx={{ textTransform: 'none', px: 1.5 }}>Day</ToggleButton>
                <ToggleButton value="upcoming" sx={{ textTransform: 'none', px: 1.5 }}>Upcoming</ToggleButton>
              </ToggleButtonGroup>
              {view !== 'upcoming' && (
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton size="small" onClick={() => shift(-1)} aria-label={`Previous ${view}`}><ChevronLeft /></IconButton>
                  <IconButton size="small" onClick={() => shift(1)} aria-label={`Next ${view}`}><ChevronRight /></IconButton>
                  <Button size="small" onClick={() => setAnchor(today)} sx={{ textTransform: 'none' }}>Today</Button>
                </Box>
              )}
              <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }} aria-live="polite">{title}</Typography>
              <Tooltip title="Reload"><IconButton size="small" onClick={() => mutate()} aria-label="Reload" sx={{ ml: 'auto' }}><Refresh /></IconButton></Tooltip>
            </Box>

            {/* Filters */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
              {[1, 2, 3].map(n => (
                <Chip key={n} label={`Hearing ${n}`} clickable onClick={() => setNumbers(l => toggle(l, n))} aria-pressed={numbers.includes(n)}
                  variant={numbers.includes(n) ? 'filled' : 'outlined'} sx={{ fontWeight: 600, ...(numbers.includes(n) && { bgcolor: NAVY, color: '#fff' }) }} />
              ))}
              <Box sx={{ width: 8 }} />
              {(Object.keys(CALENDAR_STATUS_GROUPS) as CalendarStatusGroup[]).map(g => (
                <Chip key={g} label={CALENDAR_STATUS_GROUPS[g].label} clickable onClick={() => setGroups(l => toggle(l, g))} aria-pressed={groups.includes(g)}
                  variant={groups.includes(g) ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 600, ...(groups.includes(g) && { bgcolor: STATUS_COLOR[CALENDAR_STATUS_GROUPS[g].statuses[0] as HearingStatus], color: '#fff' }) }} />
              ))}
              <TextField select size="small" label="Blotter category" value={category} onChange={e => setCategory(e.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="">All categories</MenuItem>
                {(data?.filters.categories ?? []).map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Assigned officer" value={official} onChange={e => setOfficial(e.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="">All officers</MenuItem>
                {(data?.filters.officials ?? []).map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
              </TextField>
              {(numbers.length > 0 || groups.length > 0 || category || official) && (
                <Button size="small" onClick={() => { setNumbers([]); setGroups([]); setCategory(''); setOfficial(''); }} sx={{ textTransform: 'none' }}>Clear filters</Button>
              )}
            </Box>

            {isLoading && !data ? <Skeleton variant="rounded" height={420} /> : data && (
              <>
                {view === 'month' && <Month from={range.from} anchor={anchor} today={today} byDay={byDay} onOpen={openEvent} onPick={data.canCreate ? pickDay : undefined} />}
                {view === 'week' && <Week from={range.from} today={today} byDay={byDay} onOpen={openEvent} onPick={data.canCreate ? pickDay : undefined} />}
                {view === 'day' && <DayList events={byDay.get(anchor) ?? []} onOpen={openEvent} empty={`No hearing on ${label(anchor, { month: 'long', day: 'numeric' })}.`} />}
                {view === 'upcoming' && <Upcoming byDay={byDay} onOpen={openEvent} />}
                <Legend />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {create && <CreateHearingDialog caseId={create.caseId} initialDate={create.date} classificationHref={id => `${caseBase}/${id}`}
        onClose={() => setCreate(null)} onCreated={() => { setCreate(null); void mutate(); }} />}
      {open && <HearingDetailsDialog caseId={open.caseId} hearingId={open.hearingId} caseHref={`${caseBase}/${open.caseId}`}
        onClose={() => setOpen(null)} onChanged={() => mutate()} onScheduleNext={caseId => { setOpen(null); setCreate({ caseId }); }} />}
    </Box>
  );
}

/** A hearing in a calendar cell: time, hearing number, case; the rest on hover and in the details. */
function EventChip({ e, onOpen, full = false }: { e: Event; onOpen: (e: Event) => void; full?: boolean }) {
  const c = STATUS_COLOR[e.status];
  const desc = `${formatHearingTime(e.scheduledAt)}, Hearing ${e.hearingNumber}, case ${e.case.caseNumber}, ${e.venue ?? 'Barangay Hall'}, ${e.official?.name ?? 'no officer assigned'}, ${HEARING_STATUSES[e.status]}`;
  return (
    <Tooltip title={desc}>
      <Box component="button" type="button" onClick={ev => { ev.stopPropagation(); onOpen(e); }} aria-label={desc} data-event={e.id}
        sx={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderLeft: `3px solid ${c}`, cursor: 'pointer', borderRadius: 1, px: 0.5, py: 0.25, mt: 0.25,
          bgcolor: `${c}14`, color: c, fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: full ? 'normal' : 'nowrap',
          textDecoration: e.status === 'CANCELLED' ? 'line-through' : 'none', '&:focus-visible': { outline: `2px solid ${c}` } }}>
        {formatHearingTime(e.scheduledAt)} · H{e.hearingNumber} · {e.case.caseNumber}
        {full && (
          <Box component="span" sx={{ display: 'block', fontWeight: 500, color: '#475569' }}>
            {e.venue ?? 'Barangay Hall'} · {e.official?.name ?? 'No officer'} · {HEARING_STATUSES[e.status]}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

function Month({ from, anchor, today, byDay, onOpen, onPick }: { from: string; anchor: string; today: string; byDay: Map<string, Event[]>; onOpen: (e: Event) => void; onPick?: (d: string) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box role="grid" aria-label="Month" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(96px, 1fr))', gap: 0.5, minWidth: 700 }}>
        {WEEKDAYS.map(d => <Typography key={d} role="columnheader" sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textAlign: 'center' }}>{d}</Typography>)}
        {days.map(d => {
          const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
          const events = byDay.get(d) ?? [];
          return (
            <Box key={d} role="gridcell" data-day={d} onClick={onPick ? () => onPick(d) : undefined}
              sx={{ minHeight: 96, border: '1px solid', borderColor: d === today ? '#0369a1' : '#e2e8f0', borderRadius: 1.5, p: 0.5,
                bgcolor: inMonth ? '#fff' : '#f8fafc', cursor: onPick && d >= today ? 'copy' : 'default' }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: d === today ? 800 : 600, color: d === today ? '#0369a1' : inMonth ? '#475569' : '#cbd5e1' }}>{Number(d.slice(8))}</Typography>
              {events.slice(0, 3).map(e => <EventChip key={e.id} e={e} onOpen={onOpen} />)}
              {events.length > 3 && <Typography sx={{ fontSize: '0.66rem', color: '#64748b', mt: 0.25 }}>+{events.length - 3} more</Typography>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Week({ from, today, byDay, onOpen, onPick }: { from: string; today: string; byDay: Map<string, Event[]>; onOpen: (e: Event) => void; onPick?: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))', gap: 0.75, minWidth: 920 }}>
        {days.map(d => {
          const events = byDay.get(d) ?? [];
          return (
            <Box key={d} data-day={d} onClick={onPick ? () => onPick(d) : undefined}
              sx={{ border: '1px solid', borderColor: d === today ? '#0369a1' : '#e2e8f0', borderRadius: 1.5, p: 0.75, minHeight: 300, cursor: onPick && d >= today ? 'copy' : 'default' }}>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: d === today ? '#0369a1' : NAVY }}>{label(d, { weekday: 'short', month: 'short', day: 'numeric' })}</Typography>
              {events.length === 0 && <Typography sx={{ fontSize: '0.7rem', color: '#cbd5e1', mt: 0.5 }}>No hearing</Typography>}
              {events.map(e => <EventChip key={e.id} e={e} onOpen={onOpen} full />)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function DayList({ events, onOpen, empty }: { events: Event[]; onOpen: (e: Event) => void; empty: string }) {
  if (!events.length) return <Box sx={{ textAlign: 'center', py: 5 }}><CalendarMonth sx={{ fontSize: 34, color: '#cbd5e1' }} /><Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>{empty}</Typography></Box>;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {events.map(e => (
        <Box key={e.id} component="button" type="button" onClick={() => onOpen(e)} data-event={e.id}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '96px 1fr auto' }, gap: { xs: 0.5, sm: 1.5 }, alignItems: 'center', textAlign: 'left', width: '100%',
            border: '1px solid #e2e8f0', borderLeft: `4px solid ${STATUS_COLOR[e.status]}`, borderRadius: 2, p: 1.25, bgcolor: '#fff', cursor: 'pointer', fontFamily: 'inherit',
            '&:hover': { bgcolor: '#f8fafc' }, '&:focus-visible': { outline: '2px solid #0369a1' } }}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>{formatHearingTime(e.scheduledAt)}</Typography>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.88rem' }}>Hearing {e.hearingNumber} · {e.case.caseNumber} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {e.case.caseType}</span></Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', color: '#475569', fontSize: '0.8rem', mt: 0.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Place sx={{ fontSize: 15 }} />{e.venue ?? 'Barangay Hall'}</Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Person sx={{ fontSize: 15 }} />{e.official?.name ?? 'No officer assigned'}</Box>
              <span>{formatHearingDate(e.scheduledAt)}</span>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: { sm: 'flex-end' } }}>
            <Chip size="small" label={HEARING_STATUSES[e.status]} sx={chipSx(STATUS_COLOR[e.status])} />
            {e.overdue && <Chip size="small" label="Record the outcome" sx={chipSx('#b91c1c')} />}
            {e.pendingRequests > 0 && <Chip size="small" label="New date requested" sx={chipSx('#b45309')} />}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Upcoming({ byDay, onOpen }: { byDay: Map<string, Event[]>; onOpen: (e: Event) => void }) {
  const days = [...byDay.keys()].sort();
  if (!days.length) return <DayList events={[]} onOpen={onOpen} empty="No upcoming hearing in the next 90 days." />;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {days.map(d => (
        <Box key={d}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.88rem', mb: 0.75 }}>{label(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Typography>
          <DayList events={byDay.get(d)!} onOpen={onOpen} empty="" />
        </Box>
      ))}
    </Box>
  );
}

function Legend() {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }} aria-label="Status colours">
      {(Object.keys(HEARING_STATUSES) as HearingStatus[]).map(s => (
        <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: STATUS_COLOR[s] }} />
          <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>{HEARING_STATUSES[s]}</Typography>
        </Box>
      ))}
    </Box>
  );
}
