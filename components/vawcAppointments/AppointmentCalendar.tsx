'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, ToggleButton, ToggleButtonGroup, IconButton, TextField, MenuItem, Chip, Alert, Skeleton, Tooltip,
} from '@mui/material';
import { ChevronLeft, ChevronRight, Add, CalendarMonth, Refresh, Place, Person, ViewList } from '@mui/icons-material';
import { phDay, formatHearingTime, formatHearingDate } from '@/lib/hearings';
import { APPOINTMENT_TYPES, APPOINTMENT_TYPE_KEYS, APPOINTMENT_STATUSES, type AppointmentStatus, type AppointmentView } from '@/lib/vawcAppointments';
import CreateAppointmentDialog from './CreateAppointmentDialog';
import AppointmentDetailsDialog from './AppointmentDetailsDialog';
import { NAVY, VIOLET, APPT_STATUS_COLOR, chipSx, getJson, type AppointmentList, type AppointmentRow } from './appointmentUi';

type View = 'month' | 'week' | AppointmentView;
const LISTS: Partial<Record<View, { title: string; empty: string; newestFirst?: boolean }>> = {
  upcoming: { title: 'Next 90 days', empty: 'No upcoming appointment in the next 90 days.' },
  past: { title: 'Past - the last year', empty: 'No past appointment in the last year.', newestFirst: true },
  rescheduled: { title: 'Moved to a new date', empty: 'No appointment was moved.', newestFirst: true },
  completed: { title: 'Completed - the last year', empty: 'No appointment was completed in the last year.', newestFirst: true },
  cancelled: { title: 'Cancelled', empty: 'No appointment was cancelled.', newestFirst: true },
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86_400_000;
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromDate(new Date(toDate(d).getTime() + n * DAY));
const weekStart = (d: string) => addDays(d, -toDate(d).getUTCDay());
const label = (d: string, o: Intl.DateTimeFormatOptions) => toDate(d).toLocaleDateString('en-PH', { ...o, timeZone: 'UTC' });

/**
 * The VAWC Appointment Calendar - its own calendar, never the Hearing
 * Calendar: by month or week, or as lists of upcoming, past, rescheduled,
 * completed and cancelled appointments. Clicking one opens its record;
 * clicking a day starts a new appointment on it.
 */
export default function AppointmentCalendar() {
  const today = phDay(new Date());
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);
  const [type, setType] = useState('');
  const [officer, setOfficer] = useState('');
  const [open, setOpen] = useState<AppointmentRow | null>(null);
  const [create, setCreate] = useState<{ date?: string } | null>(null);

  const range = useMemo(() => {
    if (view === 'month') { const s = weekStart(`${anchor.slice(0, 7)}-01`); return { from: s, to: addDays(s, 41) }; }
    if (view === 'week') { const s = weekStart(anchor); return { from: s, to: addDays(s, 6) }; }
    if (view === 'upcoming') return { from: today, to: addDays(today, 90) };
    if (view === 'past' || view === 'completed') return { from: addDays(today, -365), to: today };
    return { from: addDays(today, -365), to: addDays(today, 365) };
  }, [view, anchor, today]);
  const list = LISTS[view];
  const q = new URLSearchParams({ from: range.from, to: range.to });
  if (list) q.set('view', view);
  if (type) q.set('type', type);
  if (officer) q.set('officer', officer);
  const { data, error, isLoading, mutate } = useSWR<AppointmentList>(`/api/vawc/appointments?${q}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;

  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const e of data?.rows ?? []) { const d = phDay(e.scheduledAt); map.set(d, [...(map.get(d) ?? []), e]); }
    for (const v of map.values()) v.sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
    return map;
  }, [data]);

  const shift = (dir: number) => setAnchor(a => view === 'month'
    ? fromDate(new Date(Date.UTC(toDate(a).getUTCFullYear(), toDate(a).getUTCMonth() + dir, 1)))
    : addDays(a, dir * 7));
  const title = view === 'month' ? label(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${label(range.from, { month: 'short', day: 'numeric' })} - ${label(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}` : list!.title;
  const pick = (d: string) => { if (data?.canCreate && d >= today) setCreate({ date: d }); };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalendarMonth sx={{ color: VIOLET }} />
          </Box>
          <Box>
            <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>Appointment Calendar</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>VAWC appointments and follow-ups only. Blotter hearings are never shown here.</Typography>
          </Box>
        </Box>
        <Box sx={{ ml: { sm: 'auto' }, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<ViewList />} href="/vawc/appointments" sx={{ textTransform: 'none', borderRadius: 2, minHeight: 40 }}>Appointment Records</Button>
          {data?.canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreate({})} sx={{ textTransform: 'none', bgcolor: NAVY, borderRadius: 2, minHeight: 40 }}>Create Appointment</Button>
          )}
        </Box>
      </Box>

      {forbidden && <Alert severity="info" sx={{ borderRadius: 2 }}>{error?.message}</Alert>}
      {error && !forbidden && !data && <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }} action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{error.message}</Alert>}

      {!forbidden && (
        <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setView(v)} aria-label="Calendar view" sx={{ flexWrap: 'wrap' }}>
                {(['month', 'week', 'upcoming', 'past', 'rescheduled', 'completed', 'cancelled'] as View[]).map(v => (
                  <ToggleButton key={v} value={v} sx={{ textTransform: 'none', px: 1.5 }}>{v[0].toUpperCase() + v.slice(1)}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              {!list && (
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <IconButton size="small" onClick={() => shift(-1)} aria-label={`Previous ${view}`}><ChevronLeft /></IconButton>
                  <IconButton size="small" onClick={() => shift(1)} aria-label={`Next ${view}`}><ChevronRight /></IconButton>
                  <Button size="small" onClick={() => setAnchor(today)} sx={{ textTransform: 'none' }}>Today</Button>
                </Box>
              )}
              <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }} aria-live="polite">{title}</Typography>
              <Tooltip title="Reload"><IconButton size="small" onClick={() => mutate()} aria-label="Reload" sx={{ ml: 'auto' }}><Refresh /></IconButton></Tooltip>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <TextField select size="small" label="Type" value={type} onChange={e => setType(e.target.value)} sx={{ minWidth: 220 }}>
                <MenuItem value="">All types</MenuItem>
                {APPOINTMENT_TYPE_KEYS.map(t => <MenuItem key={t} value={t}>{APPOINTMENT_TYPES[t].label}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="VAWC officer" value={officer} onChange={e => setOfficer(e.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="">All officers</MenuItem>
                {(data?.filters.officers ?? []).map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
              </TextField>
            </Box>

            {isLoading && !data ? <Skeleton variant="rounded" height={420} /> : data && (
              <>
                {view === 'month' && <Month from={range.from} anchor={anchor} today={today} byDay={byDay} onOpen={setOpen} onPick={data.canCreate ? pick : undefined} />}
                {view === 'week' && <Week from={range.from} today={today} byDay={byDay} onOpen={setOpen} onPick={data.canCreate ? pick : undefined} />}
                {list && <Lists byDay={byDay} onOpen={setOpen} empty={list.empty} newestFirst={list.newestFirst} />}
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }} aria-label="Status colours">
                  {(Object.keys(APPOINTMENT_STATUSES) as AppointmentStatus[]).map(s => (
                    <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: APPT_STATUS_COLOR[s] }} />
                      <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>{APPOINTMENT_STATUSES[s]}</Typography>
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {create && <CreateAppointmentDialog initialDate={create.date} onClose={() => setCreate(null)} onCreated={() => { setCreate(null); void mutate(); }} />}
      {open && <AppointmentDetailsDialog id={open.id} caseHref={`/vawc/cases/${open.case.id}`} onClose={() => setOpen(null)} onChanged={() => mutate()} />}
    </Box>
  );
}

function Item({ e, onOpen, full = false }: { e: AppointmentRow; onOpen: (e: AppointmentRow) => void; full?: boolean }) {
  const c = APPT_STATUS_COLOR[e.status];
  const desc = `${formatHearingTime(e.scheduledAt)}, ${e.typeLabel}, case ${e.case.caseNumber}, ${e.venue}, ${e.officer?.name ?? 'no officer assigned'}, ${APPOINTMENT_STATUSES[e.status]}`;
  return (
    <Tooltip title={desc}>
      <Box component="button" type="button" onClick={ev => { ev.stopPropagation(); onOpen(e); }} aria-label={desc} data-appointment={e.id}
        sx={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderLeft: `3px solid ${c}`, cursor: 'pointer', borderRadius: 1, px: 0.5, py: 0.25, mt: 0.25,
          bgcolor: `${c}14`, color: c, fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: full ? 'normal' : 'nowrap',
          textDecoration: e.status === 'CANCELLED' ? 'line-through' : 'none', '&:focus-visible': { outline: `2px solid ${c}` } }}>
        {formatHearingTime(e.scheduledAt)} · {e.case.caseNumber}
        {full && <Box component="span" sx={{ display: 'block', fontWeight: 500, color: '#475569' }}>{e.typeLabel} · {e.officer?.name ?? 'No officer'}</Box>}
      </Box>
    </Tooltip>
  );
}

function Month({ from, anchor, today, byDay, onOpen, onPick }: { from: string; anchor: string; today: string; byDay: Map<string, AppointmentRow[]>; onOpen: (e: AppointmentRow) => void; onPick?: (d: string) => void }) {
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
              sx={{ minHeight: 96, border: '1px solid', borderColor: d === today ? VIOLET : '#e2e8f0', borderRadius: 1.5, p: 0.5, bgcolor: inMonth ? '#fff' : '#f8fafc',
                cursor: onPick && d >= today ? 'copy' : 'default' }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: d === today ? 800 : 600, color: d === today ? VIOLET : inMonth ? '#475569' : '#cbd5e1' }}>{Number(d.slice(8))}</Typography>
              {events.slice(0, 3).map(e => <Item key={e.id} e={e} onOpen={onOpen} />)}
              {events.length > 3 && <Typography sx={{ fontSize: '0.66rem', color: '#64748b', mt: 0.25 }}>+{events.length - 3} more</Typography>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Week({ from, today, byDay, onOpen, onPick }: { from: string; today: string; byDay: Map<string, AppointmentRow[]>; onOpen: (e: AppointmentRow) => void; onPick?: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))', gap: 0.75, minWidth: 920 }}>
        {days.map(d => {
          const events = byDay.get(d) ?? [];
          return (
            <Box key={d} data-day={d} onClick={onPick ? () => onPick(d) : undefined}
              sx={{ border: '1px solid', borderColor: d === today ? VIOLET : '#e2e8f0', borderRadius: 1.5, p: 0.75, minHeight: 300, cursor: onPick && d >= today ? 'copy' : 'default' }}>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: d === today ? VIOLET : NAVY }}>{label(d, { weekday: 'short', month: 'short', day: 'numeric' })}</Typography>
              {events.length === 0 && <Typography sx={{ fontSize: '0.7rem', color: '#cbd5e1', mt: 0.5 }}>No appointment</Typography>}
              {events.map(e => <Item key={e.id} e={e} onOpen={onOpen} full />)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Lists({ byDay, onOpen, empty, newestFirst }: { byDay: Map<string, AppointmentRow[]>; onOpen: (e: AppointmentRow) => void; empty: string; newestFirst?: boolean }) {
  const days = [...byDay.keys()].sort();
  if (newestFirst) days.reverse();
  if (!days.length) return <Box sx={{ textAlign: 'center', py: 5 }}><CalendarMonth sx={{ fontSize: 34, color: '#cbd5e1' }} /><Typography sx={{ color: '#64748b', fontSize: '0.88rem', mt: 1 }}>{empty}</Typography></Box>;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {days.map(d => (
        <Box key={d}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.88rem', mb: 0.75 }}>{label(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Typography>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {byDay.get(d)!.map(e => (
              <Box key={e.id} component="button" type="button" onClick={() => onOpen(e)} data-appointment={e.id}
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '96px 1fr auto' }, gap: { xs: 0.5, sm: 1.5 }, alignItems: 'center', textAlign: 'left', width: '100%',
                  border: '1px solid #e2e8f0', borderLeft: `4px solid ${APPT_STATUS_COLOR[e.status]}`, borderRadius: 2, p: 1.25, bgcolor: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  '&:hover': { bgcolor: '#f8fafc' }, '&:focus-visible': { outline: `2px solid ${VIOLET}` } }}>
                <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>{formatHearingTime(e.scheduledAt)}</Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.88rem' }}>{e.typeLabel} · {e.case.caseNumber}</Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', color: '#475569', fontSize: '0.8rem', mt: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Place sx={{ fontSize: 15 }} />{e.venue}</Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Person sx={{ fontSize: 15 }} />{e.officer?.name ?? 'No officer assigned'}</Box>
                    <span>{formatHearingDate(e.scheduledAt)}</span>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: { sm: 'flex-end' } }}>
                  <Chip size="small" label={APPOINTMENT_STATUSES[e.status]} sx={chipSx(APPT_STATUS_COLOR[e.status])} />
                  {e.rescheduleCount > 0 && e.status !== 'RESCHEDULED' && <Chip size="small" label="Moved" sx={chipSx('#b45309')} />}
                  {e.overdue && <Chip size="small" label="Record the outcome" sx={chipSx('#b91c1c')} />}
                  {e.pendingRequests > 0 && <Chip size="small" label="New date requested" sx={chipSx('#b45309')} />}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
