'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, CircularProgress, Skeleton, Checkbox, FormControlLabel,
} from '@mui/material';
import { Phone, Email, Visibility, VisibilityOff, Sms, Lock, AssignmentInd } from '@mui/icons-material';
import toast from 'react-hot-toast';

/**
 * Reporter Information on the official's case page.
 *
 * Shows the reporter's name, a masked number and their safe-contact
 * instructions. The real number is fetched only when "View contact details"
 * is pressed, from an endpoint that decides access on the server and logs
 * the attempt; it lives in this component's state until hidden, the page is
 * left, or three minutes pass. Nothing is dialled: Call and Text are plain
 * tel:/sms: links the official chooses to use.
 */

interface Summary {
  caseNumber: string;
  reporter: {
    name: string; registered: boolean; residentNumber: string | null;
    anonymous?: boolean; relationship?: string | null; affectedPersonNote?: string | null;
  };
  contact: { hasPhone: boolean; hasEmail: boolean; phoneMasked: string | null; emailMasked: string | null };
  safety: {
    preference: string | null; label: string | null; guidance: string | null;
    allowCall: boolean; allowText: boolean; note: string | null; caution: string | null;
  } | null;
  urgency: {
    urgent: boolean; riskLevel: string; status: string; requiresOfficerReview: boolean;
    immediateSafetyConcern: boolean; assessmentStatus: string | null;
  };
  access: {
    canReveal: boolean; reasonRequired: boolean; basis: string | null; code: string;
    message: string | null; canClaim: boolean; assignedTo: string | null;
  };
}

interface Revealed {
  phone: string | null; email: string | null; telHref: string | null; smsHref: string | null; missing: string | null;
}

const REVEAL_FOR_MS = 3 * 60 * 1000;

const fetchSummary = (url: string) => fetch(url, { credentials: 'include', cache: 'no-store' }).then(async r => {
  if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : 'failed');
  return (await r.json()).data as Summary;
});

export default function ReporterInfoPanel({ caseId, onAssigned }: { caseId: string; onAssigned?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/cases/${caseId}/reporter`, fetchSummary, { revalidateOnFocus: false });
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gone with the page: never left behind in memory after the official leaves.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setRevealed(null);
  };

  const reveal = async () => {
    setBusy(true); setDenied(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/reporter/reveal`, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: ['phone', 'email'], reason: reason.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setDenied(json.error ?? 'Access was not granted.'); return; }
      setRevealed(json.data);
      setAsking(false); setReason(''); setAck(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevealed(null), REVEAL_FOR_MS);
    } catch {
      setDenied('Contact details are unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/claim`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? 'Could not take this case'); return; }
      toast.success('Case assigned to you');
      await mutate();
      onAssigned?.();
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 2, mb: 2 }} />;
  if (error || !data) return null;

  const { reporter, contact, safety, urgency, access } = data;
  const needsDialog = access.reasonRequired || safety?.preference === 'no_phone' || Boolean(safety?.caution);
  const ackNeeded = safety?.preference === 'no_phone' || Boolean(safety?.caution);

  return (
    <Card sx={{ mb: 2, ...(urgency.urgent && { border: '1px solid #fecaca' }) }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>Reporter Information</Typography>
        </Box>

        {/* The case's own state, as it stands - not a substitute for access */}
        {urgency.urgent && (
          <Typography sx={{ fontSize: '0.78rem', color: '#7f1d1d', mb: 1 }}>
            {urgency.riskLevel} risk · {urgency.status}
            {urgency.immediateSafetyConcern ? ' · resident reported an immediate safety concern' : ''}
            {urgency.requiresOfficerReview ? ' · needs officer review' : ''}
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1.25 }}>
          <Typography sx={{ fontSize: '0.9rem', color: '#0c1e46', fontWeight: 600 }}>
            {reporter.name}
            {reporter.residentNumber && <Box component="span" sx={{ color: '#94a3b8', fontWeight: 400 }}> · {reporter.residentNumber}</Box>}
          </Typography>
          {/* Who the report is for: the reporter is not assumed to be the person affected. */}
          {reporter.relationship && reporter.relationship !== 'SELF' && (
            <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>
              {reporter.relationship === 'ANONYMOUS' ? 'Filed anonymously'
                : reporter.relationship === 'ON_BEHALF' ? 'Filed on behalf of the affected person'
                  : 'Reporting an incident involving someone else'}
              {reporter.affectedPersonNote && <> — affected: &ldquo;{reporter.affectedPersonNote}&rdquo;</>}
            </Typography>
          )}
          {reporter.anonymous ? (
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
              The reporter chose not to be identified. Their name and contact details are not shown, and they cannot be called back;
              reply through the case&rsquo;s follow-up messages instead.
            </Typography>
          ) : !reporter.registered && (
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
              Not filed from a resident account — no registered contact details.
            </Typography>
          )}
          {reporter.registered && access.canReveal && (
            <>
              <Row icon={<Phone sx={{ fontSize: 15 }} />} label="Phone"
                value={revealed ? (revealed.phone ?? 'Not on file') : (contact.phoneMasked ?? 'Not on file')} strong={Boolean(revealed?.phone)} />
              <Row icon={<Email sx={{ fontSize: 15 }} />} label="E-mail"
                value={revealed ? (revealed.email ?? 'Not on file') : (contact.emailMasked ?? 'Not on file')} strong={Boolean(revealed?.email)} />
            </>
          )}
        </Box>

        {/* The reporter's own instructions: shown before the number, every time */}
        {safety && (safety.preference || safety.note || safety.caution) && (
          <Alert severity={safety.preference === 'no_phone' ? 'error' : 'warning'} icon={<Lock fontSize="small" />}
            sx={{ mb: 1.25, borderRadius: 2, fontSize: '0.8rem', '& .MuiAlert-message': { width: '100%' } }}>
            {safety.label && <Box sx={{ fontWeight: 700 }}>Reporter&rsquo;s preference: {safety.label}</Box>}
            {safety.guidance && <Box>{safety.guidance}</Box>}
            {safety.note && <Box sx={{ mt: 0.5 }}>In their words: &ldquo;{safety.note}&rdquo;</Box>}
            {safety.caution && <Box sx={{ mt: 0.5 }}>{safety.caution}</Box>}
          </Alert>
        )}
        {safety && !safety.preference && reporter.registered && (
          <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 1 }}>
            The reporter did not say how to contact them. Confirm they can talk safely before discussing the case.
          </Typography>
        )}

        {revealed?.missing && <Alert severity="info" sx={{ mb: 1, borderRadius: 2, fontSize: '0.8rem' }}>{revealed.missing}</Alert>}
        {denied && <Alert severity="error" sx={{ mb: 1, borderRadius: 2, fontSize: '0.8rem' }}>{denied}</Alert>}

        {/* Actions */}
        {reporter.registered && access.canReveal && (contact.hasPhone || contact.hasEmail) && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {!revealed ? (
              <Button variant="contained" size="small" startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <Visibility />}
                disabled={busy}
                onClick={() => (needsDialog ? setAsking(true) : void reveal())}
                sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 36, '&:hover': { bgcolor: '#115e59' } }}>
                View contact details
              </Button>
            ) : (
              <>
                {revealed.telHref && (
                  <Button component="a" href={revealed.telHref} variant="contained" size="small" startIcon={<Phone />}
                    sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 36, '&:hover': { bgcolor: '#115e59' } }}>
                    Call reporter
                  </Button>
                )}
                {revealed.smsHref && (
                  <Button component="a" href={revealed.smsHref} variant="outlined" size="small" startIcon={<Sms />} sx={{ minHeight: 36 }}>
                    Text
                  </Button>
                )}
                {revealed.phone && !revealed.telHref && (
                  <Typography sx={{ fontSize: '0.78rem', color: '#b91c1c', alignSelf: 'center' }}>
                    No call or text button: the reporter said phone contact is not safe.
                  </Typography>
                )}
                <Button size="small" startIcon={<VisibilityOff />} onClick={hide} sx={{ color: '#64748b', minHeight: 36 }}>Hide</Button>
              </>
            )}
          </Box>
        )}
        {reporter.registered && access.canReveal && !contact.hasPhone && !contact.hasEmail && (
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>The reporter has no phone number or e-mail on file.</Typography>
        )}

        {/* No access: why, and the one thing that can change it */}
        {!access.canReveal && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b', flex: 1, minWidth: 200 }}>
              <Lock sx={{ fontSize: 13, verticalAlign: '-2px', mr: 0.5 }} />
              {access.message}{access.assignedTo ? ` Assigned to ${access.assignedTo}.` : ''}
            </Typography>
            {access.canClaim && (
              <Button variant="outlined" size="small" startIcon={<AssignmentInd />} disabled={busy} onClick={claim} sx={{ minHeight: 36 }}>
                Take this case
              </Button>
            )}
          </Box>
        )}
        {access.canReveal && (
          <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 1 }}>
            Viewing contact details is recorded{access.basis === 'oversight' || access.reasonRequired ? ', with your reason' : ''}.
          </Typography>
        )}
      </CardContent>

      <Dialog open={asking} onClose={() => !busy && setAsking(false)} maxWidth="xs" fullWidth aria-labelledby="reveal-title">
        <DialogTitle id="reveal-title" sx={{ fontWeight: 800, color: '#0c1e46' }}>View contact details</DialogTitle>
        <DialogContent>
          {safety?.preference === 'no_phone' && (
            <Alert severity="error" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>
              The reporter said phone contact is not safe. The number will be shown without call or text buttons.
            </Alert>
          )}
          {access.reasonRequired && (
            <TextField autoFocus fullWidth multiline minRows={2} label="Reason for access" value={reason}
              onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }}
              helperText={`Recorded in the access log. At least 10 characters. ${reason.trim().length}/300`}
              placeholder="e.g. Follow-up visit needs a time; reporter flagged as at risk" sx={{ mt: 0.5 }} />
          )}
          {ackNeeded && (
            <FormControlLabel sx={{ mt: 1, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { fontSize: '0.82rem', pt: 0.75 } }}
              control={<Checkbox checked={ack} onChange={e => setAck(e.target.checked)} />}
              label="I have read the reporter’s contact instructions and will follow them." />
          )}
          {denied && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>{denied}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAsking(false)} disabled={busy} sx={{ color: '#64748b' }}>Cancel</Button>
          <Button variant="contained" onClick={() => void reveal()}
            disabled={busy || (access.reasonRequired && reason.trim().length < 10) || (ackNeeded && !ack)}
            sx={{ bgcolor: '#0f766e', fontWeight: 700, '&:hover': { bgcolor: '#115e59' } }}>
            {busy ? 'Checking…' : 'View'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function Row({ icon, label, value, strong }: { icon: React.ReactNode; label: string; value: string; strong?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ color: '#64748b', display: 'flex' }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', minWidth: 52 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.88rem', color: '#0c1e46', fontWeight: strong ? 700 : 500, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Box>
  );
}
