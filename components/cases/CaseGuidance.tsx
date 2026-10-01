'use client';

import { useState } from 'react';
import { Box, Typography, Chip, Button, CircularProgress } from '@mui/material';
import {
  AutoAwesome, FavoriteBorder, CheckCircleOutlined, AltRoute, Phone,
} from '@mui/icons-material';
import { guidanceFor, barangayHotline, type GuidanceAction } from '@/lib/caseGuidance';
import type { Progress } from '@/lib/followUps';

/**
 * SafeComm's guidance on an open case.
 *
 * Everything on this card is advice for the person reading it. It never says
 * an officer or the police have been dispatched, because nothing has happened
 * yet beyond the report being flagged, and telling a frightened person that
 * help is coming when it has not been sent is the worst thing this screen
 * could do.
 *
 * The check-in row writes to the same follow-up endpoint the timeline below
 * uses, so one tap is a real entry on the case rather than a gesture.
 */

const NAVY = '#10294B';
const BODY = '#33445E';
const MUTED = '#5F6F86';
const TEAL = '#0D8A7D';
const DIVIDER = '#E3E8EF';

export default function CaseGuidance({
  caseId, caseType, riskLevel, caseStatus, onPosted, variant = 'resident',
}: {
  caseId: string;
  caseType: string;
  riskLevel: string;
  caseStatus: string;
  /** Lets the timeline and the progress pill refresh after a check-in. */
  onPosted?: () => void;
  /**
   * Who is reading. An officer sees the same advice so they know what the
   * resident was told, but none of the controls: those write a follow-up as
   * the resident, through an endpoint that only a resident may call, and an
   * officer tapping "I'm safe now" would be putting words in their mouth.
   */
  variant?: 'resident' | 'officer';
}) {
  const readOnly = variant === 'officer';
  const { risk, copy } = guidanceFor(riskLevel, caseType);
  const hotline = barangayHotline();
  const closed = ['Resolved', 'Closed'].includes(caseStatus);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState('');

  async function post(label: string, progress: Progress) {
    setBusy(label); setFailed(''); setNote('');
    try {
      const res = await fetch(`/api/resident/cases/${caseId}/follow-ups`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress, note: label }),
      });
      const json = await res.json();
      if (!res.ok) { setFailed(json.error ?? 'Could not save that. Please try again.'); return; }
      setNote('Saved. The barangay can see your update now.');
      onPosted?.();
    } catch {
      setFailed('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const runAction = (a: GuidanceAction) => {
    if (a.kind === 'followUp' && a.progress) post(a.label, a.progress);
  };

  const label = {
    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: MUTED,
  };

  return (
    <Box sx={{
      bgcolor: '#fff', border: '1px solid #BFE3DD', borderRadius: '16px',
      p: { xs: 2, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 2.25,
    }}>
      {/* ── a. Who is speaking, and how urgent this case is ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <Box aria-hidden sx={{
          width: 36, height: 36, borderRadius: '10px', bgcolor: TEAL, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AutoAwesome sx={{ fontSize: 19, color: '#fff' }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: '1 1 180px' }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>
            SafeComm AI
          </Typography>
          <Typography sx={{ fontSize: '0.81rem', color: MUTED }}>
            {readOnly
              ? `What the resident was shown, based on this report's ${risk.toLowerCase()} risk`
              : `Guidance for you, based on this report's ${risk.toLowerCase()} risk`}
          </Typography>
        </Box>
        <Chip
          label={copy.priorityLabel}
          size="small"
          sx={{
            bgcolor: copy.riskPill.bg, color: copy.riskPill.text,
            fontWeight: 700, fontSize: '0.78rem', flexShrink: 0,
          }}
        />
      </Box>

      {/* ── b. The calm note ── */}
      <Box sx={{
        bgcolor: '#EAF6F4', border: '1px solid #C8E6E1', borderRadius: '12px',
        p: { xs: '14px 16px', sm: '16px 18px' }, display: 'flex', gap: 1.5,
      }}>
        <FavoriteBorder aria-hidden sx={{ fontSize: 20, color: TEAL, flexShrink: 0, mt: 0.25 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: NAVY, mb: 0.75 }}>
            {copy.calm.headline}
          </Typography>
          <Typography sx={{ fontSize: '0.906rem', color: BODY, lineHeight: 1.6 }}>
            {copy.calm.body}
          </Typography>
          <Typography sx={{
            fontSize: '0.906rem', color: '#0A6B61', fontStyle: 'italic', mt: 0.75, lineHeight: 1.6,
          }}>
            {copy.calm.filipino}
          </Typography>
        </Box>
      </Box>

      {/* ── c. What to do now ── */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
          <CheckCircleOutlined aria-hidden sx={{ fontSize: 17, color: TEAL }} />
          <Typography sx={label}>What to do now</Typography>
        </Box>
        <Box component="ol" sx={{
          listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '14px',
        }}>
          {copy.steps.map((s, i) => (
            <Box component="li" key={s.title} sx={{ display: 'flex', gap: 1.25 }}>
              <Box aria-hidden sx={{
                width: 28, height: 28, borderRadius: '50%', bgcolor: '#D9F0EC', color: '#0A6B61',
                fontWeight: 700, fontSize: '0.84rem', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {i + 1}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, color: NAVY, lineHeight: 1.45 }}>
                  {s.title}
                </Typography>
                <Typography sx={{ fontSize: '0.875rem', color: BODY, lineHeight: 1.6 }}>
                  {s.detail}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── d. Plan B ── */}
      <Box sx={{
        bgcolor: copy.planB.bg, border: `1px dashed ${copy.planB.border}`, borderRadius: '12px',
        p: { xs: '14px 16px', sm: '16px 18px' },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <AltRoute aria-hidden sx={{ fontSize: 18, color: copy.planB.tagText }} />
          <Box component="span" sx={{
            bgcolor: copy.planB.tagBg, color: copy.planB.tagText, borderRadius: '6px',
            px: 0.9, py: 0.3, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em',
          }}>
            PLAN B
          </Box>
          <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, color: NAVY }}>
            {copy.planB.title}
          </Typography>
        </Box>

        {/* The marker is set explicitly: no CSS reset runs in this layout
            chain, so a bulleted list cannot be assumed to show its bullets. */}
        <Box component="ul" sx={{
          m: 0, mb: 1.5, pl: 2.5, listStyleType: 'disc', listStylePosition: 'outside',
          display: 'flex', flexDirection: 'column', gap: '6px',
          '& li': { display: 'list-item', fontSize: '0.875rem', color: BODY, lineHeight: 1.55 },
          '& li::marker': { color: MUTED },
        }}>
          {copy.planB.bullets.map(b => <li key={b}>{b}</li>)}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {copy.planB.action.kind === 'call' ? (
            <Button
              component="a"
              href={`tel:${copy.planB.action.tel}`}
              variant="contained"
              startIcon={<Phone aria-hidden sx={{ fontSize: 17 }} />}
              sx={{
                minHeight: 44, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600,
                textTransform: 'none', bgcolor: '#B42318', color: '#fff',
                '&:hover': { bgcolor: '#99200f' },
              }}
            >
              {copy.planB.action.label}
            </Button>
          ) : readOnly ? null : (
            <Button
              onClick={() => runAction(copy.planB.action)}
              disabled={closed || busy !== null}
              variant="contained"
              sx={{
                minHeight: 44, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600,
                textTransform: 'none', bgcolor: TEAL, color: '#fff',
                '&:hover': { bgcolor: '#0b7a6e' },
              }}
            >
              {busy === copy.planB.action.label
                ? <CircularProgress size={16} sx={{ color: '#fff' }} />
                : copy.planB.action.label}
            </Button>
          )}

          {/* The number comes from the barangay's settings; without one the
              button still says what it is for rather than dialling nothing. */}
          <Button
            component={hotline ? 'a' : 'button'}
            href={hotline ? `tel:${hotline.replace(/[^\d+]/g, '')}` : undefined}
            disabled={!hotline}
            variant="outlined"
            startIcon={<Phone aria-hidden sx={{ fontSize: 17 }} />}
            sx={{
              minHeight: 44, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600,
              textTransform: 'none', borderColor: '#B9C4D3', color: NAVY,
              '&:hover': { borderColor: TEAL, bgcolor: 'transparent' },
            }}
          >
            {hotline ? `Barangay hall ${hotline}` : 'Barangay hall [hotline number]'}
          </Button>
        </Box>
      </Box>

      {/* ── e. One-tap check-in. The resident's own voice, so it is theirs
             to use; an officer sees the case's timeline instead. ── */}
      {!readOnly && (
      <Box>
        <Typography component="h4" sx={{ ...label, mb: 1 }}>
          How are you now? Update us in one tap
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {copy.checkIns.map(c => (
            <Button
              key={c.label}
              onClick={() => post(c.label, c.progress)}
              disabled={closed || busy !== null}
              variant="outlined"
              sx={{
                minHeight: 44, borderRadius: '999px', px: 2, flex: '1 1 auto',
                fontSize: '0.875rem', fontWeight: 600, textTransform: 'none',
                bgcolor: '#fff', borderColor: '#B9C4D3', color: NAVY,
                '&:hover': { borderColor: TEAL, bgcolor: '#F7FBFA' },
              }}
            >
              {busy === c.label ? <CircularProgress size={16} sx={{ color: TEAL }} /> : c.label}
            </Button>
          ))}
        </Box>
        {closed && (
          <Typography sx={{ fontSize: '0.8rem', color: MUTED, mt: 1 }}>
            This case is closed. File a new report if the problem has returned.
          </Typography>
        )}
        {note && (
          <Typography role="status" sx={{ fontSize: '0.84rem', color: '#0A6B61', mt: 1 }}>
            {note}
          </Typography>
        )}
        {failed && (
          <Typography role="alert" sx={{ fontSize: '0.84rem', color: '#B42318', mt: 1 }}>
            {failed}
          </Typography>
        )}
      </Box>
      )}

      {/* ── f. What this is, and what it is not ── */}
      <Typography sx={{
        borderTop: `1px solid ${DIVIDER}`, pt: 1.5, fontSize: '0.781rem',
        color: MUTED, lineHeight: 1.55,
      }}>
        {readOnly
          ? 'This is the general guidance SafeComm showed the resident. It is not a barangay instruction and does not replace an officer\u2019s decision.'
          : 'This is general guidance written by AI. It does not replace emergency services or a barangay officer\u2019s decision.'}
      </Typography>
    </Box>
  );
}
