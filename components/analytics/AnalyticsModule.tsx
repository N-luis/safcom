'use client';

import { useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Grid, TextField, MenuItem, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
} from '@mui/material';
import {
  Insights, Map as MapIcon, ReportProblem, FactCheck, Gavel, MarkEmailRead, Refresh, AutoAwesome, Category, Diversity3,
} from '@mui/icons-material';
import { BLOTTER_CATEGORIES, VAWC_CATEGORIES } from '@/lib/classificationSchema';
import { STATUS_GROUPS, type AnalyticsScope, type StatusGroup } from '@/lib/analytics';
import { REFERRAL_STATUSES, type ReferralStatus } from '@/lib/caseRecords';
import ReportingAnalytics from './ReportingAnalytics';

const RiskHeatMap = dynamic(() => import('@/components/cases/RiskHeatMap'), { ssr: false });

/**
 * Analytics.
 *
 * It shows what SafeComm already records - the Groq and risk-matrix
 * assessments made in the background at filing and on each re-run, the
 * officers' own decisions, the workflow - and scores nothing itself. Every
 * figure comes from the server, which narrows it to what the viewer's role
 * may see; a case opens only from a desk that may open it.
 */

const NAVY = '#0c1e46';
const LEVEL_COLOR: Record<number, string> = { 1: '#15803d', 2: '#a16207', 3: '#ea580c', 4: '#dc2626', 5: '#7e22ce' };
const RISK_COLOR: Record<string, string> = { Low: '#15803d', Medium: '#ea580c', High: '#dc2626', Critical: '#7e22ce' };

const SECTIONS = [
  { id: 'overview', label: 'Case Overview', Icon: Insights },
  { id: 'heatmap', label: 'Street Risk Heatmap', Icon: MapIcon },
  { id: 'priority', label: 'High-Priority Cases', Icon: ReportProblem },
  { id: 'reporting', label: 'Reporting', Icon: FactCheck },
  { id: 'case-types', label: 'Reported Case Types', Icon: Category },
  { id: 'vawc-people', label: 'VAWC – Women & Children', Icon: Diversity3 },
  { id: 'hearings', label: 'Hearing Management', Icon: Gavel },
  { id: 'letters', label: 'Acknowledgement Letters', Icon: MarkEmailRead },
] as const;

// ── Dates ────────────────────────────────────────────────────────────────────

const phToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const shift = (day: string, days: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const PRESETS = {
  all: 'All time', d7: 'Last 7 days', d30: 'Last 30 days', d90: 'Last 90 days', year: 'This year', custom: 'Custom range',
} as const;
type Preset = keyof typeof PRESETS;
function rangeOf(p: Preset, custom: { from: string; to: string }): { from: string; to: string } {
  const t = phToday();
  if (p === 'd7') return { from: shift(t, -6), to: t };
  if (p === 'd30') return { from: shift(t, -29), to: t };
  if (p === 'd90') return { from: shift(t, -89), to: t };
  if (p === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: t };
  if (p === 'custom') return custom;
  return { from: '', to: '' };
}
const day = (d: string | Date) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
const when = (d: string | Date) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ── Data ─────────────────────────────────────────────────────────────────────

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'These figures could not be loaded.');
  return body.data;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;
// A failed section shows its error even while SWR retries in the background -
// otherwise the retry's loading state hides the failure behind a skeleton.
function useSection(section: string, query: string) {
  return useSWR<Data>(`/api/analytics/${section}?${query}`, fetcher, { revalidateOnFocus: true, refreshInterval: 60_000 });
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Section({ id, title, hint, children, action }: {
  id: (typeof SECTIONS)[number]['id']; title: string; hint?: string; children: ReactNode; action?: ReactNode;
}) {
  // The same icon as the section's chip in the nav above.
  const Icon = SECTIONS.find(s => s.id === id)!.Icon;
  return (
    <Card id={id} sx={{ mb: 2.5, scrollMarginTop: 120 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: hint ? 0.25 : 1.5, flexWrap: 'wrap' }}>
          <Icon sx={{ fontSize: 19, color: NAVY }} />
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1rem', color: NAVY }}>{title}</Typography>
          {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
        </Box>
        {hint && <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1.5 }}>{hint}</Typography>}
        {children}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return <Grid container spacing={1.5}>{Array.from({ length: 4 }).map((_, i) => <Grid key={i} size={{ xs: 6, md: 3 }}><Skeleton variant="rounded" height={84} /></Grid>)}</Grid>;
}

function Failed({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Alert severity="warning" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" startIcon={<Refresh />} onClick={retry}>Retry</Button>}>
      {error.message}
    </Alert>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <Box sx={{ py: 3, textAlign: 'center' }}><Typography sx={{ fontSize: '0.88rem', color: '#94a3b8' }}>{children}</Typography></Box>;
}

function Tile({ label, value, hint, color = NAVY, onClick }: { label: string; value: number | string; hint?: string; color?: string; onClick?: () => void }) {
  const inner = (
    <>
      <Typography sx={{ fontSize: '1.7rem', fontWeight: 800, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155', mt: 0.25 }}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: '0.74rem', color: '#64748b', mt: 0.25 }}>{hint}</Typography>}
    </>
  );
  const sx = { border: '1px solid #e2e8f0', borderTop: `3px solid ${color}`, borderRadius: 2, p: 1.5, height: '100%', bgcolor: '#fff', textAlign: 'left' as const };
  return onClick ? (
    <Box component="button" type="button" onClick={onClick} aria-label={`${label}: ${value}. Open the list.`}
      sx={{ ...sx, width: '100%', font: 'inherit', cursor: 'pointer', transition: 'box-shadow 0.15s',
        '&:hover': { boxShadow: `0 6px 18px ${color}22` }, '&:focus-visible': { outline: `3px solid ${color}55`, outlineOffset: 2 } }}>
      {inner}
    </Box>
  ) : <Box sx={sx}>{inner}</Box>;
}

// ── The module ───────────────────────────────────────────────────────────────

export interface AnalyticsModuleProps {
  /** Which caseload this board shows; the server narrows it further by role. */
  scope: AnalyticsScope;
  /** Where each desk's cases open, for this viewer - null where they cannot. */
  caseBase: { BLOTTER: string | null; VAWC: string | null };
}

export default function AnalyticsModule({ scope, caseBase }: AnalyticsModuleProps) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>('d30');
  const [custom, setCustom] = useState({ from: shift(phToday(), -29), to: phToday() });
  const [category, setCategory] = useState('');
  const range = rangeOf(preset, custom);
  const query = new URLSearchParams({ scope, ...(range.from && { from: range.from }), ...(range.to && { to: range.to }), ...(category && { category }) }).toString();
  const categories = scope === 'vawc' ? VAWC_CATEGORIES : scope === 'blotter' ? BLOTTER_CATEGORIES : [...BLOTTER_CATEGORIES, ...VAWC_CATEGORIES];
  const rangeLabel = preset === 'all' ? 'all time' : preset === 'custom' ? `${range.from || '…'} to ${range.to || '…'}` : PRESETS[preset].toLowerCase();

  const open = (desk: 'BLOTTER' | 'VAWC', id: string) => { const b = caseBase[desk]; if (b) router.push(`${b}/${id}`); };
  const canOpen = (desk: 'BLOTTER' | 'VAWC') => Boolean(caseBase[desk]);
  // A status card opens the case list only when the board is one desk's.
  const listBase = scope === 'vawc' ? caseBase.VAWC : scope === 'blotter' ? caseBase.BLOTTER : null;

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: NAVY, letterSpacing: '-0.02em' }}>Analytics</Typography>
          <Chip size="small" icon={<AutoAwesome sx={{ fontSize: '14px !important' }} />} label="AI assessment runs in the background"
            sx={{ bgcolor: '#f0fdfa', color: '#0f766e', fontWeight: 700, fontSize: '0.74rem' }} />
        </Box>
        <Typography sx={{ fontSize: '0.88rem', color: 'text.secondary', mt: 0.25 }}>
          {`${scope === 'vawc' ? 'The VAWC caseload' : scope === 'blotter' ? 'The blotter caseload' : 'Both desks'} – figures from the case records, `
            + 'the Groq and risk-matrix assessments, and officers’ decisions. AI results are advisory; nothing here is a legal finding.'}
        </Typography>
      </Box>

      {/* ── Filters, and the sections in order ── */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: 'background.default', pt: 1, pb: 1.25, mb: 1.5, borderBottom: '1px solid #e2e8f0' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          <TextField select size="small" label="Reported" value={preset} onChange={e => setPreset(e.target.value as Preset)} sx={{ minWidth: 160 }}>
            {(Object.keys(PRESETS) as Preset[]).map(p => <MenuItem key={p} value={p}>{PRESETS[p]}</MenuItem>)}
          </TextField>
          {preset === 'custom' && (
            <>
              <TextField size="small" type="date" label="From" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: custom.to || phToday() } }} />
              <TextField size="small" type="date" label="To" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: custom.from, max: phToday() } }} />
            </>
          )}
          <TextField select size="small" label="Category" value={category} onChange={e => setCategory(e.target.value)} sx={{ minWidth: 190 }}
            slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map(c => <MenuItem key={`${c.desk}-${c.category}`} value={c.category}>{c.category}</MenuItem>)}
          </TextField>
          {(preset !== 'd30' || category) && (
            <Button size="small" onClick={() => { setPreset('d30'); setCategory(''); }} sx={{ textTransform: 'none' }}>Reset filters</Button>
          )}
        </Box>
        <Box component="nav" aria-label="Analytics sections" sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.25 }}>
          {SECTIONS.filter(s => s.id !== 'vawc-people' || scope !== 'blotter').map((s, i) => (
            <Chip key={s.id} component="a" href={`#${s.id}`} clickable icon={<s.Icon sx={{ fontSize: '15px !important' }} />}
              label={`${i + 1}. ${s.label}`} size="small" sx={{ flexShrink: 0, fontWeight: 600, bgcolor: '#f1f5f9' }} />
          ))}
        </Box>
      </Box>

      <Overview query={query} rangeLabel={rangeLabel} listBase={listBase} onList={st => listBase && router.push(`${listBase}?status=${encodeURIComponent(st)}`)} />

      <Section id="heatmap" title="Street Risk Heatmap"
        hint={`Cases per street, reported ${rangeLabel}${category ? `, ${category}` : ''}. Counts only - no case, person or exact location is shown.`}>
        <RiskHeatMap scope={scope} from={range.from || undefined} to={range.to || undefined} category={category || undefined} />
      </Section>

      <Priority query={query} open={open} canOpen={canOpen} />
      {/* Reporting has its own filters - period, desk, affected-person group, case type. */}
      <ReportingAnalytics scope={scope} caseBase={caseBase} />
      <Hearings query={query} rangeLabel={rangeLabel} open={open} canOpen={canOpen} />
      <Letters query={query} rangeLabel={rangeLabel} open={open} canOpen={canOpen} />
    </Box>
  );
}

type Opener = { open: (desk: 'BLOTTER' | 'VAWC', id: string) => void; canOpen: (desk: 'BLOTTER' | 'VAWC') => boolean };

// ── 1. Case overview ─────────────────────────────────────────────────────────

function Overview({ query, rangeLabel, listBase, onList }: { query: string; rangeLabel: string; listBase: string | null; onList: (statuses: string) => void }) {
  const { data, error, isLoading, mutate } = useSection('overview', query);
  const colors: Record<StatusGroup, string> = { pending: '#a16207', underReview: '#0369a1', ongoing: '#7c3aed', resolved: '#15803d' };
  return (
    <Section id="overview" title="Case Overview" hint="The current caseload by status, and the reports filed in the selected period.">
      {error && !data ? <Failed error={error} retry={() => void mutate()} /> : isLoading ? <Loading /> : data && (
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, md: 2 }}><Tile label="Total Cases" value={data.total} hint="All, in this caseload" /></Grid>
          {(Object.keys(STATUS_GROUPS) as StatusGroup[]).map(k => (
            <Grid key={k} size={{ xs: 6, md: 2 }}>
              <Tile label={k === 'ongoing' ? 'Ongoing Cases' : k === 'resolved' ? 'Resolved Cases' : k === 'pending' ? 'Pending Cases' : 'Under Review'}
                value={data[k]} hint={STATUS_GROUPS[k].hint} color={colors[k]}
                onClick={listBase ? () => onList(STATUS_GROUPS[k].statuses.join(',')) : undefined} />
            </Grid>
          ))}
          <Grid size={{ xs: 6, md: 2 }}><Tile label="New Reports" value={data.newReports} hint={`Filed ${rangeLabel}`} color="#0f766e" /></Grid>
          {data.urgentOpen > 0 && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error" sx={{ borderRadius: 2 }}>
                {data.urgentOpen} open case{data.urgentOpen === 1 ? ' is' : 's are'} flagged for urgent review - see High-Priority Cases below.
              </Alert>
            </Grid>
          )}
          {data.other > 0 && (
            <Grid size={{ xs: 12 }}>
              <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>{data.other} case{data.other === 1 ? ' has' : 's have'} a status outside these groups and {data.other === 1 ? 'is' : 'are'} counted in the total only.</Typography>
            </Grid>
          )}
        </Grid>
      )}
    </Section>
  );
}

// ── 3. High-priority cases ───────────────────────────────────────────────────

function Priority({ query, open, canOpen }: { query: string } & Opener) {
  const { data, error, isLoading, mutate } = useSection('priority', query);
  return (
    <Section id="priority" title="High-Priority Cases"
      hint="Open cases flagged as an emergency, or at a high level in the risk matrix or the official assessment. Shown whatever their filing date: an urgent case is never filtered out."
      action={data && <Chip size="small" label={`${data.total} case${data.total === 1 ? '' : 's'} · ${data.emergencies} emergenc${data.emergencies === 1 ? 'y' : 'ies'}`} sx={{ fontWeight: 700, bgcolor: data.emergencies ? '#fef2f2' : '#f1f5f9', color: data.emergencies ? '#b91c1c' : '#475569' }} />}>
      {error && !data ? <Failed error={error} retry={() => void mutate()} /> : isLoading ? <Skeleton variant="rounded" height={160} /> : data && (
        data.cases.length === 0 ? <Empty>No open case needs urgent attention right now.</Empty> : (
          <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1080 }}>
              <TableHead>
                <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.74rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' } }}>
                  {['Reference', 'Category', 'AI-assessed risk', 'Emergency', 'Status', 'Assigned officer', 'Reported', 'Latest update', 'AI recommendation'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.cases.map((c: Data) => {
                  const openable = canOpen(c.desk);
                  return (
                    <TableRow key={c.id} hover={openable} onClick={openable ? () => open(c.desk, c.id) : undefined}
                      tabIndex={openable ? 0 : undefined} onKeyDown={openable ? e => { if (e.key === 'Enter') open(c.desk, c.id); } : undefined}
                      sx={{ cursor: openable ? 'pointer' : 'default', '&:focus-visible': { outline: '2px solid #0f766e', outlineOffset: -2 }, '& td': { fontSize: '0.82rem', verticalAlign: 'top' } }}>
                      <TableCell sx={{ fontWeight: 800, color: NAVY, whiteSpace: 'nowrap' }}>#{c.caseNumber}</TableCell>
                      <TableCell>{c.caseType}</TableCell>
                      <TableCell>
                        {c.ai?.level
                          ? <Chip size="small" label={`L${c.ai.level} ${c.ai.label ?? ''}`} sx={{ height: 22, fontWeight: 800, fontSize: '0.7rem', bgcolor: `${LEVEL_COLOR[c.ai.level]}14`, color: LEVEL_COLOR[c.ai.level] }} />
                          : <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.ai ? 'No criterion met' : 'Not assessed'}</Typography>}
                        <Typography sx={{ fontSize: '0.72rem', color: RISK_COLOR[c.officialRiskLevel] ?? '#94a3b8', mt: 0.25 }}>
                          Official: {c.officialRiskLevel ?? 'undetermined'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {c.emergency.length > 0
                          ? <Tooltip title={c.emergency.join(' · ')}><Chip size="small" icon={<ReportProblem sx={{ fontSize: '14px !important' }} />} label="Emergency" sx={{ height: 22, fontWeight: 800, fontSize: '0.7rem', bgcolor: '#fef2f2', color: '#b91c1c' }} /></Tooltip>
                          : <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>-</Typography>}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.status}</TableCell>
                      <TableCell>{c.assignedOfficer ?? <Box component="span" sx={{ color: '#b45309', fontWeight: 700 }}>Unassigned</Box>}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{day(c.filedAt)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{when(c.latestUpdate)}</TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        {c.ai?.recommendation
                          ? <Typography sx={{ fontSize: '0.78rem', color: '#334155', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.ai.recommendation}</Typography>
                          : <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.ai && !c.ai.aiUsed ? 'AI did not run' : 'None recorded'}</Typography>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Section>
  );
}

// ── 5. Hearing management ────────────────────────────────────────────────────

function Hearings({ query, rangeLabel, open, canOpen }: { query: string; rangeLabel: string } & Opener) {
  const { data, error, isLoading, mutate } = useSection('hearings', query);
  return (
    <Section id="hearings" title="Hearing Management"
      hint="Katarungang Pambarangay hearings for eligible blotter disputes. VAWC cases under RA 9262 are never mediated or conciliated at the barangay; their interventions and referrals are tracked separately.">
      {error && !data ? <Failed error={error} retry={() => void mutate()} /> : isLoading ? <Loading /> : data && (
        <>
          {data.applicable && (
            <>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, md: 2.4 }}><Tile label="Total scheduled" value={data.totalScheduled} hint={rangeLabel} color="#0369a1" /></Grid>
                <Grid size={{ xs: 6, md: 2.4 }}><Tile label="Upcoming" value={data.upcomingCount} hint="Still to come, any range" color="#0f766e" /></Grid>
                <Grid size={{ xs: 4, md: 2.4 }}><Tile label="Completed" value={data.completed} hint={`${data.settled} settled`} color="#15803d" /></Grid>
                <Grid size={{ xs: 4, md: 2.4 }}><Tile label="Rescheduled" value={data.rescheduled} hint={rangeLabel} color="#b45309" /></Grid>
                <Grid size={{ xs: 4, md: 2.4 }}><Tile label="Cancelled" value={data.cancelled} hint={rangeLabel} color="#64748b" /></Grid>
              </Grid>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY, mb: 0.75 }}>By Katarungang Pambarangay stage</Typography>
              <Box sx={{ display: 'grid', gap: 0.75, mb: 2 }}>
                {data.byStage.map((h: Data) => {
                  const max = Math.max(1, ...data.byStage.map((x: Data) => x.total));
                  return (
                    <Box key={h.stage} sx={{ display: 'grid', gridTemplateColumns: { xs: '110px 1fr', sm: '200px 1fr 260px' }, gap: 1, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: NAVY }}>{h.label}</Typography>
                      <Box sx={{ height: 14, bgcolor: '#f1f5f9', borderRadius: 1, overflow: 'hidden', display: 'flex' }} role="img"
                        aria-label={`${h.label}: ${h.total} in range, ${h.completed} completed, ${h.cancelled} cancelled`}>
                        <Box sx={{ width: `${(h.completed / max) * 100}%`, bgcolor: '#15803d' }} />
                        <Box sx={{ width: `${((h.total - h.completed - h.cancelled) / max) * 100}%`, bgcolor: '#0369a1' }} />
                        <Box sx={{ width: `${(h.cancelled / max) * 100}%`, bgcolor: '#cbd5e1' }} />
                      </Box>
                      <Typography sx={{ fontSize: '0.75rem', color: '#64748b', gridColumn: { xs: '2', sm: 'auto' }, fontVariantNumeric: 'tabular-nums' }}>
                        {h.total} in range · {h.completed} held · {h.scheduled} upcoming · {h.rescheduled} rescheduled · {h.cancelled} cancelled
                      </Typography>
                    </Box>
                  );
                })}
                <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Green: held · blue: still open · grey: cancelled. Drafts are not counted, and VAWC interventions never are.</Typography>
              </Box>
              {data.overdue > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>
                  {data.overdue} hearing{data.overdue === 1 ? ' is' : 's are'} past {data.overdue === 1 ? 'its' : 'their'} date and still marked scheduled - record whether {data.overdue === 1 ? 'it was' : 'they were'} held.
                </Alert>
              )}
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY, mb: 0.75 }}>Upcoming hearings</Typography>
              {data.upcoming.length === 0 ? <Empty>No hearing is scheduled.</Empty> : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {data.upcoming.map((h: Data) => {
                    const openable = canOpen(h.case.desk);
                    return (
                      <Box key={h.id} component={openable ? 'button' : 'div'} type={openable ? 'button' : undefined}
                        onClick={openable ? () => open(h.case.desk, h.case.id) : undefined}
                        sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25,
                          bgcolor: '#fff', font: 'inherit', textAlign: 'left', cursor: openable ? 'pointer' : 'default', width: '100%',
                          '&:hover': openable ? { bgcolor: '#f8fafc' } : undefined, '&:focus-visible': { outline: '2px solid #0f766e' } }}>
                        <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.86rem', minWidth: 150 }}>{when(h.scheduledAt)}</Typography>
                        <Chip size="small" label={h.title} sx={{ height: 22, fontWeight: 700, bgcolor: '#e0f2fe', color: '#0369a1' }} />
                        <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>#{h.case.caseNumber} · {h.case.caseType}</Typography>
                        {h.venue && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', ml: 'auto' }}>{h.venue}</Typography>}
                      </Box>
                    );
                  })}
                </Box>
              )}
            </>
          )}
          {data.vawc && (
            <Box sx={{ mt: data.applicable ? 2.5 : 0 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#7c3aed', mb: 0.75 }}>
                VAWC interventions and referrals - a separate track, never mediation
              </Typography>
              <Grid container spacing={1.5}>
                {(Object.keys(REFERRAL_STATUSES) as ReferralStatus[]).map(k => (
                  <Grid key={k} size={{ xs: 6, md: 2 }}>
                    <Tile label={`Referrals: ${REFERRAL_STATUSES[k].toLowerCase()}`} value={data.vawc.referrals[k] ?? 0} color="#7c3aed" />
                  </Grid>
                ))}
                <Grid size={{ xs: 6, md: 2 }}><Tile label="Interventions recorded" value={data.vawc.interventions} hint={rangeLabel} color="#7c3aed" /></Grid>
                <Grid size={{ xs: 6, md: 2 }}><Tile label="Follow-ups scheduled" value={data.vawc.followUpsDue} hint="From safety assessments" color="#7c3aed" /></Grid>
              </Grid>
            </Box>
          )}
        </>
      )}
    </Section>
  );
}

// ── 6. Acknowledgement letters ───────────────────────────────────────────────

function Letters({ query, rangeLabel, open, canOpen }: { query: string; rangeLabel: string } & Opener) {
  const { data, error, isLoading, mutate } = useSection('letters', query);
  return (
    <Section id="letters" title="Acknowledgement Letters"
      hint={`Letters generated ${rangeLabel}. A letter confirms that a report was received - nothing more. Generate one from the case page.`}>
      {error && !data ? <Failed error={error} retry={() => void mutate()} /> : isLoading ? <Loading /> : data && (
        <>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, md: 3 }}><Tile label="Letters generated" value={data.generated} color={NAVY} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Tile label="Letters issued" value={data.issued} hint="Given to the reporter" color="#15803d" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Tile label="Pending letters" value={data.pending} hint="Generated, not yet issued" color="#a16207" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Tile label="Reports without a letter" value={data.withoutLetter} hint={`Filed ${rangeLabel}`} color="#64748b" /></Grid>
          </Grid>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY, mb: 0.75 }}>Recently generated</Typography>
          {data.recent.length === 0 ? <Empty>No letters generated in this period.</Empty> : (
            <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.74rem', color: '#64748b', textTransform: 'uppercase' } }}>
                    {['Letter No.', 'Case reference', 'Generated', 'Status'].map(h => <TableCell key={h}>{h}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.recent.map((l: Data) => {
                    const openable = canOpen(l.case.desk);
                    return (
                      <TableRow key={l.id} hover={openable} onClick={openable ? () => open(l.case.desk, l.case.id) : undefined}
                        tabIndex={openable ? 0 : undefined} onKeyDown={openable ? e => { if (e.key === 'Enter') open(l.case.desk, l.case.id); } : undefined}
                        sx={{ cursor: openable ? 'pointer' : 'default', '& td': { fontSize: '0.82rem' } }}>
                        <TableCell sx={{ fontWeight: 700 }}>{l.letterNumber}</TableCell>
                        <TableCell>#{l.case.caseNumber}</TableCell>
                        <TableCell>{when(l.generatedAt)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={l.status === 'ISSUED' ? `Issued ${day(l.issuedAt)}` : 'Pending'}
                            sx={{ height: 22, fontWeight: 700, bgcolor: l.status === 'ISSUED' ? '#f0fdf4' : '#fffbeb', color: l.status === 'ISSUED' ? '#15803d' : '#a16207' }} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Section>
  );
}
