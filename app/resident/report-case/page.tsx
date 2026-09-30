'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Typography, Card, CardContent, Grid, TextField,
  MenuItem, ListSubheader, Button, CircularProgress, Alert, Chip,
  Divider,
} from '@mui/material';
import {
  CheckCircle, Send, ArrowBack, AutoAwesome,
  FamilyRestroom, Repeat, LocalHospital,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import StreetSelect from '@/components/forms/StreetSelect';
import OtherTypeField, { isOtherType, withOtherDetail } from '@/components/forms/OtherTypeField';
import PhotoAttachments, { type PickedPhoto } from '@/components/forms/PhotoAttachments';

const ACCENT = '#14b8a6';

const CASE_TYPES = [
  'Theft & Robbery', 'Public Nuisance', 'Domestic Dispute', 'Assault',
  'Cybercrime', 'Vandalism', 'Drug-Related', 'Traffic Violation',
  'Noise Complaint', 'Utility Problem', 'Infrastructure Issue',
  'Sanitation Concern', 'Illegal Construction', 'Animal Bite/Concern', 'Other',
];

const RISK_COLOR: Record<string, string> = { Low: '#22c55e', Medium: '#f97316', High: '#ef4444' };
const RISK_BG:    Record<string, string> = { Low: '#f0fdf4', Medium: '#fff7ed', High: '#fef2f2' };

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
  minorsInvolved:  z.boolean(),
  physicalHarm:    z.boolean(),
  recurring:       z.boolean(),
  additionalNotes: z.string().optional(),
}).refine(
  d => !isOtherType(d.caseType) || (d.otherType ?? '').trim().length >= 3,
  { path: ['otherType'], message: 'Tell us what kind of case this is' },
);
type FormData = z.infer<typeof schema>;

interface AiRisk {
  level: string;
  score: number;
  riskFactors: string[];
  justification: string;
  recommendation: string;
  confidence: number;
  highRiskZone: boolean;
}

function YesNoToggle({
  label, icon: Icon, value, onChange,
}: { label: string; icon: React.ElementType; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <Icon sx={{ fontSize: 16, color: '#64748b' }} />
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}>{label}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {[{ label: 'Yes', val: true, activeColor: '#ef4444' }, { label: 'No', val: false, activeColor: ACCENT }].map(opt => (
          <Chip
            key={String(opt.val)}
            label={opt.label}
            onClick={() => onChange(opt.val)}
            sx={{
              fontWeight: value === opt.val ? 700 : 400,
              bgcolor: value === opt.val ? `${opt.activeColor}15` : '#f1f5f9',
              color: value === opt.val ? opt.activeColor : '#64748b',
              border: value === opt.val ? `1.5px solid ${opt.activeColor}40` : '1.5px solid transparent',
              cursor: 'pointer', fontSize: '0.86rem', px: 0.5, transition: 'all 0.15s',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

export default function ReportCasePage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<{ caseNumber: string; aiRisk: AiRisk | null } | null>(null);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      caseType: '', otherType: '', description: '', street: '', location: '',
      minorsInvolved: false, physicalHarm: false, recurring: false,
      additionalNotes: '',
    },
  });

  const descLen = watch('description')?.length ?? 0;
  const selectedCaseType = watch('caseType');
  const isVawcCase = (VAWC_TYPES as readonly string[]).includes(selectedCaseType);
  const hasHighRiskFlag = watch('physicalHarm') || watch('minorsInvolved') || watch('recurring');

  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
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
          minorsInvolved: data.minorsInvolved,
          physicalHarm: data.physicalHarm,
          recurring: data.recurring,
          additionalNotes: data.additionalNotes,
          attachments: photos.map(p => ({ name: p.name, dataUrl: p.dataUrl })),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setApiError(json.error || 'Submission failed'); return; }
      setSubmitted({
        caseNumber: json.data.caseNumber,
        aiRisk: json.data.aiRiskAssessment ?? null,
      });
      toast.success('Report submitted successfully!');
    } catch {
      setApiError('Network error. Please try again.');
    }
  };

  if (submitted) {
    const risk = submitted.aiRisk;
    return (
      <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
          <Card sx={{ maxWidth: 520, p: 1 }}>
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

              <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 2, mb: risk ? 2 : 2.5, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mb: 0.5, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>Case Number</Typography>
                <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', color: ACCENT, letterSpacing: '0.06em' }}>
                  #{submitted.caseNumber}
                </Typography>
              </Box>

              {risk && (
                <Box sx={{ bgcolor: RISK_BG[risk.level] ?? '#f8fafc', border: `1px solid ${RISK_COLOR[risk.level] ?? '#e2e8f0'}30`, borderRadius: 2, p: 2, mb: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                    <AutoAwesome sx={{ fontSize: 15, color: RISK_COLOR[risk.level] }} />
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em' }}>AI Risk Assessment</Typography>
                    {risk.highRiskZone && (
                      <Chip label="High-Risk Zone" size="small" sx={{ bgcolor: '#ef444420', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 22, ml: 'auto' }} />
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Chip label={`${risk.level} Risk`} size="small" sx={{ bgcolor: RISK_COLOR[risk.level], color: 'white', fontWeight: 700, fontSize: '0.82rem' }} />
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Score {risk.score}/100 · {risk.confidence}% confidence</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.55, mb: 1 }}>{risk.justification}</Typography>
                  {risk.riskFactors.length > 0 && (
                    <Box sx={{ mt: 0.75 }}>
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>Risk Factors</Typography>
                      {risk.riskFactors.slice(0, 3).map((f, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.25 }}>
                          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: RISK_COLOR[risk.level], flexShrink: 0, mt: '5px' }} />
                          <Typography sx={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.45 }}>{f}</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                  <Divider sx={{ my: 1.25 }} />
                  <Typography sx={{ fontSize: '0.86rem', color: '#475569', fontStyle: 'italic', lineHeight: 1.5 }}>{risk.recommendation}</Typography>
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" onClick={() => router.push('/resident/my-cases')}
                  sx={{ borderColor: ACCENT, color: ACCENT, fontWeight: 600 }}>
                  View My Cases
                </Button>
                <Button variant="contained" onClick={() => setSubmitted(null)}
                  sx={{ bgcolor: ACCENT, fontWeight: 600, '&:hover': { bgcolor: '#0d9488' } }}>
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
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Button size="small" startIcon={<ArrowBack />} onClick={() => router.push('/resident')} sx={{ color: '#64748b' }}>
          Back
        </Button>
        <Divider orientation="vertical" flexItem />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>File a Report</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Submit an incident or concern to your barangay</Typography>
        </Box>
      </Box>

      <Grid container spacing={3} sx={{ maxWidth: 940 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              {apiError && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{apiError}</Alert>}

              {isVawcCase && (
                <Alert severity="info" sx={{ mb: 2.5, borderRadius: 2, bgcolor: '#f5f3ff', color: '#5b21b6', '& .MuiAlert-icon': { color: '#7c3aed' } }}>
                  This case type is handled by the VAWC desk. Your report will be routed confidentially to a VAWC officer.
                </Alert>
              )}

              {hasHighRiskFlag && (
                <Alert severity="warning" sx={{ mb: 2.5, borderRadius: 2, bgcolor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', '& .MuiAlert-icon': { color: '#ef4444' } }}>
                  Based on your answers, this case may be classified as <strong>High Risk</strong>. An officer will be prioritized to review it.
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

                <Divider />

                {/* Risk-context toggles */}
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Incident Context
                  </Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: '#94a3b8', mb: 2 }}>
                    This helps the AI classify the risk level accurately and prioritize your case.
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Controller name="physicalHarm" control={control} render={({ field }) => (
                        <YesNoToggle label="Physical harm occurred?" icon={LocalHospital} value={field.value} onChange={field.onChange} />
                      )} />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Controller name="minorsInvolved" control={control} render={({ field }) => (
                        <YesNoToggle label="Minors involved?" icon={FamilyRestroom} value={field.value} onChange={field.onChange} />
                      )} />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <Controller name="recurring" control={control} render={({ field }) => (
                        <YesNoToggle label="Has this happened before?" icon={Repeat} value={field.value} onChange={field.onChange} />
                      )} />
                    </Grid>
                  </Grid>
                </Box>

                <Divider />

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

                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={isSubmitting}
                    startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <Send />}
                    sx={{ bgcolor: ACCENT, fontWeight: 700, '&:hover': { bgcolor: '#0d9488' }, boxShadow: '0 4px 14px rgba(20,184,166,0.35)', flex: 1 }}
                  >
                    {isSubmitting ? 'Submitting…' : 'Submit Report'}
                  </Button>
                  <Button variant="outlined" size="large" onClick={() => router.push('/resident')}
                    sx={{ borderColor: '#e2e8f0', color: '#64748b' }}>
                    Cancel
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Box>
  );
}
