'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Button, Alert, Skeleton, Grid, TextField, MenuItem, ListSubheader, Drawer, IconButton, Chip, CircularProgress,
} from '@mui/material';
import { FactCheck, Category, Diversity3, Refresh, Close, ChevronRight } from '@mui/icons-material';
import { PERIODS, GROUPS, ABUSE_TYPES, type Period, type GroupFilter } from '@/lib/reportingStats';
import type { AnalyticsScope } from '@/lib/analytics';
import { SegmentBar, BarList, Stat, CountText, SERIES, INK, pct } from './ReportingCharts';

/**
 * Analytics > Reporting: four headline figures, then charts - completeness,
 * officer-reviewed classification, AI review - and two sections of their own,
 * Reported Case Types and VAWC - Women and Children Statistics. One set of
 * filters drives all of it. Every segment opens the cases behind it (for the
 * roles allowed to open them); case references are never listed on the page.
 */

const NAVY = INK.primary;
const phToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const shift = (day: string, days: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
function rangeOf(p: Period, custom: { from: string; to: string }) {
  const t = phToday();
  if (p === 'd7') return { from: shift(t, -6), to: t };
  if (p === 'd30') return { from: shift(t, -29), to: t };
  if (p === 'd90') return { from: shift(t, -89), to: t };
  if (p === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: t };
  return custom;
}
const day = (d: string | Date) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'These figures could not be loaded.');
  return body.data;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

function Panel({ id, title, Icon, hint, children, action }: { id: string; title: string; Icon: typeof FactCheck; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card id={id} sx={{ mb: 2.5, scrollMarginTop: 120 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25, flexWrap: 'wrap' }}>
          <Icon sx={{ fontSize: 19, color: NAVY }} />
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1rem', color: NAVY }}>{title}</Typography>
          {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
        </Box>
        {hint && <Typography component="div" sx={{ fontSize: '0.8rem', color: INK.muted, mb: 1.75 }}>{hint}</Typography>}
        {children}
      </CardContent>
    </Card>
  );
}

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: { xs: 1.5, sm: 2 }, height: '100%', bgcolor: '#fff' }}>
      <Typography component="h3" sx={{ fontSize: '0.88rem', fontWeight: 800, color: NAVY, mb: 1 }}>{title}</Typography>
      {children}
      {note && <Typography component="div" sx={{ fontSize: '0.74rem', color: INK.muted, mt: 1.25, lineHeight: 1.45 }}>{note}</Typography>}
    </Box>
  );
}

export default function ReportingAnalytics({ scope, caseBase }: { scope: AnalyticsScope; caseBase: { BLOTTER: string | null; VAWC: string | null } }) {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('d30');
  const [custom, setCustom] = useState({ from: shift(phToday(), -29), to: phToday() });
  const [desk, setDesk] = useState<'all' | 'BLOTTER' | 'VAWC'>(scope === 'vawc' ? 'VAWC' : scope === 'blotter' ? 'BLOTTER' : 'all');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [type, setType] = useState('');
  const [drill, setDrill] = useState<{ segment: string; title: string } | null>(null);

  const range = rangeOf(period, custom);
  const query = new URLSearchParams({ scope, from: range.from, to: range.to, desk, group: desk === 'BLOTTER' ? 'all' : group, ...(type && { type }) }).toString();
  const { data, error, isLoading, mutate } = useSWR<Data>(`/api/analytics/reporting?${query}`, fetcher, { revalidateOnFocus: true, refreshInterval: 60_000, keepPreviousData: true });

  // What this role may draw on, as the server decided.
  const allowed: AnalyticsScope = data?.scope ?? scope;
  const deskChoices = allowed === 'all' ? (['all', 'BLOTTER', 'VAWC'] as const) : allowed === 'vawc' ? (['VAWC'] as const) : (['BLOTTER'] as const);
  const effectiveDesk = deskChoices.includes(desk as never) ? desk : deskChoices[0];
  const vawcOn = effectiveDesk !== 'BLOTTER';
  const rangeLabel = period === 'custom' ? `${day(`${range.from}T00:00:00+08:00`)} to ${day(`${range.to}T00:00:00+08:00`)}` : PERIODS[period].toLowerCase();
  const changed = period !== 'd30' || group !== 'all' || type || (allowed === 'all' && desk !== 'all');
  const open = (segment: string, title: string) => setDrill({ segment, title });

  const filters = (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr)) auto' }, gap: 1, alignItems: 'start', mb: 1 }}>
      <TextField select size="small" label="Reporting period" value={period} onChange={e => setPeriod(e.target.value as Period)}>
        {(Object.keys(PERIODS) as Period[]).map(p => <MenuItem key={p} value={p}>{PERIODS[p]}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Reporting desk" value={effectiveDesk} disabled={deskChoices.length === 1}
        onChange={e => { const v = e.target.value as typeof desk; setDesk(v); if (v === 'BLOTTER') setGroup('all'); setType(''); }}>
        {deskChoices.map(k => <MenuItem key={k} value={k}>{k === 'all' ? 'All' : k === 'BLOTTER' ? 'Blotter' : 'VAWC'}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Affected-person group" value={effectiveDesk === 'BLOTTER' ? 'all' : group} disabled={!vawcOn}
        onChange={e => setGroup(e.target.value as GroupFilter)}
        helperText={vawcOn ? (group !== 'all' ? 'VAWC cases only, from recorded victim-survivors' : ' ') : 'Recorded on VAWC cases only'}>
        {(Object.keys(GROUPS) as GroupFilter[]).map(g => <MenuItem key={g} value={g}>{GROUPS[g]}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Case type" value={type} onChange={e => setType(e.target.value)}
        slotProps={{ select: { displayEmpty: true, MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } } }, inputLabel: { shrink: true } }}>
        <MenuItem value="">All case types</MenuItem>
        {effectiveDesk !== 'VAWC' && <ListSubheader>Blotter</ListSubheader>}
        {effectiveDesk !== 'VAWC' && (data?.typeOptions?.blotter ?? []).map((t: string) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        {effectiveDesk === 'VAWC' && <ListSubheader>VAWC - RA 9262</ListSubheader>}
        {effectiveDesk === 'VAWC' && (data?.typeOptions?.vawc ?? []).map((o: Data) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', minHeight: 40, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        {changed && <Button size="small" onClick={() => { setPeriod('d30'); setDesk(deskChoices[0]); setGroup('all'); setType(''); }} sx={{ textTransform: 'none' }}>Reset</Button>}
        {isLoading && data && <CircularProgress size={16} aria-label="Updating" />}
      </Box>
      {period === 'custom' && (
        <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField size="small" type="date" label="From (date reported)" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: custom.to || phToday() } }} />
          <TextField size="small" type="date" label="To (date reported)" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: custom.from, max: phToday() } }} />
        </Box>
      )}
    </Box>
  );
  const basis = (
    <>Reports <b>reported</b> {rangeLabel}{type ? `, ${type.startsWith('abuse:') ? ABUSE_TYPES[type.slice(6) as keyof typeof ABUSE_TYPES] : type}` : ''}
      {effectiveDesk !== 'all' ? `, ${effectiveDesk === 'VAWC' ? 'VAWC' : 'Blotter'} desk` : ''}{group !== 'all' && vawcOn ? `, ${GROUPS[group].toLowerCase()}` : ''}.
      {' '}Every chart uses the date reported; ages are taken at the incident.</>
  );
  const failed = error && !data;
  const loading = !data && !failed;

  return (
    <>
      <Panel id="reporting" title="Reporting" Icon={FactCheck}
        hint="Completeness measures how much detail a report gives for a preliminary assessment - never whether what it says is true. AI results are advisory and kept apart from officers' decisions.">
        {filters}
        <Typography sx={{ fontSize: '0.78rem', color: INK.secondary, mb: 1.75 }}>{basis}</Typography>
        {failed ? <Failed error={error} retry={() => void mutate()} /> : loading ? <Loading /> : data.total === 0 ? (
          <Empty>No reports match these filters in this period. Nothing is shown rather than zeros.</Empty>
        ) : (
          <>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Grid size={{ xs: 6, md: 3 }}><Stat label="Total reports" value={data.summary.total} hint="In the filters above" onPick={() => open('all', 'All reports')} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><Stat label="Complete reports" value={data.summary.complete} hint="Enough detail for a preliminary assessment" accent={SERIES[0]} onPick={() => open('completeness:complete', 'Complete reports')} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><Stat label="Awaiting clarification" value={data.summary.awaitingClarification} hint="Open, waiting on the reporter" accent={SERIES[2]} onPick={() => open('completeness:awaitingClarification', 'Awaiting clarification')} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><Stat label="Awaiting officer review" value={data.summary.awaitingReview} hint="AI assessment not yet confirmed or revised" accent={SERIES[1]} onPick={() => open('ai:awaiting', 'AI assessment awaiting officer review')} /></Grid>
            </Grid>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Block title="Report completeness" note="Each report is counted once. An open report waiting on the reporter's clarification is shown there, whatever its detail; the rest by how much detail it gives. Not assessed: filed before completeness was recorded.">
                  <SegmentBar label="Report completeness" unit="reports" total={data.total} onPick={k => open(`completeness:${k}`, `Completeness: ${LABEL.completeness[k as keyof typeof LABEL.completeness]}`)}
                    parts={[
                      { key: 'complete', label: 'Complete', value: data.completeness.complete, color: SERIES[0] },
                      { key: 'incomplete', label: 'Incomplete', value: data.completeness.incomplete, color: SERIES[1] },
                      { key: 'awaitingClarification', label: 'Awaiting clarification', value: data.completeness.awaitingClarification, color: SERIES[2] },
                      { key: 'unassessed', label: 'Not assessed', value: data.completeness.unassessed, neutral: true },
                    ]} />
                </Block>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Block title="Category and desk, as reviewed by officers"
                  note={<>Officers&apos; final decisions only - an AI-suggested category is never counted as confirmed. Misrouted: moved to the other desk. Recategorized: changed within the same desk. Percentages are of all {data.total} reports.</>}>
                  <BarList unit="reports" denominator={data.total} onPick={k => open(`classification:${k}`, `Classification: ${LABEL.classification[k as keyof typeof LABEL.classification]}`)}
                    bars={[
                      { key: 'confirmed', label: 'Correctly categorized', value: data.classification.confirmed, hint: 'Confirmed by an officer' },
                      { key: 'misrouted', label: 'Misrouted reports', value: data.classification.misrouted, hint: 'Moved to the other desk' },
                      { key: 'recategorized', label: 'Recategorized reports', value: data.classification.recategorized, hint: 'Changed within the desk' },
                      { key: 'unreviewed', label: 'Category not yet reviewed', value: data.classification.unreviewed, neutral: true },
                    ]} />
                </Block>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Block title="AI assessment, as reviewed by officers"
                  note={<>The original AI result, the officer&apos;s decision and any reason for an override are kept in each case&apos;s assessment history.
                    {' '}AI re-runs: <b>{data.ai.reruns}</b> on {data.ai.rerunCases} report{data.ai.rerunCases === 1 ? '' : 's'} - counted as runs, not reports, and kept beside the earlier results.</>}>
                  <SegmentBar label="AI assessment review" unit="reports" total={data.total} onPick={k => open(`ai:${k}`, `AI assessment: ${LABEL.ai[k as keyof typeof LABEL.ai]}`)}
                    parts={[
                      { key: 'confirmed', label: 'Confirmed by an officer', value: data.ai.confirmed, color: SERIES[0] },
                      { key: 'revised', label: 'Revised by an officer', value: data.ai.revised, color: SERIES[1] },
                      { key: 'awaiting', label: 'Awaiting officer review', value: data.ai.awaiting, color: SERIES[2] },
                      { key: 'none', label: 'No AI assessment recorded', value: data.ai.none, neutral: true },
                    ]} />
                </Block>
              </Grid>
            </Grid>
          </>
        )}
      </Panel>

      <Panel id="case-types" title="Reported Case Types" Icon={Category}
        hint={<>The same filters as Reporting above. {basis}</>}>
        {failed ? <Failed error={error} retry={() => void mutate()} /> : loading ? <Loading /> : (
          <Grid container spacing={1.5}>
            {data.caseTypes.blotter && (
              <Grid size={{ xs: 12, md: data.caseTypes.vawc ? 6 : 12 }}>
                <Block title="Blotter" note={<>The case category on each blotter report, as recorded. Percentages are of the {data.caseTypes.blotter.cases} blotter report{data.caseTypes.blotter.cases === 1 ? '' : 's'} in the filters.</>}>
                  <BarList unit="reports" denominator={data.caseTypes.blotter.cases} empty="No blotter reports in these filters."
                    bars={data.caseTypes.blotter.types.map((t: Data) => ({ key: t.type, label: t.type, value: t.count }))}
                    onPick={k => open(`blotterType:${k}`, `Blotter: ${k}`)} />
                </Block>
              </Grid>
            )}
            {data.caseTypes.vawc && <VawcTypes v={data.caseTypes.vawc} exact={data.maySeeVawcRows} open={data.maySeeVawcRows ? open : undefined} />}
          </Grid>
        )}
      </Panel>

      {allowed !== 'blotter' && effectiveDesk !== 'BLOTTER' && (
        <Panel id="vawc-people" title="VAWC – Women and Children Statistics" Icon={Diversity3}
          action={<Chip size="small" label={data?.people?.exact === false ? 'Aggregates only · small counts withheld' : 'Confidential · VAWC personnel'}
            sx={{ fontWeight: 700, bgcolor: '#f5f3ff', color: '#5b21b6' }} />}
          hint={<>Victim-survivors recorded on VAWC cases by officials - never reporters, witnesses or persons reported. {basis}</>}>
          {failed ? <Failed error={error} retry={() => void mutate()} /> : loading ? <Loading /> : data.people && <People p={data.people} open={data.people.exact ? open : undefined} />}
        </Panel>
      )}

      <CaseListDrawer drill={drill} query={query} onClose={() => setDrill(null)}
        openCase={(d, id) => { const b = caseBase[d as 'BLOTTER' | 'VAWC']; if (b) router.push(`${b}/${id}`); }} canOpen={d => Boolean(caseBase[d as 'BLOTTER' | 'VAWC'])} />
    </>
  );
}

const LABEL = {
  completeness: { complete: 'complete', incomplete: 'incomplete', awaitingClarification: 'awaiting clarification', unassessed: 'not assessed' },
  classification: { confirmed: 'correctly categorized', misrouted: 'misrouted', recategorized: 'recategorized', unreviewed: 'not yet reviewed' },
  ai: { confirmed: 'confirmed by an officer', revised: 'revised by an officer', awaiting: 'awaiting officer review', none: 'none recorded', rerun: 're-run' },
};

function VawcTypes({ v, exact, open }: { v: Data; exact: boolean; open?: (segment: string, title: string) => void }) {
  return (
    <Grid size={{ xs: 12, md: 6 }}>
      <Block title="VAWC - RA 9262 forms of violence"
        note={<>
          <b>A case can involve more than one form</b>: the bars count cases with each form, so they add up to more than the number of cases.
          {' '}<CountText value={v.withAnyType} /> case{v.withAnyType === 1 ? '' : 's'} have a form recorded, <CountText value={v.multiType} /> of them more than one.
          {' '}Percentages are of the <CountText value={v.cases} /> VAWC case{v.cases === 1 ? '' : 's'} in the filters.
          {' '}Only what officials recorded counts - the forms ticked on a completed VAWC intake form, or a case category an officer confirmed - never an AI keyword match.
          {!exact && ' Counts below 3 are withheld.'}
        </>}>
        <BarList unit="VAWC cases" denominator={v.cases} color={SERIES[0]}
          bars={[
            ...v.types.map((t: Data) => ({ key: t.key, label: t.label, value: t.count })),
            { key: 'awaiting_review', label: 'Form not yet recorded', value: v.awaitingReview, hint: 'No official review or completed intake yet', neutral: true },
            { key: 'other_category', label: 'None of the four recorded', value: v.otherCategory, hint: 'e.g. Child Abuse, Stalking, Domestic Violence', neutral: true },
          ]}
          onPick={open ? k => open(`abuse:${k}`, `VAWC: ${k in ABUSE_TYPES ? ABUSE_TYPES[k as keyof typeof ABUSE_TYPES] : k === 'awaiting_review' ? 'form not yet recorded' : 'none of the four recorded'}`) : undefined} />
        {v.categories.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: INK.secondary, mb: 0.5 }}>Case category on these VAWC cases</Typography>
            <BarList unit="VAWC cases" denominator={v.cases} color={SERIES[2]} bars={v.categories.map((c: Data) => ({ key: c.type, label: c.type, value: c.count }))}
              onPick={open ? k => open(`vawcCategory:${k}`, `VAWC category: ${k}`) : undefined} />
          </Box>
        )}
      </Block>
    </Grid>
  );
}

function People({ p, open }: { p: Data; open?: (segment: string, title: string) => void }) {
  if (p.cases.total === 0) return <Empty>No VAWC cases in these filters. Nothing is shown rather than zeros.</Empty>;
  const casesOf = (n: number | null) => pct(n, p.cases.total);
  return (
    <>
      <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: INK.secondary, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.75 }}>People - each person counted once</Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Women affected" value={p.persons.women} hint="Female, 18 or over at the incident" accent={SERIES[0]} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Children affected" value={p.persons.children} hint="Under 18 at the incident" accent={SERIES[2]} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Not recorded" value={p.persons.notRecorded} hint="Sex or age at the incident missing" accent="#94a3b8" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Stat label="Victim-survivors in all" value={p.persons.total} hint="Distinct people recorded" /></Grid>
      </Grid>
      <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: INK.secondary, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.75 }}>Cases - each case counted once</Typography>
      <BarList unit="VAWC cases" denominator={p.cases.total}
        bars={[
          { key: 'women', label: 'Cases involving women', value: p.cases.withWomen },
          { key: 'children', label: 'Cases involving children', value: p.cases.withChildren },
          { key: 'both', label: 'Involving both women and children', value: p.cases.withBoth, hint: 'Also in both bars above' },
          { key: 'none', label: 'No victim-survivor recorded', value: p.cases.noVictimRecorded, neutral: true },
        ]}
        onPick={open ? k => open(`people:${k}`, k === 'none' ? 'VAWC cases with no victim-survivor recorded' : `VAWC cases involving ${k === 'both' ? 'both women and children' : k}`) : undefined} />
      <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY, mb: 0.5 }}>How these are counted</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.25, listStyle: 'disc', '& li': { fontSize: '0.76rem', color: INK.secondary, lineHeight: 1.5, mb: 0.4 } }}>
          <li>Only victim-survivors an official recorded on the VAWC case - or, until they do, the person on the case&apos;s completed VAWC intake form. Sex and age are as recorded; nothing is inferred from a name or the narrative.</li>
          <li>A child is under 18 at the incident (RA 9262 sec. 3(h)); a woman is recorded female and 18 or over. Without an incident date, a birthdate decides only when the person was already under 18 when the report was made. RA 9262 also counts older children unable to care for themselves - that is not recorded here.</li>
          <li>The same person is recognised across cases by their VAWC client code. {p.persons.withoutClientCode ? <><CountText value={p.persons.withoutClientCode} /> recorded without a code {p.persons.withoutClientCode === 1 ? 'is' : 'are'} counted once per record.</> : 'Every person here has a client code.'}</li>
          <li>{p.cases.multipleVictims ? <><CountText value={p.cases.multipleVictims} /> case{p.cases.multipleVictims === 1 ? ' has' : 's have'} more than one victim-survivor - the people are each counted, the case once.</> : 'No case here has more than one victim-survivor recorded.'}
            {p.cases.someNotRecorded ? <> On <CountText value={p.cases.someNotRecorded} /> case{p.cases.someNotRecorded === 1 ? '' : 's'}, someone&apos;s sex or age is not recorded.</> : null}
            {' '}Cases involving women: {casesOf(p.cases.withWomen) ?? '-'}% of VAWC cases in the filters.</li>
          {!p.exact && <li>You see aggregates only: counts below 3 are withheld, and no case is listed.</li>}
        </Box>
      </Box>
    </>
  );
}

function CaseListDrawer({ drill, query, onClose, openCase, canOpen }: {
  drill: { segment: string; title: string } | null; query: string; onClose: () => void;
  openCase: (desk: string, id: string) => void; canOpen: (desk: string) => boolean;
}) {
  const { data, error, isLoading } = useSWR<Data>(drill ? `/api/analytics/reporting-cases?${query}&segment=${encodeURIComponent(drill.segment)}` : null, fetcher);
  return (
    <Drawer anchor="right" open={Boolean(drill)} onClose={onClose}
      slotProps={{ paper: { id: 'reporting-case-list', 'aria-label': drill?.title ?? 'Cases', sx: { width: { xs: '100%', sm: 460 } } } }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'flex-start', gap: 1, borderBottom: '1px solid #e2e8f0' }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 800, color: NAVY }}>{drill?.title}</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: INK.muted }}>The cases behind this figure, in the same filters. Open one in its case page.</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close the list"><Close /></IconButton>
      </Box>
      <Box sx={{ p: 2, overflowY: 'auto' }}>
        {error ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{error.message}</Alert> : isLoading || !data ? <Skeleton variant="rounded" height={160} /> : (
          <>
            <Typography sx={{ fontSize: '0.8rem', color: INK.secondary, mb: 1 }}>{data.total} case{data.total === 1 ? '' : 's'}{data.total > data.cases.length ? ` - the latest ${data.cases.length} shown` : ''}</Typography>
            {data.vawcWithheld && <Alert severity="info" sx={{ borderRadius: 2, mb: 1, fontSize: '0.8rem' }}>VAWC cases are counted in the charts but listed only for VAWC personnel.</Alert>}
            {data.cases.length === 0 ? <Empty>No case to list.</Empty> : (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                {data.cases.map((c: Data) => {
                  const ok = canOpen(c.desk);
                  return (
                    <Box key={c.id} component={ok ? 'button' : 'div'} type={ok ? 'button' : undefined} onClick={ok ? () => openCase(c.desk, c.id) : undefined}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, border: '1px solid #e2e8f0', borderRadius: 2, bgcolor: '#fff', width: '100%', textAlign: 'left',
                        font: 'inherit', cursor: ok ? 'pointer' : 'default', '&:hover': ok ? { bgcolor: '#f8fafc' } : undefined, '&:focus-visible': { outline: '2px solid #0f766e' } }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.86rem' }}>#{c.caseNumber}</Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: INK.secondary }}>{c.caseType} · {c.desk === 'VAWC' ? 'VAWC' : 'Blotter'} · {c.status} · reported {day(c.filedAt)}</Typography>
                      </Box>
                      {ok && <ChevronRight sx={{ color: INK.muted }} />}
                    </Box>
                  );
                })}
              </Box>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
}

function Loading() {
  return <Grid container spacing={1.5}>{Array.from({ length: 4 }).map((_, i) => <Grid key={i} size={{ xs: 6, md: 3 }}><Skeleton variant="rounded" height={84} /></Grid>)}</Grid>;
}
function Failed({ error, retry }: { error: Error; retry: () => void }) {
  return <Alert severity="warning" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" startIcon={<Refresh />} onClick={retry}>Retry</Button>}>{error.message}</Alert>;
}
function Empty({ children }: { children: ReactNode }) {
  return <Box sx={{ py: 3, textAlign: 'center' }}><Typography sx={{ fontSize: '0.88rem', color: '#94a3b8' }}>{children}</Typography></Box>;
}
