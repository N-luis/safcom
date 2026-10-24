'use client';

import { useState } from 'react';
import { Box, Typography, Chip, Button, Collapse, Divider, Alert } from '@mui/material';
import { FormatQuote, History, QuestionAnswer, ReportProblem, MenuBook } from '@mui/icons-material';

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
  framework?: string | null;
  matrixLevel?: number | null;
  matrixLabel?: string | null;
  matchedCriteria?: { level: number; levelLabel: string; indicator: string; evidence: string[] }[] | null;
  assessmentStatus?: string | null;
  alternativeCategories?: string[] | null;
  levelCaveats?: string[] | null;
  matrixReferences?: {
    sectionTitle: string; riskLevel: number | null; pageNumber: number | null; score: number;
    strength: 'strong' | 'weak'; suggestedAction: string | null; links: string[]; excerpt: string;
  }[] | null;
  sourceVerified?: boolean | null;
  knowledgeBaseStatus?: string | null;
  assessedBy?: string | null;
  /** The AI reader's checked reading at filing; null when it did not run. */
  aiReading?: {
    status: string; used: boolean; model: string | null; note: string;
    category: string | null; categoryConfidence: string | null; alternativeCategories: string[];
    facts: { key: string; quote: string }[];
    slots: { slot: string; value: string; quote: string }[];
    reasons: string[]; dropped: number;
    /** The preliminary assessment against the retrieved matrix text (lib/aiAssessment.ts). */
    assessment?: {
      status: 'COMPLETED' | 'ASSESSMENT_UNAVAILABLE'; unavailableReason: string | null;
      framework: string | null; suggestedCategory: string | null; level: number | null; label: string | null;
      criteria: { level: number; criterion: string; source: string; reportQuote: string }[];
      droppedCriteria: number; classificationStatus: string; understanding: string | null;
      missingInformation: string[]; uncertainty: string[]; recommendedNextAction: string | null;
      urgentHumanReview: boolean; affectedPerson: string; reporterKnowledge: string;
      sources: { sid: string; documentType: string; sectionTitle: string; riskLevel: number | null; pageNumber: number | null }[];
      frameworkStatus: string | null; at: string;
    } | null;
  } | null;
  /** Every AI interview question as asked, with the answer or how it was left. */
  aiInterview?: {
    relationship: string; rounds: number;
    turns: { id: string; round: number; text: string; slot: string | null; kind: string; value?: string; answerText?: string }[];
  } | null;
  urgentReview?: boolean;
}

const AFFECTED: Record<string, string> = { REPORTER: 'the reporter', OTHER_PERSON: 'someone other than the reporter', UNCLEAR: 'unclear' };
const KNOWLEDGE: Record<string, string> = { DIRECT: 'saw or experienced it', HEARD: 'heard it', TOLD_BY_OTHERS: 'was told by others', UNCLEAR: 'unclear' };
const ANSWER: Record<string, string> = { yes: 'Yes', no: 'No', unsure: "Don't know" };

export interface HistoryRow {
  id: string;
  kind: string;
  riskLevel: string;
  informationCompleteness?: string | null;
  caseType?: string | null;
  previousCaseType?: string | null;
  matrixLevel?: number | null;
  matrixLabel?: string | null;
  reason?: string | null;
  createdAt: string;
  actor?: { name: string; role: string } | null;
}

const COMPLETENESS: Record<string, { label: string; color: string }> = {
  INSUFFICIENT: { label: 'Information insufficient', color: '#c2410c' },
  PARTIAL: { label: 'Information partial', color: '#a16207' },
  SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: { label: 'Sufficient for preliminary assessment', color: '#15803d' },
};

const STATUS: Record<string, { label: string; color: string }> = {
  PRELIMINARY: { label: 'Preliminary', color: '#0f766e' },
  FOR_REVIEW: { label: 'For review', color: '#a16207' },
  NEEDS_MORE_INFORMATION: { label: 'Needs more information', color: '#c2410c' },
};

const KB_STATUS: Record<string, string> = {
  ok: 'Source text retrieved',
  no_match: 'No sufficiently similar source text',
  no_documents: 'Matrix not imported',
  unavailable: 'Knowledge base unreachable — unchecked',
  empty_query: 'Nothing to search',
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
  const [showRefs, setShowRefs] = useState(false);
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

          {/* The risk matrix: the document's own level, criteria and guidance */}
          {intake.framework && (
            <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, mb: 1.25, bgcolor: '#fcfcfd' }}>
              <Typography sx={label}>
                Risk matrix at filing — {intake.framework === 'VAWC' ? 'VAWC' : 'Blotter'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', my: 0.5 }}>
                <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: '#0c1e46' }}>
                  {intake.matrixLevel ? `Level ${intake.matrixLevel} — ${intake.matrixLabel}` : 'No level — no criterion met'}
                </Typography>
                {intake.assessmentStatus && (
                  <Chip size="small" label={STATUS[intake.assessmentStatus]?.label ?? intake.assessmentStatus}
                    sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700,
                      bgcolor: `${STATUS[intake.assessmentStatus]?.color ?? '#475569'}14`, color: STATUS[intake.assessmentStatus]?.color ?? '#475569' }} />
                )}
                {intake.sourceVerified === true && (
                  <Chip size="small" label="Matches imported source" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#ecfdf5', color: '#047857' }} />
                )}
                {intake.sourceVerified === false && (
                  <Chip size="small" label="Not matched to source" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#fef2f2', color: '#b91c1c' }} />
                )}
              </Box>
              {(intake.matchedCriteria ?? []).map((m, i) => (
                <Typography key={i} sx={{ fontSize: '0.8rem', color: '#334155' }}>
                  • <b>L{m.level}</b> “{m.indicator}”
                  {m.evidence[0] && <Box component="span" sx={{ color: '#64748b' }}> — reported as “{m.evidence[0]}”</Box>}
                </Typography>
              ))}
              {(intake.levelCaveats ?? []).map(c => (
                <Typography key={c} sx={{ fontSize: '0.78rem', color: '#a16207' }}>• {c}</Typography>
              ))}
              {(intake.alternativeCategories ?? []).length > 0 && (
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.5 }}>
                  Could also fit: {(intake.alternativeCategories ?? []).join(', ')}
                </Typography>
              )}

              {(intake.matrixReferences ?? []).length > 0 && (
                <>
                  <Button size="small" startIcon={<MenuBook sx={{ fontSize: 15 }} />} onClick={() => setShowRefs(v => !v)}
                    sx={{ px: 0, mt: 0.5, color: '#475569', textTransform: 'none', fontWeight: 600 }}>
                    {showRefs ? 'Hide' : 'Show'} source text ({(intake.matrixReferences ?? []).length})
                  </Button>
                  <Collapse in={showRefs}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.5 }}>
                      {(intake.matrixReferences ?? []).map((r, i) => (
                        <Box key={i} sx={{ borderLeft: `3px solid ${r.strength === 'strong' ? '#0f766e' : '#cbd5e1'}`, pl: 1 }}>
                          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>{r.sectionTitle}</Typography>
                          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            {r.pageNumber ? `Page ${r.pageNumber} · ` : ''}similarity {r.score.toFixed(2)}{r.strength === 'weak' ? ' (weak — not authoritative)' : ''}
                          </Typography>
                          {r.suggestedAction && (
                            <Typography sx={{ fontSize: '0.78rem', color: '#334155', mt: 0.25 }}>
                              <b>Suggested Action (from the document):</b> {r.suggestedAction}
                            </Typography>
                          )}
                          {r.links.map(l => (
                            <Typography key={l} component="a" href={l} target="_blank" rel="noopener noreferrer"
                              sx={{ display: 'block', fontSize: '0.72rem', color: '#2563eb', wordBreak: 'break-all' }}>{l}</Typography>
                          ))}
                        </Box>
                      ))}
                    </Box>
                  </Collapse>
                </>
              )}
              <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 0.75, fontStyle: 'italic' }}>
                {intake.knowledgeBaseStatus ? `${KB_STATUS[intake.knowledgeBaseStatus] ?? intake.knowledgeBaseStatus}. ` : ''}
                An operational triage framework, not a legal determination. {intake.assessedBy ?? ''}
              </Typography>
            </Box>
          )}

          {/* The AI reader: what it found, each with the resident's words */}
          {intake.aiReading && (
            <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, mb: 1.25, bgcolor: '#fcfcfd' }}>
              <Typography sx={label}>AI reading at filing</Typography>
              {intake.aiReading.used ? (
                <>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', my: 0.5 }}>
                    <Typography sx={{ fontSize: '0.86rem', color: '#0c1e46' }}>
                      {intake.aiReading.category
                        ? <>Read as <b>{intake.aiReading.category}</b> <Box component="span" sx={{ color: '#94a3b8' }}>({intake.aiReading.categoryConfidence} confidence)</Box></>
                        : 'No category clearly supported'}
                    </Typography>
                    {intake.aiReading.category && (
                      <Chip size="small"
                        label={intake.aiReading.category === intake.suggestedCaseCategory ? 'Agrees with the rules' : 'Differs from the rules'}
                        sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700,
                          bgcolor: intake.aiReading.category === intake.suggestedCaseCategory ? '#ecfdf5' : '#fffbeb',
                          color: intake.aiReading.category === intake.suggestedCaseCategory ? '#047857' : '#a16207' }} />
                    )}
                  </Box>
                  {intake.aiReading.facts.map(f => (
                    <Typography key={f.key} sx={{ fontSize: '0.8rem', color: '#334155' }}>
                      • <b>{f.key}</b> <Box component="span" sx={{ color: '#64748b' }}>— “{f.quote}”</Box>
                    </Typography>
                  ))}
                  {intake.aiReading.reasons.map(r => (
                    <Typography key={r} sx={{ fontSize: '0.78rem', color: '#475569', mt: 0.25 }}>{r}</Typography>
                  ))}
                  {intake.aiReading.alternativeCategories.length > 0 && (
                    <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.5 }}>
                      AI says it could also fit: {intake.aiReading.alternativeCategories.join(', ')}
                    </Typography>
                  )}
                  {intake.aiReading.dropped > 0 && (
                    <Typography sx={{ fontSize: '0.74rem', color: '#a16207', mt: 0.5 }}>
                      {intake.aiReading.dropped} item{intake.aiReading.dropped === 1 ? ' was' : 's were'} discarded because the quoted words were not in the report.
                    </Typography>
                  )}
                </>
              ) : null}
              {/* The assessment against the retrieved matrix text, kept apart from the facts */}
              {intake.aiReading.assessment && (() => {
                const a = intake.aiReading.assessment;
                return (
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed #e2e8f0' }}>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#0c1e46' }}>
                      AI preliminary assessment{a.framework ? ` — ${a.framework === 'VAWC' ? 'VAWC' : 'Blotter'} matrix` : ''}
                    </Typography>
                    {a.status === 'ASSESSMENT_UNAVAILABLE' ? (
                      <Typography sx={{ fontSize: '0.78rem', color: '#a16207' }}>Assessment unavailable: {a.unavailableReason}</Typography>
                    ) : (
                      <>
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', my: 0.25 }}>
                          <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46' }}>
                            {a.level ? <b>Level {a.level} — {a.label}</b> : 'No level — no criterion clearly met'}
                            {a.suggestedCategory && <Box component="span" sx={{ color: '#64748b' }}> · {a.suggestedCategory}</Box>}
                          </Typography>
                          <Chip size="small" label={STATUS[a.classificationStatus]?.label ?? a.classificationStatus}
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#f1f5f9', color: '#475569' }} />
                          {a.urgentHumanReview && (
                            <Chip size="small" label="Urgent review recommended" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#fef2f2', color: '#b91c1c' }} />
                          )}
                        </Box>
                        {a.understanding && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>{a.understanding}</Typography>}
                        {a.criteria.map((c, i) => (
                          <Typography key={i} sx={{ fontSize: '0.78rem', color: '#334155' }}>
                            • <b>L{c.level}</b> “{c.criterion}” <Box component="span" sx={{ color: '#94a3b8' }}>[{c.source}]</Box>
                            <Box component="span" sx={{ color: '#64748b' }}> — reported as “{c.reportQuote}”</Box>
                          </Typography>
                        ))}
                        <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mt: 0.25 }}>
                          Affected: {AFFECTED[a.affectedPerson] ?? a.affectedPerson} · Reporter {KNOWLEDGE[a.reporterKnowledge] ?? a.reporterKnowledge}
                        </Typography>
                        {a.recommendedNextAction && <Typography sx={{ fontSize: '0.76rem', color: '#334155' }}><b>Suggested next action:</b> {a.recommendedNextAction}</Typography>}
                        {a.missingInformation.length > 0 && <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>Missing: {a.missingInformation.join('; ')}</Typography>}
                        {a.uncertainty.length > 0 && <Typography sx={{ fontSize: '0.76rem', color: '#a16207' }}>Uncertain: {a.uncertainty.join('; ')}</Typography>}
                        {a.droppedCriteria > 0 && (
                          <Typography sx={{ fontSize: '0.74rem', color: '#a16207' }}>{a.droppedCriteria} cited criteria were not in the matrix text and were discarded.</Typography>
                        )}
                        <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 0.25 }}>
                          Sources: {a.sources.map(s => `${s.sid} ${s.documentType}${s.riskLevel ? ` L${s.riskLevel}` : ` ${s.sectionTitle}`}`).join(' · ')}
                          {a.frameworkStatus ? ` — ${a.frameworkStatus}` : ''}
                        </Typography>
                      </>
                    )}
                  </Box>
                );
              })()}
              <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 0.75, fontStyle: 'italic' }}>
                {intake.aiReading.note}{intake.aiReading.model ? ` Model: ${intake.aiReading.model} (Groq free plan).` : ''}
                {' '}The AI suggests; the risk matrix sets the level and an officer decides.
              </Typography>
            </Box>
          )}

          {/* The AI interview, exactly as it went */}
          {intake.aiInterview && intake.aiInterview.turns.length > 0 && (
            <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, mb: 1.25, bgcolor: '#fcfcfd' }}>
              <Typography sx={label}>Follow-up interview ({intake.aiInterview.turns.length} question{intake.aiInterview.turns.length === 1 ? '' : 's'})</Typography>
              {intake.aiInterview.turns.map(t => (
                <Box key={t.id} sx={{ mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.8rem', color: '#0c1e46' }}>{t.text}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: t.kind === 'skipped' || t.kind === 'declined' ? '#94a3b8' : '#334155' }}>
                    → {t.kind === 'skipped' ? 'Skipped' : t.kind === 'declined' ? 'Preferred not to answer'
                      : [t.value ? ANSWER[t.value] : '', t.answerText ? `“${t.answerText}”` : ''].filter(Boolean).join(' — ')}
                  </Typography>
                </Box>
              ))}
            </Box>
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
                      : h.matrixLabel ? `L${h.matrixLevel} ${h.matrixLabel}` : h.riskLevel}
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
