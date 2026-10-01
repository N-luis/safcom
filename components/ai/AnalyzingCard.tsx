'use client';

import { useEffect } from 'react';
import {
  Box, Typography, Button, LinearProgress, CircularProgress, IconButton, Tooltip, Portal,
} from '@mui/material';
import {
  CheckCircle, RadioButtonUnchecked, ErrorOutlined, AutoAwesome,
  Minimize as MinimizeIcon, OpenInFull, Close,
} from '@mui/icons-material';
import { useLanguage } from '@/lib/i18n';

/**
 * The analysis state, floating over the form rather than pushing it around.
 *
 * Every stage shown here corresponds to work that actually happens, and the
 * card only advances when that work reports it is done. There is no timer
 * driving it: a step that looks finished when it is not is worse than a slow
 * bar, because the number underneath it is a risk level someone will act on.
 *
 * The one place it is deliberately imprecise is the server call, which is a
 * single request. That stage runs on an indeterminate bar until the response
 * lands rather than being split into invented sub-steps.
 */

export type AnalysisPhase =
  | 'idle'
  | 'preparing'
  | 'reading_document'
  | 'assessing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AnalysisStage {
  id: string;
  labelKey: 'stagePreparing' | 'stageReadingDocument' | 'stageFactors' | 'stageSeverity' | 'stageRecommendations';
  /** Stages that did not run (no photo attached) are not listed at all. */
  active: boolean;
}

export interface AnalyzingCardProps {
  phase: AnalysisPhase;
  /** Index of the stage in progress, within `stages`. */
  current: number;
  stages: AnalysisStage[];
  /** 0-1 for the stage that can report it; undefined means indeterminate. */
  stageRatio?: number;
  minimized: boolean;
  slow: boolean;
  error?: string;
  onMinimize: () => void;
  onExpand: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onViewResult: () => void;
  onSubmitForReview: () => void;
  accent?: string;
}

export default function AnalyzingCard({
  phase, current, stages, stageRatio, minimized, slow, error,
  onMinimize, onExpand, onCancel, onRetry, onViewResult, onSubmitForReview,
  accent = '#14b8a6',
}: AnalyzingCardProps) {
  const { t } = useLanguage();
  const running = phase === 'preparing' || phase === 'reading_document' || phase === 'assessing';
  const done = phase === 'done';
  const failed = phase === 'error';

  // Esc minimizes rather than closing: the analysis is still running and the
  // form underneath must stay reachable.
  useEffect(() => {
    if (phase === 'idle' || minimized) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMinimize(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, minimized, onMinimize]);

  if (phase === 'idle' || phase === 'cancelled') return null;

  const completed = stages.filter((_, i) => i < current).length;
  const total = stages.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  /**
   * Centred over the form while it runs.
   *
   * It sat in the bottom-right corner, where a resident filling in the fields
   * above never looked at it and had no reason to believe anything was
   * happening. The analysis is the step they are waiting on, so it is put
   * where they are already looking, and the form behind it is dimmed to say
   * the wait is the point rather than something to work around.
   */
  const overlay = {
    // Fixed to the viewport - but only because this renders through a portal.
    // An ancestor with a transform becomes the containing block for a fixed
    // child, and the resident layout animates every page in on a motion.div,
    // which is exactly that. Inside the tree the card would be centred on the
    // scrolling content box instead of the screen.
    position: 'fixed' as const,
    inset: 0,
    zIndex: 1300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    px: 2,
    bgcolor: 'rgba(12,30,70,0.42)',
    backdropFilter: 'blur(3px)',
    animation: 'safecommFade .2s ease-out',
    '@keyframes safecommFade': { from: { opacity: 0 }, to: { opacity: 1 } },
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  };

  const card = {
    width: '100%',
    maxWidth: 420,
    // Never taller than the phone it is on; a long stage list scrolls inside
    // the card rather than pushing its buttons off the screen.
    maxHeight: { xs: '86dvh', sm: '88dvh' },
    overflowY: 'auto' as const,
    borderRadius: 3,
    boxShadow: '0 24px 60px rgba(12,30,70,0.34)',
    animation: 'safecommRise .28s ease-out',
    '@keyframes safecommRise': {
      from: { opacity: 0, transform: 'translateY(14px) scale(.97)' },
      to: { opacity: 1, transform: 'none' },
    },
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  };

  /** The minimised chip stays out of the way, in the corner. */
  const chip = {
    position: 'fixed' as const,
    zIndex: 1300,
    right: { xs: 12, sm: 16 },
    bottom: { xs: 12, sm: 16 },
    borderRadius: 3,
    boxShadow: '0 12px 40px rgba(12,30,70,0.22)',
  };

  if (minimized) {
    return (
      <Portal>
      <Box
        role="status"
        aria-live="polite"
        onClick={onExpand}
        sx={{
          ...chip,
          cursor: 'pointer',
          bgcolor: '#fff',
          border: `1px solid ${accent}44`,
          px: 1.75, py: 1,
          display: 'flex', alignItems: 'center', gap: 1,
          minHeight: 44,
          '&:focus-visible': { outline: `3px solid ${accent}55`, outlineOffset: 2 },
        }}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onExpand(); }}
      >
        {done
          ? <CheckCircle sx={{ fontSize: 17, color: accent }} />
          : <CircularProgress size={14} sx={{ color: accent }} />}
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#0c1e46' }}>
          {done ? t('analysisComplete') : `${t('analyzing')} ${Math.min(current + 1, total)}/${total}`}
        </Typography>
        <OpenInFull sx={{ fontSize: 15, color: '#94a3b8' }} />
      </Box>
      </Portal>
    );
  }

  return (
    <Portal>
    <Box
      sx={overlay}
      // Tapping the dimmed area puts it back in the corner rather than
      // cancelling: the analysis is still running underneath.
      onClick={e => { if (e.target === e.currentTarget) onMinimize(); }}
    >
    <Box
      role="status"
      aria-live="polite"
      sx={{
        ...card,
        bgcolor: failed ? '#fef2f2' : '#fff',
        border: `1px solid ${failed ? '#fecaca' : `${accent}44`}`,
        p: { xs: 2, sm: 2.5 },
      }}
    >
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        {failed
          ? <ErrorOutlined sx={{ fontSize: 18, color: '#dc2626' }} />
          : done
            ? <CheckCircle sx={{ fontSize: 18, color: accent }} />
            : <CircularProgress size={16} sx={{ color: accent }} />}
        <Typography sx={{
          fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: failed ? '#991b1b' : '#0c1e46',
        }}>
          {failed ? t('analysisFailed') : done ? t('analysisComplete') : t('analyzingReport')}
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex' }}>
          <Tooltip title={t('minimize')}>
            {/* 44px tap target with a small glyph: reachable with a thumb
                without making the header look heavy. */}
            <IconButton onClick={onMinimize} aria-label={t('minimize')}
              sx={{ width: 44, height: 44, mr: -1, mt: -1 }}>
              <MinimizeIcon sx={{ fontSize: 16, color: '#64748b' }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {failed ? (
        <Typography sx={{ fontSize: '0.86rem', color: '#991b1b', lineHeight: 1.6, mb: 1.5 }}>
          {error || t('analysisErrorBody')}
        </Typography>
      ) : (
        <>
          {stages.map((s, i) => {
            const isDone = done || i < current;
            const isCurrent = !done && i === current;
            return (
              <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6 }}>
                {isDone
                  ? <CheckCircle sx={{ fontSize: 15, color: accent }} />
                  : isCurrent
                    ? <CircularProgress size={13} sx={{ color: accent }} />
                    : <RadioButtonUnchecked sx={{ fontSize: 15, color: '#cbd5e1' }} />}
                <Typography sx={{
                  fontSize: '0.84rem',
                  color: isDone ? '#475569' : isCurrent ? '#0c1e46' : '#94a3b8',
                  fontWeight: isCurrent ? 700 : 400,
                }}>
                  {t(s.labelKey)}
                </Typography>
              </Box>
            );
          })}

          <LinearProgress
            // Indeterminate while a stage cannot report its own progress, so the
            // bar never claims a position it does not know.
            variant={typeof stageRatio === 'number' ? 'determinate' : done ? 'determinate' : 'indeterminate'}
            value={done ? 100 : typeof stageRatio === 'number' ? Math.min(99, pct + stageRatio * (100 / Math.max(1, total))) : undefined}
            sx={{
              mt: 1.25, height: 4, borderRadius: 2, bgcolor: `${accent}22`,
              '& .MuiLinearProgress-bar': { bgcolor: accent },
            }}
          />

          <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mt: 0.9, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AutoAwesome sx={{ fontSize: 13 }} />
            {done ? t('analysisCompleteBody') : t('analyzingNote')}
          </Typography>

          {slow && running && (
            <Typography sx={{ fontSize: '0.8rem', color: '#b45309', bgcolor: '#fef9c3', borderRadius: 1.5, p: 0.9, mt: 1 }}>
              {t('analysisSlow')}
            </Typography>
          )}
        </>
      )}

      {/* ── Controls. Stacked, each at least 44px, so a thumb can reach them. ── */}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
        {done && (
          <Button
            onClick={onViewResult} variant="contained" fullWidth
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 700, bgcolor: accent, '&:hover': { bgcolor: '#0d9488' } }}
          >
            {t('viewResult')}
          </Button>
        )}
        {(failed || (slow && running)) && (
          <Button
            onClick={onRetry} variant="contained" fullWidth
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 700, bgcolor: accent, '&:hover': { bgcolor: '#0d9488' } }}
          >
            {t('retry')}
          </Button>
        )}
        {slow && running && (
          <Button
            onClick={onSubmitForReview} variant="outlined" fullWidth
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#475569' }}
          >
            {t('submitForReview')}
          </Button>
        )}
        {running && !slow && (
          <Button
            onClick={onCancel} startIcon={<Close sx={{ fontSize: 16 }} />} fullWidth
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, color: '#64748b' }}
          >
            {t('cancel')}
          </Button>
        )}
      </Box>
    </Box>
    </Box>
    </Portal>
  );
}
