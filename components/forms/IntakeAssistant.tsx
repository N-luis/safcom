'use client';

import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, TextField, Chip, Alert, CircularProgress, LinearProgress, Divider,
} from '@mui/material';
import {
  AutoAwesome, Phone, Send, SkipNext, DoNotDisturbAlt, Refresh, CheckCircle, HelpOutlined,
} from '@mui/icons-material';
import type { IntakeAnswer, IntakeResult, Completeness } from '@/lib/intake';
import type { InterviewQuestion, InterviewState, InterviewTurn, ReportingRelationship } from '@/lib/interviewTypes';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';
import { useLanguage } from '@/lib/i18n';

/**
 * SafeComm Assist: the follow-up questions after a resident has written what
 * happened.
 *
 * Optional at every step. Nothing here blocks the report: every question can
 * be skipped or declined, the report can be submitted at any point, and a
 * stated danger puts the emergency numbers and a "submit now" button above
 * everything else straight away.
 *
 * The questions come from /api/resident/intake. With Groq available, they
 * are the AI interview's: a few at a time, written for this report and this
 * reporting relationship, and shown one by one - the next round is asked for
 * only when these are used up. Without it, SafeComm's own rules ask instead.
 * The rules read every answer either way, so a stated danger is always seen.
 * The spinner is the request; nothing is shown as done before the server has
 * answered.
 */

const ACCENT = '#14b8a6';

type Lang = 'tl' | 'en';

const T: Record<Lang, Record<string, string>> = {
  tl: {
    title: 'SafeComm Assist',
    start: 'Suriin ang aking report',
    startHint: 'Opsyonal. Magtatanong ng ilang bagay para maitala nang tama ang report. Maaari kang mag-submit kahit hindi ito gamitin.',
    reading: 'Binabasa ang iyong sagot…',
    readingReport: 'Binabasa ang iyong report…',
    aiRead: 'May tulong ng AI',
    answer: 'Sagutin',
    skip: 'Laktawan',
    decline: 'Ayokong sagutin',
    typePlaceholder: 'O isulat ang sagot dito (opsyonal)',
    complete: 'Gaano kakumpleto ang impormasyon',
    INSUFFICIENT: 'Kulang pa',
    PARTIAL: 'Bahagya',
    SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: 'Sapat para sa paunang pagtatasa',
    emergencyTitle: 'Kung may panganib ngayon',
    emergencyBody: 'Tumawag agad. Hindi mo kailangang tapusin ang mga tanong.',
    submitNow: 'I-submit ang report ngayon',
    summary: 'Paunang buod',
    suggested: 'Mukhang tugma sa',
    selected: 'Napili mo',
    why: 'Dahil',
    noCategory: 'Hindi pa malinaw kung anong uri ng kaso ito; titingnan ito ng opisyal.',
    prelimLevel: 'Paunang antas ng panganib',
    matrixFrom: 'Batay sa',
    NEEDS_MORE_INFORMATION: 'Kailangan pa ng impormasyon',
    PRELIMINARY: 'Paunang pagtatasa',
    FOR_REVIEW: 'Susuriin ng opisyal',
    notDetermined: 'Hindi pa matukoy',
    stillUnknown: 'Hindi pa alam',
    notAnswered: 'Hindi sinagot (pinili mo)',
    preliminaryNote: 'Ito ay paunang pagbasa lamang ng iyong mga salita. Isang opisyal ang susuri at magpapasya.',
    stale: 'Binago mo ang paglalarawan. Suriin muli para sa tamang mga tanong.',
    recheck: 'Suriin muli',
    done: 'Wala nang tanong. Maaari mo nang i-submit ang report.',
    failed: 'Hindi mabasa ng assistant ngayon. Maaari mo pa ring i-submit ang iyong report — walang mawawala.',
    retry: 'Subukang muli',
    yes: 'Oo', no: 'Hindi', unsure: 'Hindi ko alam',
    understood: 'Ayon sa pagkakaintindi',
    mayFit: 'Maaaring tungkol sa',
    nextRound: 'Naghahanda ng susunod na tanong…',
  },
  en: {
    title: 'SafeComm Assist',
    start: 'Review my report',
    startHint: 'Optional. Asks a few things so your report is recorded correctly. You can submit without using it.',
    reading: 'Reading your answer…',
    readingReport: 'Reading your report…',
    aiRead: 'AI-assisted',
    answer: 'Answer',
    skip: 'Skip',
    decline: 'Prefer not to answer',
    typePlaceholder: 'Or type your answer here (optional)',
    complete: 'How complete the information is',
    INSUFFICIENT: 'Not enough yet',
    PARTIAL: 'Partial',
    SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: 'Enough for a preliminary assessment',
    emergencyTitle: 'If there is danger now',
    emergencyBody: 'Call straight away. You do not have to finish the questions.',
    submitNow: 'Submit the report now',
    summary: 'Preliminary summary',
    suggested: 'Looks like',
    selected: 'You chose',
    why: 'Because',
    noCategory: 'It is not yet clear what kind of case this is; an officer will look at it.',
    prelimLevel: 'Preliminary risk level',
    matrixFrom: 'Based on the',
    NEEDS_MORE_INFORMATION: 'Needs more information',
    PRELIMINARY: 'Preliminary',
    FOR_REVIEW: 'For officer review',
    notDetermined: 'Not yet determined',
    stillUnknown: 'Still unknown',
    notAnswered: 'Not answered (your choice)',
    preliminaryNote: 'This is only a first reading of your own words. An officer will review it and decide.',
    stale: 'You changed the description. Check again for the right questions.',
    recheck: 'Check again',
    done: 'No more questions. You can submit your report.',
    failed: 'The assistant cannot read this right now. You can still submit your report — nothing is lost.',
    retry: 'Try again',
    yes: 'Yes', no: 'No', unsure: "I don't know",
    understood: 'What we understood',
    mayFit: 'May be about',
    nextRound: 'Preparing the next question…',
  },
};

const STEP: Record<Completeness, number> = {
  INSUFFICIENT: 1, PARTIAL: 2, SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: 3,
};
const STEP_COLOR: Record<Completeness, string> = {
  INSUFFICIENT: '#f97316', PARTIAL: '#eab308', SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT: '#22c55e',
};
const RISK_COLOR: Record<string, string> = {
  Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e',
};

export default function IntakeAssistant({
  narrative, selectedCategory, street, answers, onAnswersChange, onResult, onSubmitNow, disabled, autoStart,
  relationship = 'SELF', turns = [], onTurnsChange,
}: {
  narrative: string;
  selectedCategory: string;
  street: string;
  answers: IntakeAnswer[];
  onAnswersChange: (next: IntakeAnswer[]) => void;
  /** Who the report is for; it shapes the questions. */
  relationship?: ReportingRelationship;
  /** The AI interview as asked and answered so far. */
  turns?: InterviewTurn[];
  onTurnsChange?: (next: InterviewTurn[]) => void;
  onResult?: (r: IntakeResult | null) => void;
  /** The emergency path: file what there is, now, skipping the final review. */
  onSubmitNow: () => void;
  disabled?: boolean;
  /**
   * Start reading as soon as it appears, with no "Review my report" button -
   * used when it opens as the step before submitting.
   */
  autoStart?: boolean;
}) {
  const { lang: uiLang } = useLanguage();
  const [result, setResult] = useState<IntakeResult | null>(null);
  // Starts in the reading state when it starts itself, so there is no flash
  // of a button the resident does not need to press.
  const [loading, setLoading] = useState(Boolean(autoStart));
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  // The narrative and relationship the current result was computed from.
  const [readFrom, setReadFrom] = useState('');
  // The AI interview: its latest reading, and the questions not yet shown.
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [queue, setQueue] = useState<InterviewQuestion[]>([]);
  const [moreRounds, setMoreRounds] = useState(true);

  const lang: Lang = result ? (result.language === 'english' ? 'en' : 'tl') : (uiLang === 'tl' ? 'tl' : 'en');
  const t = T[lang];
  const readKey = `${relationship}|${narrative.trim()}`;
  const stale = Boolean(result) && readFrom !== readKey;
  const tooShort = narrative.trim().length < 10;

  const ask = async (nextAnswers: IntakeAnswer[], nextTurns: InterviewTurn[], wantQuestions: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/resident/intake', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narrative, selectedCategory: selectedCategory || null, street: street || null, answers: nextAnswers,
          relationship, turns: nextTurns, wantQuestions,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data) throw new Error(json?.error ?? 'failed');
      const data = json.data as IntakeResult & { interview: InterviewState | null };
      setResult(data);
      setReadFrom(readKey);
      onAnswersChange(nextAnswers);
      onTurnsChange?.(nextTurns);
      onResult?.(data);
      if (data.interview) {
        setInterview(data.interview);
        if (data.interview.used) {
          setQueue(data.interview.questions);
          setMoreRounds(!data.interview.done);
        } else if (data.interview.status === 'limit_reached') {
          setQueue([]);
          setMoreRounds(false);
        }
      }
      setTyped('');
    } catch {
      // The answers are kept as they were; the report itself is untouched.
      setError(t.failed);
    } finally {
      setLoading(false);
    }
  };

  // Begins on its own when asked to. Scheduled rather than run in the body
  // of the effect, since asking sets state. Earlier answers carry over, so
  // reopening continues where the resident left off.
  useEffect(() => {
    if (!autoStart) return;
    const t = setTimeout(() => { void ask(answers, turns, true); }, 0);
    return () => clearTimeout(t);
    // Once, when it appears; later questions are driven by the answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The AI's questions while it is in use; the rules' when it is not.
  const aiMode = Boolean(interview?.used);
  const aiQ = aiMode ? queue[0] ?? null : null;

  const respond = (a: Omit<IntakeAnswer, 'slot'>) => {
    if (aiQ) {
      const turn: InterviewTurn = {
        ...aiQ, kind: a.kind, ...(a.value && { value: a.value }), ...(a.text && { answerText: a.text }),
      };
      const rest = queue.slice(1);
      setQueue(rest);
      // The next round only once this one is used up.
      void ask(answers, [...turns, turn], rest.length === 0 && moreRounds);
      return;
    }
    if (!result?.nextQuestion) return;
    const slot = result.nextQuestion.slot;
    void ask([...answers.filter(x => x.slot !== slot), { slot, ...a }], turns, false);
  };

  const q = aiQ
    ? {
      text: aiQ.text,
      options: aiQ.answerType === 'yes_no'
        ? [{ value: 'yes' as const, label: t.yes }, { value: 'no' as const, label: t.no }, { value: 'unsure' as const, label: t.unsure }]
        : [],
      allowText: true,
      textPlaceholder: t.typePlaceholder,
    }
    : aiMode ? null : result?.nextQuestion ?? null;
  const danger = Boolean(result?.immediateSafetyConcern || interview?.possibleOngoingDanger);
  const busy = loading || disabled;

  return (
    <Box sx={{ border: `1px solid ${ACCENT}40`, borderRadius: 2, bgcolor: '#f0fdfa', p: { xs: 1.5, sm: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <AutoAwesome sx={{ fontSize: 18, color: ACCENT }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0c1e46' }}>{t.title}</Typography>
        {/* Said plainly when the AI reader took part; an officer still decides. */}
        {(aiMode || result?.aiAssist?.used) && (
          <Chip size="small" label={t.aiRead}
            sx={{ height: 20, fontWeight: 700, fontSize: '0.68rem', bgcolor: '#eef2ff', color: '#4338ca' }} />
        )}
        {result && (
          <Chip size="small" label={t[result.informationCompleteness]}
            sx={{
              ml: 'auto', height: 22, fontWeight: 700, fontSize: '0.72rem',
              bgcolor: `${STEP_COLOR[result.informationCompleteness]}22`,
              color: STEP_COLOR[result.informationCompleteness] === '#eab308' ? '#a16207' : STEP_COLOR[result.informationCompleteness],
            }} />
        )}
      </Box>

      {/* ── Not started ── */}
      {!result && !loading && !error && !autoStart && (
        <>
          <Typography sx={{ fontSize: '0.82rem', color: '#475569', mb: 1.25, lineHeight: 1.55 }}>{t.startHint}</Typography>
          <Button
            variant="outlined" onClick={() => ask(answers, turns, true)} disabled={busy || tooShort}
            startIcon={<AutoAwesome sx={{ fontSize: 17 }} />}
            sx={{ minHeight: 44, borderColor: ACCENT, color: '#0f766e', fontWeight: 700, textTransform: 'none', borderRadius: 2 }}
          >
            {t.start}
          </Button>
        </>
      )}

      {/* ── A real request in flight ── */}
      {loading && (
        <Box role="status" aria-live="polite" sx={{ my: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <CircularProgress size={15} sx={{ color: ACCENT }} />
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#0f766e' }}>{answers.length || turns.length ? t.reading : t.readingReport}</Typography>
          </Box>
          <LinearProgress sx={{ height: 3, borderRadius: 2, bgcolor: '#ccfbf1', '& .MuiLinearProgress-bar': { bgcolor: ACCENT } }} />
        </Box>
      )}

      {error && (
        <Alert severity="warning" sx={{ my: 1, borderRadius: 2, fontSize: '0.82rem' }}
          action={<Button size="small" onClick={() => ask(answers, turns, queue.length === 0 && moreRounds)} startIcon={<Refresh sx={{ fontSize: 15 }} />}>{t.retry}</Button>}>
          {error}
        </Alert>
      )}

      {result && (
        <>
          {/* ── Danger first, above any question ── */}
          {/* The rules' danger check, or words that say it is happening now -
              shown at once, without waiting for any answer. */}
          {danger && (
            <Alert severity="error" icon={<Phone />} sx={{ mb: 1.5, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', mb: 0.25 }}>{t.emergencyTitle}</Typography>
              <Typography sx={{ fontSize: '0.82rem', mb: 1 }}>{t.emergencyBody}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                {EMERGENCY_CONTACTS.map(c => (
                  <Button key={c.label} size="small" variant="outlined" color="error"
                    href={`tel:${c.number.replace(/[^\d+]/g, '')}`} startIcon={<Phone sx={{ fontSize: 15 }} />}
                    sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700 }}>
                    {c.label}: {c.number}
                  </Button>
                ))}
              </Box>
              <Button variant="contained" color="error" onClick={onSubmitNow} disabled={disabled}
                startIcon={<Send sx={{ fontSize: 16 }} />}
                sx={{ minHeight: 44, textTransform: 'none', fontWeight: 800 }}>
                {t.submitNow}
              </Button>
            </Alert>
          )}

          {/* ── Completeness: never a risk level ── */}
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
              {t.complete}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }} aria-label={t[result.informationCompleteness]}>
              {[1, 2, 3].map(i => (
                <Box key={i} sx={{
                  flex: 1, height: 6, borderRadius: 3,
                  bgcolor: i <= STEP[result.informationCompleteness] ? STEP_COLOR[result.informationCompleteness] : '#e2e8f0',
                }} />
              ))}
            </Box>
            <Typography sx={{ fontSize: '0.78rem', color: '#475569', mt: 0.5 }}>{result.completenessExplanation}</Typography>
          </Box>

          {stale && (
            <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.82rem' }}
              action={<Button size="small" onClick={() => ask(answers, turns, queue.length === 0 && moreRounds)} disabled={busy}>{t.recheck}</Button>}>
              {t.stale}
            </Alert>
          )}

          {/* ── One question at a time ── */}
          {q && !stale && (
            <Box sx={{ bgcolor: '#fff', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, mb: 1.5 }}>
              {result.questionsAsked === 0 && turns.length === 0 && (
                <Typography sx={{ fontSize: '0.84rem', color: '#334155', mb: 1.25, lineHeight: 1.6 }}>{result.intro}</Typography>
              )}
              <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', color: '#0c1e46', mb: 1.25 }}>
                <HelpOutlined sx={{ fontSize: 17, verticalAlign: 'text-bottom', mr: 0.5, color: ACCENT }} />
                {q.text}
              </Typography>

              {q.options.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                  {q.options.map(o => (
                    <Button key={o.value} variant="outlined" disabled={busy}
                      onClick={() => respond({ kind: 'option', value: o.value, text: typed.trim() || undefined })}
                      sx={{
                        minHeight: 44, textTransform: 'none', fontWeight: 600, borderRadius: 2,
                        borderColor: '#cbd5e1', color: '#0c1e46', justifyContent: 'flex-start',
                      }}>
                      {o.label}
                    </Button>
                  ))}
                </Box>
              )}

              {q.allowText && (
                <TextField
                  fullWidth size="small" multiline minRows={q.options.length ? 1 : 2}
                  value={typed} onChange={e => setTyped(e.target.value)}
                  placeholder={q.textPlaceholder || t.typePlaceholder}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                  sx={{ mb: 1, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                />
              )}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {(q.options.length === 0 || typed.trim()) && (
                  <Button variant="contained" disabled={busy || !typed.trim()}
                    onClick={() => respond({ kind: 'text', text: typed.trim() })}
                    sx={{ minHeight: 40, bgcolor: ACCENT, textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#0d9488' } }}>
                    {t.answer}
                  </Button>
                )}
                <Button disabled={busy} onClick={() => respond({ kind: 'skipped' })}
                  startIcon={<SkipNext sx={{ fontSize: 17 }} />}
                  sx={{ minHeight: 40, textTransform: 'none', color: '#64748b' }}>
                  {t.skip}
                </Button>
                <Button disabled={busy} onClick={() => respond({ kind: 'declined' })}
                  startIcon={<DoNotDisturbAlt sx={{ fontSize: 16 }} />}
                  sx={{ minHeight: 40, textTransform: 'none', color: '#64748b' }}>
                  {t.decline}
                </Button>
              </Box>
            </Box>
          )}

          {!q && !stale && !loading && (
            <Alert severity="success" icon={<CheckCircle sx={{ fontSize: 18 }} />} sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.82rem' }}>
              {t.done}
            </Alert>
          )}

          {/* ── What it has read so far ── */}
          <Box sx={{ bgcolor: '#fff', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
            <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>
              {t.summary}
            </Typography>

            {/* The AI's reading of what was reported - in neutral words, never as fact. */}
            {aiMode && interview?.understanding && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700 }}>{t.understood}</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#334155', lineHeight: 1.55 }}>{interview.understanding}</Typography>
                {interview.possibleCategories.length > 0 && (
                  <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25 }}>
                    {t.mayFit}: {interview.possibleCategories.join(', ')}
                  </Typography>
                )}
              </Box>
            )}

            {/* "Other" is where an unclear report is filed, not a finding, so
                it is shown as "an officer will classify this". */}
            {result.classificationStatus === 'suggested' ? (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: '0.85rem', color: '#0c1e46' }}>
                  {t.suggested} <b>{result.suggestedCaseCategory}</b>
                  {result.selectedCategory && result.selectedCategory !== result.suggestedCaseCategory && (
                    <Box component="span" sx={{ color: '#64748b' }}> · {t.selected}: {result.selectedCategory}</Box>
                  )}
                </Typography>
                {result.categoryRationale.length > 0 && (
                  <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                    {t.why}: {result.categoryRationale.join('; ')}
                  </Typography>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mb: 1 }}>
                {t.noCategory}
                {result.route === 'VAWC' && (
                  <Box component="span" sx={{ display: 'block', mt: 0.5 }}>{result.categoryRationale[1]}</Box>
                )}
              </Typography>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{t.prelimLevel}:</Typography>
              {/* The matrix's own level and label, as the document writes it. */}
              {result.matrixLevel ? (
                <Chip size="small" label={`Level ${result.matrixLevel} — ${result.matrixLabel}`} sx={{
                  height: 'auto', py: 0.25, fontWeight: 800, fontSize: '0.74rem',
                  '& .MuiChip-label': { whiteSpace: 'normal' },
                  bgcolor: `${RISK_COLOR[result.riskLevel]}1c`, color: RISK_COLOR[result.riskLevel],
                }} />
              ) : (
                <Chip size="small" label={t.notDetermined} sx={{ height: 22, fontWeight: 700, fontSize: '0.74rem', bgcolor: '#f1f5f9', color: '#475569' }} />
              )}
              <Chip size="small" label={t[result.assessmentStatus] ?? result.assessmentStatus}
                sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }} />
            </Box>
            <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', mb: 0.5 }}>
              {t.matrixFrom} {result.frameworkDocument}
            </Typography>
            {result.riskRationale.slice(1, 3).map(r => (
              <Typography key={r} sx={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.55 }}>• {r}</Typography>
            ))}
            {!result.matrixLevel && (
              <Typography sx={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.55 }}>• {result.riskRationale[0]}</Typography>
            )}
            {result.levelCaveats.map(c => (
              <Typography key={c} sx={{ fontSize: '0.78rem', color: '#a16207', lineHeight: 1.55 }}>• {c}</Typography>
            ))}

            {(aiMode && interview?.missingInformation.length ? interview.missingInformation : result.missingInformation).length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                  <b>{t.stillUnknown}:</b> {(aiMode && interview?.missingInformation.length ? interview.missingInformation : result.missingInformation).join('; ')}
                </Typography>
              </>
            )}
            {result.notAnswered.length > 0 && (
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.5 }}>
                <b>{t.notAnswered}:</b> {result.notAnswered.join('; ')}
              </Typography>
            )}
            <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', mt: 1, fontStyle: 'italic' }}>{t.preliminaryNote}</Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
