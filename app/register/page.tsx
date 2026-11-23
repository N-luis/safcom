'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, MenuItem, Skeleton, TextField, Typography } from '@mui/material';
import { Visibility, VisibilityOff, MarkEmailRead, ErrorOutlined } from '@mui/icons-material';
import AuthShell, { authPrimaryButton } from '@/components/auth/AuthShell';
import ResendVerification from '@/components/auth/ResendVerification';
import AddressFields, { emptyAddress, type AddressValue } from '@/components/forms/AddressFields';
import type { PickedLocation } from '@/components/forms/IncidentLocationMap';
import type { BoundaryGeometry } from '@/lib/jurisdiction';
import { GENDER_OPTIONS } from '@/lib/safecommConfig';

const IncidentLocationMap = dynamicImport(() => import('@/components/forms/IncidentLocationMap'), {
  ssr: false, loading: () => <Skeleton variant="rounded" height={320} />,
});

/**
 * Resident registration in one step: the account, the person, the
 * residential address and the home on the map - checked again on the server,
 * which decides. Standard reporting opens only after an official verifies
 * the residency; registering never verifies it.
 */
const NAVY = '#0c1e46';
const PASSWORD_RULE = 'At least 8 characters, with a letter and a number';
const passwordProblem = (p: string) => p.length < 8 ? 'At least 8 characters' : !/[A-Za-z]/.test(p) || !/[0-9]/.test(p) ? 'Use a letter and a number' : null;
const isMobile = (v: string) => /^09\d{9}$/.test(v);

type Errors = Partial<Record<string, string>>;
interface Done { email: string; name: string; emailSent: boolean; emailDetail?: string; flags: string[] }
interface Outside { message: string; destination: { barangay?: string; municipality?: string; province?: string } | null }

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box component="section" aria-labelledby={`reg-s${n}`} sx={{ display: 'grid', gap: 1.5, pt: 2.5, borderTop: n > 1 ? '1px solid #e2e8f0' : 'none' }}>
      <Box>
        <Typography id={`reg-s${n}`} component="h2" sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>{n}. {title}</Typography>
        {hint && <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mt: 0.25 }}>{hint}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [account, setAccount] = useState({ email: '', password: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [person, setPerson] = useState({ firstName: '', lastName: '', birthDate: '', gender: '', contactNumber: '', altContactNumber: '' });
  const [addr, setAddr] = useState<AddressValue>(emptyAddress(true));
  const [postalCode, setPostalCode] = useState('');
  const [pin, setPin] = useState<PickedLocation | null>(null);
  const [manual, setManual] = useState(false);
  const [boundary, setBoundary] = useState<BoundaryGeometry | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);
  const [outside, setOutside] = useState<Outside | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    fetch('/api/registration/jurisdiction').then(r => r.json()).then(j => { if (j?.data?.boundary) setBoundary(j.data.boundary); }).catch(() => undefined);
  }, []);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!/^\S+@\S+\.\S+$/.test(account.email.trim())) e.email = 'Enter a valid email address';
    const pw = passwordProblem(account.password); if (pw) e.password = pw;
    if (account.confirmPassword !== account.password) e.confirmPassword = 'The passwords do not match';
    if (person.firstName.trim().length < 2) e.firstName = 'Enter your first name';
    if (person.lastName.trim().length < 2) e.lastName = 'Enter your last name';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birthDate)) e.birthDate = 'Enter your date of birth';
    if (!isMobile(person.contactNumber)) e.contactNumber = '11 digits starting with 09';
    if (person.altContactNumber && !isMobile(person.altContactNumber)) e.altContactNumber = '11 digits starting with 09, or leave it empty';
    if (!addr.province.trim()) e.province = 'Choose your province';
    if (!addr.municipality.trim()) e.municipality = 'Choose your municipality';
    if (!addr.barangay.trim()) e.barangay = 'Choose your barangay';
    if (addr.street.trim().length < 2) e.street = 'Enter your street';
    if (!(addr.houseNumber ?? '').trim()) e.houseNumber = 'Enter your house or building number';
    if (postalCode && !/^\d{4}$/.test(postalCode)) e.postalCode = '4 digits, or leave it empty';
    if (!manual && !pin?.chosen) e.pin = 'Place your home on the map, or choose to be verified from the address alone.';
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setProblem(''); setEmailTaken(false); setOutside(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { setProblem('Check the highlighted fields.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/residents/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...account, email: account.email.trim(),
          firstName: person.firstName.trim(), lastName: person.lastName.trim(), birthDate: person.birthDate, gender: person.gender,
          contactNumber: person.contactNumber, altContactNumber: person.altContactNumber,
          province: addr.province.trim(), municipality: addr.municipality.trim(), barangay: addr.barangay.trim(), street: addr.street.trim(),
          houseNumber: (addr.houseNumber ?? '').trim(), purok: (addr.purok ?? '').trim(), postalCode,
          ...(manual || !pin ? { locationSource: 'NONE' } : { latitude: pin.latitude, longitude: pin.longitude, locationSource: 'MAP' }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 201 && json.success) {
        setDone({ email: json.data.email, name: json.data.name, emailSent: json.data.emailSent, emailDetail: json.data.emailDetail, flags: json.data.check?.flags ?? [] });
        window.scrollTo({ top: 0 });
        return;
      }
      if (json.code === 'OUTSIDE_JURISDICTION') { setOutside({ message: json.error, destination: json.destination ?? null }); return; }
      if (json.code === 'EMAIL_TAKEN') { setEmailTaken(true); setErrors({ email: 'Already registered' }); }
      if (json.code === 'ADDRESS_INCOMPLETE' && Array.isArray(json.missing)) setProblem(`${json.error} Missing: ${json.missing.join(', ')}.`);
      else setProblem(json.error ?? `Registration failed (error ${res.status}).`);
    } catch {
      setProblem('Network error. Nothing was saved - please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell light title="Check your email">
        <Box role="status" sx={{ display: 'grid', gap: 2 }} data-testid="register-done">
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
            <MarkEmailRead sx={{ color: '#0f766e', mt: '2px' }} />
            <Typography sx={{ color: '#1e293b', lineHeight: 1.6 }}>
              {done.emailSent ? <>We sent a confirmation link to <b>{done.email}</b>. Open it to confirm your email and sign in.</>
                : <>Your account is created, but the confirmation email could not be sent{done.emailDetail ? ` (${done.emailDetail})` : ''}. Send it again below.</>}
            </Typography>
          </Box>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Your residency is currently awaiting verification by an authorized barangay official. Until then you can sign in, follow your residency status and see the emergency hotlines; filing reports opens once you are verified.
          </Alert>
          {!done.emailSent && <ResendVerification email={done.email} />}
          <Button variant="contained" onClick={() => router.push('/resident-login')} sx={authPrimaryButton}>Go to sign in</Button>
        </Box>
      </AuthShell>
    );
  }

  const field = (k: keyof typeof person, label: string, extra: object = {}) => (
    <TextField size="small" label={label} value={person[k]} onChange={e => setPerson(p => ({ ...p, [k]: e.target.value }))}
      error={Boolean(errors[k])} helperText={errors[k] ?? ' '} fullWidth {...extra} />
  );

  return (
    <AuthShell light wide title="Create your resident account"
      subtitle="For residents of Barangay Biñang 2nd, Bocaue, Bulacan. Everything is asked once, here. An authorized barangay official verifies your residency before you can file reports.">
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'grid', gap: 1 }} data-testid="register-form">
        <Section n={1} title="Account" hint="You sign in with this email. We send a link to confirm it.">
          <TextField size="small" label="Email *" type="email" value={account.email} onChange={e => setAccount(a => ({ ...a, email: e.target.value }))}
            error={Boolean(errors.email)} helperText={errors.email ?? ' '} autoComplete="email" fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            <TextField size="small" label="Password *" type={showPw ? 'text' : 'password'} value={account.password} onChange={e => setAccount(a => ({ ...a, password: e.target.value }))}
              error={Boolean(errors.password)} helperText={errors.password ?? PASSWORD_RULE} autoComplete="new-password"
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton size="small" edge="end" onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></InputAdornment> } }} />
            <TextField size="small" label="Confirm password *" type={showPw ? 'text' : 'password'} value={account.confirmPassword} onChange={e => setAccount(a => ({ ...a, confirmPassword: e.target.value }))}
              error={Boolean(errors.confirmPassword)} helperText={errors.confirmPassword ?? ' '} autoComplete="new-password" />
          </Box>
          {emailTaken && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              This email already has an account. <Button size="small" onClick={() => router.push('/resident-login')}>Sign in</Button> or, if it was made before the new sign-in,
              <Button size="small" onClick={() => router.push('/reset-password')}>set up your password</Button>.
            </Alert>
          )}
        </Section>

        <Section n={2} title="About you">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            {field('firstName', 'First name *', { autoComplete: 'given-name' })}
            {field('lastName', 'Last name *', { autoComplete: 'family-name' })}
            {field('birthDate', 'Date of birth *', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
            <TextField select size="small" label="Sex (optional)" value={person.gender} onChange={e => setPerson(p => ({ ...p, gender: e.target.value }))} helperText=" ">
              <MenuItem value="">—</MenuItem>
              {GENDER_OPTIONS.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
            </TextField>
            {field('contactNumber', 'Contact number *', { placeholder: '09XXXXXXXXX', inputMode: 'numeric', autoComplete: 'tel' })}
            {field('altContactNumber', 'Alternative contact number (optional)', { placeholder: '09XXXXXXXXX', inputMode: 'numeric' })}
          </Box>
        </Section>

        <Section n={3} title="Residential address" hint="Choose from the lists. An address outside Barangay Biñang 2nd cannot be registered here.">
          <AddressFields value={addr} onChange={v => { setAddr(v); setOutside(null); }} mode="residence" idPrefix="reg" houseRequired
            errors={{ province: errors.province, municipality: errors.municipality, barangay: errors.barangay, street: errors.street, houseNumber: errors.houseNumber }} />
          <TextField size="small" label="Postal code (optional)" value={postalCode} onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            error={Boolean(errors.postalCode)} helperText={errors.postalCode ?? ' '} sx={{ maxWidth: 220 }} inputMode="numeric" />
        </Section>

        <Section n={4} title="Your home on the map"
          hint="Search your street, use your location, or tap your house, then drag the pin to adjust. A map location does not prove residence - an official checks it.">
          {manual ? (
            <Alert severity="info" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => setManual(false)}>Use the map</Button>}>
              No map location: the barangay verifies your address another way.
            </Alert>
          ) : (
            <>
              <IncidentLocationMap value={pin} onChange={v => { setPin(v); setErrors(e => ({ ...e, pin: undefined })); }} variant="residence" boundary={boundary}
                focusStreet={addr.street} geoBase="/api/registration/geo" />
              <Button size="small" onClick={() => { setManual(true); setPin(null); setErrors(e => ({ ...e, pin: undefined })); }} sx={{ justifySelf: 'start', textTransform: 'none' }}>
                I cannot use the map - verify my address without it
              </Button>
            </>
          )}
          {errors.pin && <Typography role="alert" sx={{ fontSize: '0.82rem', color: '#b91c1c' }}>{errors.pin}</Typography>}
        </Section>

        {outside && (
          <Alert severity="error" icon={<ErrorOutlined />} sx={{ borderRadius: 2 }} data-testid="register-outside">
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>Standard Resident Portal reporting is limited to verified residents of Barangay Biñang 2nd, Bocaue, Bulacan.</Typography>
            <Typography sx={{ fontSize: '0.86rem', mt: 0.5 }}>{outside.message}</Typography>
            {outside.destination && (
              <Typography sx={{ fontSize: '0.86rem', mt: 0.5 }}><b>Your area:</b> {[outside.destination.barangay, outside.destination.municipality, outside.destination.province].filter(Boolean).join(', ')} - contact your own barangay hall.</Typography>
            )}
            <Typography sx={{ fontSize: '0.82rem', mt: 0.5 }}>If your address is in Biñang 2nd and this is wrong, correct it above. In an emergency, call the hotlines on the SafeComm home page.</Typography>
          </Alert>
        )}
        {problem && <Alert severity="error" sx={{ borderRadius: 2 }} role="alert">{problem}</Alert>}

        <Box sx={{ display: 'grid', gap: 1, pt: 1.5 }}>
          <Button type="submit" variant="contained" size="large" disabled={busy} sx={authPrimaryButton}>
            {busy ? <CircularProgress size={22} color="inherit" /> : 'Create my account'}
          </Button>
          <Button onClick={() => router.push('/resident-login')} sx={{ textTransform: 'none', color: '#475569' }}>Already have an account? Sign in</Button>
        </Box>
      </Box>
    </AuthShell>
  );
}
