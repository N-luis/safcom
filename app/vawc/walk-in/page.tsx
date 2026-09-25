'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Typography, Card, CardContent, Grid, TextField, MenuItem,
  Button, CircularProgress, Alert, Chip, Divider,
} from '@mui/material';
import { CheckCircle, Send, ArrowBack, MonitorHeart, Info, AutoAwesome } from '@mui/icons-material';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import StreetSelect from '@/components/forms/StreetSelect';

const ACCENT = '#7c3aed';

const schema = z.object({
  residentName: z.string().min(2, 'Full name is required'),
  caseType: z.string().min(1, 'Select a case type'),
  barangay: z.string().min(1, 'Select the street'),
  description: z.string().min(20, 'Describe the incident (min 20 characters)'),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface AiRisk { level: string; score: number; recommendation: string; confidence: number }

const RISK_COLOR: Record<string, string> = { Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };
const RISK_BG: Record<string, string> = { Low: '#f0fdf4', Medium: '#fffbeb', High: '#fff7ed', Critical: '#fef2f2' };

export default function VawcWalkInPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState<{ caseNumber: string; name: string; aiRisk: AiRisk | null } | null>(null);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { residentName: '', caseType: '', barangay: '', description: '', notes: '' },
  });

  const descLen = watch('description')?.length ?? 0;

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      const res = await fetch('/api/vawc/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) { setApiError(json.error || 'Submission failed'); return; }
      setSubmitted({ caseNumber: json.data.caseNumber, name: data.residentName, aiRisk: json.data.aiRiskAssessment ?? null });
      toast.success('VAWC case filed successfully!');
    } catch {
      setApiError('Network error. Please try again.');
    }
  };

  if (submitted) {
    const risk = submitted.aiRisk;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
          <Card sx={{ maxWidth: 480, textAlign: 'center', p: 2 }}>
            <CardContent sx={{ p: 4 }}>
              <Box sx={{ width: 72, height: 72, borderRadius: '50%', bgcolor: '#f5f3ff', mx: 'auto', mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${ACCENT}40` }}>
                <CheckCircle sx={{ fontSize: 40, color: ACCENT }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', color: '#0c1e46', mb: 1 }}>Case Filed Successfully</Typography>
              <Typography sx={{ color: '#64748b', fontSize: '0.94rem', mb: 2, lineHeight: 1.6 }}>
                <Box component="span" sx={{ fontWeight: 700, color: '#0c1e46' }}>{submitted.name}</Box>&apos;s case has been registered and assigned to an officer.
              </Typography>
              <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 2, mb: 2 }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mb: 0.5, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>Case Number</Typography>
                <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', color: ACCENT, letterSpacing: '0.06em' }}>#{submitted.caseNumber}</Typography>
              </Box>
              {risk && (
                <Box sx={{ bgcolor: RISK_BG[risk.level] ?? '#f8fafc', border: `1px solid ${RISK_COLOR[risk.level] ?? '#e2e8f0'}30`, borderRadius: 2, p: 2, mb: 3, textAlign: 'left' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <AutoAwesome sx={{ fontSize: 16, color: RISK_COLOR[risk.level] ?? ACCENT }} />
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em' }}>AI Risk Assessment</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Chip label={`${risk.level} Risk`} size="small" sx={{ bgcolor: RISK_COLOR[risk.level], color: 'white', fontWeight: 700 }} />
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Score {risk.score}/100 · {risk.confidence}% confidence</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.55 }}>{risk.recommendation}</Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" onClick={() => router.push('/vawc/cases')}
                  sx={{ borderColor: ACCENT, color: ACCENT, fontWeight: 600 }}>
                  View All Cases
                </Button>
                <Button variant="contained" onClick={() => setSubmitted(null)}
                  sx={{ bgcolor: ACCENT, fontWeight: 600, '&:hover': { bgcolor: '#6d28d9' } }}>
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
    <Box sx={{ maxWidth: 1100 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Button size="small" startIcon={<ArrowBack />} onClick={() => router.push('/vawc')} sx={{ color: '#64748b' }}>
          Back
        </Button>
        <Divider orientation="vertical" flexItem />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
            Walk-in Report
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b' }}>File a VAWC case for an in-person complainant</Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              {apiError && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{apiError}</Alert>}
              <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                <Grid container spacing={2}>
                  <Grid size={12}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1 }}>Subject / Complainant</Typography>
                    <TextField label="Full Name of Subject *" fullWidth {...register('residentName')}
                      error={!!errors.residentName} helperText={errors.residentName?.message}
                      placeholder="Last name, First name, Middle initial" />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller name="caseType" control={control} render={({ field }) => (
                      <TextField {...field} value={field.value ?? ''} select label="Case Type *" fullWidth
                        error={!!errors.caseType} helperText={errors.caseType?.message}>
                        {VAWC_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                      </TextField>
                    )} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller name="barangay" control={control} render={({ field }) => (
                      <StreetSelect
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        required
                        size="medium"
                        error={!!errors.barangay}
                        helperText={errors.barangay?.message}
                      />
                    )} />
                  </Grid>
                </Grid>

                {/* AI risk assessment notice — risk level is no longer set by the officer */}
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, borderRadius: 2, border: '1px dashed #c4b5fd', bgcolor: '#faf5ff' }}>
                  <AutoAwesome sx={{ color: ACCENT, fontSize: 20, mt: 0.25 }} />
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', mb: 0.25 }}>AI Risk Assessment</Typography>
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b', lineHeight: 1.6 }}>
                      Risk level is no longer assigned manually. The moment this case is filed, SafComm AI analyzes the case type, the subject&apos;s incident history, and street/barangay hotspot data, then automatically flags it as <Box component="span" sx={{ fontWeight: 700, color: ACCENT }}>Low, Medium, High, or Critical</Box>.
                    </Typography>
                  </Box>
                </Box>

                <Divider />

                <Box>
                  <TextField
                    label="Incident Description *"
                    placeholder="Describe the incident in detail — include date, time, location, persons involved, and any injuries or threats…"
                    {...register('description')}
                    error={!!errors.description}
                    helperText={errors.description?.message ?? `${descLen}/800 characters`}
                    fullWidth multiline rows={5}
                    slotProps={{ htmlInput: { maxLength: 800 } }}
                  />
                </Box>

                <TextField
                  label="Officer Notes (optional)"
                  placeholder="Initial observations, recommended interventions, shelter referral, legal aid, etc."
                  {...register('notes')}
                  fullWidth multiline rows={3}
                />

                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Button type="submit" variant="contained" size="large" disabled={isSubmitting}
                    startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <Send />}
                    sx={{ flex: 1, bgcolor: ACCENT, fontWeight: 700, '&:hover': { bgcolor: '#6d28d9' }, boxShadow: '0 4px 14px rgba(124,58,237,0.35)' }}>
                    {isSubmitting ? 'Filing…' : 'File VAWC Case'}
                  </Button>
                  <Button variant="outlined" size="large" onClick={() => router.push('/vawc')}
                    sx={{ borderColor: '#e2e8f0', color: '#64748b' }}>
                    Cancel
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Sidebar */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ bgcolor: '#faf5ff', border: '1px solid #ede9fe', mb: 2 }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <MonitorHeart sx={{ fontSize: 18, color: ACCENT }} />
                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>What happens next?</Typography>
              </Box>
              {[
                { num: '01', text: 'Case is logged and assigned a unique VC-number immediately.' },
                { num: '02', text: 'Auto-assigned to the on-duty VAWC officer for review.' },
                { num: '03', text: 'Intervention protocol is triggered based on risk level.' },
                { num: '04', text: 'Subject can be referred to shelter, legal aid, or medical.' },
              ].map(s => (
                <Box key={s.num} sx={{ display: 'flex', gap: 1.25, mb: 1.5 }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'white' }}>{s.num}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#64748b', lineHeight: 1.55 }}>{s.text}</Typography>
                </Box>
              ))}
            </CardContent>
          </Card>

          <Card sx={{ bgcolor: '#fff7ed', border: '1px solid #fed7aa' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Info sx={{ fontSize: 16, color: '#f97316' }} />
                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#7c2d12' }}>Privacy Notice</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.86rem', color: '#9a3412', lineHeight: 1.6 }}>
                Case details are confidential under <Box component="span" sx={{ fontWeight: 700 }}>RA 9262 (VAWC Law)</Box>. Do not disclose subject information to unauthorized persons. Access is logged.
              </Typography>
              <Divider sx={{ my: 1.5, borderColor: '#fed7aa' }} />
              <Typography sx={{ fontSize: '0.82rem', color: '#c2410c', fontWeight: 600 }}>
                Emergency? Call <Box component="span" sx={{ fontSize: '0.94rem', color: '#ef4444' }}>911</Box> or WCPD <Box component="span" sx={{ fontSize: '0.94rem', color: '#ef4444' }}>166</Box>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
