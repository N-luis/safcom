'use client';

import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, Alert } from '@mui/material';
import { Send, Visibility, Edit } from '@mui/icons-material';

/** What /api/resident/cases/duplicate-check answers. Only the resident's own reports are ever described. */
export interface DuplicateCheckResult {
  result: 'POTENTIAL_DUPLICATE' | 'RELATED_CASE' | 'NO_MATCH';
  own: { id: string; caseNumber: string; filedAt: string; status: string; classification: string; explanation: string; analysis: string }[];
  otherReportMayExist: boolean;
  message: string | null;
  skipped?: string;
}

export interface DuplicateCheckDraft {
  description: string;
  incidentDate?: string | null;
  street?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  people?: string[];
}

/**
 * Ask the server whether this draft may repeat a report already on file.
 * Never in the way: a slow or failed check answers null and the form files
 * as usual.
 */
export async function runDuplicateCheck(draft: DuplicateCheckDraft, timeoutMs = 8000): Promise<DuplicateCheckResult | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/resident/cases/duplicate-check', {
      method: 'POST', credentials: 'include', cache: 'no-store', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: draft.description.slice(0, 8000), incidentDate: draft.incidentDate || null, street: draft.street || null,
        latitude: draft.latitude ?? null, longitude: draft.longitude ?? null,
        people: (draft.people ?? []).map(n => n.trim()).filter(n => n.length >= 3).slice(0, 10),
      }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { data?: DuplicateCheckResult } | null;
    return body?.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const day = (v: string) => new Date(v).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });

/**
 * "We found a report that may be similar to your submission." The resident
 * chooses: file anyway, look at their own earlier report, or go back and
 * edit. Nothing here blocks filing, and nothing about anyone else's report
 * is shown - only that one may exist.
 */
export default function DuplicateCheckDialog({ check, onContinue, onReview, onEdit }: {
  check: DuplicateCheckResult;
  onContinue: () => void;
  onReview: (caseId: string) => void;
  onEdit: () => void;
}) {
  const dup = check.result === 'POTENTIAL_DUPLICATE';
  const first = check.own[0];
  return (
    <Dialog open onClose={onEdit} fullWidth maxWidth="sm" aria-labelledby="dup-check-title" data-testid="duplicate-check-dialog">
      <DialogTitle id="dup-check-title" sx={{ fontWeight: 800, color: '#0c1e46', pb: 0.5 }}>
        {dup ? 'A similar report may already be on file' : 'This may be related to an earlier report of yours'}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, px: { xs: 2, sm: 3 } }}>
        <Typography sx={{ fontSize: '0.92rem', color: '#334155' }}>
          {check.message ?? 'We found a report that may be similar to your submission. Please review the information before continuing.'}
        </Typography>
        {check.own.length > 0 && (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Your earlier report{check.own.length > 1 ? 's' : ''}</Typography>
            {check.own.map(o => (
              <Box key={o.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#0c1e46' }}>{o.caseNumber}</Typography>
                <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Filed {day(o.filedAt)} · {o.status}</Typography>
                <Typography sx={{ fontSize: '0.84rem', color: '#334155', mt: 0.5 }}>{o.explanation}</Typography>
                {check.own.length > 1 && (
                  <Button size="small" onClick={() => onReview(o.id)} sx={{ mt: 0.5, textTransform: 'none', fontWeight: 700, p: 0, minWidth: 0 }}>Review this report</Button>
                )}
              </Box>
            ))}
          </Box>
        )}
        {check.otherReportMayExist && (
          <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.86rem' }}>
            Someone may already have reported a similar incident. You can still submit yours - an official will check whether they describe the same incident. Your report is not shared with anyone else.
          </Alert>
        )}
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
          This is only a check, not a decision. Your report is never rejected because of it, and an official decides whether two reports are the same.
          If someone is in danger, submit now.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } } }}>
        <Button onClick={onEdit} startIcon={<Edit />} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, color: '#64748b', textTransform: 'none' }}>
          Return to Edit My Report
        </Button>
        {first && (
          <Button variant="outlined" onClick={() => onReview(first.id)} startIcon={<Visibility />} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, fontWeight: 700, textTransform: 'none' }}>
            Review My Existing Report
          </Button>
        )}
        <Button variant="contained" onClick={onContinue} startIcon={<Send />} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, fontWeight: 700, textTransform: 'none' }}>
          Continue Submitting Report
        </Button>
      </DialogActions>
    </Dialog>
  );
}
