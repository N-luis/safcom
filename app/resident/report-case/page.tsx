'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Typography, Card, CardContent, Grid, TextField,
  MenuItem, ListSubheader, Button, CircularProgress, Alert,
  Divider,
} from '@mui/material';
import {
  CheckCircle, Send, ArrowBack,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import StreetSelect from '@/components/forms/StreetSelect';
import OtherTypeField, { isOtherType, withOtherDetail } from '@/components/forms/OtherTypeField';
import PhotoAttachments, { type PickedPhoto } from '@/components/forms/PhotoAttachments';
import DocumentCapture, { type CapturedDocument } from '@/components/forms/DocumentCapture';
import { useLanguage, LANGUAGES } from '@/lib/i18n';
import AnalyzingCard, { type AnalysisPhase, type AnalysisStage } from '@/components/ai/AnalyzingCard';
import CaseAssessmentPanel from '@/components/ai/CaseAssessmentPanel';
import type { CaseAssessment } from '@/lib/caseAssessment';
import { MAX_UNCLEAR_WORDS } from '@/lib/transcription';

const ACCENT = '#14b8a6';

const CASE_TYPES = [
  'Theft & Robbery', 'Public Nuisance', 'Domestic Dispute', 'Assault',
  'Cybercrime', 'Vandalism', 'Drug-Related', 'Traffic Violation',
  'Noise Complaint', 'Utility Problem', 'Infrastructure Issue',
  'Sanitation Concern', 'Illegal Construction', 'Animal Bite/Concern', 'Other',
];


const schema = z.object({
  caseType:        z.string().min(1, 'Please select a case type'),
  // Only meaningful when caseType is an "Other" option; the refine below
  // makes it required in that case.
  otherType:       z.string().optional(),
  description:     z.string().min(20, 'Please describe the incident (min 20 characters)'),
  // The street is stored on the case itself so reports and the risk heatmap
  // group by where the incident happened, not by the reporter's barangay.
  street:          z.string().min(1, 'Please select the street'),
  location:        z.string().optional(),
  additionalNotes: z.string().optional(),
}).refine(
  d => !isOtherType(d.caseType) || (d.otherType ?? '').trim().length >= 3,
  { path: ['otherType'], message: 'Tell us what kind of case this is' },
);
type FormData = z.infer<typeof schema>;


export default function ReportCasePage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<{ caseNumber: string; assessment: CaseAssessment | null } | null>(null);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      caseType: '', otherType: '', description: '', street: '', location: '',
      additionalNotes: '',
    },
  });

  const descLen = watch('description')?.length ?? 0;
  const selectedCaseType = watch('caseType');
  const isVawcCase = (VAWC_TYPES as readonly string[]).includes(selectedCaseType);

  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [document, setDocument] = useState<CapturedDocument | null>(null);
  const { lang, setLanguage, t } = useLanguage();
  const cancelConfirmText = t('cancelConfirm');
  // Mirrors the request lifecycle, so the stages shown are never ahead of
  // the work and a failure never leaves a fabricated classification behind.
  // The analysis phase follows the work actually being done; no timer advances
  // it. `stage` is an index into the stage list, which omits the document step
  // when no photo was attached rather than showing one that will not run.
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [stage, setStage] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [slow, setSlow] = useState(false);
  const cancelled = useRef(false);

  const stages: AnalysisStage[] = [
    { id: 'prepare', labelKey: 'stagePreparing', active: true },
    ...(document ? [{ id: 'read', labelKey: 'stageReadingDocument' as const, active: true }] : []),
    { id: 'factors', labelKey: 'stageFactors', active: true },
    { id: 'severity', labelKey: 'stageSeverity', active: true },
    { id: 'recs', labelKey: 'stageRecommendations', active: true },
  ];

  // Kept so Retry can re-run the same answers without the user re-typing them.
  const lastSubmission = useRef<FormData | null>(null);
  // Held until the user presses View result, so the floating card can finish
  // its own lifecycle rather than being yanked away by a screen change.
  const pendingResult = useRef<{ caseNumber: string; assessment: CaseAssessment | null } | null>(null);

const analysing = phase === 'preparing' || phase === 'reading_document' || phase === 'assessing';

  // Real elapsed time, started when the run starts and cleared when it ends,
  // so "taking longer than usual" is never shown about a run that finished.
  useEffect(() => {
    if (!analysing) { setSlow(false); return; }
    const id = setTimeout(() => setSlow(true), 30_000);
    return () => clearTimeout(id);
  }, [analysing]);

  const onSubmit = async (data: FormData) => {
    lastSubmission.current = data;
    cancelled.current = false;
    setApiError('');
    setSlow(false);
    setMinimized(false);
    setStage(0);
    setPhase('preparing');
    try {
      // The document was already read when it was chosen; this step reflects
      // that it is being attached to the report, which is real work.
      if (document) { setStage(1); }
      setStage(s2 => s2 + 1);
      setPhase('assessing');

      const res = await fetch('/api/resident/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          caseType: data.caseType,
          // Sent as `barangay` because that is the Case column the Street
          // field reads from across the app.
          barangay: data.street,
          description: withOtherDetail(
            `${data.description}${data.location ? `\n\nLandmark: ${data.location}` : ''}`,
            data.caseType,
            data.otherType ?? '',
          ),
          additionalNotes: data.additionalNotes,
          attachments: [
            ...photos.map(p => ({ name: p.name, dataUrl: p.dataUrl })),
            // The document photo is stored with the case like any other, so the
            // officer sees what was read rather than only the transcription.
            ...(document ? [{ name: document.fileName, dataUrl: document.storedDataUrl }] : []),
          ],
          documentText: document?.confirmedText || undefined,
          documentConfidence: document?.transcription?.confidence,
          // Bounded here too, so the request stays small on a phone connection.
          documentUnclearWords: document?.transcription?.unclearWords?.slice(0, MAX_UNCLEAR_WORDS),
          documentReadFailed: document?.transcription?.failed ?? undefined,
        }),
      });
      const json = await res.json();
      if (cancelled.current) return;
      if (!res.ok) {
        setPhase('error');
        setApiError(json.error || 'Submission failed');
        return;
      }
      // Only now is the assessment real, so only now do the last stages tick
      // over and the bar reach the end.
      setStage(stages.length);
      setPhase('done');
      pendingResult.current = {
        caseNumber: json.data.caseNumber,
        assessment: json.data.assessment ?? null,
      };
      toast.success('Report submitted successfully!');
    } catch {
      if (cancelled.current) return;
      setPhase('error');
      setApiError('Network error. Please try again.');
    }
  };

  if (submitted) {
    const assessment = submitted.assessment;
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', width: '100%' }}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
          <Card sx={{ width: '100%', maxWidth: 680, p: { xs: 0.5, sm: 1 } }}>
            <CardContent sx={{ p: 3.5 }}>
              <Box sx={{ width: 68, height: 68, borderRadius: '50%', bgcolor: '#f0fdf4', mx: 'auto', mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle sx={{ fontSize: 38, color: '#22c55e' }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', color: '#0c1e46', mb: 0.75, textAlign: 'center' }}>
                Report Submitted
              </Typography>
              <Typography sx={{ color: '#64748b', fontSize: '0.94rem', mb: 2.5, lineHeight: 1.6, textAlign: 'center' }}>
                Your case has been filed and an officer will review it shortly.
              </Typography>

              <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 2, mb: assessment ? 2 : 2.5, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mb: 0.5, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>Case Number</Typography>
                <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', color: ACCENT, letterSpacing: '0.06em' }}>
                  #{submitted.caseNumber}
                </Typography>
              </Box>

              {assessment && (
                <Box sx={{ mb: 2.5 }}>
                  <CaseAssessmentPanel assessment={assessment} caseNumber={submitted.caseNumber} />
                </Box>
              )}

              {/* Stacked on a phone, side by side from 600px. 44px minimum so
                  they are usable with a thumb. */}
              <Box sx={{
                display: 'flex', gap: 1.25, justifyContent: 'center',
                flexDirection: { xs: 'column', sm: 'row' },
              }}>
                <Button variant="outlined" onClick={() => router.push('/resident/my-cases')}
                  sx={{ borderColor: ACCENT, color: ACCENT, fontWeight: 600, minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
                  View My Cases
                </Button>
                <Button variant="contained" onClick={() => { setSubmitted(null); setPhase('idle'); setStage(0); pendingResult.current = null; }}
                  sx={{ bgcolor: ACCENT, fontWeight: 600, minHeight: 44, width: { xs: '100%', sm: 'auto' }, '&:hover': { bgcolor: '#0d9488' } }}>
                  File Another
                </Button>
              </Box>
            </CardContent>
          </Card>
        </motion.div>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: '100%', overflowX: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ArrowBack />} onClick={() => router.push('/resident')} sx={{ color: '#64748b', minHeight: 44 }}>
          Back
        </Button>
        <Divider orientation="vertical" flexItem />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
          {LANGUAGES.map(l => (
            <Button
              key={l.code}
              size="small"
              onClick={() => setLanguage(l.code)}
              aria-pressed={lang === l.code}
              sx={{
                minHeight: 44, minWidth: 44, px: 1.25, textTransform: 'none', fontWeight: 700,
                fontSize: '0.8rem', borderRadius: 2,
                color: lang === l.code ? ACCENT : '#94a3b8',
                bgcolor: lang === l.code ? `${ACCENT}14` : 'transparent',
              }}
            >
              {l.label}
            </Button>
          ))}
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>File a Report</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Submit an incident or concern to your barangay</Typography>
        </Box>
      </Box>

      <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ maxWidth: 940 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              {apiError && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{apiError}</Alert>}

              {isVawcCase && (
                <Alert severity="info" sx={{ mb: 2.5, borderRadius: 2, bgcolor: '#f5f3ff', color: '#5b21b6', '& .MuiAlert-icon': { color: '#7c3aed' } }}>
                  This case type is handled by the VAWC desk. Your report will be routed confidentially to a VAWC officer.
                </Alert>
              )}

              <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                {/* Case Type */}
                <Controller
                  name="caseType"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field} select label="Case Type *"
                      error={!!errors.caseType} helperText={errors.caseType?.message}
                      fullWidth
                      slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } } } }}
                    >
                      <ListSubheader>General / Community Concerns</ListSubheader>
                      {CASE_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                      <ListSubheader sx={{ color: '#7c3aed', fontWeight: 700 }}>
                        VAWC (Violence Against Women &amp; Children)
                      </ListSubheader>
                      {VAWC_TYPES.map(t => <MenuItem key={`vawc-${t}`} value={t}>{t}</MenuItem>)}
                    </TextField>
                  )}
                />

                {/* Picking "Other" asks what the case actually is */}
                {isOtherType(selectedCaseType) && (
                  <Controller
                    name="otherType"
                    control={control}
                    render={({ field }) => (
                      <OtherTypeField
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        error={!!errors.otherType}
                        helperText={errors.otherType?.message}
                      />
                    )}
                  />
                )}

                {/* Where it happened — street is structured, landmark is free text */}
                <Controller
                  name="street"
                  control={control}
                  render={({ field }) => (
                    <StreetSelect
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      required
                      size="medium"
                      error={!!errors.street}
                      helperText={errors.street?.message ?? 'Where did this happen?'}
                    />
                  )}
                />
                <TextField
                  label="Landmark / nearby detail (optional)"
                  placeholder="e.g. near the covered court, in front of Block 7"
                  {...register('location')}
                  fullWidth
                />

                {/* Description */}
                <Box>
                  <TextField
                    label="Incident Description *"
                    placeholder="Describe what happened — include date, time, persons involved, and any relevant context..."
                    {...register('description')}
                    error={!!errors.description}
                    helperText={errors.description?.message || `${descLen}/800 characters`}
                    fullWidth multiline rows={5}
                    slotProps={{ htmlInput: { maxLength: 800 } }}
                  />
                </Box>

                {/* Additional notes */}
                <TextField
                  label="Additional Notes (optional)"
                  placeholder="Any other information that might help the officer — witnesses, suspects, prior reports filed, etc."
                  {...register('additionalNotes')}
                  fullWidth multiline rows={2}
                />

                <DocumentCapture
                  value={document}
                  onChange={setDocument}
                  disabled={isSubmitting}
                  accent={ACCENT}
                />

                {/* Photo evidence — shrunk in the browser before upload */}
                <PhotoAttachments
                  photos={photos}
                  onChange={setPhotos}
                  disabled={isSubmitting}
                  accent={ACCENT}
                />

                <Box sx={{ display: 'flex', gap: 1.25, flexDirection: { xs: 'column', sm: 'row' } }}>
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={isSubmitting || analysing}
                    startIcon={isSubmitting || analysing ? <CircularProgress size={18} color="inherit" /> : <Send />}
                    sx={{ bgcolor: ACCENT, fontWeight: 700, minHeight: 48, '&:hover': { bgcolor: '#0d9488' }, boxShadow: '0 4px 14px rgba(20,184,166,0.35)', flex: 1 }}
                  >
                    {isSubmitting || analysing ? 'Submitting…' : 'Submit Report'}
                  </Button>
                  <Button variant="outlined" size="large" onClick={() => router.push('/resident')}
                    sx={{ borderColor: '#e2e8f0', color: '#64748b', minHeight: 48 }}>
                    Cancel
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

      </Grid>

      <AnalyzingCard
        phase={phase}
        current={stage}
        stages={stages}
        minimized={minimized}
        slow={slow}
        error={apiError}
        accent={ACCENT}
        onMinimize={() => setMinimized(true)}
        onExpand={() => setMinimized(false)}
        onCancel={() => {
          // Confirmed, because the work is nearly done by the time anyone
          // reaches for this. The form keeps every answer either way.
          if (!window.confirm(cancelConfirmText)) return;
          cancelled.current = true;
          setPhase('cancelled');
          setStage(0);
        }}
        onRetry={() => { if (lastSubmission.current) onSubmit(lastSubmission.current); }}
        onSubmitForReview={() => {
          // The case is already filed by this point; this just stops waiting
          // on the assessment and hands the resident their case number.
          if (pendingResult.current) { setSubmitted(pendingResult.current); }
          setPhase('idle');
        }}
        onViewResult={() => {
          if (pendingResult.current) setSubmitted(pendingResult.current);
          setPhase('idle');
          setStage(0);
        }}
      />
    </Box>
  );
}
