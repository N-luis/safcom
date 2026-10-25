'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Button, TextField, Radio, RadioGroup, FormControlLabel, Checkbox, Chip, Alert,
  CircularProgress, Divider, Grid, LinearProgress,
} from '@mui/material';
import { ArrowBack, ArrowForward, Save, CheckCircle, Lock, Phone, Edit, WarningAmber } from '@mui/icons-material';
import toast from 'react-hot-toast';
import ReporterInfoPanel from '@/components/cases/ReporterInfoPanel';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';
import { riskText } from '@/lib/triageLabels';
import {
  INTAKE_SECTIONS, MARKER_LABEL, appliesTo, isAnswered, missingForCompletion, optionsOf,
  type Answer, type Item, type Marker, type Responses,
} from '@/lib/officialIntakeForm';

/**
 * The official intake for one case (the barangay's intake form, sections
 * A-D), with the case and reporter details first - read from the records,
 * not typed. Saved on the server only: drafts, completion and later edits
 * each name the version they edited, so a double click or a stale tab
 * cannot overwrite or duplicate anything. Access is decided by the server
 * on every request; this page only shows what it is given.
 */

interface Context {
  case: {
    id: string; caseNumber: string; submittedAt: string; category: string; narrative: string; incidentDateTime: string;
    street: string; locationLabel: string; municipality: string; province: string; status: string; riskLevel: string | null;
    triageStatus: string | null; assignedTo: string; reportingRelationship: string;
  };
  reporter: null | { name: string; residentNumber: string; address: string; barangay: string; age: string; gender: string; registeredAt: string };
  affectedPerson: string;
  accusedPerson: string;
  warnings: string[];
}
interface IntakeData {
  id: string; status: 'DRAFT' | 'COMPLETED'; version: number; responses: Responses; prefilled: Record<string, string>;
  startedBy: string | null; updatedBy: string | null; completedBy: string | null; completedAt: string | null;
  createdAt: string; updatedAt: string;
  revisions: { version: number; status: string; changedItems: number; by: string | null; at: string }[];
}
interface Loaded { access: { view: boolean; edit: boolean; message: string | null }; context: Context; intake: IntakeData | null }

const STEPS = [
  { key: 'case', title: '1. Case and Reporter Information' },
  ...INTAKE_SECTIONS.map(s => ({ key: s.key, title: s.title })),
  { key: 'review', title: 'Review and Confirmation' },
];
const RELATIONSHIP: Record<string, string> = {
  SELF: 'About the reporter themself', THIRD_PARTY: 'About someone else', ON_BEHALF: 'Filed on behalf of the affected person',
  ANONYMOUS: 'Anonymous',
};
const when = (d: string) => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

export default function OfficialIntakeForm({ caseId, basePath }: { caseId: string; basePath: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [responses, setResponses] = useState<Responses>({});
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(sp.get('view') === '1');
  const started = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}/official-intake`, { credentials: 'include', cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setLoadError({ status: res.status, message: json.error ?? 'The intake could not be opened.' }); return null; }
    const data = json.data as Loaded;
    setLoaded(data); setLoadError(null);
    setResponses(data.intake?.responses ?? {}); setDirty(false); setConflict(false);
    return data;
  }, [caseId]);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    const res = await fetch(`/api/cases/${caseId}/official-intake`, { method: 'POST', credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(json.error ?? 'The intake could not be started'); started.current = false; return; }
    await load();
    toast.success(json.data?.created ? 'Intake started' : 'This case already has an intake - it has been reopened');
  }, [caseId, load]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load().then(d => { if (d && !d.intake && d.access.edit && sp.get('start') === '1') void start(); });
    }, 0);
    return () => clearTimeout(t);
  }, [load, start, sp]);

  // Leaving with unsaved answers asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setAnswer = (key: string, a: Answer) => {
    setResponses(r => ({ ...r, [key]: a }));
    setDirty(true);
    setMissingKeys(m => m.filter(k => k !== key));
  };

  const intake = loaded?.intake ?? null;
  const editable = Boolean(loaded?.access.edit && intake && !readOnly);
  const completed = intake?.status === 'COMPLETED';

  const save = async (status: 'DRAFT' | 'COMPLETED') => {
    if (!intake || saving) return;
    if (status === 'COMPLETED') {
      const missing = missingForCompletion(responses);
      if (missing.length) {
        setMissingKeys(missing.map(m => m.key));
        setStep(STEPS.length - 1);
        toast.error(`${missing.length} item${missing.length === 1 ? ' needs' : 's need'} an answer, or N/A, Unknown or Declined`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/official-intake`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: intake.version, status, responses }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) { setConflict(true); toast.error(json.error ?? 'Saved elsewhere'); return; }
      if (res.status === 422 && Array.isArray(json.missing)) { setMissingKeys(json.missing.map((m: { key: string }) => m.key)); toast.error(json.error); return; }
      if (!res.ok) { toast.error(json.error ?? 'Not saved - your answers are still on this page'); return; }
      const fresh = json.data.intake as IntakeData;
      setLoaded(l => (l ? { ...l, intake: fresh } : l));
      setResponses(fresh.responses);
      setDirty(false);
      if (json.data.flaggedUrgent) toast.error('The case has been flagged for urgent review and the desks notified', { duration: 6000 });
      toast.success(json.data.unchanged ? 'No changes to save' : status === 'COMPLETED' ? (completed ? 'Intake updated' : 'Intake completed') : 'Draft saved');
      if (status === 'COMPLETED' && !json.data.unchanged) setReadOnly(true);
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (dirty && !window.confirm('You have unsaved answers. Leave without saving?')) return;
    router.push(`${basePath}/${caseId}`);
  };

  const missingSet = useMemo(() => new Set(missingKeys), [missingKeys]);

  if (loadError) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Alert severity={loadError.status === 404 ? 'info' : 'error'} icon={<Lock />} sx={{ borderRadius: 2, maxWidth: 640 }}>
          {loadError.status === 404 ? 'Case not found.' : loadError.message}
        </Alert>
        <Button startIcon={<ArrowBack />} onClick={() => router.push(basePath)} sx={{ mt: 2 }}>Back to cases</Button>
      </Box>
    );
  }
  if (!loaded) return <Box sx={{ p: 3 }}><LinearProgress /></Box>;

  const ctx = loaded.context;
  const current = STEPS[step];
  const section = INTAKE_SECTIONS.find(s => s.key === current.key);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1000 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Button startIcon={<ArrowBack />} onClick={leave} sx={{ color: '#64748b', minHeight: 40 }}>Case #{ctx.case.caseNumber}</Button>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46' }}>Intake Form</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
            CONFIDENTIAL · {!intake ? 'Not started' : completed ? `Completed${intake.completedBy ? ` by ${intake.completedBy}` : ''}` : 'Draft'}
            {intake ? ` · version ${intake.version} · last saved ${when(intake.updatedAt)}${intake.updatedBy ? ` by ${intake.updatedBy}` : ''}` : ''}
          </Typography>
        </Box>
        {intake && readOnly && loaded.access.edit && (
          <Button variant="outlined" startIcon={<Edit />} onClick={() => setReadOnly(false)} sx={{ minHeight: 40 }}>
            {completed ? 'Edit Intake' : 'Continue Intake'}
          </Button>
        )}
      </Box>

      {loaded.access.message && <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>{loaded.access.message}</Alert>}
      {conflict && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}
          action={<Button size="small" onClick={() => { if (!dirty || window.confirm('Reloading replaces your unsaved answers with the saved version. Continue?')) void load(); }}>Reload</Button>}>
          This intake was saved by someone else since you opened it. Your answers are still on this page; reload to see the saved version.
        </Alert>
      )}

      {!intake && (
        <Card sx={{ mb: 2 }}><CardContent>
          <Typography sx={{ fontWeight: 700, color: '#0c1e46', mb: 1 }}>No intake has been started for this case.</Typography>
          {loaded.access.edit ? (
            <Button variant="contained" onClick={() => void start()} sx={{ bgcolor: '#0f766e', fontWeight: 800, '&:hover': { bgcolor: '#115e59' } }}>START INTAKE</Button>
          ) : <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Only the official handling this case can start it.</Typography>}
        </CardContent></Card>
      )}

      {/* Progress */}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }} role="tablist" aria-label="Intake sections">
        {STEPS.map((s, i) => {
          const sec = INTAKE_SECTIONS.find(x => x.key === s.key);
          const gaps = sec ? sec.items.filter(it => missingSet.has(it.key)).length : 0;
          return (
            <Chip key={s.key} role="tab" aria-selected={i === step} label={`${s.title}${gaps ? ` (${gaps})` : ''}`} onClick={() => setStep(i)}
              sx={{ fontWeight: 700, fontSize: '0.74rem',
                bgcolor: i === step ? '#0f766e' : gaps ? '#fef2f2' : '#f1f5f9', color: i === step ? '#fff' : gaps ? '#b91c1c' : '#334155' }} />
          );
        })}
      </Box>
      <LinearProgress variant="determinate" value={((step + 1) / STEPS.length) * 100} sx={{ mb: 2, height: 4, borderRadius: 2 }} />

      <Card><CardContent sx={{ p: { xs: 1.75, sm: 3 } }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#0c1e46', mb: 0.5 }}>{current.title}</Typography>
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mb: 2 }}>Step {step + 1} of {STEPS.length}</Typography>

        {current.key === 'case' && <CaseSection ctx={ctx} caseId={caseId} />}

        {section && (
          <>
            {section.note && <Alert severity="info" sx={{ mb: 2, borderRadius: 2, fontSize: '0.82rem' }}>{section.note}</Alert>}
            {section.key === 'A' && (
              <Alert severity="warning" icon={<WarningAmber />} sx={{ mb: 2, borderRadius: 2, fontSize: '0.82rem' }}>
                Before asking sensitive questions, confirm the client can speak safely and privately. They may decline any question.
              </Alert>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
              {section.items.filter(it => appliesTo(it, responses) !== 'hidden').map(it => (
                <ItemField key={it.key} item={it} answer={responses[it.key]} readOnly={!editable}
                  required={appliesTo(it, responses) === 'required'} missing={missingSet.has(it.key)}
                  prefilledFrom={intake?.prefilled[it.key]} onChange={a => setAnswer(it.key, a)}
                  extra={it.key === 'description' && editable && ctx.case.narrative ? (
                    <Button size="small" onClick={() => setAnswer('description', { value: [responses.description?.value, ctx.case.narrative].filter(Boolean).join('\n\n') })}>
                      Insert the resident&rsquo;s original words
                    </Button>
                  ) : it.key === 'currentAddress' && editable && ctx.reporter && ctx.case.reportingRelationship === 'SELF' && ctx.reporter.address !== 'Not provided' ? (
                    <Button size="small" onClick={() => setAnswer('currentAddress', { value: { ...(responses.currentAddress?.value as Record<string, string> ?? {}), street: ctx.reporter!.address } })}>
                      Use the registered address (confirm with the client)
                    </Button>
                  ) : null} />
              ))}
            </Box>
            {section.key === 'safety' && responses.immediateDanger?.value === 'yes' && (
              <Alert severity="error" icon={<Phone />} sx={{ mt: 2, borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', mb: 0.5 }}>Follow the urgent-response workflow now.</Typography>
                <Typography sx={{ fontSize: '0.82rem', mb: 1 }}>
                  You do not need to finish this form. Saving now flags the case for urgent review and notifies the desks; it does not contact anyone outside SafeComm.
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                  {EMERGENCY_CONTACTS.map(c => (
                    <Button key={c.label} size="small" variant="outlined" color="error" href={`tel:${c.number.replace(/[^\d+]/g, '')}`}>{c.label}: {c.number}</Button>
                  ))}
                </Box>
                {editable && <Button variant="contained" color="error" disabled={saving} onClick={() => void save(completed ? 'COMPLETED' : 'DRAFT')}>Save and flag now</Button>}
              </Alert>
            )}
          </>
        )}

        {current.key === 'review' && (
          <ReviewSection responses={responses} missing={missingSet} onJump={key => setStep(STEPS.findIndex(s => INTAKE_SECTIONS.find(x => x.key === s.key)?.items.some(i => i.key === key)))}
            intake={intake} />
        )}
      </CardContent></Card>

      {/* Navigation and saving */}
      <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button startIcon={<ArrowBack />} disabled={step === 0} onClick={() => setStep(s => s - 1)} sx={{ minHeight: 44 }}>Back</Button>
        {step < STEPS.length - 1 && (
          <Button variant="outlined" endIcon={<ArrowForward />} onClick={() => setStep(s => s + 1)} sx={{ minHeight: 44 }}>Continue</Button>
        )}
        <Box sx={{ flex: 1 }} />
        {editable && !completed && (
          <Button variant="outlined" startIcon={saving ? <CircularProgress size={16} /> : <Save />} disabled={saving || !dirty}
            onClick={() => void save('DRAFT')} sx={{ minHeight: 44 }}>
            Save draft
          </Button>
        )}
        {editable && step === STEPS.length - 1 && (
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle />} disabled={saving || (completed && !dirty)}
            onClick={() => void save('COMPLETED')} sx={{ minHeight: 44, bgcolor: '#0f766e', fontWeight: 800, '&:hover': { bgcolor: '#115e59' } }}>
            {completed ? 'Save update' : 'Complete intake'}
          </Button>
        )}
        {editable && completed && step !== STEPS.length - 1 && (
          <Button variant="contained" disabled={saving || !dirty} onClick={() => setStep(STEPS.length - 1)} sx={{ minHeight: 44, bgcolor: '#0f766e' }}>
            Review and save update
          </Button>
        )}
      </Box>
      {dirty && <Typography sx={{ fontSize: '0.76rem', color: '#a16207', mt: 1 }}>Unsaved changes.</Typography>}
    </Box>
  );
}

// ─── Section 1: from the records ─────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.5, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', minWidth: 190 }}>{label}</Typography>
      <Typography component="div" sx={{ fontSize: '0.86rem', color: '#0c1e46', fontWeight: 600, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{value}</Typography>
    </Box>
  );
}

function CaseSection({ ctx, caseId }: { ctx: Context; caseId: string }) {
  const c = ctx.case;
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2, fontSize: '0.82rem' }}>
        Read from the case and the reporter&rsquo;s registered profile - not typed, and not changed by this form. Confirm details with the reporter only when it is safe to do so.
      </Alert>
      {ctx.warnings.map(w => <Alert key={w} severity="warning" sx={{ mb: 1, borderRadius: 2, fontSize: '0.82rem' }}>{w}</Alert>)}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', mb: 0.5 }}>A. Case information</Typography>
          <Row label="Case reference" value={`#${c.caseNumber}`} />
          <Row label="Submitted" value={when(c.submittedAt)} />
          <Row label="Case category" value={c.category} />
          <Row label="Incident date and time" value={c.incidentDateTime} />
          <Row label="Street" value={c.street} />
          <Row label="Location" value={[c.locationLabel, c.municipality, c.province].filter(x => x !== 'Not provided').join(' · ') || 'Not provided'} />
          <Row label="Case status" value={c.status} />
          <Row label="Preliminary risk" value={riskText(c.riskLevel)} />
          <Row label="Assigned officer" value={c.assignedTo} />
          <Row label="Reporting relationship" value={RELATIONSHIP[c.reportingRelationship] ?? c.reportingRelationship} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', mb: 0.5 }}>B. Reporter information (registered)</Typography>
          {ctx.reporter ? (
            <>
              <Row label="Registered name" value={ctx.reporter.name} />
              <Row label="Resident number" value={ctx.reporter.residentNumber} />
              <Row label="Registered address" value={ctx.reporter.address} />
              <Row label="Barangay" value={ctx.reporter.barangay} />
              <Row label="Age · sex (registered)" value={`${ctx.reporter.age} · ${ctx.reporter.gender}`} />
            </>
          ) : <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>Not provided.</Typography>}
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', mt: 1.5, mb: 0.5 }}>C. Affected person and accused person</Typography>
          <Row label="Affected person" value={ctx.affectedPerson} />
          <Row label="Accused / reported person" value={ctx.accusedPerson} />
        </Grid>
      </Grid>
      <Divider sx={{ my: 2 }} />
      <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', mb: 0.5 }}>The resident&rsquo;s original report (unchanged)</Typography>
      <Box sx={{ bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, mb: 2 }}>
        <Typography sx={{ fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{c.narrative || 'Not provided'}</Typography>
      </Box>
      {/* Contact details: masked, revealed only through the logged endpoint. */}
      <ReporterInfoPanel caseId={caseId} />
    </Box>
  );
}

// ─── One item ────────────────────────────────────────────────────────────────

function ItemField({ item, answer, onChange, readOnly, required, missing, prefilledFrom, extra }: {
  item: Item; answer?: Answer; onChange: (a: Answer) => void; readOnly: boolean; required: boolean; missing: boolean;
  prefilledFrom?: string; extra?: React.ReactNode;
}) {
  const a = answer ?? {};
  // Typing an answer clears an N/A / Unknown / Declined marker.
  const set = (patch: Partial<Answer>) => {
    const next: Answer = { ...a, ...patch };
    delete next.marker;
    onChange(next);
  };
  const specify = (key: string, text: string) => set({ specify: { ...(a.specify ?? {}), [key]: text } });
  const label = `${item.no ? `${item.no}. ` : ''}${item.label}`;
  const obj = (a.value && typeof a.value === 'object' && !Array.isArray(a.value) ? a.value : {}) as Record<string, string>;
  const multi = Array.isArray(a.value) ? a.value : [];

  if (readOnly) {
    return (
      <Box>
        <Typography sx={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: '#0c1e46', whiteSpace: 'pre-wrap' }}>{display(item, answer)}</Typography>
      </Box>
    );
  }

  const opts = optionsOf(item);
  return (
    <Box sx={{ borderLeft: `3px solid ${missing ? '#ef4444' : '#e2e8f0'}`, pl: 1.5 }} id={`item-${item.key}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: '#0c1e46' }}>{label}{required ? '' : ' (optional)'}</Typography>
        {item.proposed && <Chip size="small" label="Proposed addition" sx={{ height: 18, fontSize: '0.66rem', bgcolor: '#eef2ff', color: '#4338ca' }} />}
        {prefilledFrom && <Chip size="small" label={`From ${prefilledFrom} - confirm`} sx={{ height: 18, fontSize: '0.66rem', bgcolor: '#ecfeff', color: '#0e7490' }} />}
      </Box>
      {item.hint && <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 0.75 }}>{item.hint}</Typography>}

      {a.marker ? (
        <Typography sx={{ fontSize: '0.86rem', color: '#475569', fontStyle: 'italic' }}>Recorded as: {MARKER_LABEL[a.marker]}</Typography>
      ) : (
        <>
          {(item.type === 'text' || item.type === 'date' || item.type === 'time' || item.type === 'number') && (
            <TextField size="small" fullWidth type={item.type === 'text' ? 'text' : item.type} value={(a.value as string) ?? ''}
              onChange={e => set({ value: e.target.value })} slotProps={{ htmlInput: { maxLength: 300, ...(item.type === 'number' && { min: 0, max: 130 }) } }}
              sx={{ maxWidth: item.type === 'text' ? '100%' : 260 }} />
          )}
          {item.type === 'textarea' && (
            <TextField fullWidth multiline minRows={item.key === 'description' ? 6 : 2} value={(a.value as string) ?? ''}
              onChange={e => set({ value: e.target.value })} slotProps={{ htmlInput: { maxLength: 8000 } }} />
          )}
          {(item.type === 'name' || item.type === 'address' || item.type === 'place' || item.type === 'location') && (
            <>
              {item.homeless && (
                <FormControlLabel control={<Checkbox size="small" checked={Boolean(a.homeless)} onChange={e => set({ homeless: e.target.checked })} />} label="Homeless" />
              )}
              <Grid container spacing={1}>
                {(item.parts ?? []).map(p => (
                  <Grid key={p.key} size={{ xs: 12, sm: 6, md: item.parts!.length > 4 ? 4 : 3 }}>
                    <TextField size="small" fullWidth label={p.label} value={obj[p.key] ?? ''}
                      onChange={e => set({ value: { ...obj, [p.key]: e.target.value } })} slotProps={{ htmlInput: { maxLength: 200 } }} />
                  </Grid>
                ))}
              </Grid>
            </>
          )}
          {item.type === 'single' && (
            <RadioGroup value={(a.value as string) ?? ''} onChange={e => set({ value: e.target.value })}
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: opts.length > 4 ? '1fr 1fr' : '1fr' } }}>
              {opts.map(op => (
                <Box key={op.value}>
                  <FormControlLabel value={op.value} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.86rem' }}>{op.label}</Typography>} />
                  {op.specify && a.value === op.value && (
                    <TextField size="small" fullWidth label={op.specifyLabel ?? 'Specify'} value={a.specify?.[op.value] ?? ''}
                      onChange={e => specify(op.value, e.target.value)} sx={{ mb: 1 }} />
                  )}
                </Box>
              ))}
            </RadioGroup>
          )}
          {item.type === 'multi' && (
            <Grid container spacing={1.5}>
              {(item.groups ?? []).map(g => (
                <Grid key={g.title} size={{ xs: 12, md: 6 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>{g.title}</Typography>
                  {g.options.map(op => (
                    <Box key={op.value}>
                      <FormControlLabel control={<Checkbox size="small" checked={multi.includes(op.value)}
                        onChange={e => set({ value: e.target.checked ? [...multi, op.value] : multi.filter(x => x !== op.value) })} />}
                        label={<Typography sx={{ fontSize: '0.84rem' }}>{op.label}</Typography>} />
                      {op.specify && multi.includes(op.value) && (
                        <TextField size="small" fullWidth label="Specify" value={a.specify?.[op.value] ?? ''} onChange={e => specify(op.value, e.target.value)} sx={{ mb: 1 }} />
                      )}
                    </Box>
                  ))}
                </Grid>
              ))}
            </Grid>
          )}
          {(item.type === 'yesNoSpecify' || item.type === 'yesNoDetail') && (
            <>
              <RadioGroup row value={(a.value as string) ?? ''} onChange={e => set({ value: e.target.value })}>
                <FormControlLabel value="no" control={<Radio size="small" />} label="No" />
                <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes" />
              </RadioGroup>
              {a.value === 'yes' && item.type === 'yesNoSpecify' && (
                <TextField size="small" fullWidth label={item.yesLabel ?? 'Specify'} value={a.specify?.yes ?? ''} onChange={e => specify('yes', e.target.value)} />
              )}
              {a.value === 'yes' && item.type === 'yesNoDetail' && (
                <RadioGroup value={a.detail ?? ''} onChange={e => set({ detail: e.target.value })} sx={{ pl: 2 }}>
                  {(item.detailOptions ?? []).map(op => (
                    <Box key={op.value}>
                      <FormControlLabel value={op.value} control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.84rem' }}>{op.label}</Typography>} />
                      {op.specify && a.detail === op.value && (
                        <TextField size="small" fullWidth label="Specify" value={a.specify?.[op.value] ?? ''} onChange={e => specify(op.value, e.target.value)} sx={{ mb: 1 }} />
                      )}
                    </Box>
                  ))}
                </RadioGroup>
              )}
            </>
          )}
          {item.type === 'confirm' && (
            <FormControlLabel control={<Checkbox checked={a.value === 'yes'} onChange={e => onChange(e.target.checked ? { value: 'yes' } : {})} />}
              label={<Typography sx={{ fontSize: '0.86rem' }}>Confirmed</Typography>} />
          )}
        </>
      )}

      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
        {extra}
        {item.type !== 'confirm' && (Object.keys(MARKER_LABEL) as Marker[]).map(m => (
          <Chip key={m} size="small" label={MARKER_LABEL[m]} variant={a.marker === m ? 'filled' : 'outlined'}
            onClick={() => onChange(a.marker === m ? {} : { marker: m })}
            sx={{ height: 22, fontSize: '0.7rem', ...(a.marker === m && { bgcolor: '#334155', color: '#fff' }) }} />
        ))}
      </Box>
      {missing && <Typography sx={{ fontSize: '0.76rem', color: '#b91c1c', mt: 0.5 }}>Needs an answer, or N/A, Unknown or Declined.</Typography>}
    </Box>
  );
}

/** An answer as words, for review and read-only viewing. */
function display(item: Item, a?: Answer): string {
  if (!a || (!a.marker && !isAnswered(item, a) && (a.value === undefined || a.value === ''))) return 'Not provided';
  if (a.marker) return MARKER_LABEL[a.marker];
  const opts = optionsOf(item);
  const lab = (v: string) => opts.find(o => o.value === v)?.label ?? v;
  const sp = (v: string) => (a.specify?.[v] ? ` (${a.specify[v]})` : '');
  const v = a.value;
  switch (item.type) {
    case 'single': return `${lab(v as string)}${sp(v as string)}`;
    case 'multi': return (v as string[]).map(x => `${lab(x)}${sp(x)}`).join('; ');
    case 'name': case 'address': case 'place': case 'location': {
      const o = (v ?? {}) as Record<string, string>;
      const parts = (item.parts ?? []).map(p => o[p.key]).filter(Boolean).join(', ');
      return [a.homeless ? 'Homeless' : '', parts].filter(Boolean).join(' · ') || 'Not provided';
    }
    case 'yesNoSpecify': return v === 'yes' ? `Yes${a.specify?.yes ? ` - ${a.specify.yes}` : ''}` : 'No';
    case 'yesNoDetail': return v === 'yes' ? `Yes${a.detail ? ` - ${lab(a.detail)}${sp(a.detail)}` : ''}` : 'No';
    case 'confirm': return v === 'yes' ? 'Confirmed' : 'Not confirmed';
    default: return String(v ?? 'Not provided');
  }
}

function ReviewSection({ responses, missing, onJump, intake }: {
  responses: Responses; missing: Set<string>; onJump: (key: string) => void; intake: IntakeData | null;
}) {
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2, fontSize: '0.82rem' }}>
        Check every answer with the client before completing. Completing does not investigate, resolve or close the case, and does not change the original report.
      </Alert>
      {INTAKE_SECTIONS.map(s => (
        <Box key={s.key} sx={{ mb: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#0c1e46', mb: 0.5 }}>{s.title}</Typography>
          {s.items.filter(i => appliesTo(i, responses) !== 'hidden').map(i => (
            <Box key={i.key} sx={{ display: 'flex', gap: 1, py: 0.4, flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9' }}>
              <Typography sx={{ fontSize: '0.8rem', color: missing.has(i.key) ? '#b91c1c' : '#64748b', minWidth: 260, flex: '0 0 auto', maxWidth: '100%' }}>
                {i.no ? `${i.no}. ` : ''}{i.label}
              </Typography>
              <Typography sx={{ fontSize: '0.84rem', color: '#0c1e46', flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {display(i, responses[i.key])}
                {missing.has(i.key) && <Button size="small" onClick={() => onJump(i.key)} sx={{ ml: 1, py: 0 }}>Answer</Button>}
              </Typography>
            </Box>
          ))}
        </Box>
      ))}
      {intake && intake.revisions.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46', mb: 0.5 }}>Saved versions</Typography>
          {intake.revisions.map(r => (
            <Typography key={r.version} sx={{ fontSize: '0.78rem', color: '#64748b' }}>
              Version {r.version} · {r.status === 'COMPLETED' ? 'completed' : 'draft'} · {r.changedItems} item{r.changedItems === 1 ? '' : 's'} changed · {r.by ?? 'unknown'} · {when(r.at)}
            </Typography>
          ))}
        </>
      )}
    </Box>
  );
}
