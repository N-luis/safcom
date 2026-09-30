'use client';

import { useEffect, useState } from 'react';
import { Box, Typography, LinearProgress, CircularProgress } from '@mui/material';
import { CheckCircle, RadioButtonUnchecked, ErrorOutlined, AutoAwesome } from '@mui/icons-material';

/**
 * The visible processing state while a report is actually being classified.
 *
 * The stages describe work the system really does — reading the report,
 * matching risk factors, weighing severity, frequency and escalation — and the
 * sequence is tied to the request: it starts when the request starts, holds on
 * the last analysis stage until the response lands rather than pretending to
 * finish, and stops on failure instead of showing a fabricated result.
 *
 * It is deliberately quick. The point is to make the classification legible,
 * not to stall so the system looks cleverer than it is.
 */

const STAGES = [
  'Reading incident report',
  'Analyzing reported circumstances',
  'Identifying potential risk factors',
  'Evaluating severity and frequency',
  'Checking for escalation and immediate danger',
  'Generating initial risk assessment',
];

/** Pace of the visible stages. The request usually outruns them. */
const STEP_MS = 420;

export type ProcessingState = 'idle' | 'running' | 'done' | 'error';

export default function RiskProcessing({ state, error, accent = '#14b8a6' }: {
  state: ProcessingState;
  error?: string;
  accent?: string;
}) {
  const [stage, setStage] = useState(0);

  // No reset here on purpose: the parent gives this component a fresh key per
  // submission, so each run mounts at stage 0. Resetting from inside the effect
  // would be a synchronous setState on every state change.
  useEffect(() => {
    if (state !== 'running') return;
    const id = setInterval(() => {
      // Holds one short of the end: the last stage only completes when the
      // response actually arrives, so the list never claims to have finished
      // work the system is still doing.
      setStage(s => Math.min(s + 1, STAGES.length - 1));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [state]);

  if (state === 'idle') return null;

  const failed = state === 'error';
  const done = state === 'done';

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        border: `1px solid ${failed ? '#fecaca' : `${accent}33`}`,
        bgcolor: failed ? '#fef2f2' : `${accent}08`,
        borderRadius: 2.5, p: 2.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {failed
          ? <ErrorOutlined sx={{ fontSize: 18, color: '#dc2626' }} />
          : done
            ? <CheckCircle sx={{ fontSize: 18, color: accent }} />
            : <CircularProgress size={16} sx={{ color: accent }} />}
        <Typography sx={{
          fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: failed ? '#991b1b' : '#0c1e46',
        }}>
          {failed ? 'AI Risk Assessment unavailable' : done ? 'AI Risk Assessment complete' : 'AI Risk Assessment'}
        </Typography>
      </Box>

      {failed ? (
        <Typography sx={{ fontSize: '0.88rem', color: '#991b1b', lineHeight: 1.6 }}>
          {error || 'The report could not be classified.'} No risk level has been assigned — your report was not
          submitted, so nothing has been filed. Please try again.
        </Typography>
      ) : (
        <>
          {STAGES.map((label, i) => {
            const complete = done || i < stage;
            const current = !done && i === stage;
            return (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.65 }}>
                {complete
                  ? <CheckCircle sx={{ fontSize: 15, color: accent }} />
                  : current
                    ? <Box sx={{
                        width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Box sx={{
                          width: 8, height: 8, borderRadius: '50%', bgcolor: accent,
                          animation: 'pulse 1s ease-in-out infinite',
                          '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
                          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                        }} />
                      </Box>
                    : <RadioButtonUnchecked sx={{ fontSize: 15, color: '#cbd5e1' }} />}
                <Typography sx={{
                  fontSize: '0.86rem',
                  color: complete ? '#475569' : current ? '#0c1e46' : '#94a3b8',
                  fontWeight: current ? 700 : 400,
                }}>
                  {label}
                </Typography>
              </Box>
            );
          })}

          {!done && (
            <>
              <LinearProgress sx={{
                mt: 1.25, height: 4, borderRadius: 2, bgcolor: `${accent}1a`,
                '& .MuiLinearProgress-bar': { bgcolor: accent },
              }} />
              <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AutoAwesome sx={{ fontSize: 13 }} />
                Please wait while SafeComm analyzes the report.
              </Typography>
            </>
          )}
        </>
      )}
    </Box>
  );
}
