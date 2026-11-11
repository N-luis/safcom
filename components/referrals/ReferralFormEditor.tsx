'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Button, TextField, MenuItem, Alert, CircularProgress, LinearProgress, Tabs, Tab, useMediaQuery, useTheme,
} from '@mui/material';
import { ArrowBack, Save, PictureAsPdf, Lock } from '@mui/icons-material';
import toast from 'react-hot-toast';
import ReferralFormPreview, { type PreviewKey } from '@/components/referrals/ReferralFormPreview';
import { REFERRAL_AGENCIES, referralAgenciesFor, type ReferralAgency, type ReportPath } from '@/lib/caseRecords';
import { REFERRAL_FORM_LABELS, EMPTY_REFERRAL_FORM, CLIENT_SEX, referralFormSchema, type ReferralFormKey } from '@/lib/referralForm';

/**
 * The Referral Form for one case, with a live preview - like the intake form.
 *
 * The fields on the left and, on the right, the form as it prints
 * (ReferralFormPreview) drawn from the same `v` state: there is no second
 * copy of the values, so every keystroke shows at once. On a small screen the
 * two are the Input and Preview tabs.
 *
 * A new referral starts from what the case records (the server's prefill,
 * each value marked with its source) and is saved as a referral on the case;
 * after that the form can be corrected. The PDF is made by the server from
 * what is saved, so unsaved changes are saved first. Who may open, save or
 * download it is decided by the server on every request.
 */

interface Values {
  agency: ReferralAgency | '';
  agencyOther: string;
  /** YYYY-MM-DD */
  referredAt: string;
  reason: string;
  form: Record<ReferralFormKey, string>;
}
interface Loaded {
  caseNumber: string;
  desk: ReportPath;
  /** Null until the referral is first saved. */
  referralId: string | null;
  from: Partial<Record<ReferralFormKey, string>>;
  prefilled: Partial<Record<ReferralFormKey, string>>;
  edit: boolean;
  message: string | null;
}

const todayPh = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const phDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);
const toLabel = (v: Values) => (v.agency === 'OTHER' ? v.agencyOther : v.agency ? REFERRAL_AGENCIES[v.agency].label : '');

export default function ReferralFormEditor({ caseId, referralId, basePath }: { caseId: string; referralId: string | null; basePath: string }) {
  const router = useRouter();
  const theme = useTheme();
  const twoPanel = useMediaQuery(theme.breakpoints.up('lg'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  // The one copy of the values: the fields and the preview both read it.
  const [v, setV] = useState<Values>({ agency: '', agencyOther: '', referredAt: todayPh(), reason: '', form: { ...EMPTY_REFERRAL_FORM } });
  const [saved, setSaved] = useState<Values | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'pdf'>(null);
  const lock = useRef(false);
  const [panel, setPanel] = useState<'input' | 'preview'>('input');
  const [changed, setChanged] = useState<{ key: PreviewKey; n: number } | null>(null);
  const isNew = !loaded?.referralId;
  // A new referral's unsaved starting point is in `saved` too, so this is "typed since".
  const dirty = !saved || !same(v, saved);

  const load = useCallback(async () => {
    const url = referralId ? `/api/cases/${caseId}/referrals/${referralId}` : `/api/cases/${caseId}/referrals`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setLoadError({ status: res.status, message: json.error ?? 'The referral form could not be opened.' }); return; }
    const d = json.data;
    if (referralId) {
      const r = d.referral;
      const values: Values = { agency: r.agency, agencyOther: r.agencyOther ?? '', referredAt: phDay(r.referredAt), reason: r.reason ?? '', form: r.form };
      setV(values); setSaved(values);
      setLoaded({ caseNumber: d.caseNumber, desk: d.desk, referralId, from: {}, prefilled: {}, edit: d.access.edit, message: d.access.message });
    } else {
      // A new referral: what the case already records, for the official to check.
      // That starting point counts as unchanged; typing makes it unsaved.
      const start: Values = { agency: '', agencyOther: '', referredAt: todayPh(), reason: '', form: d.form };
      setV(start); setSaved(start);
      setLoaded({ caseNumber: d.caseNumber, desk: d.desk, referralId: null, from: d.from, prefilled: d.form, edit: true, message: null });
    }
  }, [caseId, referralId]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty || !loaded?.edit) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, loaded?.edit]);

  const touch = (key: PreviewKey) => setChanged(c => ({ key, n: (c?.n ?? 0) + 1 }));
  const setField = (k: ReferralFormKey) => (e: { target: { value: string } }) => { setV(x => ({ ...x, form: { ...x.form, [k]: e.target.value } })); touch(k); };
  const setMeta = (k: 'agency' | 'agencyOther' | 'referredAt' | 'reason') => (e: { target: { value: string } }) => {
    setV(x => ({ ...x, [k]: e.target.value }));
    touch(k === 'agency' || k === 'agencyOther' ? 'to' : k);
  };

  // The same checks the server makes, shown on the field.
  const errors = useMemo(() => {
    const p = referralFormSchema.safeParse(v.form);
    const out: Partial<Record<ReferralFormKey, string>> = {};
    if (!p.success) for (const i of p.error.issues) { const k = i.path[0] as ReferralFormKey; if (k && !out[k]) out[k] = i.message; }
    return out;
  }, [v.form]);

  /** Save what is on screen. Returns the referral's id, or null when it was not saved. */
  const save = async (quiet = false): Promise<string | null> => {
    if (!loaded) return null;
    if (isNew && !v.agency) { toast.error('Choose the office the client is referred to (To:)'); jumpTo('to'); return null; }
    if (isNew && v.agency === 'OTHER' && !v.agencyOther.trim()) { toast.error('Name the office the client is referred to'); jumpTo('to'); return null; }
    if (Object.keys(errors).length) { toast.error(Object.values(errors)[0]!); return null; }
    const sending = v;
    const res = isNew
      ? await fetch(`/api/cases/${caseId}/referrals`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agency: v.agency, agencyOther: v.agency === 'OTHER' ? v.agencyOther : '', referredAt: v.referredAt, reason: v.reason, status: 'REFERRED', form: v.form }) })
      : await fetch(`/api/cases/${caseId}/referrals/${loaded.referralId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: v.form, reason: v.reason }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(json.error ?? 'Not saved - your entries are still on this page'); return null; }
    const id = (isNew ? json.data.id : loaded.referralId) as string;
    setSaved(sending);
    setLoaded(l => (l ? { ...l, referralId: id } : l));
    if (!quiet) toast.success(isNew ? 'Referral saved' : 'Referral form saved');
    // From now on this page is the saved referral's.
    if (isNew) window.history.replaceState(null, '', `${basePath}/${caseId}/referrals/${id}`);
    return id;
  };

  /** One action at a time: a second click while the first is on its way does nothing. */
  const once = async (kind: 'save' | 'pdf', fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(kind);
    try { await fn(); } finally { lock.current = false; setBusy(null); }
  };

  const downloadPdf = () => once('pdf', async () => {
    let id = loaded?.referralId ?? null;
    if (loaded?.edit && (dirty || !id)) id = await save(true);
    else if (dirty && !window.confirm('The PDF has the saved version. Your unsaved changes will not be in it. Continue?')) return;
    if (!id) return;
    const res = await fetch(`/api/cases/${caseId}/referrals/${id}/pdf`, { credentials: 'include' });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'The PDF could not be made'); return; }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Referral-Form.pdf';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  function jumpTo(key: PreviewKey) {
    setPanel('input');
    setTimeout(() => {
      const el = document.getElementById(`rf-${key}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLElement>('input, textarea, [role="combobox"]')?.focus({ preventScroll: true });
    }, 80);
  }

  const leave = () => {
    if (dirty && loaded?.edit && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push(`${basePath}/${caseId}`);
  };

  if (loadError) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Alert severity={loadError.status === 404 ? 'info' : 'error'} icon={<Lock />} sx={{ borderRadius: 2, maxWidth: 640 }}>
          {loadError.status === 404 ? 'Not found.' : loadError.message}
        </Alert>
        <Button startIcon={<ArrowBack />} onClick={() => router.push(`${basePath}/${caseId}`)} sx={{ mt: 2 }}>Back to the case</Button>
      </Box>
    );
  }
  if (!loaded) return <Box sx={{ p: 3 }}><LinearProgress /></Box>;
  const ro = !loaded.edit;

  const tf = (k: ReferralFormKey, extra: { label?: string; multiline?: boolean; type?: string; max?: number; span?: boolean; inputMode?: 'tel' | 'numeric' | 'email' } = {}) => {
    const fromPrefill = loaded.from[k] && v.form[k] === loaded.prefilled[k];
    return (
      <Box id={`rf-${k}`} sx={{ gridColumn: extra.span ? { sm: '1 / -1' } : undefined }}>
        <TextField fullWidth size="small" label={extra.label ?? REFERRAL_FORM_LABELS[k]} value={v.form[k]} onChange={setField(k)} disabled={ro}
          type={extra.type ?? 'text'} multiline={extra.multiline} minRows={extra.multiline ? 2 : undefined}
          error={Boolean(errors[k])} helperText={errors[k] ?? (fromPrefill ? `From ${loaded.from[k]} - check it` : undefined)}
          slotProps={{ htmlInput: { maxLength: extra.max ?? 300, ...(extra.inputMode && { inputMode: extra.inputMode }) } }} />
      </Box>
    );
  };
  const group = (title: string, children: React.ReactNode) => (
    <Card><CardContent sx={{ p: { xs: 1.75, sm: 2.25 } }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0c1e46', mb: 1.25 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>{children}</Box>
    </CardContent></Card>
  );

  return (
    <Box sx={twoPanel
      ? { p: 3, maxWidth: 1760, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
      : { p: { xs: 1.5, sm: 3 }, maxWidth: 1000 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Button startIcon={<ArrowBack />} onClick={leave} sx={{ color: '#64748b', minHeight: 40 }}>Case #{loaded.caseNumber}</Button>
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46' }}>Referral Form</Typography>
          {loaded.edit && (
            <Typography role="status" sx={{ fontSize: '0.8rem', fontWeight: 700, color: isNew ? '#64748b' : dirty ? '#a16207' : '#15803d' }}>
              {isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'Saved'}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {loaded.edit && (
            <Button variant="outlined" startIcon={busy === 'save' ? <CircularProgress size={16} /> : <Save />} disabled={Boolean(busy) || (!isNew && !dirty)}
              onClick={() => void once('save', async () => { await save(); })} sx={{ minHeight: 40 }}>Save</Button>
          )}
          <Button variant="contained" startIcon={busy === 'pdf' ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdf />} disabled={Boolean(busy) || (ro && isNew)}
            onClick={() => void downloadPdf()} sx={{ minHeight: 40, bgcolor: '#0f766e', fontWeight: 800, '&:hover': { bgcolor: '#115e59' } }}>
            Download PDF
          </Button>
        </Box>
      </Box>

      {loaded.message && <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>{loaded.message}</Alert>}

      {!twoPanel && (
        <Tabs value={panel} onChange={(_, x) => setPanel(x)} variant="fullWidth" sx={{ mb: 1.5, borderBottom: '1px solid #e2e8f0' }} aria-label="Form or preview">
          <Tab value="input" label="Input" sx={{ fontWeight: 700 }} />
          <Tab value="preview" label="Preview" sx={{ fontWeight: 700 }} />
        </Tabs>
      )}

      <Box sx={twoPanel ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2.5, flex: 1, minHeight: 0 } : undefined}>
        {/* The fields stay mounted while the preview tab is shown, so nothing typed is lost. */}
        <Box data-testid="referral-form-input" sx={{ minWidth: 0, display: !twoPanel && panel === 'preview' ? 'none' : 'flex', flexDirection: 'column', gap: 2,
          ...(twoPanel && { overflowY: 'auto', minHeight: 0, pr: 1 }) }}>
          {group('Referred to', <>
            <TextField size="small" label="Case No." value={loaded.caseNumber} disabled />
            <Box id="rf-referredAt">
              <TextField fullWidth size="small" type="date" label="Date of Referral" value={v.referredAt} onChange={setMeta('referredAt')} disabled={ro || !isNew}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayPh() } }} />
            </Box>
            <Box id="rf-to" sx={{ gridColumn: { sm: '1 / -1' } }}>
              <TextField select fullWidth size="small" label="To:" value={v.agency} onChange={setMeta('agency')} disabled={ro || !isNew}>
                {referralAgenciesFor(loaded.desk).map(k => <MenuItem key={k} value={k}>{REFERRAL_AGENCIES[k].label}</MenuItem>)}
              </TextField>
            </Box>
            {v.agency === 'OTHER' && (
              <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
                <TextField fullWidth size="small" label="Name of the office" value={v.agencyOther} onChange={setMeta('agencyOther')} disabled={ro || !isNew}
                  slotProps={{ htmlInput: { maxLength: 160 } }} />
              </Box>
            )}
            {tf('toAddress', { span: true })}
            {tf('toContactPerson', { span: true, max: 160 })}
          </>)}

          {group('Client', <>
            {tf('clientName', { span: true, max: 160 })}
            {tf('clientAge', { type: 'number', inputMode: 'numeric', max: 3 })}
            <Box id="rf-clientSex">
              <TextField select fullWidth size="small" label="Sex" value={v.form.clientSex} onChange={setField('clientSex')} disabled={ro}
                helperText={loaded.from.clientSex && v.form.clientSex === loaded.prefilled.clientSex ? `From ${loaded.from.clientSex} - check it` : undefined}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value=""><em>Leave blank</em></MenuItem>
                {CLIENT_SEX.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Box>
            {tf('clientAddress', { span: true })}
            {tf('guardianName', { max: 160 })}
            {tf('guardianContact', { label: 'Contact No.', max: 40, inputMode: 'tel' })}
            {tf('guardianAddress', { span: true })}
          </>)}

          {group('Reason and services', <>
            <Box id="rf-reason" sx={{ gridColumn: { sm: '1 / -1' } }}>
              <TextField fullWidth size="small" multiline minRows={2} label="Reason/s for Referral" value={v.reason} onChange={setMeta('reason')} disabled={ro}
                slotProps={{ htmlInput: { maxLength: 500 } }} />
            </Box>
            {tf('servicesRequested', { span: true, multiline: true, max: 1000 })}
          </>)}

          {group('Feedback requested and send to Referring Party/Agency', <>
            {tf('feedbackTo', { label: 'Referring Party/Agency', span: true, max: 200 })}
            {tf('feedbackAddress', { span: true })}
            {tf('feedbackCellPhone', { max: 40, inputMode: 'tel' })}
            {tf('feedbackLandline', { max: 40, inputMode: 'tel' })}
            {tf('feedbackEmail', { type: 'email', max: 160, inputMode: 'email' })}
            {tf('feedbackFax', { max: 40, inputMode: 'tel' })}
            {tf('feedbackContact', { span: true, max: 160 })}
          </>)}

          {group('Referred by', <>
            {tf('referredByName', { label: 'Printed name', max: 160 })}
            {tf('referredByDesignation', { max: 160 })}
          </>)}
        </Box>

        {(twoPanel || panel === 'preview') && (
          <Box sx={{ height: twoPanel ? '100%' : '80vh', minHeight: twoPanel ? 0 : 420, minWidth: 0 }}>
            <ReferralFormPreview caseNumber={loaded.caseNumber} referredAt={v.referredAt} to={toLabel(v)} reason={v.reason} form={v.form}
              changed={changed} onJump={ro ? undefined : jumpTo} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
