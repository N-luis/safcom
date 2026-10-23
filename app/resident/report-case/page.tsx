'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Typography, Card, CardContent, Grid, TextField,
  MenuItem, ListSubheader, Button, CircularProgress, Alert,
  Divider, ToggleButton, ToggleButtonGroup,
  Dialog, DialogTitle, DialogContent, DialogActions,
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
import { useLanguage } from '@/lib/i18n';
import AnalyzingCard, { type AnalysisPhase, type AnalysisStage } from '@/components/ai/AnalyzingCard';
import CaseAssessmentPanel from '@/components/ai/CaseAssessmentPanel';
import type { CaseAssessment } from '@/lib/caseAssessment';
import dynamicImport from 'next/dynamic';
import { BARANGAY_STREETS, type BarangayStreet } from '@/lib/streets';
import BarangayStreetMap from '@/components/forms/BarangayStreetMap';
import IntakeAssistant from '@/components/forms/IntakeAssistant';
import type { IntakeAnswer, IntakeResult } from '@/lib/intake';
import type { PickedLocation } from '@/components/forms/IncidentLocationMap';

/**
 * Leaflet reaches for window as it loads, so the picker is never rendered on
 * the server. The placeholder holds the same height to stop the form jumping
 * when it arrives.
 */
const IncidentLocationMap = dynamicImport(
  () => import('@/components/forms/IncidentLocationMap'),
  {
    ssr: false,
    loading: () => (
      <Box sx={{
        height: { xs: 260, sm: 320 }, border: '1px solid #e2e8f0', borderRadius: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
      }}>
        <CircularProgress size={18} sx={{ color: ACCENT }} />
        <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Loading the map\u2026</Typography>
      </Box>
    ),
  },
);

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

  const { register, handleSubmit, control, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      caseType: '', otherType: '', description: '', street: '', location: '',
      additionalNotes: '',
    },
  });

  const descLen = watch('description')?.length ?? 0;

  // The pin. The street field stays the value the case is filed under; this
  // carries the coordinates alongside it.
  const [place, setPlace] = useState<PickedLocation | null>(null);

  /**
   * A pin moved, so the street follows it.
   *
   * A road the barangay already lists is set to that exact label, because the
   * reports and the heatmap group by this string and "J.P. Rizal St." and
   * "JP Rizal Street" would otherwise be two places. Anything else is kept as
   * the geocoder wrote it, which StreetSelect holds under its "Other" option.
   * Clearing the pin does not clear the street: the resident may have typed it
   * themselves, and taking it back would be rude.
   */
  // What the map last wrote into the street field. Without this the two chase
  // each other: the map fills the street, the street sends the map back to it,
  // and the resident's pin jumps off the spot they chose.
  const streetFromMap = useRef('');

  /**
   * The barangay's own map opens first.
   *
   * It is the drawing from the wall of the hall, so a resident recognises
   * their street on it at a glance. The real map is a tap away for anyone who
   * wants to mark the exact spot - more precise, far less familiar, which is
   * the right way round for the one that is optional.
   */
  const [locView, setLocView] = useState<'barangay' | 'exact'>('barangay');

  /**
   * A street was tapped on the barangay map.
   *
   * It sets the street field and nothing else. The drawing cannot say where
   * that is in latitude and longitude - it is a diagram, not a survey - so
   * the coordinate is left to the precise map, which fills it in from a
   * checked point when there is one for that street.
   */
  const onPickStreet = (street: BarangayStreet) => {
    streetFromMap.current = '';
    setValue('street', street, { shouldValidate: true, shouldDirty: true });
  };

  const onPlaceChange = (next: PickedLocation | null) => {
    setPlace(next);
    // The pin came from the street the resident picked, so the street field is
    // already right. Overwriting it with the road the geocoder names would
    // throw away the barangay's own label - "Violeta Metroville Subd." would
    // silently become "Violeta Avenue", which is not on the list at all.
    if (next?.fromStreet) return;
    if (!next?.street) return;
    const known = BARANGAY_STREETS.find(
      sx => sx.toLowerCase() === next.street!.toLowerCase(),
    );
    const chosen = known ?? next.street;
    streetFromMap.current = chosen;
    setValue('street', chosen, { shouldValidate: true, shouldDirty: true });
  };

  // Only a street the resident picked themselves moves the map.
  const streetValue = watch('street');
  const focusStreet = streetValue && streetValue !== streetFromMap.current ? streetValue : undefined;
  const selectedCaseType = watch('caseType');
  const isVawcCase = (VAWC_TYPES as readonly string[]).includes(selectedCaseType);

  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  // SafeComm Assist: the answers given so far, and its latest reading.
  const [intakeAnswers, setIntakeAnswers] = useState<IntakeAnswer[]>([]);
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  // The final look before filing. Skipped by the emergency path.
  const [reviewing, setReviewing] = useState<FormData | null>(null);
  const descriptionValue = watch('description') ?? '';

  /**
   * A draft, so a failed request or a reload never costs the resident what
   * they wrote. sessionStorage, not localStorage, on purpose: this is someone's
   * account of being hurt, and on a shared phone it must not outlive the tab.
   */
  const DRAFT_KEY = 'safecomm_report_draft';
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw) as { description?: string; caseType?: string; answers?: IntakeAnswer[] };
        if (d.description && !getValues('description')) setValue('description', d.description);
        if (d.caseType && !getValues('caseType')) setValue('caseType', d.caseType);
        if (Array.isArray(d.answers)) setIntakeAnswers(d.answers);
      } catch { /* private mode or a malformed draft: start clean */ }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          description: descriptionValue, caseType: selectedCaseType, answers: intakeAnswers,
        }));
      } catch { /* storage unavailable: the in-page state still holds it */ }
    }, 300);
    return () => clearTimeout(t);
  }, [descriptionValue, selectedCaseType, intakeAnswers]);
  const { t } = useLanguage();
  const cancelConfirmText = t('cancelConfirm');
  // Mirrors the request lifecycle, so the stages shown are never ahead of
  // the work and a failure never leaves a fabricated classification behind.
  // The analysis phase follows the work actually being done; no timer advances
  // it, and `stage` is an index into the stage list below.
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [stage, setStage] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [slow, setSlow] = useState(false);
  const cancelled = useRef(false);

  const stages: AnalysisStage[] = [
    { id: 'prepare', labelKey: 'stagePreparing', active: true },
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
          // Only sent once a pin is actually down. Nothing about the
          // resident's own position is recorded unless they placed it.
          latitude: place?.chosen ? place.latitude : undefined,
          longitude: place?.chosen ? place.longitude : undefined,
          locationLabel: place?.chosen ? place.label ?? undefined : undefined,
          municipality: place?.chosen ? place.municipality ?? undefined : undefined,
          province: place?.chosen ? place.province ?? undefined : undefined,
          description: withOtherDetail(
            `${data.description}${data.location ? `\n\nLandmark: ${data.location}` : ''}`,
            data.caseType,
            data.otherType ?? '',
          ),
          additionalNotes: data.additionalNotes,
          attachments: photos.map(p => ({ name: p.name, dataUrl: p.dataUrl })),
          // What the resident wrote, before any landmark was appended, and
          // their answers. The server reads both again itself.
          intakeNarrative: data.description,
          intakeAnswers,
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
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
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

              <Box component="form" onSubmit={handleSubmit(data => setReviewing(data))} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

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
                {/* Where it happened. The map fills the street field below;
                    that field stays editable, because a point with no road in
                    the map data still has a name the resident knows. */}
                <Box>
                  <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46', mb: 0.5 }}>
                    Where did this happen?
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mb: 1 }}>
                    Tap your street on the barangay map. If you can show the exact spot, switch to
                    Exact spot &mdash; it helps the barangay get there faster.
                  </Typography>

                  <ToggleButtonGroup
                    value={locView}
                    exclusive
                    size="small"
                    aria-label="How to give the location"
                    onChange={(_, v) => { if (v) setLocView(v); }}
                    disabled={isSubmitting || analysing}
                    sx={{
                      mb: 1.25,
                      '& .MuiToggleButton-root': {
                        minHeight: 40, px: 1.75, textTransform: 'none',
                        fontWeight: 700, fontSize: '0.82rem',
                        '&.Mui-selected': { bgcolor: '#14b8a618', color: '#0f766e' },
                      },
                    }}
                  >
                    <ToggleButton value="barangay">Barangay map</ToggleButton>
                    <ToggleButton value="exact">Exact spot</ToggleButton>
                  </ToggleButtonGroup>

                  {locView === 'barangay' ? (
                    <BarangayStreetMap
                      value={streetValue}
                      onPick={onPickStreet}
                      disabled={isSubmitting || analysing}
                    />
                  ) : (
                    <IncidentLocationMap
                      value={place}
                      onChange={onPlaceChange}
                      focusStreet={focusStreet}
                      disabled={isSubmitting || analysing}
                    />
                  )}
                </Box>

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
                      helperText={
                        errors.street?.message
                        ?? (place?.chosen && place.street
                          ? 'Filled in from the map. You can change it if it is wrong.'
                          : 'Where did this happen?')
                      }
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

                <IntakeAssistant
                  narrative={descriptionValue}
                  selectedCategory={selectedCaseType}
                  street={streetValue}
                  answers={intakeAnswers}
                  onAnswersChange={setIntakeAnswers}
                  onResult={setIntakeResult}
                  disabled={isSubmitting || analysing}
                  // Danger: file what there is now. Validation still runs (a
                  // case needs a street and a description), but the review
                  // step is skipped.
                  onSubmitNow={() => { void handleSubmit(onSubmit)(); }}
                />

                {/* Additional notes */}
                <TextField
                  label="Additional Notes (optional)"
                  placeholder="Any other information that might help the officer — witnesses, suspects, prior reports filed, etc."
                  {...register('additionalNotes')}
                  fullWidth multiline rows={2}
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

      <Dialog open={Boolean(reviewing)} onClose={() => setReviewing(null)} maxWidth="sm" fullWidth
        aria-labelledby="review-title"
        sx={{ '& .MuiDialog-paper': { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'auto' }, borderRadius: 3 } }}>
        <DialogTitle id="review-title" sx={{ fontWeight: 800, color: '#0c1e46' }}>Review before submitting</DialogTitle>
        <DialogContent>
          {reviewing && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {([
                ['Case type you chose', reviewing.caseType === 'Other' || /^Other/.test(reviewing.caseType) ? `${reviewing.caseType} — ${reviewing.otherType ?? ''}` : reviewing.caseType],
                ...(intakeResult?.suggestedCaseCategory && intakeResult.suggestedCaseCategory !== reviewing.caseType
                  ? [['Description fits', `${intakeResult.suggestedCaseCategory} (both are sent to the officer)`]] : []),
                ['Street', reviewing.street],
                ['Questions answered', intakeAnswers.length
                  ? `${intakeAnswers.filter(a => a.kind === 'option' || a.kind === 'text').length} answered, ${intakeAnswers.filter(a => a.kind === 'skipped' || a.kind === 'declined').length} skipped`
                  : 'None — you can still submit'],
                ...(intakeResult ? [['Information', intakeResult.informationCompleteness === 'SUFFICIENT_FOR_PRELIMINARY_ASSESSMENT'
                  ? 'Enough for a preliminary assessment' : intakeResult.informationCompleteness === 'PARTIAL' ? 'Partial' : 'Not enough yet — an officer will follow up']] : []),
                ['Photos', String(photos.length)],
              ] as [string, string][]).map(([k, v]) => (
                <Box key={k} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.84rem', color: '#94a3b8', minWidth: 150 }}>{k}</Typography>
                  <Typography sx={{ fontSize: '0.84rem', color: '#0c1e46', fontWeight: 600, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{v}</Typography>
                </Box>
              ))}
              <Box sx={{ bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
                <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', mb: 0.5 }}>Your description</Typography>
                <Typography sx={{ fontSize: '0.86rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{reviewing.description}</Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
          <Button onClick={() => setReviewing(null)} sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, color: '#64748b' }}>
            Edit
          </Button>
          <Button variant="contained" startIcon={<Send />}
            onClick={() => { const d = reviewing; setReviewing(null); if (d) onSubmit(d); }}
            sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' }, bgcolor: ACCENT, fontWeight: 700, '&:hover': { bgcolor: '#0d9488' } }}>
            Submit report
          </Button>
        </DialogActions>
      </Dialog>

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
