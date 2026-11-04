'use client';

import { useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup, TextField, Button, CircularProgress, Alert, Checkbox, FormControlLabel, Chip } from '@mui/material';
import { FactCheck } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { KP_CHECKLIST, KP_ANSWER_LABELS, KP_ELIGIBILITY_LABELS, decideKpReview, type KpAnswer, type KpAnswers, type KpEligibilityState } from '@/lib/hearings';
import { NAVY, send, chipSx } from './hearingUi';

const STATE_COLOR: Record<KpEligibilityState, string> = { PENDING_REVIEW: '#64748b', NEEDS_VERIFICATION: '#b45309', ELIGIBLE: '#15803d', NOT_ELIGIBLE: '#b91c1c' };
const ANSWER_COLOR: Record<KpAnswer, 'success' | 'error' | 'warning' | 'standard'> = { YES: 'success', NO: 'error', UNKNOWN: 'warning', NOT_APPLICABLE: 'standard' };

/**
 * The official's eligibility review for Katarungang Pambarangay proceedings
 * (lib/hearings.ts KP_CHECKLIST). Each point is answered Yes, No, Unknown or
 * Not applicable - or left for later. Only a No - a legal exclusion the
 * official found - makes the case not eligible; an Unknown leaves it to be
 * verified; every point cleared still needs the official's approval. A
 * review can be saved part-way and continued: `initial` holds the answers
 * saved last time.
 */
export default function KpReviewForm({ caseId, caseType, initial, onSaved }: {
  caseId: string; caseType: string; initial?: KpAnswers | null; onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<KpAnswers>(() => ({ ...(initial ?? {}) }));
  const [approve, setApprove] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const outcome = decideKpReview(answers, approve);
  const allCleared = !outcome.exclusions.length && !outcome.toVerify.length && !outcome.unanswered.length;
  const answered = KP_CHECKLIST.length - outcome.unanswered.length;

  const save = async () => {
    if (outcome.decision === 'NOT_ELIGIBLE' && note.trim().length < 3) { toast.error('Say what the exclusion rests on'); return; }
    setSaving(true);
    try {
      await send(`/api/cases/${caseId}/kp-review`, 'POST', { answers, approve: allCleared && approve, note: note.trim() || undefined });
      toast.success(outcome.decision === 'ELIGIBLE' ? 'Approved for Katarungang Pambarangay proceedings'
        : outcome.decision === 'NOT_ELIGIBLE' ? 'Recorded as not eligible'
          : outcome.decision === 'NEEDS_VERIFICATION' ? 'Saved - the unknown points need verifying' : 'Review saved - continue it any time');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };

  return (
    <Box sx={{ border: '1px solid #cbd5e1', borderRadius: 2, p: 1.5, bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <FactCheck sx={{ fontSize: 18, color: '#0369a1' }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>Eligibility review - Katarungang Pambarangay</Typography>
        <Chip size="small" label={`${KP_ELIGIBILITY_LABELS[outcome.decision]} · ${answered}/${KP_CHECKLIST.length} answered`} sx={{ ...chipSx(STATE_COLOR[outcome.decision]), ml: 'auto' }} />
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color: '#475569', mb: 1 }}>
        For the verified category <b>{caseType}</b>, from RA 7160 secs. 408, 409 and 412(b) and RA 9262. Answer what you have checked; mark <b>Unknown</b> what
        still has to be verified, and leave the rest for later. Only a <b>No</b> - an exclusion you found - makes the case not eligible.
        The review is kept with your name and the date; saving it again keeps the earlier one.
      </Typography>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {KP_CHECKLIST.map(c => (
          <Box key={c.key} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: 0.75, alignItems: 'center', borderBottom: '1px solid #e2e8f0', pb: 1 }}>
            <Box>
              <Typography sx={{ fontSize: '0.8rem', color: '#334155' }}>{c.label}</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8' }}>{c.basis}</Typography>
            </Box>
            <ToggleButtonGroup exclusive size="small" value={answers[c.key] ?? null} aria-label={c.short}
              onChange={(_, v: KpAnswer | null) => { setAnswers(a => ({ ...a, [c.key]: v })); setApprove(false); }}>
              {(['YES', 'NO', 'UNKNOWN', ...(c.na ? ['NOT_APPLICABLE'] : [])] as KpAnswer[]).map(a => (
                <ToggleButton key={a} value={a} color={ANSWER_COLOR[a]} sx={{ textTransform: 'none', px: 1, py: 0.25, fontSize: '0.74rem' }}>{KP_ANSWER_LABELS[a]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        ))}
      </Box>
      {outcome.decision === 'NOT_ELIGIBLE' && (
        <Alert severity="error" sx={{ mt: 1, borderRadius: 2, fontSize: '0.78rem', py: 0.25 }}>
          A No records a legal exclusion: the case will be not eligible for barangay mediation or conciliation. Say below what it rests on.
        </Alert>
      )}
      {outcome.decision === 'NEEDS_VERIFICATION' && (
        <Alert severity="warning" sx={{ mt: 1, borderRadius: 2, fontSize: '0.78rem', py: 0.25 }}>
          Saved as needing verification. No hearing can be created until the unknown points are checked - this does not make the case not eligible.
        </Alert>
      )}
      {allCleared && (
        <FormControlLabel sx={{ mt: 1, alignItems: 'flex-start' }}
          control={<Checkbox size="small" checked={approve} onChange={e => setApprove(e.target.checked)} sx={{ pt: 0.25 }} />}
          label={<Typography sx={{ fontSize: '0.8rem', color: NAVY, fontWeight: 600, pt: 0.4 }}>I have verified every point and approve this case for Katarungang Pambarangay proceedings.</Typography>} />
      )}
      <TextField fullWidth size="small" multiline minRows={2} sx={{ mt: 1 }}
        label={outcome.decision === 'NOT_ELIGIBLE' ? 'What the exclusion rests on *' : outcome.decision === 'NEEDS_VERIFICATION' ? 'What to verify, and how (optional)' : 'Note (optional)'}
        value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
        <Button variant="contained" size="small" onClick={save} disabled={saving || answered === 0} sx={{ textTransform: 'none', bgcolor: outcome.decision === 'NOT_ELIGIBLE' ? '#b91c1c' : NAVY, minHeight: 34 }}>
          {saving ? <CircularProgress size={16} color="inherit" />
            : outcome.decision === 'ELIGIBLE' ? 'Approve for KP proceedings'
              : outcome.decision === 'NOT_ELIGIBLE' ? 'Record as not eligible'
                : outcome.decision === 'NEEDS_VERIFICATION' ? 'Save - needs verification' : 'Save review progress'}
        </Button>
      </Box>
    </Box>
  );
}
