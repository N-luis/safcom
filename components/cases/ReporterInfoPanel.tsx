'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Box, Typography, Card, CardContent, Button, Alert, CircularProgress, Skeleton, Divider } from '@mui/material';
import { Phone, Email, Visibility, VisibilityOff, Sms, Lock, AssignmentInd } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { displayPhMobile } from '@/lib/phoneNumber';

/**
 * Reporter Information on the official's case page.
 *
 * Shows the reporter's name, their role in the report, a masked number and
 * their safe-contact instructions. "View Resident Information" opens the
 * resident's full stored record straight away - no reason or confirmation is
 * asked for. The server decides access by role and case assignment and logs
 * every view. The details live in this component's state until hidden, the
 * page is left, or three minutes pass. Nothing is dialled: Call and Text are
 * plain tel:/sms: links the official chooses to use.
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
    canReveal: boolean; basis: string | null; code: string;
    message: string | null; canClaim: boolean; assignedTo: string | null;
  };
}

interface ResidentInfo {
  basis: string;
  resident: {
    fullName: string | null; residentNumber: string | null; age: number | null; sex: string | null;
    address: string | null; barangay: string | null; phone: string | null; email: string | null;
    accountStatus: string | null; emailVerified: boolean; registeredAt: string | null; updatedAt: string | null;
  } | null;
  linkedAs?: string[];
  telHref?: string | null;
  smsHref?: string | null;
  missing: string | null;
}

const NAVY = '#0c1e46';
const label = { fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
const SHOW_FOR_MS = 3 * 60 * 1000;

/** The reporter's role, from what they said when filing - never inferred. */
const ROLE: Record<string, string> = {
  SELF: 'Reporter · said the incident happened to them',
  THIRD_PARTY: 'Informant · reporting an incident involving someone else',
  ON_BEHALF: 'Third-party reporter · filing on behalf of the person affected',
};
const LINKED: Record<string, string> = { AFFECTED: 'the person affected', REPORTED: 'the person reported' };

const day = (d: string | null) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
const when = (d: string | null) => d ? new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

const fetchSummary = (url: string) => fetch(url, { credentials: 'include', cache: 'no-store' }).then(async r => {
  if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : 'failed');
  return (await r.json()).data as Summary;
});

export default function ReporterInfoPanel({ caseId, onAssigned }: { caseId: string; onAssigned?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/cases/${caseId}/reporter`, fetchSummary, { revalidateOnFocus: false });
  const [info, setInfo] = useState<ResidentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gone with the page: never left behind in memory after the official leaves.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setInfo(null);
  };

  const view = async () => {
    setBusy(true); setDenied(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/reporter/resident-info`, { method: 'POST', credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setDenied(json.error ?? 'Access was not granted.'); return; }
      setInfo(json.data);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setInfo(null), SHOW_FOR_MS);
    } catch {
      setDenied('Resident information is unavailable right now.');
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
  const r = info?.resident ?? null;
  const role = reporter.relationship ? ROLE[reporter.relationship] : null;

  // The reporter's own instructions: shown with the contact details, every time.
  const safetyBlock = safety && reporter.registered && (
    safety.preference || safety.note || safety.caution ? (
      <Alert severity={safety.preference === 'no_phone' ? 'error' : 'warning'} icon={<Lock fontSize="small" />}
        sx={{ mb: 1, borderRadius: 2, fontSize: '0.8rem', '& .MuiAlert-message': { width: '100%' } }}>
        {safety.label && <Box sx={{ fontWeight: 700 }}>Reporter&rsquo;s preference: {safety.label}</Box>}
        {safety.guidance && <Box>{safety.guidance}</Box>}
        {safety.note && <Box sx={{ mt: 0.5 }}>In their words: &ldquo;{safety.note}&rdquo;</Box>}
        {safety.caution && <Box sx={{ mt: 0.5 }}>{safety.caution}</Box>}
      </Alert>
    ) : (
      <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mb: 1 }}>
        The reporter did not say how to contact them. Do not assume this number is safe: confirm they can talk before discussing the case.
      </Typography>
    )
  );

  return (
    <Card sx={{ mb: 2, ...(urgency.urgent && { border: '1px solid #fecaca' }) }}>
      <CardContent sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY, mb: 1.25 }}>Reporter Information</Typography>

        {/* The case's own state, as it stands - not a substitute for access */}
        {urgency.urgent && (
          <Typography sx={{ fontSize: '0.78rem', color: '#7f1d1d', mb: 1 }}>
            {urgency.riskLevel} risk · {urgency.status}
            {urgency.immediateSafetyConcern ? ' · resident reported an immediate safety concern' : ''}
            {urgency.requiresOfficerReview ? ' · needs officer review' : ''}
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.25 }}>
          <Typography sx={{ fontSize: '0.9rem', color: NAVY, fontWeight: 600 }}>
            {reporter.name}
            {reporter.residentNumber && <Box component="span" sx={{ color: '#94a3b8', fontWeight: 400 }}> · {reporter.residentNumber}</Box>}
          </Typography>
          {/* Who this person is in the report. The reporter is not assumed to be the person affected. */}
          {!reporter.anonymous && (
            <Typography sx={{ fontSize: '0.8rem', color: '#475569' }} data-testid="reporter-role">
              {role ?? 'Reporter · did not say who was affected'}
              {reporter.affectedPersonNote && reporter.relationship !== 'SELF' && <> — affected: &ldquo;{reporter.affectedPersonNote}&rdquo;</>}
            </Typography>
          )}
          {reporter.anonymous ? (
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
              The reporter chose not to be identified. Their name and contact details are not shown, and they cannot be called back;
              reply through the case&rsquo;s follow-up messages instead.
            </Typography>
          ) : !reporter.registered && (
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
              Not filed from a resident account — no registered resident information.
            </Typography>
          )}
        </Box>

        {/* Before viewing: the instructions, then the masked contact details */}
        {reporter.registered && access.canReveal && !info && (
          <>
            {safetyBlock}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.25 }}>
              <Row icon={<Phone sx={{ fontSize: 15 }} />} label="Phone" value={contact.phoneMasked ?? 'Not on file'} />
              <Row icon={<Email sx={{ fontSize: 15 }} />} label="E-mail" value={contact.emailMasked ?? 'Not on file'} />
            </Box>
            <Button variant="contained" size="small" startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <Visibility />}
              disabled={busy} onClick={() => void view()}
              sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 36, '&:hover': { bgcolor: '#115e59' } }}>
              View Resident Information
            </Button>
          </>
        )}

        {/* The resident's record, as stored */}
        {info && (
          <Box data-testid="resident-info" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {r ? (
              <>
                <Section title="Personal">
                  <Field name="Full name" value={r.fullName} />
                  <Field name="Resident ID" value={r.residentNumber} />
                  <Field name="Date of birth" value={null} empty="Not recorded" />
                  <Field name="Age" value={r.age !== null ? `${r.age} (as given at registration)` : null} />
                  <Field name="Sex" value={r.sex} />
                  <Field name="Address" value={r.address} />
                  <Field name="Barangay" value={r.barangay} />
                </Section>
                <Divider />
                <Section title="Contact">
                  {safetyBlock}
                  <Field name="Contact number" value={r.phone ? displayPhMobile(r.phone) : null} strong />
                  <Field name="E-mail" value={r.email} strong />
                  <Field name="Other contacts" value={null} empty="None registered" />
                  {(info.telHref || info.smsHref) && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                      {info.telHref && (
                        <Button component="a" href={info.telHref} variant="contained" size="small" startIcon={<Phone />}
                          sx={{ bgcolor: '#0f766e', fontWeight: 700, minHeight: 36, '&:hover': { bgcolor: '#115e59' } }}>
                          Call reporter
                        </Button>
                      )}
                      {info.smsHref && (
                        <Button component="a" href={info.smsHref} variant="outlined" size="small" startIcon={<Sms />} sx={{ minHeight: 36 }}>
                          Text
                        </Button>
                      )}
                    </Box>
                  )}
                  {r.phone && !info.telHref && (
                    <Typography sx={{ fontSize: '0.78rem', color: '#b91c1c', mt: 0.5 }}>
                      No call or text button: the reporter said phone contact is not safe.
                    </Typography>
                  )}
                </Section>
                <Divider />
                <Section title="Account">
                  <Field name="Account status" value={r.accountStatus} />
                  <Field name="Verification" value={r.emailVerified ? 'E-mail verified' : 'E-mail not verified'} />
                  <Field name="Registered" value={day(r.registeredAt)} />
                  <Field name="Last updated" value={when(r.updatedAt)} />
                </Section>
                <Divider />
                <Section title="In this case">
                  <Field name="Role" value={role ?? 'Reporter · did not say who was affected'} />
                  {(info.linkedAs ?? []).map(l => (
                    <Field key={l} name="Also linked as" value={`${LINKED[l] ?? l} (linked by an official by resident ID)`} />
                  ))}
                  {reporter.relationship !== 'SELF' && (
                    <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                      The person affected and the person reported are recorded separately in the case, not as this resident.
                    </Typography>
                  )}
                </Section>
              </>
            ) : (
              info.missing && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{info.missing}</Alert>
            )}
            {r && info.missing && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{info.missing}</Alert>}
            <Box>
              <Button size="small" startIcon={<VisibilityOff />} onClick={hide} sx={{ color: '#64748b', minHeight: 36 }}>Hide</Button>
            </Box>
          </Box>
        )}

        {denied && <Alert severity="error" sx={{ mt: 1, borderRadius: 2, fontSize: '0.8rem' }}>{denied}</Alert>}

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
        {access.canReveal && reporter.registered && (
          <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 1 }}>Each view is recorded in the access log.</Typography>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ ...label, mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );
}

function Field({ name, value, empty = 'Not recorded', strong }: { name: string; value: string | number | null; empty?: string; strong?: boolean }) {
  const missing = value === null || value === '';
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, gap: { xs: 0, sm: 1 }, mb: 0.6 }}>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{name}</Typography>
      <Typography sx={{ fontSize: '0.86rem', color: missing ? '#94a3b8' : NAVY, fontWeight: strong && !missing ? 700 : 400,
        fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        {missing ? empty : value}
      </Typography>
    </Box>
  );
}

function Row({ icon, label: name, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ color: '#64748b', display: 'flex' }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', minWidth: 52 }}>{name}</Typography>
      <Typography sx={{ fontSize: '0.88rem', color: NAVY, fontWeight: 500, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Box>
  );
}
