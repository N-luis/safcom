'use client';

import { useState, type ReactNode } from 'react';
import { Box, Typography, Chip, Button, Collapse } from '@mui/material';
import { AltRoute, ExpandLess, ExpandMore } from '@mui/icons-material';
import { DESK_DECISION_LABEL, type DeskRecommendation, type DeskDecision } from '@/lib/reportDesk';
import type { HistoryRow } from './IntakeReviewPanel';

const COLOR: Record<DeskDecision, string> = { BLOTTER: '#0369a1', VAWC: '#7c3aed', NEEDS_CLARIFICATION: '#b45309', HUMAN_REVIEW: '#b91c1c' };
const chip = (c: string) => ({ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: `${c}14`, color: c, border: `1px solid ${c}33` });
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Which desk SafeComm AI recommended for the report, and the official
 * decision beside it - kept apart. The recommendation is the one stored when
 * the report was filed (and any after a delayed AI reading); it is never
 * edited. The official decision is the category an officer confirmed or
 * changed, with who, when and why (CategoryReview, below).
 */
export default function ReportingDeskPanel({ history }: { history?: HistoryRow[] }) {
  const [open, setOpen] = useState(false);
  const recs = (history ?? []).filter(h => h.kind === 'desk_recommendation' && h.rationale);
  if (!recs.length) return null;
  const latest = recs.at(-1)!;
  const r = latest.rationale as DeskRecommendation;
  const decisions = (history ?? []).filter(h => (h.kind === 'category_confirm' || h.kind === 'category_change') && h.createdAt >= recs[0].createdAt);
  const official = decisions.at(-1);
  const color = COLOR[r.decision] ?? '#64748b';

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
        <AltRoute sx={{ fontSize: 18, color }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: '#0c1e46' }}>Reporting desk - SafeComm AI recommendation</Typography>
        <Chip size="small" label={DESK_DECISION_LABEL[r.decision] ?? r.decision} sx={chip(color)} />
        {r.confidentialReview && <Chip size="small" label="Confidential VAWC review" sx={chip('#7c3aed')} />}
        {r.awaitingAi && <Chip size="small" label="Waiting for the AI" sx={chip('#64748b')} />}
      </Box>
      <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', mb: 1 }}>
        {when(r.classifiedAt)} · {r.ai.used ? `read with the AI (${r.ai.model ?? 'model not recorded'})` : r.awaitingAi ? 'the AI could not run - not classified yet' : 'rules only'}
        {' '}· filed as &quot;{latest.caseType}&quot; · a recommendation, not a legal finding
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 1, display: 'grid', gap: 0.25 }}>
        {r.explanation.map(e => <Typography key={e} component="li" sx={{ fontSize: '0.8rem', color: '#334155' }}>{e}</Typography>)}
      </Box>

      <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: official ? '#f0fdf4' : '#f8fafc', border: `1px solid ${official ? '#bbf7d0' : '#e2e8f0'}`, mb: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Official classification</Typography>
        {official ? (
          <Typography sx={{ fontSize: '0.82rem', color: '#14532d' }}>
            {official.kind === 'category_change' ? `Changed from "${official.previousCaseType}" to "${official.caseType}"` : `Confirmed as "${official.caseType}"`}
            {' '}by {official.actor?.name ?? 'an official'}, {when(official.createdAt)}{official.reason ? ` - ${official.reason}` : ''}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>No official decision yet. Confirm or correct the category below - a change needs a reason, and the recommendation above is kept.</Typography>
        )}
      </Box>

      <Button size="small" onClick={() => setOpen(o => !o)} endIcon={open ? <ExpandLess /> : <ExpandMore />} sx={{ textTransform: 'none', px: 0 }}>
        {open ? 'Hide' : 'Show'} what it rests on
      </Button>
      <Collapse in={open}>
        <Box sx={{ display: 'grid', gap: 1, mt: 0.5 }}>
          <Section title="Indicators in the report">
            {r.indicators.length ? r.indicators.map(i => <Line key={`${i.label}:${i.quote}`}>{i.label}: &quot;{i.quote}&quot;</Line>) : <Line muted>None quoted.</Line>}
          </Section>
          <Section title="Missing information">
            {r.missingInformation.length ? r.missingInformation.map(m => <Line key={m}>{m}</Line>) : <Line muted>Nothing listed.</Line>}
          </Section>
          {r.questions.length > 0 && (
            <Section title="Questions offered to the resident (they may skip them)">
              {r.questions.map(q => <Line key={q}>{q}</Line>)}
            </Section>
          )}
          <Section title="Knowledge-base sources (BLOTTER and VAWC matrices)">
            {r.sources.length ? r.sources.map((s, i) => (
              <Line key={i}>{s.framework} · {s.sectionTitle}{s.pageNumber ? `, p. ${s.pageNumber}` : ''}{s.riskLabel ? ` · ${s.riskLabel}` : ''} · {s.strength} match</Line>
            )) : <Line muted>No source text matched closely enough to cite.</Line>}
          </Section>
          {recs.length > 1 && (
            <Section title="Earlier recommendations">
              {recs.slice(0, -1).map(h => {
                const e = h.rationale as DeskRecommendation;
                return <Line key={h.id}>{when(e.classifiedAt)}: {DESK_DECISION_LABEL[e.decision] ?? e.decision}{e.awaitingAi ? ' (the AI could not run)' : ''}</Line>;
              })}
            </Section>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.25 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gap: 0.25 }}>{children}</Box>
    </Box>
  );
}
const Line = ({ children, muted }: { children: ReactNode; muted?: boolean }) => (
  <Typography sx={{ fontSize: '0.8rem', color: muted ? '#94a3b8' : '#334155', overflowWrap: 'anywhere' }}>{children}</Typography>
);
