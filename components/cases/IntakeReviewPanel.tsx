'use client';

import { useState } from 'react';
import { Box, Typography, Chip, Button, Collapse, Divider, Alert } from '@mui/material';
import { FormatQuote, History, QuestionAnswer, ReportProblem } from '@mui/icons-material';

/**
 * What the assisted intake recorded, laid out for the officer deciding on it.
 *
 * Everything here is the resident's account. Quotes are their words; nothing
 * has been verified, and the panel says so rather than letting a tidy layout
 * imply otherwise.
 */

export interface IntakeRecord {
  narrative: string;
  selectedCategory?: string | null;
  turns: { slot: string; topic: string; outcome: string; value: string | null; text: string | null }[];
  informationCompleteness: string;
  suggestedCaseCategory?: string | null;
  classificationStatus?: string | null;
  categoryConfidence: string;
  categoryRationale: string[];
  conflicts: string[];
  route: string;
  immediateSafetyConcern: boolean;
  supportingIndicators: { label: string; quote: string; source: string }[];
  missingInformation: string[];
  requiresOfficerReview: boolean;
  reviewReasons: string[];
  engineVersion: string;
  createdAt: string;
}

export interface HistoryRow {
  id: string;
  kind: string;
  riskLevel: string;
  informationCompleteness?: string | null;
  caseType?: string | null;
  previousCaseType?: string | null;
  reason?: string | null;
  createdAt: string;
  actor?: { name: string; role: string } | null;
}

const COMPLETENESS: Record<string, { label: string; color: string }> = {
  INSUFFICIENT: { label: 'Information insufficient', color: '#c2410c' },
  PARTIAL: { label: 'Information partial', color: '#a16207' },
  SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: { label: 'Sufficient for preliminary assessment', color: '#15803d' },
};

const SUPPORT: Record<string, string> = {
  high: 'well supported by the report',
  medium: 'partly supported by the report',
  low: 'not supported — needs review',
};

const KIND: Record<string, string> = {
  preliminary: 'Preliminary assessment (automated)',
  walk_in: 'Walk-in, assessed at filing',
  officer_confirm: 'Confirmed by an officer',
  officer_override: 'Changed by an officer',
  category_confirm: 'Category confirmed by an officer',
  category_change: 'Category changed by an officer',
};

export function CompletenessChip({ value }: { value?: string | null }) {
  if (!value) return null;
  const c = COMPLETENESS[value] ?? { label: value, color: '#475569' };
  return (
    <Chip size="small" label={c.label}
      sx={{ height: 22, fontWeight: 700, fontSize: '0.72rem', bgcolor: `${c.color}14`, color: c.color }} />
  );
}

const fmt = (d: string) => new Date(d).toLocaleString('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export default function IntakeReviewPanel({ intake, history }: {
  intake?: IntakeRecord | null;
  history?: HistoryRow[];
}) {
  const [showTurns, setShowTurns] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const label = { fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', mb: 0.5 };

  return (
    <Box>
      {intake ? (
        <>
          {intake.immediateSafetyConcern && (
            <Alert severity="error" icon={<ReportProblem />} sx={{ mb: 1.25, borderRadius: 2, fontSize: '0.84rem' }}>
              The resident reported an immediate safety concern.
            </Alert>
          )}

          {/* Category: what the words describe, beside what was chosen */}
          <Typography sx={label}>Category</Typography>
          <Box sx={{ mb: 1.25 }}>
            <Typography sx={{ fontSize: '0.86rem', color: '#0c1e46' }}>
              {intake.classificationStatus === 'needs_review'
                ? <>No category clearly supported — filed as <b>{intake.suggestedCaseCategory}</b> for an officer to classify</>
                : <>Suggested from the description: <b>{intake.suggestedCaseCategory}</b></>}
              {/* Qualitative, not a calibrated probability, so never a number. */}
              <Box component="span" sx={{ color: '#94a3b8' }}>
                {' '}({SUPPORT[intake.categoryConfidence] ?? intake.categoryConfidence})
              </Box>
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
              {intake.selectedCategory ? `A category was sent with the report: ${intake.selectedCategory} (context only) · ` : ''}
              Route: {intake.route === 'VAWC' ? 'VAWC desk' : 'Blotter desk'}
            </Typography>
            {intake.categoryRationale.map(r => (
              <Typography key={r} sx={{ fontSize: '0.78rem', color: '#64748b' }}>• {r}</Typography>
            ))}
          </Box>

          {intake.conflicts.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1.25, borderRadius: 2, fontSize: '0.8rem' }}>
              {intake.conflicts.map(c => <div key={c}>{c}</div>)}
            </Alert>
          )}

          {/* Indicators, in the resident's own words */}
          {intake.supportingIndicators.length > 0 && (
            <>
              <Typography sx={label}>Reported indicators — not verified</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.25 }}>
                {intake.supportingIndicators.map((i, n) => (
                  <Box key={n} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                    <FormatQuote sx={{ fontSize: 15, color: '#94a3b8', mt: '2px', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.82rem', color: '#334155' }}>
                      <b>{i.label}:</b> &ldquo;{i.quote}&rdquo;
                      <Box component="span" sx={{ color: '#94a3b8' }}> — {i.source === 'answer' ? 'answer to a question' : 'written report'}</Box>
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {intake.missingInformation.length > 0 && (
            <>
              <Typography sx={label}>Still unknown</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: '#475569', mb: 1.25 }}>
                {intake.missingInformation.join('; ')}. Unknown is not taken as safe or as dangerous.
              </Typography>
            </>
          )}

          {intake.turns.length > 0 && (
            <>
              <Button size="small" startIcon={<QuestionAnswer sx={{ fontSize: 15 }} />} onClick={() => setShowTurns(v => !v)}
                sx={{ px: 0, color: '#475569', textTransform: 'none', fontWeight: 600 }}>
                {showTurns ? 'Hide' : 'Show'} follow-up answers ({intake.turns.length})
              </Button>
              <Collapse in={showTurns}>
                <Box sx={{ mt: 0.75, mb: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {intake.turns.map(t => (
                    <Box key={t.slot} sx={{ fontSize: '0.8rem' }}>
                      <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{t.topic}</Typography>
                      <Typography sx={{ fontSize: '0.84rem', color: t.outcome === 'answered' ? '#0c1e46' : '#94a3b8', fontStyle: t.outcome === 'answered' ? 'normal' : 'italic' }}>
                        {t.outcome === 'answered'
                          ? [t.value, t.text && `“${t.text}”`].filter(Boolean).join(' — ')
                          : t.outcome === 'not sure' ? 'Not sure' : t.outcome === 'declined' ? 'Preferred not to answer' : 'Skipped'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </>
          )}

          <Box sx={{ mt: 1 }}>
            <Typography sx={label}>Original narrative</Typography>
            <Typography sx={{ fontSize: '0.84rem', color: '#334155', whiteSpace: 'pre-wrap', bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1 }}>
              {intake.narrative}
            </Typography>
          </Box>
        </>
      ) : (
        <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mb: 1 }}>
          Filed before the assisted intake, so there are no follow-up answers on record.
        </Typography>
      )}

      {history && history.length > 0 && (
        <>
          <Divider sx={{ my: 1.25 }} />
          <Button size="small" startIcon={<History sx={{ fontSize: 15 }} />} onClick={() => setShowHistory(v => !v)}
            sx={{ px: 0, color: '#475569', textTransform: 'none', fontWeight: 600 }}>
            {showHistory ? 'Hide' : 'Show'} assessment history ({history.length})
          </Button>
          <Collapse in={showHistory}>
            <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {history.map(h => (
                <Box key={h.id} sx={{ borderLeft: '3px solid #e2e8f0', pl: 1 }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46', fontWeight: 600 }}>
                    {KIND[h.kind] ?? h.kind}: {h.kind.startsWith('category_')
                      ? (h.kind === 'category_change' ? `${h.previousCaseType} → ${h.caseType}` : h.caseType)
                      : h.riskLevel}
                  </Typography>
                  <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                    {fmt(h.createdAt)}{h.actor ? ` · ${h.actor.name}` : ''}
                  </Typography>
                  {h.reason && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>“{h.reason}”</Typography>}
                </Box>
              ))}
            </Box>
          </Collapse>
        </>
      )}
    </Box>
  );
}
