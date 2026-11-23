'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Collapse, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, RadioGroup, Radio, FormControlLabel, FormLabel, ButtonBase,
} from '@mui/material';
import { ContentCopy, Refresh, ExpandMore, OpenInNew } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  INDICATOR_KEYS, INDICATOR_LABELS, MATCH_STATUSES, REVIEW_ACTIONS, CASE_MATCH_LABELS, canReview, isOpenMatch,
  type Level, type ReviewAction, type MatchStatus, type CaseMatchLabel, type IndicatorKey,
} from '@/lib/caseMatching';

const NAVY = '#0c1e46';

interface OtherCase { id: string; caseNumber: string; caseType: string; incidentDate: string | null; filedAt: string; status: string }
interface HistoryRow { id: string; kind: string; by: string | null; fromStatus: string | null; toStatus: string | null; reason: string | null; createdAt: string }
interface Match {
  id: string; classification: 'POTENTIAL_DUPLICATE' | 'RELATED_CASE'; status: MatchStatus; statusLabel: string; other: OtherCase; primaryCaseId: string | null;
  matchingEstimate: number; indicators: Record<IndicatorKey, Level>; matchingInformation: string[]; differences: string[]; uncertainties: string[];
  explanation: string; analysis: 'AI' | 'RULES'; aiModel: string | null; detectedAt: string; reviewedAt: string | null; reviewedBy: string | null; reviewReason: string | null;
  history: HistoryRow[];
}
interface MatchesData {
  scan: { status: string; scannedAt: string; candidates: number; matches: number; aiStatus: string | null } | null;
  label: CaseMatchLabel | null; matches: Match[]; canReview: boolean;
}

const LEVEL_SX: Record<Level, { bg: string; fg: string }> = {
  HIGH: { bg: '#fee2e2', fg: '#991b1b' }, MEDIUM: { bg: '#fef3c7', fg: '#92400e' }, LOW: { bg: '#f1f5f9', fg: '#475569' },
};
export const MATCH_LABEL_SX: Record<CaseMatchLabel, { bg: string; fg: string }> = {
  POTENTIAL_DUPLICATE: { bg: '#fee2e2', fg: '#991b1b' }, RELATED_FOUND: { bg: '#ede9fe', fg: '#5b21b6' }, PENDING_REVIEW: { bg: '#fef3c7', fg: '#92400e' },
  VERIFIED_DUPLICATE: { bg: '#fce7f3', fg: '#9d174d' }, NOT_DUPLICATE: { bg: '#dcfce7', fg: '#166534' }, NO_MATCH: { bg: '#f1f5f9', fg: '#475569' },
};
const STATUS_SX: Record<string, { bg: string; fg: string }> = {
  PENDING_REVIEW: { bg: '#fef3c7', fg: '#92400e' }, FURTHER_REVIEW: { bg: '#ffedd5', fg: '#9a3412' }, VERIFIED_DUPLICATE: { bg: '#fce7f3', fg: '#9d174d' },
  RELATED: { bg: '#ede9fe', fg: '#5b21b6' }, NOT_DUPLICATE: { bg: '#dcfce7', fg: '#166534' },
};
const chip = (c: { bg: string; fg: string }) => ({ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: c.bg, color: c.fg });
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not given');
const when = (v: string) => new Date(v).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The Case Monitoring label as a chip (lists and the panel). */
export function MatchLabelChip({ label, size = 'small' }: { label: string | null | undefined; size?: 'small' | 'medium' }) {
  if (!label || !(label in CASE_MATCH_LABELS)) return null;
  const l = label as CaseMatchLabel;
  return <Chip size={size} label={CASE_MATCH_LABELS[l]} data-testid="match-label" sx={chip(MATCH_LABEL_SX[l])} />;
}

async function getMatches(url: string): Promise<MatchesData> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Could not load the matches'), { status: res.status });
  return body.data as MatchesData;
}

function aiLine(scan: MatchesData['scan']) {
  if (!scan) return 'Not checked yet.';
  if (scan.status === 'RUNNING') return 'A check is running…';
  if (scan.status === 'FAILED') return 'The last check could not finish. Run it again.';
  const ai = scan.aiStatus === 'ok' ? 'database comparison, with an AI-assisted reading of the closest reports'
    : scan.aiStatus === 'none' ? 'database comparison'
    : 'database comparison only (the AI reading was not available)';
  return `Checked ${when(scan.scannedAt)} - ${ai}.`;
}

/**
 * "Potential Duplicate and Related Cases" on a case (Blotter and VAWC Case
 * Monitoring). What SafeComm found is a suggestion for an official to
 * decide: both cases are always kept, and nothing changes until someone
 * reviews it. The server sends only matches this official may see (never a
 * VAWC case to a blotter officer) and decides who may review.
 */
export default function CaseMatchesPanel({ caseId, basePath, caseFiledAt }: { caseId: string; basePath: string; caseFiledAt?: string | null }) {
  const url = `/api/cases/${caseId}/matches`;
  const { data, error, isLoading, mutate } = useSWR(url, getMatches, { revalidateOnFocus: false });
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<{ match: Match; action: ReviewAction } | null>(null);

  const recheck = async () => {
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recheck' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(body.error ?? 'The check could not be run.'); return; }
      await mutate(body.data, { revalidate: false });
      toast.success('Checked again');
    } finally { setBusy(false); }
  };

  if (error && (error as { status?: number }).status === 404) return null;
  return (
    <Card sx={{ mb: 2 }} component="section" aria-labelledby="case-matches-title" data-testid="case-matches">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
          <ContentCopy sx={{ fontSize: 18, color: '#7c3aed' }} />
          <Typography id="case-matches-title" component="h2" sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY, flex: 1, minWidth: 0 }}>
            Potential Duplicate and Related Cases
          </Typography>
          {data && <MatchLabelChip label={data.label} />}
        </Box>
        {isLoading && <Skeleton variant="rounded" height={64} />}
        {error && <Alert severity="warning" sx={{ fontSize: '0.82rem' }}>{(error as Error).message}</Alert>}
        {data && (
          <>
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mb: 1.25 }}>
              {aiLine(data.scan)} Suggestions only - an official decides, and both reports are always kept.
            </Typography>
            {data.matches.length === 0 && data.scan?.status === 'DONE' && (
              <Typography sx={{ fontSize: '0.84rem', color: '#334155', mb: 1 }}>No Match Found: no report on this desk looked like the same or a connected incident.</Typography>
            )}
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              {data.matches.map(m => (
                <MatchCard key={m.id} m={m} caseId={caseId} basePath={basePath} canDecide={data.canReview} onDecide={action => setDeciding({ match: m, action })} />
              ))}
            </Box>
            {data.canReview && (
              <Button size="small" variant="text" startIcon={<Refresh sx={{ fontSize: 16 }} />} onClick={recheck} disabled={busy}
                sx={{ mt: 1, textTransform: 'none', fontWeight: 700, color: '#5b21b6' }}>
                {busy ? 'Checking…' : 'Check again'}
              </Button>
            )}
          </>
        )}
      </CardContent>
      {deciding && (
        <DecisionDialog key={`${deciding.match.id}-${deciding.action}`} caseId={caseId} caseFiledAt={caseFiledAt ?? null} match={deciding.match} action={deciding.action}
          onClose={() => setDeciding(null)} onDone={d => { void mutate(d, { revalidate: false }); setDeciding(null); }} />
      )}
    </Card>
  );
}

function List({ title, items, testid }: { title: string; items: string[]; testid: string }) {
  if (!items.length) return null;
  return (
    <Box data-testid={testid}>
      <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: '0.83rem', color: '#334155' }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </Box>
    </Box>
  );
}

function MatchCard({ m, caseId, basePath, canDecide, onDecide }: { m: Match; caseId: string; basePath: string; canDecide: boolean; onDecide: (a: ReviewAction) => void }) {
  const [open, setOpen] = useState(isOpenMatch(m.status));
  const [history, setHistory] = useState(false);
  const isDup = m.classification === 'POTENTIAL_DUPLICATE';
  const primary = m.primaryCaseId ? (m.primaryCaseId === caseId ? 'this case' : m.other.caseNumber) : null;
  const actions = (Object.keys(REVIEW_ACTIONS) as ReviewAction[]).filter(a => canReview(m.status, a));
  return (
    <Box data-testid="case-match" sx={{ border: '1px solid', borderColor: isDup && isOpenMatch(m.status) ? '#fecaca' : '#e2e8f0', borderRadius: 2, p: 1.25 }}>
      <ButtonBase onClick={() => setOpen(o => !o)} aria-expanded={open} sx={{ width: '100%', textAlign: 'left', display: 'block', borderRadius: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Chip size="small" label={isDup ? 'Potential Duplicate' : 'Related Case'} sx={chip(isDup ? MATCH_LABEL_SX.POTENTIAL_DUPLICATE : MATCH_LABEL_SX.RELATED_FOUND)} />
          <Chip size="small" label={MATCH_STATUSES[m.status] ?? m.statusLabel} sx={chip(STATUS_SX[m.status] ?? MATCH_LABEL_SX.NO_MATCH)} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>{m.other.caseNumber}</Typography>
          <ExpandMore sx={{ ml: 'auto', fontSize: 20, color: '#64748b', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </Box>
        <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.5 }}>
          {m.other.caseType} · incident {day(m.other.incidentDate)} · detected {when(m.detectedAt)}
        </Typography>
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ display: 'grid', gap: 1.1, mt: 1.1 }}>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }} data-testid="match-indicators">
            {INDICATOR_KEYS.map(k => {
              const level = m.indicators?.[k] ?? 'LOW';
              return <Chip key={k} size="small" label={`${INDICATOR_LABELS[k]}: ${level.charAt(0)}${level.slice(1).toLowerCase()}`} sx={chip(LEVEL_SX[level])} />;
            })}
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>
            Matching estimate: <b>{Math.round(m.matchingEstimate * 100)}%</b> - an estimate from the indicators above, not a probability and not a finding.
          </Typography>
          <Box sx={{ bgcolor: '#f8fafc', borderRadius: 1.5, p: 1 }}>
            <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: m.analysis === 'AI' ? '#5b21b6' : '#475569', mb: 0.25 }}>
              {m.analysis === 'AI' ? 'AI-assisted explanation (checked against the database comparison)' : 'Explanation from the database comparison'}
            </Typography>
            <Typography sx={{ fontSize: '0.84rem', color: '#1e293b' }}>{m.explanation}</Typography>
          </Box>
          <List title="What matches" items={m.matchingInformation} testid="match-matching" />
          <List title="What differs" items={m.differences} testid="match-differences" />
          <List title="Uncertain or missing" items={m.uncertainties} testid="match-uncertainties" />
          <Button component={Link} href={`${basePath}/${m.other.id}`} size="small" variant="outlined" startIcon={<OpenInNew sx={{ fontSize: 15 }} />}
            sx={{ justifySelf: 'start', textTransform: 'none', fontWeight: 700, borderRadius: 2 }}>
            Open {m.other.caseNumber}
          </Button>
          {m.reviewedAt && (
            <Typography sx={{ fontSize: '0.8rem', color: '#334155' }} data-testid="match-review">
              {MATCH_STATUSES[m.status]} - by {m.reviewedBy ?? 'an official'}, {when(m.reviewedAt)}
              {primary ? ` · primary case: ${primary}` : ''}{m.reviewReason ? ` · reason: ${m.reviewReason}` : ''}
            </Typography>
          )}
          {canDecide && actions.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {actions.map(a => (
                <Button key={a} size="small" variant={a === 'confirm_duplicate' ? 'contained' : 'outlined'} onClick={() => onDecide(a)}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, minHeight: 36,
                    ...(a === 'confirm_duplicate' ? { bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } } : {}) }}>
                  {REVIEW_ACTIONS[a].label}
                </Button>
              ))}
            </Box>
          )}
          <Box>
            <Button size="small" onClick={() => setHistory(h => !h)} aria-expanded={history} sx={{ textTransform: 'none', fontSize: '0.78rem', p: 0, minWidth: 0 }}>
              {history ? 'Hide history' : `History (${m.history.length})`}
            </Button>
            <Collapse in={history} unmountOnExit>
              <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 2.25, fontSize: '0.78rem', color: '#475569' }}>
                {m.history.map(h => (
                  <li key={h.id}>
                    {when(h.createdAt)} - {h.kind === 'detected' ? 'Found' : h.kind === 'redetected' ? 'Checked again' : 'Reviewed'} by {h.by ?? 'SafeComm'}
                    {h.kind === 'reviewed' && h.fromStatus && h.toStatus ? `: ${MATCH_STATUSES[h.fromStatus as MatchStatus] ?? h.fromStatus} → ${MATCH_STATUSES[h.toStatus as MatchStatus] ?? h.toStatus}` : ''}
                    {h.reason ? ` - ${h.reason}` : ''}
                  </li>
                ))}
              </Box>
            </Collapse>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}

function DecisionDialog({ caseId, caseFiledAt, match, action, onClose, onDone }: {
  caseId: string; caseFiledAt: string | null; match: Match; action: ReviewAction; onClose: () => void; onDone: (d: MatchesData) => void;
}) {
  // The case filed first is the usual primary; the official may choose the other.
  const older = caseFiledAt && new Date(match.other.filedAt).getTime() < new Date(caseFiledAt).getTime() ? match.other.id : caseId;
  const [primary, setPrimary] = useState<string>(match.primaryCaseId ?? older);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsReason = action === 'not_duplicate' || !isOpenMatch(match.status);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/matches`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, matchId: match.id, reason: reason.trim() || undefined, expectedStatus: match.status,
          ...(action === 'confirm_duplicate' && { primaryCaseId: primary }) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body.error ?? 'The decision was not saved.'); return; }
      toast.success(`${REVIEW_ACTIONS[action].label}: saved`);
      onDone(body.data as MatchesData);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{REVIEW_ACTIONS[action].label}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5 }}>
        <Typography sx={{ fontSize: '0.86rem', color: '#334155' }}>
          {action === 'confirm_duplicate' && `Both reports stay on record. Choose the case the barangay continues on; the reporter of the other is told, in general words, that it was reviewed as a duplicate.`}
          {action === 'mark_related' && `The two cases are linked to each other as related; each is handled as its own case.`}
          {action === 'not_duplicate' && `The warning is cleared. Say why - this is kept with the decision.`}
          {action === 'further_review' && `The match stays open for another official to look at.`}
        </Typography>
        {action === 'confirm_duplicate' && (
          <Box>
            <FormLabel sx={{ fontSize: '0.82rem', fontWeight: 700 }}>Primary case</FormLabel>
            <RadioGroup value={primary} onChange={e => setPrimary(e.target.value)}>
              <FormControlLabel value={caseId} control={<Radio size="small" />} label="This case" />
              <FormControlLabel value={match.other.id} control={<Radio size="small" />} label={`${match.other.caseNumber} (filed ${day(match.other.filedAt)})`} />
            </RadioGroup>
          </Box>
        )}
        <TextField label={needsReason ? 'Reason (required)' : 'Reason or note (optional)'} value={reason} onChange={e => setReason(e.target.value)}
          multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} required={needsReason}
          helperText={!isOpenMatch(match.status) ? 'This changes a decision already made, so a reason is required.' : undefined} />
        {err && <Alert severity="error">{err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || (needsReason && reason.trim().length < 5)}>{busy ? 'Saving…' : 'Save decision'}</Button>
      </DialogActions>
    </Dialog>
  );
}
