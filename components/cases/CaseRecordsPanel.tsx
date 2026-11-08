'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Divider, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, RadioGroup, Radio, FormControlLabel, FormControl, InputLabel, Select, MenuItem, Collapse,
  CircularProgress, useMediaQuery,
} from '@mui/material';
import { Lock, PersonOutlined, HealthAndSafety, Share, Edit, Add, History, Warning, PictureAsPdf } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  REPORT_PATH_LABEL, REPORTING_CHANNELS, SAFETY_QUESTIONS, ANSWER_LABEL, YES_NO_UNKNOWN, REFERRAL_AGENCIES,
  REFERRAL_STATUSES, referralAgenciesFor, RESOLUTION_TYPES, type ReportPath, type ReportingChannel, type ReferralAgency, type ReferralStatus,
  type YesNoUnknownAnswer, type ResolutionType,
} from '@/lib/caseRecords';
import { PH_MOBILE_HINT, displayPhMobile, isPhMobileLocal, normalizePhMobile, phMobileLocal } from '@/lib/phoneNumber';
import PhMobileField from '@/components/forms/PhMobileField';
import VictimSurvivorsPanel from './VictimSurvivorsPanel';
import { REFERRAL_FORM_LABELS, EMPTY_REFERRAL_FORM, CLIENT_SEX, formOf, type ReferralFormKey } from '@/lib/referralForm';

/**
 * The case's records beside the narrative, for officials: the report details,
 * the person affected and the person reported, the initial safety assessment
 * (VAWC) and the referrals. Officer-only - none of this reaches the reporter.
 *
 * What the reporter said and what an official recorded are shown apart; an
 * official's correction never replaces the reporter's account.
 */

interface Party {
  id: string; role: 'AFFECTED' | 'REPORTED'; source: 'reporter' | 'official';
  fullName: string | null; age: number | null; address: string | null; contactNumber: string | null;
  relationship: string | null; dependentsAffected: string | null; details: string | null;
  updatedBy: string | null; updatedAt: string;
}
interface Safety {
  immediateConcern: YesNoUnknownAnswer; dependentsAffected: YesNoUnknownAnswer; urgentAssistance: YesNoUnknownAnswer;
  medicalNeeded: YesNoUnknownAnswer; shelterNeeded: YesNoUnknownAnswer; policeOrReferralNeeded: YesNoUnknownAnswer;
  additionalConcerns: string | null; initialAction: string | null; assistanceProvided: string | null; protectionActions: string | null;
  safeContactConfirmed: YesNoUnknownAnswer | null; preferredAssistance: string | null; followUpRequirements: string | null; safetyPlan: string | null;
  followUpAt: string | null; version: number; updatedBy: string | null; updatedAt: string;
}
type Referral = {
  id: string; agency: ReferralAgency; agencyOther: string | null; referredAt: string; reason: string | null;
  status: ReferralStatus; notes: string | null; createdBy: string | null; formUpdatedAt: string | null;
} & { [K in ReferralFormKey]: string | number | null };
interface Records {
  access: { view: boolean; edit: boolean; message: string | null };
  report: {
    caseNumber: string; caseNumberLabel: string; desk: ReportPath; reportPath: ReportPath | null;
    reportingChannel: ReportingChannel | null; incidentDate: string | null; incidentTimeApprox: string | null;
    witnessInfo: string | null; filedAt: string; reportingRelationship: string | null; affectedPersonNote: string | null;
    resolution: { type: ResolutionType; summary: string | null; at: string | null; by: string | null } | null;
  };
  parties: Party[];
  safety: Safety | null;
  safetyHistory: { id: string; snapshot: Partial<Safety>; by: string | null; at: string }[];
  referrals: Referral[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Could not load'), { status: res.status });
  return body.data as Records;
};

const NAVY = '#0c1e46';
const label = { fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
const day = (d: string) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const when = (d: string) => new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Field({ name, value }: { name: string; value: string | number | null | undefined }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, gap: { xs: 0, sm: 1 }, mb: 0.6 }}>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{name}</Typography>
      <Typography sx={{ fontSize: '0.86rem', color: value === null || value === undefined || value === '' ? '#94a3b8' : NAVY, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {value === null || value === undefined || value === '' ? 'Not given' : value}
      </Typography>
    </Box>
  );
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
  return json.data;
}

// ─── People ───────────────────────────────────────────────────────────────────

function PartyDialog({ caseId, role, vawc, start, onClose, onSaved }: {
  caseId: string; role: 'AFFECTED' | 'REPORTED'; vawc: boolean; start: Party | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    fullName: start?.fullName ?? '', age: start?.age?.toString() ?? '', address: start?.address ?? '',
    contactNumber: phMobileLocal(start?.contactNumber), relationship: start?.relationship ?? '',
    dependentsAffected: start?.dependentsAffected ?? '', details: start?.details ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const who = role === 'AFFECTED' ? (vawc ? 'Victim-survivor' : 'Person affected') : 'Person reported';
  const save = async () => {
    // The number field is shown on the VAWC desk only; a started-but-wrong one is not saved silently.
    if (role === 'AFFECTED' && vawc && f.contactNumber && !isPhMobileLocal(f.contactNumber)) {
      toast.error(`Contact number: ${PH_MOBILE_HINT}, or leave it empty.`);
      return;
    }
    setSaving(true);
    try {
      const party: Record<string, unknown> = {
        fullName: f.fullName, age: f.age, address: f.address, relationship: f.relationship, details: f.details,
        ...(role === 'AFFECTED' && { contactNumber: normalizePhMobile(f.contactNumber) ?? '', ...(f.dependentsAffected && { dependentsAffected: f.dependentsAffected }) }),
      };
      await send(`/api/cases/${caseId}/records`, 'PUT', { role, party });
      toast.success(`${who} details saved`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>
        {who} - official record
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Saved beside what the reporter said; their account is not changed. Leave out what is not known.</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <TextField size="small" label="Full name, if known" value={f.fullName} onChange={set('fullName')} slotProps={{ htmlInput: { maxLength: 120 } }} />
        <TextField size="small" label="Age, if known" type="number" value={f.age} onChange={set('age')} slotProps={{ htmlInput: { min: 0, max: 120 } }} />
        <TextField size="small" label="Address, if needed" value={f.address} onChange={set('address')} slotProps={{ htmlInput: { maxLength: 200 } }} />
        {role === 'AFFECTED' && vawc && (
          <PhMobileField size="small" label="Contact number - only if it is safe to use" value={f.contactNumber} onChange={d => setF(p => ({ ...p, contactNumber: d }))} />
        )}
        <TextField size="small" value={f.relationship} onChange={set('relationship')} slotProps={{ htmlInput: { maxLength: 120 } }}
          label={role === 'AFFECTED' ? 'Relationship to the reporter' : `Relationship to the ${vawc ? 'victim-survivor' : 'person affected'}`} />
        {role === 'AFFECTED' && (
          <FormControl size="small">
            <InputLabel>Children or dependents potentially affected</InputLabel>
            <Select label="Children or dependents potentially affected" value={f.dependentsAffected} onChange={e => setF(p => ({ ...p, dependentsAffected: String(e.target.value) }))}>
              <MenuItem value="">Not recorded</MenuItem>
              {YES_NO_UNKNOWN.map(a => <MenuItem key={a} value={a}>{ANSWER_LABEL[a]}</MenuItem>)}
            </Select>
          </FormControl>
        )}
        <TextField size="small" label="Other relevant information" multiline minRows={2} value={f.details} onChange={set('details')} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Save details'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PartyBlock({ title, role, parties, vawc, selfReport, note, edit, onEdit }: {
  title: string; role: 'AFFECTED' | 'REPORTED'; parties: Party[]; vawc: boolean; selfReport: boolean;
  note: string | null; edit: boolean; onEdit: (start: Party | null) => void;
}) {
  const reported = parties.find(p => p.role === role && p.source === 'reporter') ?? null;
  const official = parties.find(p => p.role === role && p.source === 'official') ?? null;
  const show = (p: Party) => (
    <>
      <Field name="Full name" value={p.fullName} />
      <Field name="Age" value={p.age} />
      <Field name="Address" value={p.address} />
      {role === 'AFFECTED' && vawc && <Field name="Contact number" value={p.contactNumber ? displayPhMobile(p.contactNumber) : p.contactNumber} />}
      <Field name={role === 'AFFECTED' ? 'Relationship to reporter' : 'Relationship to person affected'} value={p.relationship} />
      {role === 'AFFECTED' && <Field name="Children / dependents affected" value={p.dependentsAffected ? ANSWER_LABEL[p.dependentsAffected as YesNoUnknownAnswer] : null} />}
      <Field name="Other information" value={p.details} />
    </>
  );
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
        <PersonOutlined sx={{ fontSize: 17, color: '#64748b' }} />
        <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: NAVY }}>{title}</Typography>
        {edit && (
          <Button size="small" startIcon={<Edit sx={{ fontSize: 14 }} />} onClick={() => onEdit(official ?? reported)}
            sx={{ ml: 'auto', textTransform: 'none', minHeight: 32 }}>
            {official ? 'Edit official record' : 'Add official record'}
          </Button>
        )}
      </Box>
      {role === 'AFFECTED' && selfReport && (
        <Typography sx={{ fontSize: '0.8rem', color: '#475569', mb: 0.5 }}>The reporter filed this for themselves.</Typography>
      )}
      {role === 'AFFECTED' && note && <Field name="Reporter described them as" value={note} />}
      {reported ? (
        <>
          <Typography sx={{ ...label, mt: 0.5, mb: 0.5 }}>As the reporter gave it</Typography>
          {show(reported)}
        </>
      ) : !official && !(role === 'AFFECTED' && (selfReport || note)) && (
        <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>The reporter gave no details. Nothing is assumed.</Typography>
      )}
      {official && (
        <>
          <Typography sx={{ ...label, mt: 1, mb: 0.5 }}>Recorded by {official.updatedBy ?? 'an official'} · {when(official.updatedAt)}</Typography>
          {show(official)}
        </>
      )}
    </Box>
  );
}

// ─── Safety assessment ───────────────────────────────────────────────────────

function SafetyDialog({ caseId, start, onClose, onSaved }: { caseId: string; start: Safety | null; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<Record<string, string>>(() => Object.fromEntries(SAFETY_QUESTIONS.map(q => [q.key, start?.[q.key] ?? ''])));
  const [t, setT] = useState({
    additionalConcerns: start?.additionalConcerns ?? '', initialAction: start?.initialAction ?? '',
    assistanceProvided: start?.assistanceProvided ?? '', protectionActions: start?.protectionActions ?? '',
    preferredAssistance: start?.preferredAssistance ?? '', followUpRequirements: start?.followUpRequirements ?? '',
    safetyPlan: start?.safetyPlan ?? '',
    followUpAt: start?.followUpAt ? new Date(start.followUpAt).toISOString().slice(0, 16) : '',
  });
  // Optional: an urgent case is recorded without waiting to confirm a safe contact.
  const [safeContact, setSafeContact] = useState<string>(start?.safeContactConfirmed ?? '');
  const [saving, setSaving] = useState(false);
  const unanswered = SAFETY_QUESTIONS.filter(q => !a[q.key]);
  const save = async () => {
    if (unanswered.length) { toast.error('Answer every question - "Not known" is an answer'); return; }
    setSaving(true);
    try {
      const out = await send(`/api/cases/${caseId}/safety`, 'PUT', {
        ...a, ...t, ...(safeContact && { safeContactConfirmed: safeContact }), followUpAt: t.followUpAt ? new Date(t.followUpAt).toISOString() : '', expectedVersion: start?.version ?? 0,
      });
      if (out.flaggedUrgent) toast.error('Flagged for urgent review - the desks have been notified', { duration: 6000 });
      else toast.success('Safety assessment saved');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  };
  const urgentNow = a.immediateConcern === 'yes' || a.urgentAssistance === 'yes';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>
        Initial safety assessment
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Officer-only. Answer from what you know now - you can update it later; earlier versions are kept.</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.25 }}>
        {SAFETY_QUESTIONS.map(q => (
          <Box key={q.key}>
            <Typography id={`sq-${q.key}`} sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>{q.label}</Typography>
            <RadioGroup row aria-labelledby={`sq-${q.key}`} value={a[q.key]} onChange={e => setA(p => ({ ...p, [q.key]: e.target.value }))}>
              {YES_NO_UNKNOWN.map(v => <FormControlLabel key={v} value={v} control={<Radio size="small" />} label={ANSWER_LABEL[v]} />)}
            </RadioGroup>
          </Box>
        ))}
        {urgentNow && (
          <Alert severity="error" icon={<Warning />} sx={{ borderRadius: 2 }}>
            Saving flags this case for urgent review and notifies the desks at once. Follow the urgent-response
            protocol now - do not wait for this form or for any AI result.
          </Alert>
        )}
        <Box>
          <Typography id="sq-safeContact" sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>Has a safe way to contact the victim-survivor been confirmed?</Typography>
          <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>Optional - do not delay an urgent case for it.</Typography>
          <RadioGroup row aria-labelledby="sq-safeContact" value={safeContact} onChange={e => setSafeContact(e.target.value)}>
            {YES_NO_UNKNOWN.map(v => <FormControlLabel key={v} value={v} control={<Radio size="small" />} label={ANSWER_LABEL[v]} />)}
          </RadioGroup>
        </Box>
        <TextField size="small" label="Preferred assistance" placeholder="What the victim-survivor asks for - e.g. counseling, medical check, shelter, legal help"
          value={t.preferredAssistance} onChange={e => setT(p => ({ ...p, preferredAssistance: e.target.value }))} slotProps={{ htmlInput: { maxLength: 500 } }} />
        <TextField size="small" label="Additional safety concerns" multiline minRows={2} value={t.additionalConcerns} onChange={e => setT(p => ({ ...p, additionalConcerns: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField size="small" label="Initial action taken" multiline minRows={2} value={t.initialAction} onChange={e => setT(p => ({ ...p, initialAction: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField size="small" label="Assistance provided" multiline minRows={2} value={t.assistanceProvided} onChange={e => setT(p => ({ ...p, assistanceProvided: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField size="small" label="Protection-related actions" multiline minRows={2} value={t.protectionActions} onChange={e => setT(p => ({ ...p, protectionActions: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField size="small" label="Safety planning" placeholder="The safety plan agreed with the victim-survivor - where to go, who to call, code words, documents to keep ready"
          multiline minRows={3} value={t.safetyPlan} onChange={e => setT(p => ({ ...p, safetyPlan: e.target.value }))} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <TextField size="small" label="Follow-up requirements" multiline minRows={2} value={t.followUpRequirements}
          onChange={e => setT(p => ({ ...p, followUpRequirements: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField size="small" label="Follow-up schedule" type="datetime-local" value={t.followUpAt} onChange={e => setT(p => ({ ...p, followUpAt: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving} color={urgentNow ? 'error' : 'primary'} sx={{ textTransform: 'none', ...(!urgentNow && { bgcolor: NAVY }) }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : urgentNow ? 'Save and flag as urgent' : 'Save assessment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Referrals ───────────────────────────────────────────────────────────────

/**
 * Add a referral, or fill in / correct its Annex B referral form. A new one
 * starts from what the case already records (the server's prefill) - every
 * field can be changed, and anything left blank prints as a line to fill in.
 */
function ReferralDialog({ caseId, desk, referral, onClose, onSaved }: {
  caseId: string; desk: ReportPath; referral?: Referral | null; onClose: () => void; onSaved: () => void;
}) {
  const editing = Boolean(referral);
  const phone = useMediaQuery('(max-width:600px)');
  // Today in Philippine time, read once when the dialog opens.
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const [f, setF] = useState({ agency: (referral?.agency ?? '') as ReferralAgency | '', agencyOther: referral?.agencyOther ?? '',
    referredAt: today, reason: referral?.reason ?? '', status: 'REFERRED' as ReferralStatus, notes: '' });
  const [form, setForm] = useState<Record<ReferralFormKey, string>>(() => (referral ? formOf(referral) : { ...EMPTY_REFERRAL_FORM }));
  const [from, setFrom] = useState<Partial<Record<ReferralFormKey, string>>>({});
  const [saving, setSaving] = useState(false);
  // A new referral: what the case records, for the official to check. Not when editing - the saved form is shown.
  const { data: prefill, isLoading: prefilling } = useSWR(editing ? null : `/api/cases/${caseId}/referrals`, async (url: string) => {
    const res = await fetch(url, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body.data as { form: Record<ReferralFormKey, string>; from: Partial<Record<ReferralFormKey, string>> } : null;
  }, { revalidateOnFocus: false });
  const [applied, setApplied] = useState(false);
  if (prefill && !applied) { setApplied(true); setForm(prefill.form); setFrom(prefill.from); }

  const set = (k: ReferralFormKey) => (e: { target: { value: string } }) => setForm(p => ({ ...p, [k]: e.target.value }));
  const hint = (k: ReferralFormKey) => (from[k] && form[k] === prefill?.form[k] ? `From ${from[k]} - check it` : undefined);
  const tf = (k: ReferralFormKey, extra: Record<string, unknown> = {}) => (
    <TextField size="small" label={REFERRAL_FORM_LABELS[k]} value={form[k]} onChange={set(k)} helperText={hint(k)} {...extra} />
  );
  const save = async () => {
    if (!editing && !f.agency) { toast.error('Choose the office'); return; }
    setSaving(true);
    try {
      if (editing) {
        await send(`/api/cases/${caseId}/referrals/${referral!.id}`, 'PUT', { form, reason: f.reason });
        toast.success('Referral form saved');
      } else {
        await send(`/api/cases/${caseId}/referrals`, 'POST', { ...f, form });
        toast.success('Referral recorded - download its referral form from the list');
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(false); }
  };
  const section = (title: string) => <Typography sx={{ ...label, mt: 0.5 }}>{title}</Typography>;
  const two = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={phone} scroll="paper">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>
        {editing ? 'Referral form' : 'Record a referral'}
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
          Annex B - Referral Form. Blank fields print as lines to fill in by hand; the signature is signed on the printed copy.
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        {desk === 'VAWC' && (
          <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>
            VAWC cases are not referred to the Lupon for mediation or conciliation. This form names the client - give it only to the receiving office.
          </Alert>
        )}
        {prefilling && <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ borderRadius: 2, fontSize: '0.82rem' }}>Filling in what the case already records...</Alert>}

        {section('To')}
        {editing ? (
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: NAVY }}>
            {referral!.agency === 'OTHER' ? referral!.agencyOther : REFERRAL_AGENCIES[referral!.agency]?.label} · {day(referral!.referredAt)}
          </Typography>
        ) : (
          <Box sx={two}>
            <FormControl size="small">
              <InputLabel>Office referred to</InputLabel>
              <Select label="Office referred to" value={f.agency} onChange={e => setF(p => ({ ...p, agency: e.target.value as ReferralAgency }))}>
                {referralAgenciesFor(desk).map(k => <MenuItem key={k} value={k}>{REFERRAL_AGENCIES[k].label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField size="small" label="Date of Referral" type="date" value={f.referredAt} onChange={e => setF(p => ({ ...p, referredAt: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }} />
            {f.agency === 'OTHER' && (
              <TextField size="small" label="Name of the office" value={f.agencyOther} onChange={e => setF(p => ({ ...p, agencyOther: e.target.value }))}
                slotProps={{ htmlInput: { maxLength: 160 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
            )}
          </Box>
        )}
        <Box sx={two}>
          {tf('toAddress', { slotProps: { htmlInput: { maxLength: 300 } } })}
          {tf('toContactPerson', { slotProps: { htmlInput: { maxLength: 160 } } })}
        </Box>

        {section('Client')}
        <Box sx={two}>
          {tf('clientName', { slotProps: { htmlInput: { maxLength: 160 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
          {tf('clientAge', { type: 'number', slotProps: { htmlInput: { min: 0, max: 120, inputMode: 'numeric' } } })}
          <TextField select size="small" label="Sex" value={form.clientSex} onChange={set('clientSex')} helperText={hint('clientSex') ?? 'As recorded - leave blank if not known'}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value=""><em>Not recorded</em></MenuItem>
            {CLIENT_SEX.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          {tf('clientAddress', { slotProps: { htmlInput: { maxLength: 300 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
        </Box>

        {section('Family / guardian')}
        <Box sx={two}>
          {tf('guardianName', { slotProps: { htmlInput: { maxLength: 160 } } })}
          {tf('guardianContact', { slotProps: { htmlInput: { maxLength: 40, inputMode: 'tel' } } })}
          {tf('guardianAddress', { slotProps: { htmlInput: { maxLength: 300 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
        </Box>

        {section('Reason and services')}
        <TextField size="small" label="Reason/s for Referral" multiline minRows={2} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} slotProps={{ htmlInput: { maxLength: 500 } }} />
        {tf('servicesRequested', { multiline: true, minRows: 2, slotProps: { htmlInput: { maxLength: 1000 } } })}

        {section('Feedback to the referring party')}
        <Box sx={two}>
          {tf('feedbackTo', { label: 'Referring Party/Agency', slotProps: { htmlInput: { maxLength: 200 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
          {tf('feedbackAddress', { slotProps: { htmlInput: { maxLength: 300 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
          {tf('feedbackCellPhone', { slotProps: { htmlInput: { maxLength: 40, inputMode: 'tel' } } })}
          {tf('feedbackLandline', { slotProps: { htmlInput: { maxLength: 40, inputMode: 'tel' } } })}
          {tf('feedbackEmail', { type: 'email', slotProps: { htmlInput: { maxLength: 160 } } })}
          {tf('feedbackFax', { slotProps: { htmlInput: { maxLength: 40, inputMode: 'tel' } } })}
          {tf('feedbackContact', { slotProps: { htmlInput: { maxLength: 160 } }, sx: { gridColumn: { sm: '1 / -1' } } })}
        </Box>

        {section('Referred by')}
        <Box sx={two}>
          {tf('referredByName', { slotProps: { htmlInput: { maxLength: 160 } } })}
          {tf('referredByDesignation', { slotProps: { htmlInput: { maxLength: 160 } } })}
        </Box>

        {!editing && (
          <>
            {section('For SafeComm only - not on the form')}
            <Box sx={two}>
              <FormControl size="small">
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value as ReferralStatus }))}>
                  {(Object.keys(REFERRAL_STATUSES) as ReferralStatus[]).map(k => <MenuItem key={k} value={k}>{REFERRAL_STATUSES[k]}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" label="Notes" multiline minRows={1} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} slotProps={{ htmlInput: { maxLength: 1000 } }} />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || (!editing && prefilling)} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : editing ? 'Save referral form' : 'Save referral'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── The panel ───────────────────────────────────────────────────────────────

export default function CaseRecordsPanel({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Records>(`/api/cases/${caseId}/records`, fetcher);
  const [party, setParty] = useState<{ role: 'AFFECTED' | 'REPORTED'; start: Party | null } | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [editingReferral, setEditingReferral] = useState<Referral | null>(null);
  const [showSafetyHistory, setShowSafetyHistory] = useState(false);
  const saved = () => { setParty(null); setSafetyOpen(false); setReferralOpen(false); void mutate(); onChanged?.(); };

  const updateReferral = async (r: Referral, status: ReferralStatus) => {
    try {
      await send(`/api/cases/${caseId}/referrals/${r.id}`, 'PATCH', { status });
      toast.success('Referral updated');
      void mutate();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update'); }
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
          <Lock sx={{ fontSize: 17, color: '#64748b' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Case records</Typography>
          <Chip size="small" label="Officer-only" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: '#f1f5f9', color: '#475569' }} />
        </Box>

        {isLoading && <><Skeleton height={22} /><Skeleton height={22} width="70%" /><Skeleton height={80} /></>}
        {error && (
          <Alert severity={(error as { status?: number }).status === 403 ? 'info' : 'warning'} sx={{ borderRadius: 2, fontSize: '0.84rem' }}>
            {error.message}
          </Alert>
        )}

        {data && (() => {
          const vawc = data.report.desk === 'VAWC';
          const edit = data.access.edit;
          const r = data.report;
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {!edit && data.access.message && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{data.access.message}</Alert>}

              {/* Report details */}
              <Box>
                <Typography sx={{ ...label, mb: 0.75 }}>Report</Typography>
                <Field name={r.caseNumberLabel} value={`#${r.caseNumber}`} />
                {/* Older reports name the form the resident picked; a report filed now
                    has none - SafeComm recommended the desk (see the AI assessment). */}
                <Field name="Form used" value={r.reportPath ? REPORT_PATH_LABEL[r.reportPath].title : 'Not chosen by the reporter - desk recommended by SafeComm AI'} />
                <Field name="Reporting channel" value={r.reportingChannel ? REPORTING_CHANNELS[r.reportingChannel] : null} />
                <Field name="Date of incident" value={r.incidentDate ? day(`${r.incidentDate}T00:00:00+08:00`) : null} />
                <Field name="Approximate time" value={r.incidentTimeApprox} />
                <Field name="Witnesses" value={r.witnessInfo} />
                {r.resolution && (
                  <>
                    <Field name="Resolution" value={RESOLUTION_TYPES[r.resolution.type]?.label ?? r.resolution.type} />
                    <Field name="How it was resolved" value={r.resolution.summary} />
                    <Field name="Resolved" value={r.resolution.at ? `${when(r.resolution.at)}${r.resolution.by ? ` · ${r.resolution.by}` : ''}` : null} />
                  </>
                )}
                {r.reportPath && r.reportPath !== r.desk && (
                  <Alert severity="warning" sx={{ mt: 0.5, borderRadius: 2, fontSize: '0.8rem' }}>
                    Filed on the {REPORT_PATH_LABEL[r.reportPath].title} form, but the report reads as a {vawc ? 'VAWC' : 'Blotter'} matter. Confirm the desk in the category review.
                  </Alert>
                )}
              </Box>

              <Divider />

              {/* People */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography sx={label}>People in this report</Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                  The reporter, the person affected and the person reported are kept apart - none is assumed to be another.
                </Typography>
                <PartyBlock title={vawc ? 'Victim-survivor' : 'Person affected'} role="AFFECTED" parties={data.parties} vawc={vawc}
                  selfReport={r.reportingRelationship === 'SELF'} note={r.affectedPersonNote} edit={edit}
                  onEdit={start => setParty({ role: 'AFFECTED', start })} />
                <PartyBlock title="Person reported" role="REPORTED" parties={data.parties} vawc={vawc}
                  selfReport={false} note={null} edit={edit} onEdit={start => setParty({ role: 'REPORTED', start })} />
              </Box>

              {/* The victim-survivors, one per person, for the women and children statistics - the VAWC desk's */}
              {vawc && (
                <>
                  <Divider />
                  <VictimSurvivorsPanel caseId={caseId} />
                </>
              )}

              {/* Safety assessment - the VAWC desk's */}
              {vawc && (
                <>
                  <Divider />
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                      <HealthAndSafety sx={{ fontSize: 17, color: '#b45309' }} />
                      <Typography sx={{ ...label, color: '#b45309' }}>Initial safety assessment</Typography>
                      {edit && (
                        <Button size="small" startIcon={data.safety ? <Edit sx={{ fontSize: 14 }} /> : <Add sx={{ fontSize: 14 }} />}
                          onClick={() => setSafetyOpen(true)} sx={{ ml: 'auto', textTransform: 'none', minHeight: 32 }}>
                          {data.safety ? 'Update' : 'Record assessment'}
                        </Button>
                      )}
                    </Box>
                    {data.safety ? (
                      <>
                        {SAFETY_QUESTIONS.map(q => (
                          <Box key={q.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.4 }}>
                            <Typography sx={{ fontSize: '0.82rem', color: '#334155' }}>{q.label}</Typography>
                            <Chip size="small" label={ANSWER_LABEL[data.safety![q.key]]} sx={{
                              height: 20, fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
                              bgcolor: data.safety![q.key] === 'yes' ? '#fef2f2' : data.safety![q.key] === 'no' ? '#f0fdf4' : '#f1f5f9',
                              color: data.safety![q.key] === 'yes' ? '#b91c1c' : data.safety![q.key] === 'no' ? '#15803d' : '#475569',
                            }} />
                          </Box>
                        ))}
                        <Box sx={{ mt: 0.75 }}>
                          <Field name="Additional concerns" value={data.safety.additionalConcerns} />
                          <Field name="Initial action" value={data.safety.initialAction} />
                          <Field name="Assistance provided" value={data.safety.assistanceProvided} />
                          <Field name="Protection actions" value={data.safety.protectionActions} />
                          <Field name="Safe contact confirmed" value={data.safety.safeContactConfirmed ? ANSWER_LABEL[data.safety.safeContactConfirmed] : null} />
                          <Field name="Preferred assistance" value={data.safety.preferredAssistance} />
                          <Field name="Safety plan" value={data.safety.safetyPlan} />
                          <Field name="Follow-up requirements" value={data.safety.followUpRequirements} />
                          <Field name="Follow-up" value={data.safety.followUpAt ? when(data.safety.followUpAt) : null} />
                        </Box>
                        <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                          Version {data.safety.version} · {data.safety.updatedBy ?? 'an official'} · {when(data.safety.updatedAt)}
                        </Typography>
                        {data.safetyHistory.length > 1 && (
                          <>
                            <Button size="small" startIcon={<History sx={{ fontSize: 14 }} />} onClick={() => setShowSafetyHistory(v => !v)}
                              sx={{ px: 0, textTransform: 'none', color: '#475569' }}>
                              {showSafetyHistory ? 'Hide' : 'Show'} earlier versions ({data.safetyHistory.length - 1})
                            </Button>
                            <Collapse in={showSafetyHistory}>
                              {data.safetyHistory.slice(1).map(h => (
                                <Typography key={h.id} sx={{ fontSize: '0.76rem', color: '#64748b' }}>
                                  {when(h.at)} · {h.by ?? 'an official'} · immediate concern: {ANSWER_LABEL[(h.snapshot.immediateConcern ?? 'unknown') as YesNoUnknownAnswer]}
                                  {h.snapshot.initialAction ? ` · action: ${h.snapshot.initialAction}` : ''}
                                </Typography>
                              ))}
                            </Collapse>
                          </>
                        )}
                      </>
                    ) : (
                      <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                        Not recorded yet. An immediate danger is acted on at once - this form does not need to be finished first.
                      </Typography>
                    )}
                  </Box>
                </>
              )}

              <Divider />

              {/* Referrals */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                  <Share sx={{ fontSize: 16, color: '#7c3aed' }} />
                  <Typography sx={label}>Referrals</Typography>
                  {edit && (
                    <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />} onClick={() => setReferralOpen(true)}
                      sx={{ ml: 'auto', textTransform: 'none', minHeight: 32 }}>Add referral</Button>
                  )}
                </Box>
                {data.referrals.length === 0 ? (
                  <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No referrals recorded.</Typography>
                ) : data.referrals.map(ref => (
                  <Box key={ref.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1, mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY, flex: 1, minWidth: 160 }}>
                        {ref.agency === 'OTHER' ? ref.agencyOther : REFERRAL_AGENCIES[ref.agency]?.label ?? ref.agency}
                      </Typography>
                      {edit ? (
                        <Select size="small" value={ref.status} onChange={e => void updateReferral(ref, e.target.value as ReferralStatus)}
                          sx={{ fontSize: '0.78rem', height: 30 }} inputProps={{ 'aria-label': 'Referral status' }}>
                          {(Object.keys(REFERRAL_STATUSES) as ReferralStatus[]).map(k => <MenuItem key={k} value={k}>{REFERRAL_STATUSES[k]}</MenuItem>)}
                        </Select>
                      ) : (
                        <Chip size="small" label={REFERRAL_STATUSES[ref.status]} sx={{ height: 22, fontSize: '0.72rem' }} />
                      )}
                    </Box>
                    <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {day(ref.referredAt)} · {ref.createdBy ?? 'an official'}
                    </Typography>
                    {ref.reason && <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.25, overflowWrap: 'anywhere' }}>{ref.reason}</Typography>}
                    {ref.notes && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25, overflowWrap: 'anywhere' }}>{ref.notes}</Typography>}
                    {/* Annex B - Referral Form: a PDF of this referral, for the receiving office */}
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 0.75 }}>
                      <Button size="small" variant="outlined" startIcon={<PictureAsPdf sx={{ fontSize: 16 }} />} component="a"
                        href={`/api/cases/${caseId}/referrals/${ref.id}/pdf`} download
                        sx={{ textTransform: 'none', minHeight: 32, borderColor: '#c4b5fd', color: '#6d28d9' }}>
                        Download referral form (PDF)
                      </Button>
                      {edit && (
                        <Button size="small" startIcon={<Edit sx={{ fontSize: 15 }} />} onClick={() => setEditingReferral(ref)} sx={{ textTransform: 'none', minHeight: 32 }}>
                          {ref.formUpdatedAt ? 'Edit form' : 'Fill in the form'}
                        </Button>
                      )}
                      {!ref.formUpdatedAt && <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Recorded before the form - it prints with blank lines</Typography>}
                    </Box>
                  </Box>
                ))}
              </Box>

              {party && <PartyDialog caseId={caseId} role={party.role} vawc={vawc} start={party.start} onClose={() => setParty(null)} onSaved={saved} />}
              {safetyOpen && <SafetyDialog caseId={caseId} start={data.safety} onClose={() => setSafetyOpen(false)} onSaved={saved} />}
              {referralOpen && <ReferralDialog caseId={caseId} desk={data.report.desk} onClose={() => setReferralOpen(false)} onSaved={saved} />}
              {editingReferral && <ReferralDialog caseId={caseId} desk={data.report.desk} referral={editingReferral} onClose={() => setEditingReferral(null)}
                onSaved={() => { setEditingReferral(null); saved(); }} />}
            </Box>
          );
        })()}
      </CardContent>
    </Card>
  );
}
