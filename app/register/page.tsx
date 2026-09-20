'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Button, Typography, Grid, TextField, MenuItem, Select,
  FormControl, InputLabel, FormHelperText, InputAdornment, IconButton,
  CircularProgress, Alert, LinearProgress, Chip, Divider,
} from '@mui/material';
import {
  Shield, CheckCircle, Visibility, VisibilityOff,
  Close, Person, Phone, Home, Email, Lock, Badge, ArrowForward,
  VerifiedUser, Security, ArrowBack, LocationOn,
  Warning, InfoOutlined,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// ─── Constants ────────────────────────────────────────────────────────────────
const BARANGAYS = ['Binan 2nd'];

const STEPS = [
  { num: 1, label: 'Personal Info', desc: 'Name, age, and barangay' },
  { num: 2, label: 'Contact Details', desc: 'Phone, email, address' },
  { num: 3, label: 'Security', desc: 'Create your password' },
];

// ─── Validation ───────────────────────────────────────────────────────────────
const schema = z.object({
  firstName: z.string().min(2, 'At least 2 characters required'),
  lastName: z.string().min(2, 'At least 2 characters required'),
  age: z.number().int().min(1, 'Too low').max(120, 'Invalid age'),
  gender: z.enum(['Male', 'Female', 'Other'], { error: 'Select a gender' }),
  barangay: z.string().min(1, 'Select your barangay'),
  contactNumber: z.string().min(10, 'At least 10 digits').regex(/^[0-9+\-\s()]+$/, 'Invalid phone'),
  email: z.string().email('Enter a valid email'),
  address: z.string().min(10, 'Provide your full address (min 10 characters)'),
  password: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Include one uppercase letter')
    .regex(/[0-9]/, 'Include one number'),
  confirmPassword: z.string(),
  agreeTerms: z.boolean().refine(v => v === true, { message: 'You must agree to continue' }),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

const STEP_FIELDS: (keyof FormData)[][] = [
  ['firstName', 'lastName', 'age', 'gender', 'barangay'],
  ['contactNumber', 'email', 'address'],
  ['password', 'confirmPassword', 'agreeTerms'],
];

// ─── Password strength ────────────────────────────────────────────────────────
function getStrength(pw: string) {
  if (!pw) return { score: 0, label: '', color: '#e5e7eb' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { score: 20, label: 'Weak', color: '#ef4444' };
  if (s === 2) return { score: 40, label: 'Fair', color: '#f59e0b' };
  if (s === 3) return { score: 65, label: 'Good', color: '#3b82f6' };
  return { score: s >= 5 ? 100 : 85, label: s >= 5 ? 'Very Strong' : 'Strong', color: '#14b8a6' };
}

// ─── Reusable teal field sx ───────────────────────────────────────────────────
const tf = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2.5,
    '& fieldset': { borderColor: '#d1d5db' },
    '&:hover fieldset': { borderColor: '#14b8a6' },
    '&.Mui-focused fieldset': { borderColor: '#14b8a6', borderWidth: 2 },
    '&.Mui-error fieldset': { borderColor: '#ef4444' },
  },
  '& .MuiInputLabel-root.Mui-focused': { color: '#14b8a6' },
};

// ─── Left panel content per step ─────────────────────────────────────────────
const LEFT_CONTENT = [
  {
    title: 'Join SafCom',
    subtitle: 'Start by telling us about yourself. This information helps your barangay verify your identity.',
    features: [
      { icon: VerifiedUser, text: 'Your identity will be verified by barangay officials', color: '#14b8a6' },
      { icon: Shield, text: 'Resident accounts are separate from officer accounts', color: '#3b82f6' },
      { icon: Security, text: 'VAWC & Blotter Officers use a different login', color: '#8b5cf6' },
    ],
  },
  {
    title: 'Contact Info',
    subtitle: 'We use your contact details to send you case updates and important community alerts.',
    features: [
      { icon: Phone, text: 'Receive SMS alerts for your barangay', color: '#14b8a6' },
      { icon: Email, text: 'Case status updates sent to your email', color: '#3b82f6' },
      { icon: LocationOn, text: 'Address links you to local barangay services', color: '#8b5cf6' },
    ],
  },
  {
    title: 'Almost Done',
    subtitle: 'Create a strong password to finish setting up your account.',
    features: [
      { icon: Lock, text: 'Your password is hashed and never stored in plain text', color: '#14b8a6' },
      { icon: VerifiedUser, text: 'Account goes live once reviewed by an officer', color: '#8b5cf6' },
    ],
  },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0-indexed
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState<{ residentNumber: string; name: string } | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const emailDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, watch, control, trigger, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', age: undefined as unknown as number, gender: '' as 'Male' | 'Female' | 'Other', barangay: '', contactNumber: '', email: '', address: '', password: '', confirmPassword: '', agreeTerms: false },
    mode: 'onChange',
  });

  const pwValue = watch('password', '');
  const emailValue = watch('email', '');
  const agreeValue = watch('agreeTerms');
  const strength = getStrength(pwValue);

  // Real-time email check
  useEffect(() => {
    if (!emailValue || !emailValue.includes('@')) { setEmailStatus('idle'); return; }
    setEmailStatus('checking');
    if (emailDebounce.current) clearTimeout(emailDebounce.current);
    emailDebounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/auth/check-email?email=${encodeURIComponent(emailValue)}`);
        const j = await r.json();
        setEmailStatus(j.data?.available ? 'available' : 'taken');
      } catch {
        setEmailStatus('idle');
      }
    }, 600);
    return () => { if (emailDebounce.current) clearTimeout(emailDebounce.current); };
  }, [emailValue]);

  const nextStep = async () => {
    const valid = await trigger(STEP_FIELDS[step]);
    if (!valid) return;
    if (step === 1 && emailStatus === 'taken') return;
    setStep(s => s + 1);
  };

  const prevStep = () => setStep(s => s - 1);

  const onSubmit = async (data: FormData) => {
    setServerError('');
    if (emailStatus === 'taken') return;

    try {
      const res = await fetch('/api/residents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          age: data.age,
          gender: data.gender,
          barangay: data.barangay,
          contactNumber: data.contactNumber,
          address: data.address,
          email: data.email,
          password: data.password,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setServerError(json.error || 'Registration failed'); return; }
      setDone({ residentNumber: json.data.residentNumber, name: `${data.firstName} ${data.lastName}` });
      toast.success('Account created! Pending verification.');
    } catch {
      setServerError('Network error. Please try again.');
    }
  };

  const content = LEFT_CONTENT[step];

  // ── Success screen ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'linear-gradient(135deg, #071739 0%, #0c2461 100%)', background: 'linear-gradient(135deg, #071739 0%, #0c2461 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <motion.div initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, type: 'spring', damping: 20 }}>
          <Box sx={{ bgcolor: 'white', borderRadius: 4, p: { xs: 4, sm: 5 }, textAlign: 'center', maxWidth: 500, boxShadow: '0 30px 70px rgba(0,0,0,0.4)' }}>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: 'spring', damping: 14 }}>
              <Box sx={{ width: 80, height: 80, borderRadius: '50%', bgcolor: '#f0fdf4', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3 }}>
                <CheckCircle sx={{ color: '#22c55e', fontSize: 44 }} />
              </Box>
            </motion.div>
            <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', color: '#071739', mb: 1 }}>
              Registration Submitted!
            </Typography>
            <Typography sx={{ color: '#6b7280', lineHeight: 1.75, mb: 1.5, fontSize: '0.9rem' }}>
              Welcome, <Box component="span" sx={{ fontWeight: 700, color: '#0c1e46' }}>{done.name}</Box>! Your account has been submitted for review.
            </Typography>
            <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2.5, p: 2, mb: 2.5 }}>
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mb: 0.5, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Resident Number</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '1.3rem', color: '#14b8a6', letterSpacing: '0.06em' }}>{done.residentNumber}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {[
                { icon: CheckCircle, text: 'Your registration is under review', color: '#22c55e' },
                { icon: Warning, text: 'Account will be activated within 24 hours', color: '#f59e0b' },
                { icon: InfoOutlined, text: 'You will be notified once approved', color: '#3b82f6' },
              ].map(item => (
                <Box key={item.text} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: `${item.color}0d`, borderRadius: 2, border: `1px solid ${item.color}22` }}>
                  <item.icon sx={{ fontSize: 18, color: item.color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.82rem', color: '#374151' }}>{item.text}</Typography>
                </Box>
              ))}
            </Box>
            <Button fullWidth variant="contained" onClick={() => router.push('/resident-login')}
              endIcon={<ArrowForward />}
              sx={{ bgcolor: '#14b8a6', fontWeight: 700, py: 1.5, borderRadius: 2.5, fontSize: '0.95rem', '&:hover': { bgcolor: '#0d9488' }, mb: 1.5 }}>
              Go to Resident Login
            </Button>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Use your email and password to sign in once approved.
            </Typography>
          </Box>
        </motion.div>
      </Box>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────────────
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f5f7' }}>

      {/* Navbar */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 100, bgcolor: 'white', borderBottom: '1px solid #e5e7eb', px: { xs: 2, md: 4 }, py: 1.5 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }} onClick={() => router.push('/resident-login')}>
            <Box sx={{ width: 34, height: 34, borderRadius: 1.5, background: 'linear-gradient(135deg, #0a7c6b, #14b8a6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield sx={{ color: 'white', fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, color: '#071739', fontSize: '1rem' }}>SafCom</Typography>
            <Chip label="Resident Portal" size="small" sx={{ bgcolor: 'rgba(20,184,166,0.1)', color: '#0a7c6b', fontWeight: 700, fontSize: '0.7rem', border: '1px solid rgba(20,184,166,0.25)' }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button onClick={() => router.push('/resident-login')} startIcon={<ArrowBack sx={{ fontSize: 15 }} />}
              sx={{ color: '#6b7280', fontWeight: 500, fontSize: '0.82rem', '&:hover': { color: '#111827', bgcolor: 'rgba(0,0,0,0.04)' } }}>
              Back to Login
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Officer notice banner */}
      <Box sx={{ bgcolor: '#fffbeb', borderBottom: '1px solid #fde68a', px: { xs: 2, md: 4 }, py: 1.25 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Warning sx={{ fontSize: 16, color: '#f59e0b', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.8rem', color: '#92400e' }}>
            <Box component="span" sx={{ fontWeight: 700 }}>Residents only.</Box>{' '}
            VAWC Officers and Blotter Officers do not register here — contact your System Administrator for an account.
          </Typography>
        </Box>
      </Box>

      {/* Main */}
      <Box sx={{ maxWidth: 1140, mx: 'auto', px: { xs: 1.5, md: 3 }, py: { xs: 3, md: 5 } }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Box sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.12)', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: { md: 680 } }}>

            {/* Left panel */}
            <Box sx={{
              width: { xs: '100%', md: 340 }, flexShrink: 0,
              background: 'linear-gradient(160deg, #071739 0%, #0b1e46 60%, #0f2a5c 100%)',
              p: { xs: 3.5, md: 5 }, display: 'flex', flexDirection: 'column',
              position: 'relative', overflow: 'hidden',
            }}>
              {/* BG blobs */}
              <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {[0, 1].map(i => (
                  <Box key={i} component={motion.div}
                    animate={{ scale: [1, 1.15, 1], opacity: [0.04, 0.09, 0.04] }}
                    transition={{ duration: 8 + i * 3, repeat: Infinity, delay: i * 2.5 }}
                    sx={{
                      position: 'absolute', borderRadius: '50%',
                      width: 260 + i * 80, height: 260 + i * 80,
                      background: i === 0 ? 'radial-gradient(circle, rgba(20,184,166,1) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(59,130,246,1) 0%, transparent 70%)',
                      top: i === 0 ? '-15%' : '55%', left: i === 0 ? '-10%' : '25%',
                    }} />
                ))}
                <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)', backgroundSize: '36px 36px' }} />
              </Box>

              <Box sx={{ position: 'relative', zIndex: 1, flex: 1 }}>
                {/* Logo */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 5 }}>
                  <Box sx={{ width: 38, height: 38, borderRadius: 2, background: 'linear-gradient(135deg, #0a7c6b, #14b8a6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(20,184,166,0.4)' }}>
                    <Shield sx={{ color: 'white', fontSize: 20 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, color: 'white', fontSize: '0.95rem', lineHeight: 1.1 }}>SafCom</Typography>
                    <Typography sx={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.4)', letterSpacing: 2, textTransform: 'uppercase' }}>Community Portal</Typography>
                  </Box>
                </Box>

                {/* Step guide */}
                <Box sx={{ mb: 4 }}>
                  {STEPS.map((s, i) => (
                    <Box key={s.num} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75, mb: 1.5 }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <Box sx={{
                          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: i < step ? '#14b8a6' : i === step ? 'rgba(20,184,166,0.25)' : 'rgba(255,255,255,0.08)',
                          border: i === step ? '2px solid #14b8a6' : i < step ? '2px solid #14b8a6' : '2px solid rgba(255,255,255,0.12)',
                          transition: 'all 0.3s',
                        }}>
                          {i < step
                            ? <CheckCircle sx={{ fontSize: 16, color: 'white' }} />
                            : <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: i === step ? '#14b8a6' : 'rgba(255,255,255,0.3)' }}>{s.num}</Typography>
                          }
                        </Box>
                        {i < STEPS.length - 1 && (
                          <Box sx={{ width: 2, height: 20, bgcolor: i < step ? '#14b8a6' : 'rgba(255,255,255,0.1)', mt: 0.5, borderRadius: 1, transition: 'background 0.3s' }} />
                        )}
                      </Box>
                      <Box sx={{ pt: '2px' }}>
                        <Typography sx={{ fontWeight: i === step ? 700 : 500, color: i === step ? 'white' : i < step ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)', fontSize: '0.82rem', transition: 'all 0.3s' }}>{s.label}</Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', mt: 0.1 }}>{s.desc}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>

                {/* Dynamic content */}
                <AnimatePresence mode="wait">
                  <motion.div key={step}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Typography sx={{ fontWeight: 800, color: 'white', fontSize: '1.15rem', mb: 1, lineHeight: 1.3 }}>{content.title}</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.65, mb: 3 }}>{content.subtitle}</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      {content.features.map(f => (
                        <Box key={f.text} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                          <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: `${f.color}22`, border: `1px solid ${f.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px' }}>
                            <f.icon sx={{ fontSize: 16, color: f.color }} />
                          </Box>
                          <Typography sx={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.55, pt: '4px' }}>{f.text}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </motion.div>
                </AnimatePresence>
              </Box>

              {/* Bottom DPA note */}
              <Box sx={{ position: 'relative', zIndex: 1, mt: 4, p: 2, borderRadius: 2, bgcolor: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.18)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Lock sx={{ color: '#14b8a6', fontSize: 14 }} />
                  <Typography sx={{ fontSize: '0.71rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    Protected under the{' '}
                    <Box component="span" sx={{ color: '#14b8a6', fontWeight: 600 }}>Data Privacy Act</Box>
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Right form panel */}
            <Box sx={{ flex: 1, bgcolor: 'white', p: { xs: 3, md: 5 }, display: 'flex', flexDirection: 'column' }}>
              {/* Step progress */}
              <Box sx={{ mb: 3.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography sx={{ fontWeight: 800, color: '#111827', fontSize: '1.2rem' }}>
                    {STEPS[step].label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: '#9ca3af' }}>Step {step + 1} of {STEPS.length}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={((step + 1) / STEPS.length) * 100}
                  sx={{ height: 4, borderRadius: 2, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #0a7c6b, #14b8a6)', borderRadius: 2 } }}
                />
              </Box>

              {serverError && (
                <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setServerError('')}>{serverError}</Alert>
              )}

              <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <AnimatePresence mode="wait">

                  {/* ── STEP 1: Personal Info ── */}
                  {step === 0 && (
                    <motion.div key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                      <Grid container spacing={2.5}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="First Name *" fullWidth {...register('firstName')}
                            error={!!errors.firstName} helperText={errors.firstName?.message}
                            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Person sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                            sx={tf} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Last Name *" fullWidth {...register('lastName')}
                            error={!!errors.lastName} helperText={errors.lastName?.message}
                            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Badge sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                            sx={tf} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Age *" type="number" fullWidth
                            {...register('age', { valueAsNumber: true })}
                            error={!!errors.age} helperText={errors.age?.message}
                            sx={tf} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <Controller name="gender" control={control} render={({ field }) => (
                            <FormControl fullWidth error={!!errors.gender} sx={tf}>
                              <InputLabel>Gender *</InputLabel>
                              <Select {...field} value={field.value ?? ''} label="Gender *" sx={{ borderRadius: 2.5 }}>
                                {['Male', 'Female', 'Other'].map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                              </Select>
                              {errors.gender && <FormHelperText>{errors.gender.message}</FormHelperText>}
                            </FormControl>
                          )} />
                        </Grid>
                        <Grid size={12}>
                          <Controller name="barangay" control={control} render={({ field }) => (
                            <FormControl fullWidth error={!!errors.barangay} sx={tf}>
                              <InputLabel>Barangay *</InputLabel>
                              <Select {...field} value={field.value ?? ''} label="Barangay *" sx={{ borderRadius: 2.5 }}>
                                {BARANGAYS.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
                              </Select>
                              {errors.barangay && <FormHelperText>{errors.barangay.message}</FormHelperText>}
                            </FormControl>
                          )} />
                        </Grid>
                      </Grid>
                    </motion.div>
                  )}

                  {/* ── STEP 2: Contact & Address ── */}
                  {step === 1 && (
                    <motion.div key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                      <Grid container spacing={2.5}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Contact Number *" fullWidth {...register('contactNumber')}
                            error={!!errors.contactNumber} helperText={errors.contactNumber?.message}
                            placeholder="09XX XXX XXXX"
                            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Phone sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                            sx={tf} />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Email Address *" type="email" fullWidth {...register('email')}
                            error={!!errors.email || emailStatus === 'taken'}
                            helperText={
                              errors.email?.message
                              ?? (emailStatus === 'taken' ? 'This email is already registered' : undefined)
                            }
                            slotProps={{
                              input: {
                                startAdornment: <InputAdornment position="start"><Email sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment>,
                                endAdornment: emailStatus !== 'idle' && (
                                  <InputAdornment position="end">
                                    {emailStatus === 'checking' && <CircularProgress size={16} sx={{ color: '#9ca3af' }} />}
                                    {emailStatus === 'available' && <CheckCircle sx={{ fontSize: 18, color: '#22c55e' }} />}
                                    {emailStatus === 'taken' && <Close sx={{ fontSize: 18, color: '#ef4444' }} />}
                                  </InputAdornment>
                                ),
                              },
                            }}
                            sx={{
                              ...tf,
                              ...(emailStatus === 'available' && {
                                '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#22c55e' },
                                '& .MuiOutlinedInput-root fieldset': { borderColor: '#22c55e' },
                              }),
                            }}
                          />
                          {emailStatus === 'available' && (
                            <Typography sx={{ fontSize: '0.72rem', color: '#22c55e', mt: 0.5, ml: 0.5 }}>Email is available</Typography>
                          )}
                        </Grid>
                        <Grid size={12}>
                          <TextField label="Residential Address *" fullWidth {...register('address')}
                            error={!!errors.address} helperText={errors.address?.message}
                            placeholder="House No., Street, Barangay, City"
                            multiline rows={2}
                            slotProps={{ input: { startAdornment: <InputAdornment position="start" sx={{ mt: '-24px' }}><Home sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                            sx={tf} />
                        </Grid>
                      </Grid>
                    </motion.div>
                  )}

                  {/* ── STEP 3: Security ── */}
                  {step === 2 && (
                    <motion.div key="step3" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                      <Grid container spacing={2.5}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Password *" type={showPw ? 'text' : 'password'} fullWidth {...register('password')}
                            error={!!errors.password} helperText={errors.password?.message}
                            slotProps={{ input: {
                              startAdornment: <InputAdornment position="start"><Lock sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment>,
                              endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowPw(p => !p)} edge="end" size="small">{showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></InputAdornment>,
                            } }}
                            sx={tf} />
                          {pwValue && (
                            <Box sx={{ mt: 1.5 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography sx={{ fontSize: '0.7rem', color: '#6b7280' }}>Strength</Typography>
                                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: strength.color }}>{strength.label}</Typography>
                              </Box>
                              <LinearProgress variant="determinate" value={strength.score}
                                sx={{ height: 4, borderRadius: 2, bgcolor: '#e5e7eb', '& .MuiLinearProgress-bar': { bgcolor: strength.color, borderRadius: 2, transition: 'width 0.4s ease, background-color 0.3s' } }} />
                              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                {[
                                  { rule: '8+ chars', pass: pwValue.length >= 8 },
                                  { rule: 'Uppercase', pass: /[A-Z]/.test(pwValue) },
                                  { rule: 'Number', pass: /[0-9]/.test(pwValue) },
                                  { rule: 'Symbol', pass: /[^A-Za-z0-9]/.test(pwValue) },
                                ].map(r => (
                                  <Chip key={r.rule} label={r.rule} size="small" icon={r.pass ? <CheckCircle sx={{ fontSize: '12px !important', color: '#22c55e !important' }} /> : undefined}
                                    sx={{ fontSize: '0.65rem', height: 20, bgcolor: r.pass ? '#f0fdf4' : '#f8fafc', color: r.pass ? '#15803d' : '#94a3b8', border: `1px solid ${r.pass ? '#bbf7d0' : '#e2e8f0'}` }} />
                                ))}
                              </Box>
                            </Box>
                          )}
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Confirm Password *" type={showConfirm ? 'text' : 'password'} fullWidth {...register('confirmPassword')}
                            error={!!errors.confirmPassword} helperText={errors.confirmPassword?.message}
                            slotProps={{ input: {
                              startAdornment: <InputAdornment position="start"><Lock sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment>,
                              endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowConfirm(p => !p)} edge="end" size="small">{showConfirm ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></InputAdornment>,
                            } }}
                            sx={tf} />
                        </Grid>
                        <Grid size={12}>
                          <Divider sx={{ my: 0.5 }} />
                          <Box
                            onClick={() => setValue('agreeTerms', !agreeValue, { shouldValidate: true })}
                            sx={{
                              display: 'flex', alignItems: 'flex-start', gap: 1.5, mt: 1.5, p: 2,
                              borderRadius: 2, cursor: 'pointer', transition: 'background 0.15s',
                              bgcolor: agreeValue ? 'rgba(20,184,166,0.05)' : '#fafafa',
                              border: `1px solid ${agreeValue ? 'rgba(20,184,166,0.25)' : '#e5e7eb'}`,
                              '&:hover': { bgcolor: 'rgba(20,184,166,0.04)' },
                            }}
                          >
                            <Box sx={{
                              width: 20, height: 20, borderRadius: 1, border: `2px solid ${agreeValue ? '#14b8a6' : '#d1d5db'}`,
                              bgcolor: agreeValue ? '#14b8a6' : 'white',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px', transition: 'all 0.15s',
                            }}>
                              {agreeValue && <CheckCircle sx={{ fontSize: 14, color: 'white' }} />}
                            </Box>
                            <Typography sx={{ fontSize: '0.8rem', color: '#4b5563', lineHeight: 1.6 }}>
                              I agree to the{' '}
                              <Box component="span" sx={{ color: '#0a7c6b', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>Terms of Service</Box>
                              {' '}and{' '}
                              <Box component="span" sx={{ color: '#0a7c6b', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>Privacy Policy</Box>.
                              My data is protected under the Data Privacy Act.
                            </Typography>
                          </Box>
                          {errors.agreeTerms && (
                            <Typography sx={{ color: '#ef4444', fontSize: '0.75rem', mt: 0.75, ml: 0.5 }}>{errors.agreeTerms.message}</Typography>
                          )}
                        </Grid>
                      </Grid>
                    </motion.div>
                  )}

                </AnimatePresence>

                {/* Navigation buttons */}
                <Box sx={{ display: 'flex', gap: 1.5, mt: 'auto', pt: 3.5 }}>
                  {step > 0 && (
                    <Button variant="outlined" onClick={prevStep} startIcon={<ArrowBack sx={{ fontSize: 15 }} />}
                      sx={{ borderColor: '#e2e8f0', color: '#64748b', fontWeight: 600, borderRadius: 2.5, px: 3, '&:hover': { borderColor: '#14b8a6', color: '#0a7c6b' } }}>
                      Back
                    </Button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <Button variant="contained" onClick={nextStep} endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
                      sx={{ flex: 1, py: 1.5, fontWeight: 700, fontSize: '0.95rem', borderRadius: 2.5, background: 'linear-gradient(135deg, #0a7c6b, #14b8a6)', boxShadow: '0 6px 20px rgba(20,184,166,0.3)', '&:hover': { background: 'linear-gradient(135deg, #065f50, #0d9488)' } }}>
                      Continue
                    </Button>
                  ) : (
                    <Button type="submit" variant="contained" disabled={isSubmitting} endIcon={!isSubmitting && <ArrowForward sx={{ fontSize: 16 }} />}
                      sx={{ flex: 1, py: 1.5, fontWeight: 700, fontSize: '0.95rem', borderRadius: 2.5, background: 'linear-gradient(135deg, #0a7c6b, #14b8a6)', boxShadow: '0 6px 20px rgba(20,184,166,0.3)', '&:hover': { background: 'linear-gradient(135deg, #065f50, #0d9488)' }, '&:disabled': { background: '#d1d5db', boxShadow: 'none', color: '#9ca3af' } }}>
                      {isSubmitting ? <CircularProgress size={22} sx={{ color: 'white' }} /> : 'Create Account'}
                    </Button>
                  )}
                </Box>

                {/* Sign in link */}
                <Box sx={{ textAlign: 'center', mt: 2.5 }}>
                  <Typography sx={{ fontSize: '0.83rem', color: '#9ca3af' }}>
                    Already have an account?{' '}
                    <Box component="span" onClick={() => router.push('/resident-login')}
                      sx={{ color: '#0a7c6b', fontWeight: 700, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                      Sign in here
                    </Box>
                  </Typography>
                </Box>
              </Box>
            </Box>

          </Box>
        </motion.div>

        {/* Footer */}
        <Box sx={{ textAlign: 'center', mt: 4, pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2.5, mb: 1 }}>
            {[{ icon: Lock, label: 'SSL Encrypted' }, { icon: Shield, label: 'Data Privacy Act' }, { icon: VerifiedUser, label: 'Verified Portal' }].map(item => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <item.icon sx={{ fontSize: 13, color: '#9ca3af' }} />
                <Typography sx={{ fontSize: '0.68rem', color: '#9ca3af' }}>{item.label}</Typography>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.7rem', color: '#9ca3af' }}>© 2025 SafCom Institutional. All Rights Reserved.</Typography>
        </Box>
      </Box>
    </Box>
  );
}
