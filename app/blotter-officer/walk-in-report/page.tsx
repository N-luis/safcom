'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField,
  Select, MenuItem, FormControl, InputLabel, Stepper, Step, StepLabel,
  Chip, Divider, IconButton, Paper, Radio, RadioGroup,
  FormControlLabel, FormLabel, LinearProgress,
} from '@mui/material';
import {
  RecordVoiceOver, Person, Assignment, Gavel, CheckCircle,
  ArrowForward, ArrowBack, Refresh, LocationOn, Phone, Print, AutoAwesome, Cake,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { mutate } from 'swr';
import toast from 'react-hot-toast';
import { GENDER_OPTIONS } from '@/lib/safecommConfig';
import StreetSelect from '@/components/forms/StreetSelect';
import OtherTypeField, { isOtherType, withOtherDetail } from '@/components/forms/OtherTypeField';
import { ageOn, birthDateBounds } from '@/lib/age';

const INCIDENT_TYPES = ['Theft & Robbery', 'Public Nuisance', 'Domestic Dispute', 'Assault', 'Cybercrime', 'Vandalism', 'Drug-Related', 'Trespassing', 'Other'];
const GENDERS = GENDER_OPTIONS;

// Philippine mobile numbers are 11 digits and always start 09.
const PH_MOBILE = /^09\d{9}$/;

/**
 * Strips everything but digits and caps the field at 11. A pasted +63 number
 * is converted to its 09 form first — otherwise truncating would silently drop
 * the last digit and leave the officer with a number that looks complete.
 */
function normalizePhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('63')) d = `0${d.slice(2)}`;
  return d.slice(0, 11);
}

const STEPS = ['Reporter Info', 'Incident Details', 'Classification', 'Review & Submit'];

interface FormData {
  reporterName: string; contactNumber: string; address: string; birthDate: string; gender: string;
  incidentType: string; otherType: string; incidentDate: string; incidentTime: string; barangay: string;
  description: string; witnesses: string;
  notes: string;
}

interface AiRisk { level: string; score: number; recommendation: string; confidence: number }

const EMPTY: FormData = {
  reporterName: '', contactNumber: '', address: '', birthDate: '', gender: 'Male',
  incidentType: 'Theft & Robbery', otherType: '', incidentDate: new Date().toISOString().split('T')[0],
  incidentTime: new Date().toTimeString().slice(0, 5), barangay: '',
  description: '', witnesses: '',
  notes: '',
};

const RISK_COLOR: Record<string, string> = { Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e' };

function StepReporterInfo({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const set = (k: keyof FormData, v: string) => setForm({ ...form, [k]: v });

  // Only flag a bad number once the officer has started typing, so the field
  // isn't red before they touch it.
  const contactDigits = form.contactNumber.length;
  const contactValid = PH_MOBILE.test(form.contactNumber);
  const contactError = contactDigits > 0 && !contactValid;
  const contactHelper = contactError
    ? (form.contactNumber.startsWith('09')
        ? `Must be exactly 11 digits — ${contactDigits}/11 entered`
        : 'Philippine mobile numbers start with 09')
    : `${contactDigits}/11 digits`;

  // Computed once per mount: reading the clock while rendering would give a
  // different answer on every re-render.
  const [dateBounds] = useState(() => birthDateBounds());
  const age = ageOn(form.birthDate);
  const birthDateError = Boolean(form.birthDate) && age === null;
  const birthHelper = birthDateError
    ? 'That date has not happened yet'
    : age !== null
      ? `Age ${age}`
      : 'Pick a date to show the age';

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12 }}>
        <TextField fullWidth label="Full Name *" size="small" value={form.reporterName} onChange={e => set('reporterName', e.target.value)} placeholder="Juan Dela Cruz" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField fullWidth label="Contact Number *" size="small"
          value={form.contactNumber}
          onChange={e => set('contactNumber', normalizePhone(e.target.value))}
          error={contactError}
          helperText={contactHelper}
          placeholder="09171234567"
          slotProps={{
            htmlInput: { maxLength: 11, inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'tel-national' },
            input: { startAdornment: <Phone sx={{ fontSize: 16, color: '#94a3b8', mr: 0.5 }} /> },
          }}
          sx={{
            '& .MuiOutlinedInput-root': { borderRadius: 2 },
            ...(contactValid && { '& .MuiFormHelperText-root': { color: '#16a34a', fontWeight: 600 } }),
          }} />
      </Grid>
      <Grid size={{ xs: 12, sm: 3 }}>
        <TextField
          fullWidth label="Date of Birth" size="small" type="date"
          value={form.birthDate}
          onChange={e => set('birthDate', e.target.value)}
          error={birthDateError}
          helperText={birthHelper}
          slotProps={{
            inputLabel: { shrink: true },
            // A date picker cannot offer a birthday in the future, and a year
            // typed as 1089 instead of 1989 is caught here rather than on submit.
            htmlInput: { max: dateBounds.max, min: dateBounds.min },
            input: { startAdornment: <Cake sx={{ fontSize: 16, color: '#94a3b8', mr: 0.75 }} /> },
          }}
          sx={{
            '& .MuiOutlinedInput-root': { borderRadius: 2 },
            ...(age !== null && { '& .MuiFormHelperText-root': { color: '#16a34a', fontWeight: 700 } }),
          }} />
      </Grid>
      <Grid size={{ xs: 12, sm: 3 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Gender</InputLabel>
          <Select value={form.gender} label="Gender" onChange={e => set('gender', e.target.value)} sx={{ borderRadius: 2 }}>
            {GENDERS.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
          </Select>
        </FormControl>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField fullWidth label="Address *" size="small" value={form.address} onChange={e => set('address', e.target.value)} placeholder="House No., Street, City" slotProps={{ input: { startAdornment: <LocationOn sx={{ fontSize: 16, color: '#94a3b8', mr: 0.5 }} /> } }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
    </Grid>
  );
}

function StepIncidentDetails({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const set = (k: keyof FormData, v: string) => setForm({ ...form, [k]: v });

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Incident Type *</InputLabel>
          <Select value={form.incidentType} label="Incident Type *" onChange={e => set('incidentType', e.target.value)} sx={{ borderRadius: 2 }}>
            {INCIDENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
      </Grid>
      {/* Picking "Other" asks what the incident actually is */}
      {isOtherType(form.incidentType) && (
        <Grid size={{ xs: 12 }}>
          <OtherTypeField
            size="small"
            label="Please specify the incident type *"
            value={form.otherType}
            onChange={v => set('otherType', v)}
            helperText="Describe the kind of incident in a few words - e.g. Lost property, Animal complaint"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
        </Grid>
      )}
      <Grid size={{ xs: 12, sm: 6 }}>
        {/* `barangay` is the Case column the Street field reads from. */}
        <StreetSelect value={form.barangay} onChange={v => set('barangay', v)} required />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField fullWidth label="Date of Incident *" size="small" type="date" value={form.incidentDate} onChange={e => set('incidentDate', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField fullWidth label="Time of Incident" size="small" type="time" value={form.incidentTime} onChange={e => set('incidentTime', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField fullWidth label="Description *" multiline rows={4} size="small" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the incident in detail — what happened, where, who was involved, and any injuries or property damage." sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField fullWidth label="Witnesses (optional)" multiline rows={2} size="small" value={form.witnesses} onChange={e => set('witnesses', e.target.value)} placeholder="Names and contact details of any witnesses present" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
    </Grid>
  );
}

function StepClassification({ form, setForm }: { form: FormData; setForm: (f: FormData) => void }) {
  const set = (k: keyof FormData, v: string) => setForm({ ...form, [k]: v });
  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12 }}>
        <FormLabel sx={{ fontSize: '0.94rem', fontWeight: 600, color: '#0c1e46', mb: 1, display: 'block' }}>Risk Classification</FormLabel>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, border: '1px dashed #c7d2fe', borderRadius: 2.5, bgcolor: '#eef2ff' }}>
          <AutoAwesome sx={{ color: '#4f46e5', fontSize: 20, mt: 0.25 }} />
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46', mb: 0.5 }}>AI Risk Assessment</Typography>
            <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.6 }}>
              Officers no longer assign the risk level manually. The instant this report is filed, SafComm AI analyzes the incident type, the reporter&apos;s case history, and location hotspot density, then automatically flags it as <Box component="span" sx={{ fontWeight: 700, color: '#4f46e5' }}>Low, Medium, High, or Critical</Box>.
            </Typography>
          </Box>
        </Box>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField fullWidth label="Officer Notes (optional)" multiline rows={3} size="small" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes for case handling, follow-up actions, or additional context…" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
      </Grid>
    </Grid>
  );
}

function StepReview({ form, caseNumber }: { form: FormData; caseNumber: string }) {
  const rows = [
    { label: 'Reporter', value: form.reporterName },
    { label: 'Contact', value: form.contactNumber },
    { label: 'Age / Gender', value: `${ageOn(form.birthDate) ?? '—'} / ${form.gender}` },
    { label: 'Address', value: form.address },
    { label: 'Incident Type', value: isOtherType(form.incidentType) && form.otherType.trim()
        ? `Other - ${form.otherType.trim()}` : form.incidentType },
    { label: 'Date & Time', value: `${form.incidentDate} at ${form.incidentTime}` },
    { label: 'Street', value: form.barangay },
  ];
  return (
    <Box>
      <Box sx={{ p: 1.5, bgcolor: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CheckCircle sx={{ color: '#22c55e', fontSize: 18 }} />
        <Typography sx={{ fontSize: '0.9rem', color: '#15803d', fontWeight: 500 }}>
          Ready to submit — Case number will be <strong>{caseNumber}</strong>
        </Typography>
      </Box>
      <Box sx={{ p: 1.5, bgcolor: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesome sx={{ color: '#4f46e5', fontSize: 16 }} />
        <Typography sx={{ fontSize: '0.86rem', color: '#3730a3' }}>
          Risk level will be automatically assessed by SafComm AI the moment this report is submitted.
        </Typography>
      </Box>
      <Grid container spacing={1.5}>
        {rows.map(({ label, value }) => (
          <Grid size={{ xs: 6 }} key={label}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: '#f1f5f9' }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.2 }}>{label}</Typography>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 500, color: '#0c1e46' }}>
                {value || '—'}
              </Typography>
            </Paper>
          </Grid>
        ))}
        {form.description && (
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: '#f1f5f9' }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.2 }}>Description</Typography>
              <Typography sx={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.6 }}>{form.description}</Typography>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}

export default function WalkInReportPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submittedCase, setSubmittedCase] = useState('');
  const [aiRisk, setAiRisk] = useState<AiRisk | null>(null);

  const caseNumber = `BLT-${Date.now().toString().slice(-6)}`;

  const validate = (): boolean => {
    if (step === 0) {
      if (!form.reporterName.trim()) { toast.error('Reporter name is required'); return false; }
      if (!form.contactNumber.trim()) { toast.error('Contact number is required'); return false; }
      if (!PH_MOBILE.test(form.contactNumber)) {
        toast.error('Enter a valid 11-digit mobile number starting with 09 (e.g. 09171234567)');
        return false;
      }
      if (form.birthDate && ageOn(form.birthDate) === null) {
        toast.error('The date of birth cannot be in the future');
        return false;
      }
      if (!form.address.trim()) { toast.error('Address is required'); return false; }
    }
    if (step === 1) {
      if (!form.barangay.trim()) { toast.error('Select the street where the incident happened'); return false; }
      if (isOtherType(form.incidentType) && form.otherType.trim().length < 3) {
        toast.error('Tell us what kind of incident this is'); return false;
      }
      if (!form.description.trim()) { toast.error('Description is required'); return false; }
    }
    return true;
  };

  const next = () => { if (validate()) setStep(s => Math.min(s + 1, 3)); };
  const back = () => setStep(s => Math.max(s - 1, 0));

  const submit = async () => {
    if (!validate()) return;
    // validate() is step-scoped; re-check the number here so an edit made after
    // stepping back can never be filed.
    if (!PH_MOBILE.test(form.contactNumber)) {
      toast.error('Enter a valid 11-digit mobile number starting with 09 (e.g. 09171234567)');
      setStep(0);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseNumber,
          residentName: form.reporterName,
          caseType: form.incidentType,
          status: 'Open',
          barangay: form.barangay,
          description: withOtherDetail(
            `[Walk-in Report ${form.incidentDate} ${form.incidentTime}]\n\n${form.description}${form.witnesses ? `\n\nWitnesses: ${form.witnesses}` : ''}`,
            form.incidentType,
            form.otherType,
          ),
          notes: form.notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setSubmittedCase(caseNumber);
      setAiRisk(json.data?.aiRiskAssessment ?? null);
      setDone(true);
      mutate(key => typeof key === 'string' && key.includes('/api/cases'));
      toast.success('Walk-in case filed successfully!');
    } catch { toast.error('Failed to submit report'); }
    finally { setSubmitting(false); }
  };

  const reset = () => { setForm(EMPTY); setStep(0); setDone(false); setSubmittedCase(''); setAiRisk(null); };

  if (done) {
    return (
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', mb: 3, letterSpacing: '-0.02em' }}>Walk-in Report</Typography>
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 6, px: 4 }}>
              <Box sx={{ width: 72, height: 72, borderRadius: '50%', bgcolor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                <CheckCircle sx={{ fontSize: 40, color: '#22c55e' }} />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', mb: 1 }}>Case Filed Successfully</Typography>
              <Typography sx={{ color: 'text.secondary', mb: 2 }}>
                The walk-in blotter case has been recorded and assigned.
              </Typography>
              <Chip
                label={`Case Number: ${submittedCase}`}
                sx={{ bgcolor: '#dbeafe', color: '#1d4ed8', fontWeight: 700, fontSize: '0.94rem', px: 1, py: 0.5, height: 32, mb: 2 }}
              />
              {aiRisk && (
                <Box sx={{ maxWidth: 380, mx: 'auto', mb: 3, p: 2, borderRadius: 2.5, textAlign: 'left', bgcolor: `${RISK_COLOR[aiRisk.level]}0c`, border: `1px solid ${RISK_COLOR[aiRisk.level]}35` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <AutoAwesome sx={{ fontSize: 16, color: RISK_COLOR[aiRisk.level] }} />
                    <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em' }}>AI-Flagged Risk Level</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Chip label={`${aiRisk.level} Risk`} size="small" sx={{ bgcolor: RISK_COLOR[aiRisk.level], color: 'white', fontWeight: 700 }} />
                    <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Score {aiRisk.score}/100 · {aiRisk.confidence}% confidence</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.55 }}>{aiRisk.recommendation}</Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" startIcon={<Print />} sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569' }}>
                  Print Blotter Entry
                </Button>
                <Button variant="contained" startIcon={<Refresh />} onClick={reset} sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
                  File Another Report
                </Button>
              </Box>
            </CardContent>
          </Card>
        </motion.div>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>Walk-in Report</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>Record a walk-in complainant and file a blotter entry</Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Stepper sidebar */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Card sx={{ position: { md: 'sticky' }, top: 24 }}>
            <CardContent sx={{ p: 2 }}>
              <Stepper orientation="vertical" activeStep={step} nonLinear sx={{ '& .MuiStepLabel-label': { fontSize: '0.9rem' } }}>
                {STEPS.map((label, i) => (
                  <Step key={label} completed={i < step}>
                    <StepLabel
                      onClick={() => i < step && setStep(i)}
                      sx={{ cursor: i < step ? 'pointer' : 'default', '& .MuiStepLabel-label': { fontWeight: i === step ? 700 : 400, color: i === step ? '#0c1e46' : undefined } }}
                    >
                      {label}
                    </StepLabel>
                  </Step>
                ))}
              </Stepper>
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ px: 0.5 }}>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 0.5 }}>Progress</Typography>
                <LinearProgress
                  variant="determinate"
                  value={((step) / (STEPS.length - 1)) * 100}
                  sx={{ height: 5, borderRadius: 5, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: '#0c1e46', borderRadius: 5 } }}
                />
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mt: 0.5 }}>
                  Step {step + 1} of {STEPS.length}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Form content */}
        <Grid size={{ xs: 12, md: 9 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                {[<Person />, <Assignment />, <Gavel />, <CheckCircle />][step]}
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: '#0c1e46' }}>{STEPS[step]}</Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary' }}>
                    {['Enter the reporter\'s personal details', 'Describe what happened in detail', 'Classify the incident risk level', 'Review all information before submitting'][step]}
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ mb: 3 }} />

              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.18 }}
                >
                  {step === 0 && <StepReporterInfo form={form} setForm={setForm} />}
                  {step === 1 && <StepIncidentDetails form={form} setForm={setForm} />}
                  {step === 2 && <StepClassification form={form} setForm={setForm} />}
                  {step === 3 && <StepReview form={form} caseNumber={caseNumber} />}
                </motion.div>
              </AnimatePresence>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, pt: 2.5, borderTop: '1px solid #f1f5f9' }}>
                <Button
                  variant="outlined" startIcon={<ArrowBack />}
                  onClick={back} disabled={step === 0}
                  sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#475569', '&:hover': { borderColor: '#0c1e46', color: '#0c1e46' } }}
                >
                  Back
                </Button>
                {step < 3 ? (
                  <Button variant="contained" endIcon={<ArrowForward />} onClick={next} sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
                    Continue
                  </Button>
                ) : (
                  <Button
                    variant="contained" startIcon={<RecordVoiceOver />}
                    onClick={submit} disabled={submitting}
                    sx={{ borderRadius: 2, bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, px: 3 }}
                  >
                    {submitting ? 'Submitting…' : 'Submit Blotter Entry'}
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
