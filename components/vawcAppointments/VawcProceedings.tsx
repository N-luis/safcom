'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Chip, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  FormControlLabel, Checkbox, CircularProgress, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Shield, Share, History, Add, EventNote } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { formatHearingDate, formatHearingTime } from '@/lib/hearings';
import {
  BPO_APPLICANTS, BPO_ACTING, BPO_SERVICE_METHODS, BPO_STATUSES, BPO_PERIOD_NOTE,
  REFERRAL_AGENCIES, VAWC_REFERRAL_STATUSES, ACTIVITY_KINDS, type ActivityItem, type ActivityKind,
} from '@/lib/vawcProceedings';
import { NAVY, VIOLET, chipSx, getJson, send, todayPh } from './appointmentUi';

/**
 * VAWC Case Proceedings on screen: Barangay Protection Orders (application,
 * ex parte decision and service as separate steps) and referrals with their
 * follow-up dates. (Court dates are Hearings.) The desk
 * records; it never holds a hearing here. Officials only.
 */

type Officer = { id: string; name: string } | null;
interface Bpo { id: string; reference: string; status: keyof typeof BPO_STATUSES; case: { id: string; caseNumber: string }; appliedAt: string; applicantType: string;
  decision: string | null; decidedAt: string | null; actingRole: string | null; actingOfficialName: string | null; punongBarangayUnavailable: boolean;
  servedAt: string | null; serviceMethod: string | null; servedByName: string | null; officer: Officer; lastDay: string | null; inEffect: boolean;
  applicationNotes: string | null; exParteAssessment: string | null; serviceNotes: string | null; cancelReason: string | null; canEdit: boolean }
interface Referral { id: string; reference: string; status: keyof typeof VAWC_REFERRAL_STATUSES; case: { id: string; caseNumber: string }; agencyType: keyof typeof REFERRAL_AGENCIES;
  agencyName: string; referredAt: string; purpose: string; followUpAt: string | null; outcome: string | null; officer: Officer; canEdit: boolean }
interface Data { bpos: Bpo[]; referrals: Referral[]; items: ActivityItem[]; canCreate: boolean }

const CASE_BASE = '/vawc/cases';
const BPO_COLOR: Record<string, string> = { APPLIED: '#b91c1c', ISSUED: '#c2410c', SERVED: '#15803d', DENIED: '#64748b', CANCELLED: '#94a3b8' };
const REF_COLOR: Record<string, string> = { REFERRED: '#0369a1', ACKNOWLEDGED: '#0f766e', IN_PROGRESS: '#b45309', COMPLETED: '#15803d', DECLINED_BY_CLIENT: '#64748b', NO_RESPONSE: '#b91c1c' };
const day = (d: string | null) => (d ? formatHearingDate(d) : '—');
const dayTime = (d: string | null) => (d ? `${formatHearingDate(d)}, ${formatHearingTime(d)}` : '—');
const nowTime = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(11, 16);
const options = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

// ── A small form dialog, driven by its fields ────────────────────────────────

type Field = { name: string; label: string; type?: 'text' | 'multiline' | 'date' | 'time' | 'select' | 'checkbox'; options?: { value: string; label: string }[];
  required?: boolean; helper?: string; show?: (v: Record<string, unknown>) => boolean };
interface FormSpec { title: string; note?: string; fields: Field[]; initial: Record<string, unknown>; url: string; method: 'POST' | 'PATCH'; extra?: Record<string, unknown>; submit: string }

function FormDialog({ spec, onClose, onDone }: { spec: FormSpec; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>(spec.initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = spec.fields.filter(f => !f.show || f.show(v));
  const missing = shown.some(f => f.required && f.type !== 'checkbox' && !String(v[f.name] ?? '').trim());
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { ...spec.extra, ...Object.fromEntries(shown.map(f => [f.name, f.type === 'checkbox' ? Boolean(v[f.name]) : (String(v[f.name] ?? '').trim() || undefined)])) };
      await send(spec.url, spec.method, body);
      toast.success('Saved');
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1.05rem' }}>{spec.title}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        {spec.note && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{spec.note}</Alert>}
        {shown.map(f => f.type === 'checkbox' ? (
          <FormControlLabel key={f.name} control={<Checkbox checked={Boolean(v[f.name])} onChange={e => setV(p => ({ ...p, [f.name]: e.target.checked }))} />}
            label={<Typography sx={{ fontSize: '0.84rem' }}>{f.label}</Typography>} />
        ) : (
          <TextField key={f.name} size="small" label={f.label} required={f.required} value={String(v[f.name] ?? '')}
            onChange={e => setV(p => ({ ...p, [f.name]: e.target.value }))} helperText={f.helper}
            select={f.type === 'select'} multiline={f.type === 'multiline'} minRows={f.type === 'multiline' ? 3 : undefined}
            type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'} slotProps={{ inputLabel: { shrink: f.type === 'date' || f.type === 'time' || undefined } }}>
            {f.type === 'select' && (f.options ?? []).map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        ))}
        {err && <Alert severity="error" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || missing} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {busy ? <CircularProgress size={16} color="inherit" /> : spec.submit}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryDialog({ kind, id, title, onClose }: { kind: string; id: string; title: string; onClose: () => void }) {
  const { data, error } = useSWR<{ history: { id: string; label: string; at: string; by: string; note: string | null }[] }>(`/api/vawc/proceedings/${kind}/${id}`, getJson);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1.05rem' }}>History - {title}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{(error as Error).message}</Alert>}
        {!data && !error && <Skeleton height={80} />}
        {data?.history.map(h => (
          <Box key={h.id} sx={{ py: 0.75, borderBottom: '1px solid #f1f5f9' }}>
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>{h.label}</Typography>
            <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>{dayTime(h.at)} · {h.by}</Typography>
            {h.note && <Typography sx={{ fontSize: '0.8rem', color: '#334155' }}>Reason: {h.note}</Typography>}
          </Box>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button></DialogActions>
    </Dialog>
  );
}

// ── The forms ────────────────────────────────────────────────────────────────

const newBpo = (caseId: string): FormSpec => ({
  title: 'Record a BPO application', submit: 'Record application', url: '/api/vawc/proceedings', method: 'POST', extra: { kind: 'bpo', caseId },
  note: 'RA 9262 sec. 14: the Punong Barangay (or a Kagawad, if the Punong Barangay is unavailable) acts on it ex parte on the date of filing. No hearing is held.',
  initial: { appliedDate: todayPh(), appliedTime: nowTime(), applicantType: 'VICTIM_SURVIVOR' },
  fields: [
    { name: 'appliedDate', label: 'Date filed', type: 'date', required: true }, { name: 'appliedTime', label: 'Time filed', type: 'time', required: true },
    { name: 'applicantType', label: 'Who applied', type: 'select', options: options(BPO_APPLICANTS), required: true },
    { name: 'applicationNotes', label: 'Application details (officials only)', type: 'multiline' },
  ],
});
const decideBpo = (b: Bpo): FormSpec => ({
  title: `Record the decision - ${b.reference}`, submit: 'Record decision', url: `/api/vawc/proceedings/bpo/${b.id}`, method: 'PATCH', extra: { action: 'decide' },
  initial: { decision: 'ISSUED', date: todayPh(), time: nowTime(), actingRole: 'PUNONG_BARANGAY' },
  fields: [
    { name: 'decision', label: 'Decision', type: 'select', options: [{ value: 'ISSUED', label: 'Issued' }, { value: 'DENIED', label: 'Not issued' }], required: true },
    { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'time', label: 'Time', type: 'time', required: true },
    { name: 'actingRole', label: 'Decided by', type: 'select', options: options(BPO_ACTING), required: true },
    { name: 'actingOfficialName', label: 'Name of the official who decided', required: true },
    { name: 'punongBarangayUnavailable', label: 'I attest that the Punong Barangay was unavailable at the time (required when a Kagawad decides)', type: 'checkbox',
      show: v => v.actingRole === 'KAGAWAD' },
    { name: 'exParteAssessment', label: 'Ex parte assessment and reasons (officials only)', type: 'multiline', required: true },
  ],
});
const serveBpo = (b: Bpo): FormSpec => ({
  title: `Record service on the respondent - ${b.reference}`, submit: 'Record service', url: `/api/vawc/proceedings/bpo/${b.id}`, method: 'PATCH', extra: { action: 'serve' },
  note: 'RA 9262 sec. 14: served personally on the respondent immediately after issuance. The respondent is never told of the victim-survivor\'s hearings or meetings.',
  initial: { date: todayPh(), time: nowTime(), serviceMethod: 'PERSONAL' },
  fields: [
    { name: 'date', label: 'Date served', type: 'date', required: true }, { name: 'time', label: 'Time served', type: 'time', required: true },
    { name: 'serviceMethod', label: 'How', type: 'select', options: options(BPO_SERVICE_METHODS), required: true },
    { name: 'servedByName', label: 'Served by (barangay official)', required: true },
    { name: 'serviceNotes', label: 'Notes (officials only)', type: 'multiline' },
  ],
});
const cancelSpec = (kind: string, id: string, reference: string): FormSpec => ({
  title: `Mark as recorded in error - ${reference}`, submit: 'Mark as recorded in error', url: `/api/vawc/proceedings/${kind}/${id}`, method: 'PATCH', extra: { action: 'cancel' },
  note: 'The record and its history are kept; it only stops counting as current.', initial: {},
  fields: [{ name: 'reason', label: 'Why it was recorded in error', type: 'multiline', required: true }],
});
const newReferral = (caseId: string): FormSpec => ({
  title: 'Record a referral', submit: 'Record referral', url: '/api/vawc/proceedings', method: 'POST', extra: { kind: 'referral', caseId },
  initial: { agencyType: 'SWDO', referredDate: todayPh(), status: 'REFERRED' },
  fields: [
    { name: 'agencyType', label: 'Service', type: 'select', options: options(REFERRAL_AGENCIES), required: true },
    { name: 'agencyName', label: 'Agency or office', required: true }, { name: 'referredDate', label: 'Date referred', type: 'date', required: true },
    { name: 'purpose', label: 'What it is for (officials only)', type: 'multiline', required: true },
    { name: 'status', label: 'Status', type: 'select', options: options(VAWC_REFERRAL_STATUSES), required: true },
    { name: 'followUpDate', label: 'Follow up on', type: 'date' },
  ],
});
const updateReferral = (r: Referral): FormSpec => ({
  title: `Update the referral - ${r.reference}`, submit: 'Save', url: `/api/vawc/proceedings/referral/${r.id}`, method: 'PATCH', extra: { action: 'update' },
  initial: { status: r.status, followUpDate: r.followUpAt ? r.followUpAt.slice(0, 10) : '', outcome: r.outcome ?? '' },
  fields: [
    { name: 'status', label: 'Status', type: 'select', options: options(VAWC_REFERRAL_STATUSES), required: true },
    { name: 'followUpDate', label: 'Next follow-up', type: 'date' }, { name: 'outcome', label: 'Outcome or notes (officials only)', type: 'multiline' },
  ],
});

// ── Rows ─────────────────────────────────────────────────────────────────────

function RowBox({ children }: { children: React.ReactNode }) {
  return <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, display: 'grid', gap: 0.5 }}>{children}</Box>;
}
const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <Typography sx={{ fontSize: '0.8rem', color: '#334155' }}><Box component="span" sx={{ color: '#64748b' }}>{k}: </Box>{v}</Typography>
);
const Actions = ({ children }: { children: React.ReactNode }) => <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>{children}</Box>;
const act = { size: 'small' as const, sx: { textTransform: 'none', minHeight: 30 } };

function BpoRow({ b, showCase, onForm, onHistory }: { b: Bpo; showCase?: boolean; onForm: (s: FormSpec) => void; onHistory: () => void }) {
  return (
    <RowBox>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', color: NAVY }}>{b.reference}</Typography>
        <Chip size="small" label={BPO_STATUSES[b.status]} sx={chipSx(BPO_COLOR[b.status])} />
        {b.inEffect && <Chip size="small" label={`In effect until ${day(b.lastDay)}`} sx={chipSx('#15803d')} />}
        {showCase && <a href={`${CASE_BASE}/${b.case.id}`} style={{ marginLeft: 'auto', color: '#0369a1', fontWeight: 600, fontSize: '0.8rem' }}>{b.case.caseNumber}</a>}
      </Box>
      <Line k="Applied" v={`${dayTime(b.appliedAt)} · ${BPO_APPLICANTS[b.applicantType as keyof typeof BPO_APPLICANTS] ?? b.applicantType}`} />
      {b.decision && <Line k={b.decision === 'ISSUED' ? 'Issued' : 'Not issued'} v={`${dayTime(b.decidedAt)} · ${b.actingOfficialName} (${BPO_ACTING[b.actingRole as keyof typeof BPO_ACTING]}${b.actingRole === 'KAGAWAD' ? ', Punong Barangay unavailable - attested' : ''})`} />}
      {b.decision === 'ISSUED' && <Line k="Served" v={b.servedAt ? `${dayTime(b.servedAt)} · ${b.servedByName} (${BPO_SERVICE_METHODS[b.serviceMethod as keyof typeof BPO_SERVICE_METHODS]})` : <b style={{ color: '#c2410c' }}>Not yet served</b>} />}
      {b.decision === 'ISSUED' && <Line k="Last effective day" v={day(b.lastDay)} />}
      {b.exParteAssessment && <Line k="Ex parte assessment" v={b.exParteAssessment} />}
      {b.cancelReason && <Line k="Recorded in error" v={b.cancelReason} />}
      <Actions>
        {b.canEdit && b.status === 'APPLIED' && <Button {...act} variant="contained" onClick={() => onForm(decideBpo(b))} sx={{ ...act.sx, bgcolor: NAVY }}>Record decision</Button>}
        {b.canEdit && b.status === 'ISSUED' && <Button {...act} variant="contained" onClick={() => onForm(serveBpo(b))} sx={{ ...act.sx, bgcolor: NAVY }}>Record service</Button>}
        <Button {...act} startIcon={<History sx={{ fontSize: 15 }} />} onClick={onHistory}>History</Button>
        {b.canEdit && b.status !== 'CANCELLED' && <Button {...act} color="inherit" onClick={() => onForm(cancelSpec('bpo', b.id, b.reference))}>Recorded in error</Button>}
      </Actions>
    </RowBox>
  );
}

function ReferralRow({ r, showCase, onForm, onHistory }: { r: Referral; showCase?: boolean; onForm: (s: FormSpec) => void; onHistory: () => void }) {
  return (
    <RowBox>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', color: NAVY }}>{r.reference}</Typography>
        <Chip size="small" label={VAWC_REFERRAL_STATUSES[r.status]} sx={chipSx(REF_COLOR[r.status])} />
        {showCase && <a href={`${CASE_BASE}/${r.case.id}`} style={{ marginLeft: 'auto', color: '#0369a1', fontWeight: 600, fontSize: '0.8rem' }}>{r.case.caseNumber}</a>}
      </Box>
      <Line k={REFERRAL_AGENCIES[r.agencyType]} v={r.agencyName} />
      <Line k="Referred" v={day(r.referredAt)} />
      <Line k="Follow up" v={r.followUpAt ? day(r.followUpAt) : 'No date set'} />
      <Line k="Purpose" v={r.purpose} />
      {r.outcome && <Line k="Outcome" v={r.outcome} />}
      <Actions>
        {r.canEdit && <Button {...act} variant="contained" onClick={() => onForm(updateReferral(r))} sx={{ ...act.sx, bgcolor: NAVY }}>Update</Button>}
        <Button {...act} startIcon={<History sx={{ fontSize: 15 }} />} onClick={onHistory}>History</Button>
      </Actions>
    </RowBox>
  );
}

function useDialogs(mutate: () => void) {
  const [form, setForm] = useState<FormSpec | null>(null);
  const [hist, setHist] = useState<{ kind: string; id: string; title: string } | null>(null);
  const ui = (
    <>
      {form && <FormDialog spec={form} onClose={() => setForm(null)} onDone={() => { setForm(null); mutate(); }} />}
      {hist && <HistoryDialog {...hist} onClose={() => setHist(null)} />}
    </>
  );
  return { setForm, setHist, ui };
}

function Section({ icon, title, action, children, empty }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode[]; empty: string }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
        {icon}<Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY }}>{title}</Typography>
        <Box sx={{ ml: 'auto' }}>{action}</Box>
      </Box>
      {children.length ? <Box sx={{ display: 'grid', gap: 1 }}>{children}</Box> : <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>{empty}</Typography>}
    </Box>
  );
}

// ── On the VAWC case page ────────────────────────────────────────────────────

/** BPO and referral records of one VAWC case - never mounted on a blotter case. */
export function ProceedingsPanel({ caseId }: { caseId: string }) {
  const { data, error, isLoading, mutate } = useSWR<Data>(`/api/vawc/proceedings?caseId=${encodeURIComponent(caseId)}`, getJson);
  const d = useDialogs(() => void mutate());
  const add = (label: string, spec: () => FormSpec) => data?.canCreate
    ? <Button size="small" startIcon={<Add sx={{ fontSize: 15 }} />} onClick={() => d.setForm(spec())} sx={{ textTransform: 'none', minHeight: 30 }}>{label}</Button> : null;
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <EventNote sx={{ fontSize: 17, color: VIOLET }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Protection Orders &amp; Referrals</Typography>
          <Button size="small" href="/vawc/hearings?section=due" sx={{ ml: 'auto', textTransform: 'none', minHeight: 32 }}>All due dates</Button>
        </Box>
        {isLoading && <Skeleton height={60} />}
        {error && !data && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{(error as Error).message}</Alert>}
        {data && (
          <>
            <Section icon={<Shield sx={{ fontSize: 16, color: '#b91c1c' }} />} title="Barangay Protection Orders (BPO)" action={add('Record application', () => newBpo(caseId))}
              empty="No BPO application recorded.">
              {data.bpos.map(b => <BpoRow key={b.id} b={b} onForm={d.setForm} onHistory={() => d.setHist({ kind: 'bpo', id: b.id, title: b.reference })} />)}
            </Section>
            {data.bpos.some(b => b.decision === 'ISSUED') && <Typography sx={{ fontSize: '0.74rem', color: '#64748b', mt: -1.5 }}>{BPO_PERIOD_NOTE}</Typography>}
            <Section icon={<Share sx={{ fontSize: 16, color: '#0f766e' }} />} title="Referrals" action={add('Record referral', () => newReferral(caseId))} empty="No referral recorded.">
              {data.referrals.map(r => <ReferralRow key={r.id} r={r} onForm={d.setForm} onHistory={() => d.setHist({ kind: 'referral', id: r.id, title: r.reference })} />)}
            </Section>
          </>
        )}
      </CardContent>
      {d.ui}
    </Card>
  );
}

// ── On the module page: every case the official may see ──────────────────────

export type ProceedingSection = 'bpo' | 'referral' | 'due';

export function ProceedingsSection({ section }: { section: ProceedingSection }) {
  const { data, error, isLoading, mutate } = useSWR<Data>('/api/vawc/proceedings', getJson, { keepPreviousData: true });
  const d = useDialogs(() => void mutate());
  if (isLoading && !data) return <Skeleton variant="rounded" height={240} />;
  if (error && !data) return <Alert severity="info" sx={{ borderRadius: 2 }}>{(error as Error).message}</Alert>;
  if (!data) return null;
  const note = <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1.5 }}>Records are added on the VAWC case page, under Protection Orders &amp; Referrals.</Typography>;
  return (
    <>
      {section === 'bpo' && <>{note}<Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 1.5 }}>{BPO_PERIOD_NOTE}</Typography>
        <Grid>{data.bpos.map(b => <BpoRow key={b.id} b={b} showCase onForm={d.setForm} onHistory={() => d.setHist({ kind: 'bpo', id: b.id, title: b.reference })} />)}</Grid>
        {!data.bpos.length && <Empty text="No BPO recorded on your VAWC cases." />}</>}
      {section === 'referral' && <>{note}
        <Grid>{data.referrals.map(r => <ReferralRow key={r.id} r={r} showCase onForm={d.setForm} onHistory={() => d.setHist({ kind: 'referral', id: r.id, title: r.reference })} />)}</Grid>
        {!data.referrals.length && <Empty text="No referral recorded on your VAWC cases." />}</>}
      {section === 'due' && <DueList items={data.items} />}
      {d.ui}
    </>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr', xl: '1fr 1fr 1fr' }, gap: 1.25 }}>{children}</Box>
);
const Empty = ({ text }: { text: string }) => <Typography sx={{ textAlign: 'center', color: '#64748b', fontSize: '0.88rem', py: 4 }}>{text}</Typography>;

/** BPO steps and last days and referral follow-ups, in date order - each labelled for what it is. */
export function DueList({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <Empty text="Nothing is due on your VAWC cases." />;
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' } }}>
            <TableCell>Date</TableCell><TableCell>Kind</TableCell><TableCell>What</TableCell><TableCell>Record</TableCell><TableCell>Case</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map(i => (
            <TableRow key={`${i.kind}:${i.recordId}:${i.day}`} sx={{ '& td': { fontSize: '0.8rem' } }}>
              <TableCell sx={{ whiteSpace: 'nowrap', color: i.overdue ? '#b91c1c' : undefined, fontWeight: i.overdue ? 700 : 400 }}>
                {formatHearingDate(`${i.day}T12:00:00+08:00`)}{i.at ? `, ${formatHearingTime(i.at)}` : ''}{i.overdue ? ' · overdue' : ''}
              </TableCell>
              <TableCell><Chip size="small" label={ACTIVITY_KINDS[i.kind as ActivityKind].label} sx={chipSx(ACTIVITY_KINDS[i.kind as ActivityKind].color)} /></TableCell>
              <TableCell>{i.title}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{i.reference}</TableCell>
              <TableCell><a href={`${CASE_BASE}/${i.caseId}`} style={{ color: '#0369a1', fontWeight: 600 }}>{i.caseNumber}</a></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
