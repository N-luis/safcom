'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Chip, Button, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  CircularProgress, Collapse,
} from '@mui/material';
import { Refresh, Gavel, AutoAwesome, ReportProblem, ExpandMore, ExpandLess } from '@mui/icons-material';
import toast from 'react-hot-toast';

/**
 * Every AI preliminary assessment of the case - the one made at filing and
 * each re-run since - beside the official assessment, and never mixed with it.
 *
 * An AI result is advisory: it is labelled so, it does not change the case's
 * level, and an officer confirms or revises the official assessment below
 * (AssessmentReview). Earlier results stay listed; a re-run adds one.
 */

interface Criterion { level: number; levelLabel?: string; indicator: string; evidence?: string[] }
interface AiPart {
  used?: boolean; model?: string | null;
  assessment?: {
    status?: string; understanding?: string | null; recommendedNextAction?: string | null; urgentHumanReview?: boolean;
    missingInformation?: string[]; uncertainty?: string[]; level?: number | null; label?: string | null; unavailableReason?: string | null;
  } | null;
}
interface Entry {
  id?: string; at: string; by?: string | null; reason?: string | null;
  framework: string | null; matrixLevel: number | null; matrixLabel: string | null;
  status: string | null; informationCompleteness?: string | null; suggestedCategory: string | null;
  immediateSafetyConcern: boolean; triageStatus?: string | null;
  matchedCriteria: Criterion[] | null; missingInformation: string[] | null; recommendedNextSteps: string[] | null;
  references: { sectionTitle: string; riskLevel: number | null; pageNumber: number | null }[] | null;
  sourceVerified: boolean | null; knowledgeBaseStatus: string | null; assessedBy: string | null;
  ai: AiPart | null; newInformation?: string | null;
}
interface Data {
  canRerun: boolean; rerunsToday: number; rerunLimit: number;
  official: { riskLevel: string | null; triageStatus: string | null; decision: { kind: string; riskLevel: string | null; reason: string | null; by: string | null; at: string } | null };
  atFiling: Entry | null;
  reruns: Entry[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load the assessments');
  return body.data as Data;
};

const NAVY = '#0c1e46';
// The matrices' own five levels, each its own colour.
const LEVEL_COLOR: Record<number, string> = { 1: '#15803d', 2: '#a16207', 3: '#ea580c', 4: '#dc2626', 5: '#7e22ce' };
const RISK_COLOR: Record<string, string> = { Low: '#15803d', Medium: '#ea580c', High: '#dc2626', Critical: '#7e22ce' };
const STATUS: Record<string, string> = {
  PRELIMINARY: 'Preliminary', FOR_REVIEW: 'For review', NEEDS_MORE_INFORMATION: 'Needs more information',
};
const when = (d: string) => new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function EntryCard({ e, title, open, onToggle }: { e: Entry; title: string; open: boolean; onToggle: () => void }) {
  const a = e.ai?.assessment ?? null;
  const urgent = e.immediateSafetyConcern || Boolean(a?.urgentHumanReview) || e.triageStatus === 'URGENT_REVIEW';
  const col = e.matrixLevel ? LEVEL_COLOR[e.matrixLevel] : '#64748b';
  const next = a?.recommendedNextAction ?? e.recommendedNextSteps?.[0] ?? null;
  const missing = [...new Set([...(e.missingInformation ?? []), ...(a?.missingInformation ?? [])])];
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderLeft: `3px solid ${col}`, borderRadius: 2, p: 1.25, bgcolor: '#fcfcfd' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY }}>{title}</Typography>
        <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{when(e.at)}{e.by ? ` · ${e.by}` : ''}</Typography>
        <Button size="small" onClick={onToggle} aria-expanded={open} endIcon={open ? <ExpandLess /> : <ExpandMore />}
          sx={{ ml: 'auto', textTransform: 'none', minHeight: 30, color: '#475569' }}>
          {open ? 'Less' : 'Details'}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
        <Chip size="small" label={e.matrixLevel ? `Level ${e.matrixLevel} — ${e.matrixLabel}` : 'No level — no criterion met'}
          sx={{ height: 22, fontWeight: 800, fontSize: '0.72rem', bgcolor: `${col}14`, color: col }} />
        {e.suggestedCategory && <Chip size="small" label={e.suggestedCategory} sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#f1f5f9' }} />}
        {e.status && <Chip size="small" label={STATUS[e.status] ?? e.status} sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#f1f5f9', color: '#475569' }} />}
        {urgent && <Chip size="small" icon={<ReportProblem sx={{ fontSize: 14 }} />} label="Urgent" sx={{ height: 22, fontWeight: 800, fontSize: '0.72rem', bgcolor: '#fef2f2', color: '#b91c1c' }} />}
        {e.framework && <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>{e.framework === 'VAWC' ? 'VAWC' : 'Blotter'} matrix</Typography>}
      </Box>
      {e.reason && <Typography sx={{ fontSize: '0.78rem', color: '#475569', mt: 0.5 }}><b>Why re-run:</b> {e.reason}</Typography>}
      {a?.understanding && <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.5 }}>{a.understanding}</Typography>}
      {next && <Typography sx={{ fontSize: '0.78rem', color: '#334155', mt: 0.25 }}><b>Suggested next action:</b> {next}</Typography>}
      <Collapse in={open}>
        <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {(e.matchedCriteria ?? []).length > 0 ? (
            <Box>
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b' }}>Risk indicators met (matrix criteria, with the report&apos;s words)</Typography>
              {(e.matchedCriteria ?? []).map((m, i) => (
                <Typography key={i} sx={{ fontSize: '0.78rem', color: '#334155' }}>
                  • <b>L{m.level}</b> “{m.indicator}”{m.evidence?.[0] && <Box component="span" sx={{ color: '#64748b' }}> — “{m.evidence[0]}”</Box>}
                </Typography>
              ))}
            </Box>
          ) : <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>No matrix criterion was met by what the report says.</Typography>}
          {missing.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#a16207' }}><b>Missing or unclear:</b> {missing.join('; ')}</Typography>}
          {(a?.uncertainty ?? []).length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#a16207' }}><b>Uncertain:</b> {a!.uncertainty!.join('; ')}</Typography>}
          {a?.unavailableReason && <Typography sx={{ fontSize: '0.78rem', color: '#a16207' }}>AI assessment unavailable: {a.unavailableReason}</Typography>}
          {(e.references ?? []).length > 0 && (
            <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>
              <b>Knowledge-base references:</b> {(e.references ?? []).map(r => `${r.sectionTitle}${r.pageNumber ? ` (p. ${r.pageNumber})` : ''}`).join(' · ')}
            </Typography>
          )}
          {e.sourceVerified === false && <Typography sx={{ fontSize: '0.74rem', color: '#b91c1c' }}>The level could not be matched to the imported matrix text.</Typography>}
          {e.newInformation && (
            <Typography sx={{ fontSize: '0.76rem', color: '#475569', whiteSpace: 'pre-wrap' }}><b>New information given:</b> {e.newInformation}</Typography>
          )}
          <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', fontStyle: 'italic' }}>
            {e.ai?.used ? `Groq ${e.ai.model ?? ''} read the report against the retrieved matrix text. ` : 'Rule-based reading only (the AI did not run). '}
            {e.assessedBy ?? ''}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}

export default function AiAssessmentHistory({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Data>(`/api/cases/${caseId}/ai-assessment`, fetcher);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [info, setInfo] = useState('');
  const [running, setRunning] = useState(false);

  const rerun = async () => {
    if (reason.trim().length < 5) { toast.error('Say why it is being re-run - what is new'); return; }
    setRunning(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/ai-assessment`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), newInformation: info.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not re-run');
      if (body.data?.flaggedUrgent) toast.error('The new assessment found an immediate safety concern - flagged for urgent review', { duration: 6000 });
      else toast.success('AI assessment re-run - the result is listed below');
      setDialog(false); setReason(''); setInfo('');
      setOpen(body.data?.historyId ?? null);
      await mutate();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not re-run');
    } finally { setRunning(false); }
  };

  if (isLoading) return <Box sx={{ mb: 1.25 }}><Skeleton height={60} /></Box>;
  if (error || !data) return error ? <Alert severity="warning" sx={{ mb: 1.25, borderRadius: 2, fontSize: '0.82rem' }}>{error.message}</Alert> : null;

  const d = data.official.decision;
  const offCol = RISK_COLOR[data.official.riskLevel ?? ''] ?? '#64748b';
  const left = data.rerunLimit - data.rerunsToday;
  return (
    <Box sx={{ mb: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* The official assessment - an officer's, not the AI's */}
      <Box sx={{ border: '1px solid #cbd5e1', borderRadius: 2, p: 1.25, bgcolor: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Gavel sx={{ fontSize: 16, color: NAVY }} />
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY }}>Official assessment</Typography>
          <Chip size="small" label={data.official.riskLevel ? `${data.official.riskLevel} risk` : 'Risk undetermined'}
            sx={{ height: 22, fontWeight: 800, fontSize: '0.72rem', bgcolor: `${offCol}14`, color: offCol }} />
        </Box>
        <Typography sx={{ fontSize: '0.78rem', color: '#475569', mt: 0.5 }}>
          {d
            ? <>{d.kind === 'officer_override' ? 'Revised' : 'Confirmed'} by {d.by ?? 'an officer'} · {when(d.at)}{d.reason ? <> — “{d.reason}”</> : null}</>
            : 'Not yet reviewed by an officer. The level shown is the preliminary one; confirm or revise it below.'}
        </Typography>
      </Box>

      {/* The AI's - advisory, every one kept */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <AutoAwesome sx={{ fontSize: 16, color: '#0f766e' }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY }}>AI preliminary assessments</Typography>
        <Chip size="small" label="Advisory - not a legal finding" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: '#f0fdfa', color: '#0f766e' }} />
        {data.canRerun && (
          <Button size="small" variant="outlined" startIcon={<Refresh sx={{ fontSize: 15 }} />} onClick={() => setDialog(true)} disabled={left <= 0}
            sx={{ ml: 'auto', textTransform: 'none', minHeight: 32, borderRadius: 2 }}>
            Re-run assessment
          </Button>
        )}
      </Box>

      {data.reruns.map((e, i) => (
        <EntryCard key={e.id} e={e} title={`Re-run ${data.reruns.length - i}`} open={open === e.id} onToggle={() => setOpen(o => o === e.id ? null : e.id!)} />
      ))}
      {data.atFiling
        ? <EntryCard e={data.atFiling} title="At filing" open={open === 'filing'} onToggle={() => setOpen(o => o === 'filing' ? null : 'filing')} />
        : <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>No assessment was recorded at filing.</Typography>}

      <Dialog open={dialog} onClose={() => !running && setDialog(false)} fullWidth maxWidth="sm" scroll="paper">
        <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>
          Re-run the AI assessment
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
            The report as filed is read again against the retrieved risk-matrix text, with anything new you add below set apart from it.
            Earlier results are kept, and the case&apos;s level does not change unless you revise it.
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
          <TextField label="Why re-run it? *" value={reason} onChange={e => setReason(e.target.value)} size="small"
            placeholder="e.g. the complainant was interviewed today" slotProps={{ htmlInput: { maxLength: 300 } }} />
          <TextField label="New information (optional)" value={info} onChange={e => setInfo(e.target.value)} multiline minRows={3}
            helperText="What was learned since filing - only what was said or seen. Phone numbers, e-mails and the reporter's name are removed before it is sent to the AI; avoid other names."
            slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>{left} of {data.rerunLimit} re-runs left today for this case.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setDialog(false)} disabled={running} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={rerun} disabled={running} sx={{ textTransform: 'none', bgcolor: '#0f766e', '&:hover': { bgcolor: '#115e59' } }}>
            {running ? <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />Assessing…</> : 'Re-run assessment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
