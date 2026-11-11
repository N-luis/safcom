'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Button, TextField, Radio, RadioGroup, FormControlLabel, Checkbox, Chip, Alert, CircularProgress,
  Grid, LinearProgress, Tabs, Tab, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, MenuItem, Select, FormControl, InputLabel,
  Divider, useMediaQuery, useTheme,
} from '@mui/material';
import {
  ArrowBack, Save, Visibility, PictureAsPdf, Send, History, Close, Lock, TaskAlt, Undo, Block as BlockIcon, UploadFile, Lightbulb, Person,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import ServiceReferralPreview from '@/components/referrals/ServiceReferralPreview';
import { riskText } from '@/lib/triageLabels';
import {
  EMPTY_SERVICE_REFERRAL_FORM, FIELD_LABELS, DESTINATIONS, DESTINATION_KEYS, SERVICES, servicesFor, CLIENT_SIGNATORY, ISSUED_VIA, ACK_BASIS, ACK_STATUS,
  REFERRAL_STATUS, normalizeForm, issueProblems, serviceReferralFormSchema, changedKeys, cancelAllowed, mmddyyyy, serviceLabel,
  type ServiceReferralForm, type FormKey, type TextKey, type Destination, type ServiceKey, type ClientSignatory, type IssuedVia, type AckBasis,
  type AckStatus, type ReferralStatus, type SectionC, type Suggestion, type Problem,
} from '@/lib/serviceReferralForm';

/**
 * One Service Referral Form ("Referral Form.pdf"), for one VAWC case.
 *
 * Two panels: the editable fields on the left and, on the right, the live
 * document (ServiceReferralPreview) drawn from the same `form` state - there
 * is no second copy of the values, so every keystroke and tick shows at
 * once. On a small screen the two are the Edit Form and Preview tabs.
 *
 * The server decides everything that matters - who may see or change it,
 * what is valid, when it may be issued, acknowledged or cancelled - on every
 * request. A draft saves only when the officer saves it; every save names the
 * version it edited, so a double click or a stale tab overwrites nothing.
 * Nothing is kept in the browser's storage, nothing is logged to the console.
 */

interface Context {
  caseId: string; caseNumber: string; caseType: string; status: string; riskLevel: string | null; triageStatus: string | null;
  filedAt: string; assignedTo: string | null; contactPreference: string | null; intakeStatus: string | null;
  suggestions: Suggestion[];
}
interface Referral {
  id: string; caseId: string; reference: string; status: ReferralStatus; destination: Destination | null; services: ServiceKey[];
  receivingOrganization: string | null; form: ServiceReferralForm; prefilled: Partial<Record<FormKey, { source: string; value: string }>>;
  version: number; createdBy: string | null; createdAt: string; updatedBy: string | null; updatedAt: string;
  issuedBy: string | null; issuedAt: string | null; issuedVia: IssuedVia | null; documentSha256: string | null;
  ack: SectionC & { basis: AckBasis | null; recordedBy: string | null; recordedAt: string | null };
  cancelled: { by: string | null; at: string; reason: string | null } | null;
  events: { id: string; type: string; version: number | null; changedKeys: string[]; note: string | null; by: string | null; at: string }[];
  attachments: { id: string; kind: string; mimeType: string; size: number; by: string | null; at: string }[];
}
interface Loaded { referral: Referral; context: Context; me: { name: string | null }; access: { edit: boolean; message: string | null } }

const when = (d: string) => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const todayPh = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const CONTACT_PREF: Record<string, string> = {
  call_ok: 'Calls and texts are fine', text_first: 'Text first before calling', no_phone: 'Do not call or text - not safe',
};
const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Started', SAVED: 'Draft saved', ISSUED: 'Issued', ACKNOWLEDGED: 'Receipt recorded', RETURNED: 'Returned for follow-up',
  CANCELLED: 'Cancelled', SCAN_ADDED: 'Scan added', DOCUMENT_GENERATED: 'PDF downloaded',
};
const ACCENT = '#7c3aed';

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export default function ServiceReferralEditor({ caseId, referralId, basePath }: { caseId: string; referralId: string; basePath: string }) {
  const router = useRouter();
  const theme = useTheme();
  const twoPanel = useMediaQuery(theme.breakpoints.up('lg'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  // The one copy of the form's values: the fields and the preview both read it.
  const [form, setForm] = useState<ServiceReferralForm>(EMPTY_SERVICE_REFERRAL_FORM);
  // What is on screen now - read by a save that finishes while the officer keeps typing.
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'pdf' | 'issue' | 'ack' | 'cancel' | 'scan'>(null);
  const lock = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [changed, setChanged] = useState<{ key: FormKey; n: number } | null>(null);
  const [panel, setPanel] = useState<'edit' | 'preview'>('edit');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'issue' | 'ack' | 'cancel'>(null);
  const [nameSplit, setNameSplit] = useState(false);
  const [missingKeys, setMissingKeys] = useState<FormKey[]>([]);

  const base = `/api/cases/${caseId}/service-referrals/${referralId}`;
  const load = useCallback(async () => {
    const { ok, status, json } = await call(base, 'GET');
    if (!ok) { setLoadError({ status, message: json.error ?? 'The referral could not be opened.' }); return; }
    const data = json.data as Loaded;
    setLoaded(data); setForm(data.referral.form); setDirty(false); setConflict(false); setLoadError(null);
  }, [base]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const r = loaded?.referral;
  const editable = Boolean(loaded?.access.edit && r?.status === 'DRAFT');
  const problems = useMemo(() => issueProblems(form), [form]);
  // Field-level checks, as the server will make them.
  const fieldErrors = useMemo(() => {
    const p = serviceReferralFormSchema.safeParse(form);
    const out: Partial<Record<FormKey, string>> = {};
    if (!p.success) for (const i of p.error.issues) { const k = i.path[0] as FormKey; if (k && !out[k]) out[k] = i.message; }
    return out;
  }, [form]);

  /** Every change goes through here: the one state, normalised, and the preview told which part moved. */
  const update = (patch: Partial<ServiceReferralForm>, key: FormKey) => {
    setForm(f => normalizeForm({ ...f, ...patch }));
    setDirty(true);
    setChanged(c => ({ key, n: (c?.n ?? 0) + 1 }));
    setMissingKeys(m => m.filter(k => k !== key));
    if (key === 'referredByFirst' || key === 'referredByLast') setNameSplit(false);
  };

  /** Save the draft on screen. One at a time; the version sent is the one on screen. */
  const save = useCallback(async (quiet = false): Promise<Referral | null> => {
    if (!r || !editable) return null;
    const sent = formRef.current;
    const { ok, status, json } = await call(base, 'PUT', { expectedVersion: r.version, form: sent });
    if (status === 409) { setConflict(true); toast.error(json.error ?? 'Saved elsewhere - reload', { id: 'sr-save' }); return null; }
    if (!ok) { toast.error(json.error ?? 'Not saved - your changes are still on this page', { id: 'sr-save' }); return null; }
    const fresh = json.data.referral as Referral;
    setLoaded(l => (l ? { ...l, referral: fresh } : l));
    // Take the server's copy only when nothing was typed while saving; otherwise it stays unsaved.
    const typedSince = changedKeys(formRef.current, sent).length > 0;
    if (!typedSince) setForm(fresh.form);
    setDirty(typedSince);
    if (!quiet) toast.success(json.data.unchanged ? 'No changes to save' : 'Draft saved', { id: 'sr-save' });
    return fresh;
  }, [r, editable, base]);

  /** Run one action at a time - a second click while the first is on its way does nothing. */
  const once = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(kind);
    try { await fn(); } finally { lock.current = false; setBusy(null); }
  };

  const download = (copy: 'issued' | 'record' = 'issued') => once('pdf', async () => {
    if (!r) return;
    if (dirty && editable) {
      if (!(await save(true))) { toast.error('The PDF was not made: the latest changes could not be saved first.'); return; }
    } else if (dirty && !window.confirm('The PDF has the saved version. Your unsaved changes will not be in it. Continue?')) return;
    const res = await fetch(`${base}/pdf?copy=${copy}`, { credentials: 'include' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'The PDF could not be made'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    const suffix = r.status === 'DRAFT' ? '-DRAFT' : r.status === 'CANCELLED' ? '-CANCELLED' : copy === 'record' ? '-RECORD' : '';
    a.href = url; a.download = `Service-Referral-${r.reference}${suffix}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    void load();
  });

  const jumpTo = (key: FormKey) => {
    setPanel('edit'); setPreviewOpen(false);
    setTimeout(() => {
      const el = document.getElementById(`sr-${key}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    }, 80);
  };

  const leave = (to = `${basePath}/${caseId}`) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push(to);
  };

  if (loadError) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Alert severity={loadError.status === 404 ? 'info' : 'error'} icon={<Lock />} sx={{ borderRadius: 2, maxWidth: 640 }}>
          {loadError.status === 404 ? 'Referral not found.' : loadError.message}
        </Alert>
        <Button startIcon={<ArrowBack />} onClick={() => router.push(`${basePath}/${caseId}`)} sx={{ mt: 2 }}>Back to the case</Button>
      </Box>
    );
  }
  if (!loaded || !r) return <Box sx={{ p: 3 }}><LinearProgress /></Box>;
  const ctx = loaded.context;
  const sectionC: SectionC = r.ack;
  const missing = new Set(missingKeys);

  const tf = (k: TextKey, opts: { label?: string; multiline?: boolean; type?: string; hint?: string; size?: 12 | 6 | 4 | 3 } = {}) => {
    const pre = r.prefilled[k];
    const fromPrefill = pre && form[k] === pre.value;
    const err = fieldErrors[k];
    return (
      <Grid size={{ xs: 12, sm: opts.size ?? 12 }} id={`sr-${k}`}>
        <TextField fullWidth size="small" label={opts.label ?? FIELD_LABELS[k]} value={form[k]} disabled={!editable}
          type={opts.type ?? 'text'} multiline={opts.multiline} minRows={opts.multiline ? 2 : undefined}
          onChange={e => update({ [k]: e.target.value } as Partial<ServiceReferralForm>, k)}
          error={Boolean(err) || missing.has(k)}
          helperText={err ?? (missing.has(k) ? 'Required before issuing' : fromPrefill ? `From ${pre!.source} - check it` : (k === 'referredByFirst' || k === 'referredByLast') && nameSplit ? 'Split from your account name - check it' : opts.hint)}
          slotProps={{ htmlInput: { maxLength: k === 'actionTaken' ? 600 : 300 }, formHelperText: { sx: { color: fromPrefill && !err ? '#0e7490' : undefined } } }} />
      </Grid>
    );
  };

  const statusChip = (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      <Chip size="small" label={REFERRAL_STATUS[r.status]} sx={{ fontWeight: 800, bgcolor: r.status === 'DRAFT' ? '#fef3c7' : r.status === 'ISSUED' ? '#ede9fe' : '#f1f5f9', color: r.status === 'DRAFT' ? '#a16207' : r.status === 'ISSUED' ? ACCENT : '#475569' }} />
      {r.status !== 'DRAFT' && r.ack.status && (
        <Chip size="small" label={ACK_STATUS[r.ack.status as AckStatus]} sx={{ fontWeight: 700, bgcolor: r.ack.status === 'ACKNOWLEDGED' ? '#dcfce7' : r.ack.status === 'RETURNED' ? '#ffedd5' : '#f1f5f9', color: r.ack.status === 'ACKNOWLEDGED' ? '#15803d' : r.ack.status === 'RETURNED' ? '#c2410c' : '#475569' }} />
      )}
      {dirty && <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: '#a16207' }}>Unsaved changes</Typography>}
    </Box>
  );

  const preview = (variant: 'panel' | 'print' = 'panel') => (
    <ServiceReferralPreview form={form} reference={r.reference} status={r.status} sectionC={sectionC} unsaved={dirty}
      changed={variant === 'panel' ? changed : null} onJump={editable ? jumpTo : undefined} variant={variant} />
  );

  return (
    <Box sx={twoPanel
      ? { p: 3, maxWidth: 1760, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
      : { p: { xs: 1.5, sm: 3 }, maxWidth: 1000 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <Button startIcon={<ArrowBack />} onClick={() => leave()} sx={{ color: '#64748b', minHeight: 40 }}>Case #{ctx.caseNumber}</Button>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46' }}>Service Referral Form</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
            CONFIDENTIAL · {r.reference} · version {r.version} · last saved {when(r.updatedAt)}{r.updatedBy ? ` by ${r.updatedBy}` : ''}
          </Typography>
          {statusChip}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {editable && (
            <Button variant="outlined" startIcon={busy === 'save' ? <CircularProgress size={16} /> : <Save />} disabled={Boolean(busy) || !dirty || conflict}
              onClick={() => once('save', async () => { await save(); })} sx={{ minHeight: 40 }}>Save Draft</Button>
          )}
          <Button variant="outlined" startIcon={<Visibility />} onClick={() => (twoPanel ? setPreviewOpen(true) : setPanel('preview'))} sx={{ minHeight: 40 }}>Preview Document</Button>
          <Button variant="outlined" startIcon={busy === 'pdf' ? <CircularProgress size={16} /> : <PictureAsPdf />} disabled={Boolean(busy)} onClick={() => void download('issued')} sx={{ minHeight: 40 }}>
            {r.status === 'DRAFT' ? 'Generate PDF (draft)' : r.status === 'ISSUED' ? 'Issued PDF' : 'PDF (cancelled)'}
          </Button>
          {editable && (
            <Button variant="contained" startIcon={<Send />} disabled={Boolean(busy) || conflict} onClick={() => setDialog('issue')}
              sx={{ minHeight: 40, bgcolor: ACCENT, fontWeight: 800, '&:hover': { bgcolor: '#6d28d9' } }}>Issue / Record Referral</Button>
          )}
          <Button startIcon={<History />} onClick={() => leave(`${basePath}/${caseId}#service-referrals`)} sx={{ minHeight: 40 }}>Referral History</Button>
        </Box>
      </Box>

      {loaded.access.message && <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2 }}>{loaded.access.message}</Alert>}
      {!loaded.access.edit && !loaded.access.message && <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2 }}>You can view this referral. Changing it is for the VAWC officer the case is assigned to.</Alert>}
      {conflict && (
        <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}
          action={<Button size="small" onClick={() => { if (!dirty || window.confirm('Reloading replaces your unsaved changes with the saved version. Continue?')) void load(); }}>Reload</Button>}>
          This referral was changed elsewhere since you opened it. Your changes are still on this page; reload to see the saved version.
        </Alert>
      )}

      {!twoPanel && (
        <Tabs value={panel} onChange={(_, v) => setPanel(v)} variant="fullWidth" sx={{ mb: 1.5, borderBottom: '1px solid #e2e8f0' }} aria-label="Edit form or preview">
          <Tab value="edit" label="Edit Form" sx={{ fontWeight: 700 }} />
          <Tab value="preview" label="Preview" sx={{ fontWeight: 700 }} />
        </Tabs>
      )}

      <Box sx={twoPanel ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2.5, flex: 1, minHeight: 0 } : undefined}>
        {/* The fields stay mounted while the preview tab is shown, so nothing typed is lost. */}
        <Box data-testid="referral-edit-pane" sx={{ minWidth: 0, display: !twoPanel && panel === 'preview' ? 'none' : 'flex', flexDirection: 'column', gap: 2,
          // The cards keep their full height and the column scrolls; a shrinking card cut its fields off.
          '& > *': { flexShrink: 0 },
          ...(twoPanel && { overflowY: 'auto', minHeight: 0, pr: 1 }) }}>

          <CaseContextCard ctx={ctx} />
          {r.status === 'CANCELLED' && r.cancelled && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>Cancelled {when(r.cancelled.at)}{r.cancelled.by ? ` by ${r.cancelled.by}` : ''}. Reason: {r.cancelled.reason}</Alert>
          )}
          {r.status === 'ISSUED' && (
            <IssuedCard r={r} edit={loaded.access.edit} busy={Boolean(busy)} onAck={() => setDialog('ack')} onCancel={() => setDialog('cancel')}
              onRecordCopy={() => void download('record')} />
          )}
          {editable && <ChecklistCard problems={problems} onJump={jumpTo} />}

          <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
            <SectionTitle>Client Code and Incident No.</SectionTitle>
            <Grid container spacing={1.5}>
              {tf('clientCode', { size: 6, hint: 'As on the intake form - no names' })}
              {tf('incidentNo', { size: 6 })}
            </Grid>
          </CardContent></Card>

          <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
            <SectionTitle>A. Referring Organization Information</SectionTitle>
            <Grid container spacing={1.5}>
              {tf('referringOrganization')}
              {tf('actionTaken', { multiline: true, hint: 'What your office has done so far - briefly, without the narrative' })}
              {tf('referredByLast', { size: 6, label: '3. Referred by - Last Name' })}
              {tf('referredByFirst', { size: 6, label: 'First Name' })}
              {tf('referredByMiddle', { size: 6, label: 'Middle Name' })}
              {tf('referredByExt', { size: 6, label: 'Extension (Jr., III), if any' })}
              {editable && loaded.me.name && !form.referredByLast && !form.referredByFirst && (
                <Grid size={12}>
                  <Button size="small" startIcon={<Person />} sx={{ textTransform: 'none' }} onClick={() => {
                    const parts = loaded.me.name!.trim().split(/\s+/);
                    const last = parts.length > 1 ? parts.pop()! : '';
                    update({ referredByFirst: parts.join(' '), referredByLast: last }, 'referredByLast');
                    setNameSplit(true);
                  }}>Use my account name ({loaded.me.name}) - check how it is split</Button>
                </Grid>
              )}
              {tf('position', { size: 6 })}
              {tf('contactNo', { size: 6 })}
              {tf('email', { type: 'email' })}
              {tf('addressNo', { size: 3, label: '7. Address - No.' })}
              {tf('addressStreet', { size: 3, label: 'Street Name' })}
              {tf('addressBarangay', { size: 3, label: 'Barangay' })}
              {tf('addressCity', { size: 3, label: 'City/Mun' })}
            </Grid>
          </CardContent></Card>

          <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
            <SectionTitle>B. Service Referral Information</SectionTitle>
            <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1 }}>
              One referral is for one receiving organization. To refer the client to both a barangay and a social welfare office, issue this one and create another for the second - each keeps its own document and acknowledgement.
            </Typography>
            <SuggestionsBox suggestions={ctx.suggestions} editable={editable} form={form}
              onPick={k => update({ destination: SERVICES[k].destination, services: [...form.services, k] }, 'services')} />
            <Box id="sr-destination" sx={{ mt: 1.5, ...(missing.has('destination') && { borderLeft: '3px solid #ef4444', pl: 1 }) }}>
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46' }}>8. Referral Service - referred to</Typography>
              <RadioGroup value={form.destination} onChange={e => {
                const d = e.target.value as Destination;
                if (form.services.length && form.destination && d !== form.destination && !window.confirm('Changing where the client is referred clears the services ticked. Continue?')) return;
                update({ destination: d, services: d === form.destination ? form.services : [] }, 'destination');
              }}>
                {DESTINATION_KEYS.map(d => <FormControlLabel key={d} value={d} disabled={!editable} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.88rem' }}>{DESTINATIONS[d].label}</Typography>} />)}
              </RadioGroup>
            </Box>
            {form.destination && (
              <>
                <Box id="sr-services" sx={{ mt: 1, pl: 1.5, borderLeft: `3px solid ${missing.has('services') ? '#ef4444' : '#ede9fe'}` }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>Services (tick all that apply)</Typography>
                  {servicesFor(form.destination).map(k => (
                    <Box key={k}>
                      <FormControlLabel disabled={!editable} control={<Checkbox size="small" checked={form.services.includes(k)}
                        onChange={e => update({ services: e.target.checked ? [...form.services, k] : form.services.filter(s => s !== k) }, 'services')} />}
                        label={<Typography sx={{ fontSize: '0.86rem' }}>{SERVICES[k].label}</Typography>} />
                      {'other' in SERVICES[k] && form.services.includes(k) && (
                        <Box id="sr-serviceOther" sx={{ pl: 4, pb: 1 }}>
                          <TextField size="small" fullWidth label="Specify the other service" value={form.serviceOther} disabled={!editable}
                            error={Boolean(fieldErrors.serviceOther) || missing.has('serviceOther')} helperText={fieldErrors.serviceOther}
                            onChange={e => update({ serviceOther: e.target.value }, 'serviceOther')} slotProps={{ htmlInput: { maxLength: 200 } }} />
                        </Box>
                      )}
                    </Box>
                  ))}
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>Ticking a service asks for it. It does not record that the service has been provided.</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46', mt: 2, mb: 1 }}>
                  Receiving organization - {DESTINATIONS[form.destination].short}
                </Typography>
                <Grid container spacing={1.5}>
                  {tf('receivingAgency', { label: form.destination === 'BARANGAY' ? 'Barangay / Office' : 'Agency/Organization', hint: 'The office you have confirmed will receive this' })}
                  {tf('receivingAddress', { multiline: true })}
                  {tf('receivingContactPerson')}
                  {tf('receivingContactNo', { size: 6 })}
                  {tf('receivingEmail', { size: 6, type: 'email' })}
                </Grid>
              </>
            )}
          </CardContent></Card>

          <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
            <SectionTitle>Signatures</SectionTitle>
            <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem', mb: 1.5 }}>
              SafeComm has no electronic signature. Print the form; the client (or parent/guardian) and you sign it by hand. Keep a scan of the signed copy with this referral once it is issued. A typed name is never treated as a signature.
            </Alert>
            <Box id="sr-clientSignatory">
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46' }}>Who will sign the client&rsquo;s line</Typography>
              <RadioGroup value={form.clientSignatory} onChange={e => update({ clientSignatory: e.target.value as ClientSignatory }, 'clientSignatory')}>
                {(Object.keys(CLIENT_SIGNATORY) as ClientSignatory[]).map(k => (
                  <FormControlLabel key={k} value={k} disabled={!editable} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.86rem' }}>{CLIENT_SIGNATORY[k]}</Typography>} />
                ))}
              </RadioGroup>
            </Box>
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 1 }}>
              The service provider&rsquo;s printed name comes from &ldquo;Referred by&rdquo;. The signature line and both dates are left for a hand.
            </Typography>
          </CardContent></Card>

          <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.5 } }}>
            <SectionTitle>C. To be accomplished by the Receiving Organization</SectionTitle>
            <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>
              {r.status === 'DRAFT'
                ? 'Left blank for the receiving organization. Once the referral is issued, record their acknowledgement here from the signed copy or their confirmation.'
                : r.status === 'ISSUED' ? `${ACK_STATUS[(r.ack.status ?? 'AWAITING') as AckStatus]}.` : 'This referral was cancelled.'}
            </Typography>
          </CardContent></Card>

          <ScansCard r={r} caseId={caseId} edit={Boolean(loaded.access.edit && r.status !== 'CANCELLED')} busy={Boolean(busy)}
            onUpload={(kind, dataUrl) => once('scan', async () => {
              const { ok, json } = await call(`${base}/attachments`, 'POST', { kind, dataUrl });
              if (!ok) { toast.error(json.error ?? 'The scan was not saved'); return; }
              setLoaded(l => (l ? { ...l, referral: json.data.referral } : l));
              toast.success('Scan kept with the referral');
            })} />
          <EventsCard r={r} />
          {editable && (
            <Box>
              <Button color="inherit" startIcon={<BlockIcon />} onClick={() => setDialog('cancel')} sx={{ color: '#64748b' }}>Discard this draft (cancel)</Button>
            </Box>
          )}
        </Box>

        {(twoPanel || panel === 'preview') && (
          <Box sx={{ height: twoPanel ? '100%' : '80vh', minHeight: twoPanel ? 0 : 420, minWidth: 0 }}>{preview()}</Box>
        )}
      </Box>

      {previewOpen && (
        <Dialog open fullScreen onClose={() => setPreviewOpen(false)} aria-label="Document preview">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: '1px solid #e2e8f0' }}>
            <Typography sx={{ fontWeight: 800, color: '#0c1e46' }}>Service Referral Form - {r.reference}</Typography>
            <IconButton onClick={() => setPreviewOpen(false)} aria-label="Close preview" sx={{ ml: 'auto' }}><Close /></IconButton>
          </Box>
          <Box sx={{ height: 'calc(100vh - 58px)', p: 1.5 }}>{preview()}</Box>
        </Dialog>
      )}

      {dialog === 'issue' && (
        <IssueDialog form={form} problems={problems} busy={busy === 'issue'} dirty={dirty} onClose={() => setDialog(null)} onJump={k => { setDialog(null); setMissingKeys(problems.required.map(p => p.key)); jumpTo(k); }}
          onIssue={(issuedVia) => once('issue', async () => {
            let current = r;
            if (dirty) { const s = await save(true); if (!s) return; current = s; }
            const { ok, status, json } = await call(`${base}/issue`, 'POST', { expectedVersion: current.version, issuedVia, recipientVerified: true });
            if (status === 422 && Array.isArray(json.missing)) { setMissingKeys(json.missing.map((m: Problem) => m.key)); toast.error(json.error); return; }
            if (status === 409) { setConflict(true); toast.error(json.error ?? 'Already issued or changed - reload'); return; }
            if (!ok) { toast.error(json.error ?? 'Not issued'); return; }
            setLoaded(l => (l ? { ...l, referral: json.data.referral } : l)); setForm(json.data.referral.form); setDirty(false);
            setDialog(null);
            toast.success(`${current.reference} issued - awaiting acknowledgement from the receiving organization`, { duration: 6000 });
          })} />
      )}
      {dialog === 'ack' && (
        <AckDialog issuedAt={r.issuedAt!} from={(r.ack.status ?? 'AWAITING') as AckStatus} busy={busy === 'ack'} onClose={() => setDialog(null)}
          onSave={body => once('ack', async () => {
            const { ok, json } = await call(`${base}/acknowledgement`, 'POST', body);
            if (!ok) { toast.error(json.error ?? 'Not recorded'); return; }
            setLoaded(l => (l ? { ...l, referral: json.data.referral } : l));
            setDialog(null);
            toast.success(body.status === 'ACKNOWLEDGED' ? 'Receipt recorded' : 'Recorded as returned for follow-up');
          })} />
      )}
      {dialog === 'cancel' && (
        <CancelDialog busy={busy === 'cancel'} issued={r.status === 'ISSUED'} onClose={() => setDialog(null)}
          onCancel={reason => once('cancel', async () => {
            const { ok, json } = await call(`${base}/cancel`, 'POST', { reason });
            if (!ok) { toast.error(json.error ?? 'Not cancelled'); return; }
            setLoaded(l => (l ? { ...l, referral: json.data.referral } : l)); setDirty(false); setForm(json.data.referral.form);
            setDialog(null);
            toast.success('Referral cancelled');
          })} />
      )}
      {editable && (
        <Box sx={{ position: 'fixed', bottom: 16, right: 16, display: { xs: 'block', lg: 'none' }, zIndex: 10 }}>
          {dirty && <Button variant="contained" startIcon={<Save />} disabled={Boolean(busy) || conflict} onClick={() => once('save', async () => { await save(); })}
            sx={{ borderRadius: 6, boxShadow: 3 }}>Save Draft</Button>}
        </Box>
      )}
    </Box>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: '#0c1e46', mb: 1.25 }}>{children}</Typography>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.3, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', minWidth: 150 }}>{label}</Typography>
      <Typography component="div" sx={{ fontSize: '0.84rem', color: '#0c1e46', fontWeight: 600, flex: 1, minWidth: 0 }}>{value}</Typography>
    </Box>
  );
}

function CaseContextCard({ ctx }: { ctx: Context }) {
  return (
    <Card sx={{ borderLeft: `4px solid ${ACCENT}` }}><CardContent sx={{ p: { xs: 1.75, sm: 2.25 } }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0c1e46', mb: 0.75 }}>Linked to VAWC case #{ctx.caseNumber}</Typography>
      <Grid container spacing={1}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Row label="Case type" value={ctx.caseType} />
          <Row label="Case status" value={ctx.status} />
          <Row label="Preliminary risk" value={riskText(ctx.riskLevel)} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Row label="Assigned officer" value={ctx.assignedTo ?? 'Unassigned'} />
          <Row label="Official intake" value={ctx.intakeStatus === 'COMPLETED' ? 'Completed' : ctx.intakeStatus === 'DRAFT' ? 'Draft' : 'Not started'} />
          <Row label="Safe-contact preference" value={ctx.contactPreference ? CONTACT_PREF[ctx.contactPreference] ?? ctx.contactPreference : 'Not stated'} />
        </Grid>
      </Grid>
      <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mt: 1 }}>
        Only what this referral needs goes on the form. The narrative, evidence and other people&rsquo;s details are not copied into it, and nothing here changes the case.
        {ctx.contactPreference === 'no_phone' && ' The reporter said phone contact is not safe - tell the receiving organization before it contacts the client.'}
        {ctx.intakeStatus !== 'COMPLETED' && ' The form asks that a copy of the intake form go with it - the intake is not completed yet.'}
      </Typography>
    </CardContent></Card>
  );
}

function SuggestionsBox({ suggestions, editable, form, onPick }: { suggestions: Suggestion[]; editable: boolean; form: ServiceReferralForm; onPick: (k: ServiceKey) => void }) {
  return (
    <Box sx={{ bgcolor: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 2, p: 1.25 }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem', fontWeight: 800, color: '#6b21a8' }}>
        <Lightbulb sx={{ fontSize: 16 }} /> From the case&rsquo;s safety assessment - suggestions only, you decide
      </Typography>
      {suggestions.map(s => {
        const blocked = s.service ? Boolean(form.destination && form.destination !== SERVICES[s.service].destination) : false;
        const done = s.service ? form.services.includes(s.service) : false;
        return (
          <Box key={s.text} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 0.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.8rem', color: '#4c1d95', flex: 1, minWidth: 200 }}>{s.text}</Typography>
            {s.service && editable && !done && (
              <Button size="small" disabled={blocked} onClick={() => onPick(s.service!)} sx={{ textTransform: 'none', py: 0 }}>
                {blocked ? 'For the other office - create a separate referral' : `Tick "${SERVICES[s.service].label}"`}
              </Button>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ChecklistCard({ problems, onJump }: { problems: { required: Problem[]; recommended: Problem[] }; onJump: (k: FormKey) => void }) {
  if (!problems.required.length && !problems.recommended.length) {
    return <Alert severity="success" sx={{ borderRadius: 2 }}>Everything the form needs is filled in. Check it against the preview, then issue it.</Alert>;
  }
  return (
    <Alert severity={problems.required.length ? 'warning' : 'info'} sx={{ borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.86rem' }}>
        {problems.required.length ? `${problems.required.length} item${problems.required.length === 1 ? '' : 's'} to fill in before issuing` : 'Ready to issue - a few optional items are blank'}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {problems.required.map(p => <li key={`r-${p.key}`}><Button size="small" onClick={() => onJump(p.key)} sx={{ textTransform: 'none', p: 0, minWidth: 0, fontWeight: 700 }}>{p.label}</Button> - {p.message}</li>)}
        {problems.recommended.map(p => <li key={`o-${p.key}`} style={{ color: '#475569' }}><Button size="small" onClick={() => onJump(p.key)} sx={{ textTransform: 'none', p: 0, minWidth: 0 }}>{p.label}</Button> - {p.message} (optional)</li>)}
      </Box>
    </Alert>
  );
}

function IssuedCard({ r, edit, busy, onAck, onCancel, onRecordCopy }: { r: Referral; edit: boolean; busy: boolean; onAck: () => void; onCancel: () => void; onRecordCopy: () => void }) {
  const ack = r.ack.status as AckStatus;
  return (
    <Card sx={{ border: '1px solid #ddd6fe' }}><CardContent sx={{ p: { xs: 1.75, sm: 2.25 } }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0c1e46', mb: 0.5 }}>Issued {r.issuedAt ? when(r.issuedAt) : ''}{r.issuedBy ? ` by ${r.issuedBy}` : ''}</Typography>
      <Row label="How it was given" value={r.issuedVia ? ISSUED_VIA[r.issuedVia] : '-'} />
      <Row label="Receiving organization" value={r.receivingOrganization ?? '-'} />
      <Row label="Services requested" value={r.services.map(k => serviceLabel(k, r.form)).join('; ')} />
      <Row label="Document reference" value={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.74rem', wordBreak: 'break-all' }}>SHA-256 {r.documentSha256}</Box>} />
      <Divider sx={{ my: 1 }} />
      <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46' }}>Section C - {ACK_STATUS[ack]}</Typography>
      {ack !== 'AWAITING' && (
        <>
          <Row label="Received by (printed name)" value={r.ack.receivedByName ?? '-'} />
          <Row label="Position / Job Title" value={r.ack.position ?? '-'} />
          <Row label="Their client code" value={r.ack.clientCode ?? '-'} />
          <Row label="Date received" value={r.ack.dateReceived ? mmddyyyy(r.ack.dateReceived) : '-'} />
          <Row label="Remarks" value={r.ack.remarks ?? '-'} />
          <Row label="Recorded from" value={r.ack.basis ? ACK_BASIS[r.ack.basis] : '-'} />
          <Row label="Recorded by" value={`${r.ack.recordedBy ?? '-'}${r.ack.recordedAt ? ` · ${when(r.ack.recordedAt)}` : ''}`} />
        </>
      )}
      <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mt: 0.5 }}>
        Issued is not received, and received is not provided: record receipt only from the receiving organization&rsquo;s signed copy or confirmation.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.25 }}>
        {edit && ack !== 'ACKNOWLEDGED' && (
          <Button variant="contained" size="small" startIcon={ack === 'RETURNED' ? <Undo /> : <TaskAlt />} disabled={busy} onClick={onAck} sx={{ bgcolor: '#15803d', '&:hover': { bgcolor: '#166534' } }}>
            Record acknowledgement
          </Button>
        )}
        {ack !== 'AWAITING' && <Button size="small" variant="outlined" startIcon={<PictureAsPdf />} disabled={busy} onClick={onRecordCopy}>Record copy (with Section C)</Button>}
        {edit && cancelAllowed('ISSUED', ack) && <Button size="small" color="inherit" startIcon={<BlockIcon />} disabled={busy} onClick={onCancel} sx={{ color: '#64748b' }}>Withdraw (cancel)</Button>}
      </Box>
    </CardContent></Card>
  );
}

function EventsCard({ r }: { r: Referral }) {
  return (
    <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.25 } }}>
      <SectionTitle>This referral&rsquo;s history</SectionTitle>
      {r.events.slice().reverse().map(e => (
        <Box key={e.id} sx={{ display: 'flex', gap: 1, py: 0.4, borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#0c1e46', minWidth: 140 }}>{EVENT_LABEL[e.type] ?? e.type}</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: '#475569', flex: 1, minWidth: 160 }}>
            {e.by ?? 'Unknown'} · {when(e.at)}{e.version ? ` · v${e.version}` : ''}
            {e.type === 'SAVED' && e.changedKeys.length ? ` · ${e.changedKeys.length} field${e.changedKeys.length === 1 ? '' : 's'} changed` : ''}
            {e.note && e.type !== 'CANCELLED' ? ` · ${e.note}` : ''}
          </Typography>
        </Box>
      ))}
    </CardContent></Card>
  );
}

function ScansCard({ r, caseId, edit, busy, onUpload }: { r: Referral; caseId: string; edit: boolean; busy: boolean; onUpload: (kind: 'SIGNED_REFERRAL' | 'ACKNOWLEDGEMENT', dataUrl: string) => void }) {
  const [kind, setKind] = useState<'SIGNED_REFERRAL' | 'ACKNOWLEDGEMENT'>('SIGNED_REFERRAL');
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.25 } }}>
      <SectionTitle>Signed copies (print, sign, scan)</SectionTitle>
      <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mb: 1 }}>
        Kept privately with this referral and opened only after the same access check. No file name is kept.
      </Typography>
      {r.attachments.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No scans yet.</Typography>}
      {r.attachments.map((a, i) => (
        <Box key={a.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.3 }}>
          <Button size="small" href={`/api/cases/${caseId}/service-referrals/${r.id}/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" sx={{ textTransform: 'none' }}>
            Scan {i + 1}: {a.kind === 'SIGNED_REFERRAL' ? 'signed referral form' : 'acknowledgement'}
          </Button>
          <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>{a.by ?? '-'} · {when(a.at)} · {Math.round(a.size / 1024)} KB</Typography>
        </Box>
      ))}
      {edit && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>What is it</InputLabel>
            <Select label="What is it" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
              <MenuItem value="SIGNED_REFERRAL">Signed referral form</MenuItem>
              <MenuItem value="ACKNOWLEDGEMENT" disabled={r.status !== 'ISSUED'}>Receiving organization&rsquo;s acknowledgement</MenuItem>
            </Select>
          </FormControl>
          <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > 3 * 1024 * 1024) { toast.error('The file must be under 3 MB'); return; }
            const reader = new FileReader();
            reader.onload = () => onUpload(kind, String(reader.result));
            reader.readAsDataURL(file);
          }} />
          <Button variant="outlined" size="small" startIcon={<UploadFile />} disabled={busy} onClick={() => input.current?.click()}>Add scan (JPG, PNG, PDF)</Button>
        </Box>
      )}
    </CardContent></Card>
  );
}

function IssueDialog({ form, problems, busy, dirty, onClose, onJump, onIssue }: {
  form: ServiceReferralForm; problems: { required: Problem[]; recommended: Problem[] }; busy: boolean; dirty: boolean;
  onClose: () => void; onJump: (k: FormKey) => void; onIssue: (via: IssuedVia) => void;
}) {
  const [via, setVia] = useState<IssuedVia | ''>('');
  const [verified, setVerified] = useState(false);
  const blocked = problems.required.length > 0;
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Issue / Record Referral</DialogTitle>
      <DialogContent>
        {blocked ? (
          <Alert severity="warning" sx={{ borderRadius: 2, mb: 1.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.86rem' }}>Not ready to issue</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {problems.required.map(p => <li key={p.key}><Button size="small" onClick={() => onJump(p.key)} sx={{ textTransform: 'none', p: 0, minWidth: 0, fontWeight: 700 }}>{p.label}</Button> - {p.message}</li>)}
            </Box>
          </Alert>
        ) : (
          <>
            <Typography sx={{ fontSize: '0.86rem', color: '#334155', mb: 1.5 }}>
              Issuing records that you gave this referral to <b>{form.receivingAgency}</b> ({DESTINATIONS[form.destination as Destination].short}). SafeComm does not send it. After this the form cannot be changed, its PDF is kept as the issued document, and Section C waits for the receiving organization. Issuing does not mean the service has been provided.
            </Typography>
            {problems.recommended.length > 0 && (
              <Alert severity="info" sx={{ borderRadius: 2, mb: 1.5, fontSize: '0.8rem' }}>
                Optional items still blank: {problems.recommended.map(p => p.label).join('; ')}.
              </Alert>
            )}
            <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
              <InputLabel>How it is given</InputLabel>
              <Select label="How it is given" value={via} onChange={e => setVia(e.target.value as IssuedVia)}>
                {(Object.keys(ISSUED_VIA) as IssuedVia[]).map(k => <MenuItem key={k} value={k}>{ISSUED_VIA[k]}</MenuItem>)}
              </Select>
            </FormControl>
            {via === 'EMAIL' && (
              <Alert severity="warning" sx={{ borderRadius: 2, mb: 1.5, fontSize: '0.8rem' }}>
                Send it only to an address you have confirmed belongs to the receiving organization{form.receivingEmail ? ` (${form.receivingEmail})` : ''}, from your official account. Do not put the client&rsquo;s name in the subject line.
              </Alert>
            )}
            <FormControlLabel control={<Checkbox checked={verified} onChange={e => setVerified(e.target.checked)} />}
              label={<Typography sx={{ fontSize: '0.84rem' }}>I have confirmed that this is the right receiving organization and that its contact details are correct. The referral goes only to it.</Typography>} />
            {dirty && <Typography sx={{ fontSize: '0.76rem', color: '#a16207' }}>Your unsaved changes are saved first.</Typography>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        {!blocked && (
          <Button variant="contained" disabled={busy || !verified || !via} onClick={() => via && onIssue(via)} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Send />}
            sx={{ bgcolor: ACCENT, fontWeight: 800, '&:hover': { bgcolor: '#6d28d9' } }}>Issue referral</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function AckDialog({ issuedAt, from, busy, onClose, onSave }: {
  issuedAt: string; from: AckStatus; busy: boolean; onClose: () => void;
  onSave: (body: Record<string, string | undefined>) => void;
}) {
  const [f, setF] = useState({ status: 'ACKNOWLEDGED' as 'ACKNOWLEDGED' | 'RETURNED', basis: '' as AckBasis | '', receivedByName: '', position: '', clientCode: '', dateReceived: '', remarks: '' });
  const min = new Date(new Date(issuedAt).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const ack = f.status === 'ACKNOWLEDGED';
  const ready = f.basis && (ack ? f.receivedByName.trim().length >= 2 && f.dateReceived : f.remarks.trim().length >= 5);
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Record the receiving organization&rsquo;s acknowledgement</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ borderRadius: 2, mb: 1.5, fontSize: '0.8rem' }}>
          Record only what the receiving organization actually returned or confirmed{from === 'RETURNED' ? ' (it was returned for follow-up before)' : ''}. Receipt does not mean the service has been provided.
        </Alert>
        <RadioGroup row value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value as typeof f.status }))} sx={{ mb: 1 }}>
          <FormControlLabel value="ACKNOWLEDGED" control={<Radio size="small" />} label="Received / Acknowledged" />
          <FormControlLabel value="RETURNED" control={<Radio size="small" />} label="Returned for follow-up" />
        </RadioGroup>
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>What this is recorded from</InputLabel>
          <Select label="What this is recorded from" value={f.basis} onChange={e => setF(p => ({ ...p, basis: e.target.value as AckBasis }))}>
            {(Object.keys(ACK_BASIS) as AckBasis[]).map(k => <MenuItem key={k} value={k} sx={{ whiteSpace: 'normal' }}>{ACK_BASIS[k]}</MenuItem>)}
          </Select>
        </FormControl>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label={`9. Received by - printed name${ack ? '' : ' (if any)'}`} value={f.receivedByName} onChange={set('receivedByName')} helperText="As written on their copy - not a signature" slotProps={{ htmlInput: { maxLength: 160 } }} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label="10. Position / Job Title" value={f.position} onChange={set('position')} slotProps={{ htmlInput: { maxLength: 160 } }} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label="11. Client Code (theirs)" value={f.clientCode} onChange={set('clientCode')} slotProps={{ htmlInput: { maxLength: 80 } }} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth type="date" label={`12. Date of Received${ack ? '' : ' (if any)'}`} value={f.dateReceived} onChange={set('dateReceived')}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min, max: todayPh() } }} /></Grid>
          <Grid size={12}><TextField size="small" fullWidth multiline minRows={2} label={`13. Remarks${ack ? '' : ' - why it was returned, and the follow-up needed'}`} value={f.remarks} onChange={set('remarks')} slotProps={{ htmlInput: { maxLength: 1000 } }} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={() => onSave({ ...f, basis: f.basis || undefined, dateReceived: f.dateReceived || undefined, position: f.position || undefined, clientCode: f.clientCode || undefined, receivedByName: f.receivedByName || undefined, remarks: f.remarks || undefined })}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <TaskAlt />}>Record</Button>
      </DialogActions>
    </Dialog>
  );
}

function CancelDialog({ busy, issued, onClose, onCancel }: { busy: boolean; issued: boolean; onClose: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{issued ? 'Withdraw this referral' : 'Discard this draft'}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.84rem', color: '#475569', mb: 1.5 }}>
          It is kept as cancelled, with its history{issued ? ' and its issued document' : ''}; it is not deleted.{issued ? ' Tell the receiving organization it is withdrawn.' : ''}
        </Typography>
        <TextField fullWidth size="small" multiline minRows={2} label="Reason" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Keep it</Button>
        <Button color="error" variant="contained" disabled={busy || reason.trim().length < 5} onClick={() => onCancel(reason)}>Cancel referral</Button>
      </DialogActions>
    </Dialog>
  );
}
