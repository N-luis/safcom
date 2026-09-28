'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box, Button, Typography, Grid, TextField, MenuItem, Select,
  FormControl, InputLabel, FormHelperText, InputAdornment,
  CircularProgress, Alert, Chip,
} from '@mui/material';
import {
  Shield, Person, Phone, Home, Badge, ArrowForward,
  LocationOn, CalendarMonth, CheckCircle,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

const ACCENT = '#0a7c6b';

// Age is derived from the birth date rather than typed, so it can't be misstated.
function calculateAge(birthDate: string): number {
  // Parse YYYY-MM-DD by component: `new Date('2003-05-15')` is UTC midnight,
  // which shifts a day in timezones behind UTC and skews the age.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - mo;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age -= 1;
  return age;
}

function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0];
}

const schema = z.object({
  firstName: z.string().min(2, 'At least 2 characters required'),
  lastName: z.string().min(2, 'At least 2 characters required'),
  birthDate: z.string()
    .min(1, 'Select your date of birth')
    .refine(v => calculateAge(v) >= 1 && calculateAge(v) <= 120, 'Enter a valid date of birth'),
  gender: z.enum(['Male', 'Female', 'Other'], { error: 'Select a gender' }),
  username: z.string()
    .min(3, 'At least 3 characters').max(20, 'At most 20 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, numbers, dot, dash and underscore'),
  contactNumber: z.string()
    .length(11, 'Contact number must be exactly 11 digits')
    .regex(/^09\d{9}$/, 'Enter a valid mobile number starting with 09'),
  streetAddress: z.string().min(3, 'Enter your house number and street'),
  barangay: z.string().min(2, 'Enter your barangay'),
  city: z.string().min(2, 'Enter your city or municipality'),
  zipCode: z.string().regex(/^\d{4}$/, 'ZIP code must be 4 digits'),
});
type FormData = z.infer<typeof schema>;

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

/**
 * Clerk owns the account and has already verified the email. This page
 * collects the barangay profile and writes the linked Resident row, so a
 * Clerk user can never sit in the portal without one.
 */
export default function CompleteProfilePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [checking, setChecking] = useState(true);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, watch, control, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '', lastName: '', birthDate: '',
      gender: '' as 'Male' | 'Female' | 'Other',
      username: '', contactNumber: '',
      streetAddress: '', barangay: '', city: '', zipCode: '',
    },
    mode: 'onChange',
  });

  // Google (and other OAuth providers) hand Clerk the person's name. Prefill it
  // so signing in with Gmail doesn't mean retyping what Clerk already knows.
  // Only fills blanks, so it can never overwrite something already typed.
  useEffect(() => {
    if (!isLoaded || !user) return;
    if (user.firstName && !getValues('firstName')) {
      setValue('firstName', user.firstName, { shouldValidate: true });
    }
    if (user.lastName && !getValues('lastName')) {
      setValue('lastName', user.lastName, { shouldValidate: true });
    }
  }, [isLoaded, user, setValue, getValues]);

  const birthValue = watch('birthDate', '');
  const parsedAge = birthValue ? calculateAge(birthValue) : NaN;
  const derivedAge = Number.isNaN(parsedAge) || parsedAge < 0 || parsedAge > 120 ? null : parsedAge;
  const contactDigits = (watch('contactNumber', '') ?? '').length;
  const contactReg = register('contactNumber');

  // Anyone who already has a profile is bridged straight into the portal.
  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { router.replace('/sign-in'); return; }

    let cancelled = false;
    (async () => {
      const res = await fetch('/api/auth/clerk-session', { method: 'POST', credentials: 'include' });
      if (cancelled) return;
      if (res.ok) { router.replace('/resident'); return; }
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [isLoaded, user, router]);

  const onSubmit = async (data: FormData) => {
    setServerError('');
    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) { setServerError('No verified email found on your account.'); return; }

    try {
      const res = await fetch('/api/residents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          age: calculateAge(data.birthDate),
          gender: data.gender,
          barangay: data.barangay,
          // Resident.address is a single column, so recompose the parts here.
          address: [data.streetAddress, data.barangay, `${data.city} ${data.zipCode}`]
            .map(s => s.trim()).filter(Boolean).join(', '),
          contactNumber: data.contactNumber,
          email,
          username: data.username,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setServerError(json.error ?? 'Could not save your profile.'); return; }

      await fetch('/api/auth/clerk-session', { method: 'POST', credentials: 'include' });
      toast.success(`Welcome, ${data.firstName}! Your profile is complete.`);
      router.replace('/resident');
    } catch {
      setServerError('Network error. Please try again.');
    }
  };

  if (!isLoaded || checking) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#f4f5f7' }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress sx={{ color: ACCENT, mb: 2 }} />
          <Typography sx={{ fontSize: '0.98rem', color: '#64748b' }}>Checking your account…</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f5f7', py: { xs: 3, md: 6 }, px: 2 }}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
        style={{ maxWidth: 720, margin: '0 auto' }}>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, justifyContent: 'center', mb: 2.5 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '10px', background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield sx={{ fontSize: 19, color: 'white' }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: '#0c1e46' }}>SafeComm</Typography>
        </Box>

        <Box sx={{ bgcolor: 'white', borderRadius: 4, p: { xs: 2.5, sm: 4 }, boxShadow: '0 20px 60px rgba(0,0,0,0.10)' }}>
          <Box sx={{ mb: 3 }}>
            <Chip icon={<CheckCircle sx={{ fontSize: '14px !important' }} />} label="Email verified" size="small"
              sx={{ bgcolor: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: '0.78rem', mb: 1.5 }} />
            <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', color: '#0c1e46' }}>
              Complete your profile
            </Typography>
            <Typography sx={{ fontSize: '0.94rem', color: '#64748b', mt: 0.5 }}>
              Your barangay needs a few more details before you can file reports and track cases.
            </Typography>
            {user?.primaryEmailAddress?.emailAddress && (
              <Typography sx={{ fontSize: '0.86rem', color: '#0a7c6b', mt: 1, fontWeight: 600 }}>
                Signed in as {user.primaryEmailAddress.emailAddress}
              </Typography>
            )}
          </Box>

          {serverError && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{serverError}</Alert>}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
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
                <TextField label="Date of Birth *" type="date" fullWidth {...register('birthDate')}
                  error={!!errors.birthDate}
                  helperText={errors.birthDate?.message ?? (derivedAge !== null ? `Age: ${derivedAge} year${derivedAge !== 1 ? 's' : ''} old` : 'Pick your birth date')}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { max: isoYearsAgo(0), min: isoYearsAgo(120) },
                    input: { startAdornment: <InputAdornment position="start"><CalendarMonth sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> },
                  }}
                  sx={{ ...tf, ...(derivedAge !== null && !errors.birthDate && { '& .MuiFormHelperText-root': { color: ACCENT, fontWeight: 600 } }) }} />
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

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Username *" fullWidth {...register('username')}
                  error={!!errors.username}
                  helperText={errors.username?.message ?? 'Used to sign in alongside your email'}
                  placeholder="juan.delacruz"
                  slotProps={{
                    htmlInput: { maxLength: 20, autoCapitalize: 'none', spellCheck: false },
                    input: { startAdornment: <InputAdornment position="start"><Person sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> },
                  }}
                  sx={tf} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Contact Number *" fullWidth
                  {...contactReg}
                  onChange={e => {
                    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
                    contactReg.onChange(e);
                  }}
                  error={!!errors.contactNumber}
                  helperText={errors.contactNumber?.message ?? `${contactDigits}/11 digits`}
                  placeholder="09171234567" inputMode="numeric"
                  slotProps={{
                    htmlInput: { maxLength: 11, inputMode: 'numeric', pattern: '[0-9]*' },
                    input: { startAdornment: <InputAdornment position="start"><Phone sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> },
                  }}
                  sx={{ ...tf, ...(contactDigits === 11 && !errors.contactNumber && { '& .MuiFormHelperText-root': { color: ACCENT, fontWeight: 600 } }) }} />
              </Grid>

              <Grid size={12}>
                <Typography sx={{ fontWeight: 700, color: '#374151', fontSize: '0.86rem', textTransform: 'uppercase', letterSpacing: 1, mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Home sx={{ fontSize: 15, color: '#14b8a6' }} /> Residential Address
                </Typography>
              </Grid>
              <Grid size={12}>
                <TextField label="Street Address *" fullWidth {...register('streetAddress')}
                  error={!!errors.streetAddress} helperText={errors.streetAddress?.message}
                  placeholder="House No., Street, Purok / Subdivision"
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><Home sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                  sx={tf} />
              </Grid>
              {/* All three are free text so a resident can enter whatever
                  address they actually live at, rather than being held to a
                  fixed barangay list. */}
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Barangay *" fullWidth {...register('barangay')}
                  error={!!errors.barangay} helperText={errors.barangay?.message}
                  placeholder="Biñang 2nd"
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><LocationOn sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                  sx={tf} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="City / Municipality *" fullWidth {...register('city')}
                  error={!!errors.city} helperText={errors.city?.message}
                  placeholder="Bocaue"
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><LocationOn sx={{ fontSize: 17, color: '#9ca3af' }} /></InputAdornment> } }}
                  sx={tf} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="ZIP Code *" fullWidth {...register('zipCode')}
                  error={!!errors.zipCode} helperText={errors.zipCode?.message ?? '4-digit postal code'}
                  placeholder="3018" inputMode="numeric"
                  slotProps={{ htmlInput: { maxLength: 4 } }}
                  sx={tf} />
              </Grid>
            </Grid>

            <Button type="submit" fullWidth variant="contained" disabled={isSubmitting}
              endIcon={!isSubmitting && <ArrowForward sx={{ fontSize: 16 }} />}
              sx={{ mt: 3.5, py: 1.5, fontWeight: 700, fontSize: '0.98rem', borderRadius: 2.5,
                background: `linear-gradient(135deg, ${ACCENT}, #14b8a6)`,
                boxShadow: '0 6px 20px rgba(20,184,166,0.3)',
                '&:hover': { background: 'linear-gradient(135deg, #065f50, #0d9488)' },
                '&:disabled': { background: '#d1d5db', boxShadow: 'none', color: '#9ca3af' } }}>
              {isSubmitting ? <CircularProgress size={22} sx={{ color: 'white' }} /> : 'Finish & Enter Portal'}
            </Button>
          </Box>
        </Box>
      </motion.div>
    </Box>
  );
}
