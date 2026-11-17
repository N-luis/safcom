'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import {
  Box, Card, CardContent, Typography, Button, TextField, Autocomplete, Alert, Skeleton, Chip, IconButton, Tooltip, ToggleButton, ToggleButtonGroup,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  useMediaQuery,
} from '@mui/material';
import { PictureAsPdf, Print, Save, RestartAlt, Add, Close, Description, FolderOpen, DeleteOutlined, ZoomOutMap, CropFree } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  KP_FORM_IDS, KP_FORMS, applyRecord, dateOrderWarnings, effectiveKp16Name, effectiveRecipient, effectiveSignatory, emptyForms, isKpFormId,
  missingRequired, prefilledIntake, recordData, type FieldSpec, type KpFormId, type KpIntakeState, type KpPrefill, type ServiceMethod,
} from '@/lib/kpForms/forms';
import { cleanNames, pdfFileName } from '@/lib/kpForms/format';
import { kpFormEntry } from './documents';
import KpDocumentView from './KpDocumentView';
import { KP_FONTS } from './fonts';
import { exportPagesToPdf } from './exportPdf';
import { PAGE_W, resetMeasureCache } from './layout';

/**
 * KP Forms on the Walk-in Report page (Blotter desk): pick the walk-in
 * report, pick the form, fill it on the left, see the document on the right
 * as it is typed, then Export as PDF, Print or Save it to the report.
 *
 * The buttons, the inputs and the document all come from one registry
 * (lib/kpForms/forms.ts + components/kpForms/documents.tsx). The preview,
 * the print and the PDF are the same component, so they cannot drift apart.
 */

const NAVY = '#0c1e46';
const ACCENT = '#1d4ed8';
interface CaseOption { id: string; caseNumber: string; caseType: string; filedAt: string; forms: number }
interface RecordRow { id: string; formType: string; caseNo: string | null; createdAt: string; updatedAt: string }
interface Detail { case: { id: string; caseNumber: string; caseType: string }; prefill: KpPrefill; records: RecordRow[] }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? 'Something went wrong');
  return body.data as T;
}
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function KpFormsPanel({ caseId: initialCaseId = null }: { caseId?: string | null }) {
  const [q, setQ] = useState('');
  const [caseId, setCaseId] = useState<string | null>(initialCaseId);
  const options = useSWR<{ rows: CaseOption[] }>(`/api/kp-forms/cases${q ? `?q=${encodeURIComponent(q)}` : ''}`, (u: string) => api<{ rows: CaseOption[] }>(u), { keepPreviousData: true });
  const detail = useSWR<Detail>(caseId ? `/api/kp-forms?caseId=${encodeURIComponent(caseId)}` : null, (u: string) => api<Detail>(u), { revalidateOnFocus: false });
  const picked = options.data?.rows.find(r => r.id === caseId) ?? (detail.data ? { ...detail.data.case, filedAt: '', forms: detail.data.records.length } : null);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Card>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Description sx={{ color: ACCENT, fontSize: 20 }} />
            <Typography component="h2" sx={{ fontWeight: 700, fontSize: '1rem', color: NAVY }}>KP Forms</Typography>
            <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>Katarungang Pambarangay forms for a walk-in report.</Typography>
          </Box>
          <Autocomplete
            options={options.data?.rows ?? []} value={picked} loading={options.isLoading}
            onChange={(_, v) => setCaseId(v?.id ?? null)}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ(v.trim()); }}
            filterOptions={x => x} getOptionLabel={o => o.caseNumber} isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText={options.error ? 'The walk-in reports could not be loaded' : q ? 'No walk-in report with that case number' : 'No walk-in report yet'}
            renderOption={(props, o) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex !important', gap: 1, alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: '0.9rem' }}>{o.caseNumber}</Typography>
                  <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{o.caseType}{o.filedAt ? ` · ${new Date(o.filedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</Typography>
                  {o.forms > 0 && <Chip size="small" label={`${o.forms} saved`} sx={{ ml: 'auto', height: 20, fontSize: '0.7rem' }} />}
                </Box>
              );
            }}
            renderInput={p => <TextField {...p} size="small" label="Walk-in report" placeholder="Choose the walk-in report, or type its case number" />}
            sx={{ maxWidth: 520 }}
          />
          {options.error && <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => options.mutate()}>Retry</Button>}>{(options.error as Error).message}</Alert>}
        </CardContent>
      </Card>

      {caseId && detail.isLoading && !detail.data && <Skeleton variant="rounded" height={420} />}
      {caseId && detail.error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} action={<Button color="inherit" size="small" onClick={() => detail.mutate()}>Retry</Button>}>{(detail.error as Error).message}</Alert>
      )}
      {detail.data && detail.data.case.id === caseId && (
        <KpEditor key={caseId} detail={detail.data} onSaved={() => { void detail.mutate(); void options.mutate(); }} />
      )}
    </Box>
  );
}

// ── The editor for one walk-in report ────────────────────────────────────────

interface Draft { state: KpIntakeState; recordIds: Partial<Record<KpFormId, string>>; saved: Partial<Record<KpFormId, string>> }
const draftKey = (caseId: string) => `kp-forms-draft:${caseId}`;
function readDraft(caseId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(caseId));
    const d = raw ? JSON.parse(raw) as Draft : null;
    return d && d.state?.walkInReportId === caseId && isKpFormId(d.state.activeForm) ? d : null;
  } catch { return null; }
}
const snap = (id: KpFormId, s: KpIntakeState) => JSON.stringify(recordData(id, s));

function KpEditor({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const caseId = detail.case.id;
  const narrow = useMediaQuery('(max-width:1023.95px)');
  // A draft from this browser tab comes back after a refresh; otherwise the walk-in report fills what it can.
  const [first] = useState(() => {
    const draft = typeof window !== 'undefined' ? readDraft(caseId) : null;
    const base = prefilledIntake(caseId, detail.prefill);
    return { draft, base };
  });
  const [state, setState] = useState<KpIntakeState>(first.draft?.state ?? first.base);
  const [recordIds, setRecordIds] = useState<Partial<Record<KpFormId, string>>>(first.draft?.recordIds ?? {});
  // What each form was when last saved or opened; a new form starts from the prefilled one.
  const [saved, setSaved] = useState<Partial<Record<KpFormId, string>>>(first.draft?.saved ?? {});
  const [focused, setFocused] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<'save' | 'pdf' | 'print' | null>(null);
  const [zoom, setZoom] = useState<'fit' | '100'>('fit');
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const [pendingExport, setPendingExport] = useState<KpFormId | null>(null);
  const [previewW, setPreviewW] = useState(600);
  const previewRef = useRef<HTMLDivElement | null>(null);
  // The latest state, for work that finishes after an await (opening a saved form).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const id = state.activeForm;
  const spec = kpFormEntry(id);
  const isDirty = (fid: KpFormId) => snap(fid, state) !== (saved[fid] ?? snap(fid, first.base));
  const dirty = KP_FORM_IDS.filter(isDirty);

  // The fonts are measured for line breaks: once they have loaded, measure again.
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => { if (live) { resetMeasureCache(); setFontsTick(t => t + 1); } });
    return () => { live = false; };
  }, []);

  // The preview fits the panel's width.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPreviewW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow, mobileView]);

  // A draft in this tab, a second after the last keystroke - gone once everything is saved.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (!dirty.length) sessionStorage.removeItem(draftKey(caseId));
        else sessionStorage.setItem(draftKey(caseId), JSON.stringify({ state, recordIds, saved } satisfies Draft));
      } catch { /* private mode: no draft, nothing else changes */ }
    }, 1000);
    return () => clearTimeout(t);
  }, [state, recordIds, saved, caseId, dirty.length]);

  // Leaving the page with unsaved changes: the browser asks first.
  useEffect(() => {
    if (!dirty.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);

  const doc = useMemo(() => spec.render(state, KP_FONTS, focused), [spec, state, focused, fontsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const printDoc = useMemo(() => spec.render(state, KP_FONTS, null), [spec, state, fontsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = zoom === '100' ? 1 : Math.min(1, Math.max(0.3, (previewW - 32) / PAGE_W));
  const missing = missingRequired(id, state);
  const dateWarnings = dateOrderWarnings(id, state);

  // ── Changing values ──
  const setShared = <K extends keyof KpIntakeState['shared']>(k: K, v: KpIntakeState['shared'][K]) => setState(s => ({ ...s, shared: { ...s.shared, [k]: v } }));
  const setForm = (k: string, v: unknown) => setState(s => ({ ...s, forms: { ...s.forms, [s.activeForm]: { ...s.forms[s.activeForm], [k]: v } } }));
  const pickForm = (fid: KpFormId) => setState(s => ({ ...s, activeForm: fid }));

  // ── Save / export / print ──
  const warnMissing = (what: string) => {
    if (missing.length) toast(`${what} with ${missing.length} blank required field${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`, { icon: '⚠️', duration: 5000 });
  };
  const save = async () => {
    setShowErrors(true);
    setBusy('save');
    try {
      const data = recordData(id, state);
      const rid = recordIds[id];
      const out = rid
        ? await api<RecordRow>(`/api/kp-forms/${rid}`, { method: 'PUT', body: JSON.stringify({ data }) })
        : await api<RecordRow>('/api/kp-forms', { method: 'POST', body: JSON.stringify({ caseId, formType: id, data }) });
      setRecordIds(r => ({ ...r, [id]: out.id }));
      setSaved(sv => ({ ...sv, [id]: snap(id, state) }));
      toast.success(`${spec.label} saved to this walk-in report`);
      warnMissing('Saved');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(null); }
  };
  const exportPdf = async (fid: KpFormId = id) => {
    setShowErrors(true);
    setBusy('pdf');
    try {
      const pages = Array.from(exportRef.current?.querySelectorAll<HTMLElement>('.kp-page') ?? []);
      await exportPagesToPdf(pages, pdfFileName(kpFormEntry(fid).number, state.shared.caseNo));
      warnMissing('Exported');
    } catch (e) {
      console.error('[KP forms PDF]', e instanceof Error ? e.message : e);
      toast.error('The PDF could not be made. Try again.');
    } finally { setBusy(null); }
  };
  const print = () => { setShowErrors(true); warnMissing('Printing'); setTimeout(() => window.print(), 50); };

  // Export from the saved list: open the record, then export once it is drawn.
  useEffect(() => {
    if (!pendingExport || pendingExport !== state.activeForm) return;
    const t = setTimeout(() => { void exportPdf(pendingExport).finally(() => setPendingExport(null)); }, 120);
    return () => clearTimeout(t);
  }, [pendingExport, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRecord = async (r: RecordRow, thenExport = false) => {
    if (!isKpFormId(r.formType)) return;
    const fid = r.formType;
    const go = async () => {
      try {
        const rec = await api<{ data: unknown }>(`/api/kp-forms/${r.id}`);
        const next = applyRecord(stateRef.current, fid, rec.data);
        setState(next);
        setSaved(sv => ({ ...sv, [fid]: snap(fid, next) }));
        setRecordIds(ids => ({ ...ids, [fid]: r.id }));
        if (thenExport) setPendingExport(fid);
        else toast.success(`${kpFormEntry(fid).label} opened`);
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not open the form'); }
    };
    if (isDirty(fid) && recordIds[fid] !== r.id) {
      setConfirm({ title: `Open the saved ${kpFormEntry(fid).label}?`, body: 'The changes you have not saved on this form will be replaced.', action: 'Open', run: () => void go() });
    } else void go();
  };
  const deleteRecord = (r: RecordRow) => setConfirm({
    title: `Delete this ${isKpFormId(r.formType) ? kpFormEntry(r.formType).label : 'form'}?`, danger: true, action: 'Delete',
    body: `Saved ${when(r.updatedAt)}${r.caseNo ? ` for Usaping Barangay Blg. ${r.caseNo}` : ''}. It is removed from this walk-in report.`,
    run: async () => {
      try {
        await api(`/api/kp-forms/${r.id}`, { method: 'DELETE' });
        if (isKpFormId(r.formType) && recordIds[r.formType] === r.id) {
          const fid = r.formType;
          setRecordIds(ids => { const n = { ...ids }; delete n[fid]; return n; });
          setSaved(sv => { const n = { ...sv }; delete n[fid]; return n; });
        }
        toast.success('Deleted');
        onSaved();
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete'); }
    },
  });
  const clearForm = () => setConfirm({
    title: `Clear ${spec.label}?`, action: 'Clear', danger: true,
    body: 'This form\'s own fields go back to blank (dates to today). The case number, Para sa, parties and Punong Barangay stay.',
    run: () => setState(s => ({ ...s, forms: { ...s.forms, [s.activeForm]: emptyForms()[s.activeForm] } })),
  });

  const err = (f: FieldSpec) => showErrors && missing.includes(f.label);

  // ── The inputs ──
  const groups = useMemo(() => {
    const out: { name: string; fields: FieldSpec[] }[] = [];
    for (const f of spec.fields) {
      const g = out.find(x => x.name === f.group);
      if (g) g.fields.push(f); else out.push({ name: f.group, fields: [f] });
    }
    return out;
  }, [spec]);

  const inputs = (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {groups.map(g => (
        <Box key={g.name} sx={{ display: 'grid', gap: 1.25 }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{g.name}</Typography>
          {g.fields.map(f => (
            <FieldInput key={`${id}-${f.key}`} f={f} formId={id} state={state} error={err(f)} setShared={setShared} setForm={setForm}
              onFocus={() => setFocused(f.key)} onBlur={() => setFocused(null)} />
          ))}
        </Box>
      ))}
    </Box>
  );

  const toolbar = (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button variant="contained" size="small" onClick={() => void exportPdf()} disabled={busy !== null}
        startIcon={busy === 'pdf' ? <CircularProgress size={14} color="inherit" /> : <PictureAsPdf />}
        sx={{ textTransform: 'none', bgcolor: NAVY, '&:hover': { bgcolor: '#1a3a6e' } }}>{busy === 'pdf' ? 'Exporting…' : 'Export as PDF'}</Button>
      <Button variant="outlined" size="small" startIcon={<Print />} onClick={print} disabled={busy !== null} sx={{ textTransform: 'none' }}>Print</Button>
      <Button variant="outlined" size="small" onClick={() => void save()} disabled={busy !== null}
        startIcon={busy === 'save' ? <CircularProgress size={14} /> : <Save />} sx={{ textTransform: 'none' }}>
        {recordIds[id] ? 'Save changes' : 'Save'}
      </Button>
      <Button size="small" startIcon={<RestartAlt />} onClick={clearForm} disabled={busy !== null} sx={{ textTransform: 'none', color: '#64748b' }}>Clear form</Button>
      <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_, v) => v && setZoom(v)} aria-label="Zoom" sx={{ ml: { md: 'auto' } }}>
        <ToggleButton value="fit" aria-label="Fit to width" sx={{ textTransform: 'none', px: 1.25 }}><ZoomOutMap sx={{ fontSize: 16, mr: 0.5 }} />Fit</ToggleButton>
        <ToggleButton value="100" aria-label="Actual size" sx={{ textTransform: 'none', px: 1.25 }}><CropFree sx={{ fontSize: 16, mr: 0.5 }} />100%</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );

  return (
    <>
      {detail.records.length > 0 && <SavedList records={detail.records} openId={recordIds} onOpen={r => void openRecord(r)} onExport={r => void openRecord(r, true)} onDelete={deleteRecord} />}

      <Card>
        <CardContent sx={{ p: { xs: 1.5, md: 2 }, '&:last-child': { pb: 2 }, display: 'grid', gap: 2 }}>
          {/* One button per form, from the registry. */}
          <Box role="group" aria-label="KP form" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1 }}>
            {KP_FORMS.map(f => {
              const on = f.id === id;
              return (
                <Box key={f.id} component="button" type="button" aria-pressed={on} onClick={() => pickForm(f.id)}
                  sx={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2, p: 1.1, border: `1.5px solid ${on ? ACCENT : '#e2e8f0'}`,
                    bgcolor: on ? ACCENT : '#fff', color: on ? '#fff' : NAVY, transition: 'background .15s, border-color .15s',
                    '&:hover': { borderColor: ACCENT }, '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography component="span" sx={{ fontWeight: 800, fontSize: '0.86rem' }}>KP Form {f.number}</Typography>
                    {isDirty(f.id) && <Box component="span" title="Unsaved changes" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: on ? '#fde68a' : '#f59e0b', ml: 'auto' }} />}
                  </Box>
                  <Typography component="span" sx={{ display: 'block', fontSize: '0.74rem', lineHeight: 1.3, opacity: on ? 0.9 : 0.75, mt: 0.25 }}>{f.buttonTitle}</Typography>
                </Box>
              );
            })}
          </Box>

          {(missing.length > 0 && showErrors) || dateWarnings.length > 0 ? (
            <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.82rem', py: 0.25 }}>
              {showErrors && missing.length > 0 && <div>Still blank: {missing.join(', ')}. You can still print or export it to fill by hand.</div>}
              {dateWarnings.map(w => <div key={w}>{w}</div>)}
            </Alert>
          ) : null}

          {narrow && (
            <ToggleButtonGroup exclusive fullWidth size="small" value={mobileView} onChange={(_, v) => v && setMobileView(v)} aria-label="Edit or preview">
              <ToggleButton value="edit" sx={{ textTransform: 'none', fontWeight: 700 }}>Edit</ToggleButton>
              <ToggleButton value="preview" sx={{ textTransform: 'none', fontWeight: 700 }}>Preview</ToggleButton>
            </ToggleButtonGroup>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '2fr 3fr', gap: 2, alignItems: 'start' }}>
            {(!narrow || mobileView === 'edit') && (
              <Box sx={{ maxHeight: narrow ? 'none' : 'calc(100vh - 160px)', overflowY: narrow ? 'visible' : 'auto', pr: narrow ? 0 : 1, position: narrow ? 'static' : 'sticky', top: 16 }}>
                {inputs}
              </Box>
            )}
            {(!narrow || mobileView === 'preview') && (
              <Box sx={{ display: 'grid', gap: 1.25, minWidth: 0 }}>
                {toolbar}
                <Box ref={previewRef} aria-label={`${spec.label} preview`}
                  sx={{ bgcolor: '#cbd5e1', borderRadius: 2, p: 2, overflow: 'auto', maxHeight: narrow ? 'none' : 'calc(100vh - 200px)' }}>
                  <KpDocumentView doc={doc} scale={scale} shadow gap={20} />
                </Box>
              </Box>
            )}
          </Box>
          {narrow && mobileView === 'edit' && <Box>{toolbar}</Box>}
        </CardContent>
      </Card>

      {/* The same pages at their true size: what Print prints and the PDF captures. Off screen. */}
      <PrintRoot>
        <div ref={exportRef}><KpDocumentView doc={printDoc} gap={0} /></div>
      </PrintRoot>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{confirm?.title}</DialogTitle>
        <DialogContent><Typography sx={{ fontSize: '0.9rem', color: '#475569' }}>{confirm?.body}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" color={confirm?.danger ? 'error' : 'primary'} sx={{ textTransform: 'none' }}
            onClick={() => { const c = confirm; setConfirm(null); c?.run(); }}>{confirm?.action}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ── Saved forms on this walk-in report ───────────────────────────────────────

function SavedList({ records, openId, onOpen, onExport, onDelete }: {
  records: RecordRow[]; openId: Partial<Record<KpFormId, string>>; onOpen: (r: RecordRow) => void; onExport: (r: RecordRow) => void; onDelete: (r: RecordRow) => void;
}) {
  return (
    <Card>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 1 } }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY, mb: 1 }}>Saved KP forms on this walk-in report</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap' } }}>
                <TableCell>Form</TableCell><TableCell>Usaping Barangay Blg.</TableCell><TableCell>Last updated</TableCell><TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map(r => {
                const label = isKpFormId(r.formType) ? KP_FORMS.find(f => f.id === r.formType)!.label : r.formType;
                const open = isKpFormId(r.formType) && openId[r.formType] === r.id;
                return (
                  <TableRow key={r.id} data-kp-record={r.id} sx={{ '& td': { fontSize: '0.84rem' } }}>
                    <TableCell sx={{ fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{label}{open && <Chip size="small" label="open" sx={{ ml: 1, height: 18, fontSize: '0.68rem' }} />}</TableCell>
                    <TableCell>{r.caseNo ?? '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{when(r.updatedAt)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button size="small" startIcon={<FolderOpen sx={{ fontSize: 16 }} />} onClick={() => onOpen(r)} sx={{ textTransform: 'none' }}>Open</Button>
                      <Button size="small" startIcon={<PictureAsPdf sx={{ fontSize: 16 }} />} onClick={() => onExport(r)} sx={{ textTransform: 'none' }}>Export PDF</Button>
                      <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${label}`} onClick={() => onDelete(r)}><DeleteOutlined sx={{ fontSize: 18, color: '#b91c1c' }} /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

// ── Print: only the pages ────────────────────────────────────────────────────

const PRINT_CSS = `
#kp-print-root { position: fixed; left: -20000px; top: 0; width: 816px; pointer-events: none; }
@media print {
  @page { size: letter; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#kp-print-root) { display: none !important; }
  #kp-print-root { position: static !important; left: auto !important; width: auto !important; }
  #kp-print-root .kp-page { break-after: page; page-break-after: always; box-shadow: none !important; }
  #kp-print-root .kp-page:last-child { break-after: auto; page-break-after: auto; }
}`;

function PrintRoot({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const div = document.createElement('div');
    div.id = 'kp-print-root';
    div.setAttribute('aria-hidden', 'true');
    document.body.appendChild(div);
    const style = document.createElement('style');
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    const t = setTimeout(() => setEl(div), 0);
    return () => { clearTimeout(t); div.remove(); style.remove(); };
  }, []);
  return el ? createPortal(children, el) : null;
}

// ── One input, from its spec ─────────────────────────────────────────────────

function FieldInput({ f, formId, state, error, setShared, setForm, onFocus, onBlur }: {
  f: FieldSpec; formId: KpFormId; state: KpIntakeState; error: boolean;
  setShared: <K extends keyof KpIntakeState['shared']>(k: K, v: KpIntakeState['shared'][K]) => void;
  setForm: (k: string, v: unknown) => void; onFocus: () => void; onBlur: () => void;
}) {
  const inputId = `kp-${formId}-${f.key}`;
  const form = state.forms[formId] as unknown as Record<string, unknown>;
  const common = { id: inputId, label: `${f.label}${f.required ? ' *' : ''}`, size: 'small' as const, fullWidth: true, onFocus, onBlur, error,
    helperText: error ? 'Required' : f.hint, slotProps: { htmlInput: { maxLength: f.maxLength } } };

  if (f.type === 'names') {
    const key = f.key as 'complainants' | 'respondents';
    const list = state.shared[key];
    return (
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Typography component="label" htmlFor={`${inputId}-0`} sx={{ fontSize: '0.8rem', color: error ? '#d32f2f' : '#475569', fontWeight: 600 }}>{f.label}{f.required ? ' *' : ''}</Typography>
        {list.map((n, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 0.5 }}>
            <TextField id={`${inputId}-${i}`} size="small" fullWidth value={n} placeholder="Full name" onFocus={onFocus} onBlur={onBlur} error={error && i === 0}
              onChange={e => setShared(key, list.map((x, j) => (j === i ? e.target.value : x)))} slotProps={{ htmlInput: { maxLength: 120, 'aria-label': `${f.label} ${i + 1}` } }} />
            {list.length > 1 && (
              <IconButton aria-label={`Remove name ${i + 1}`} onClick={() => setShared(key, list.filter((_, j) => j !== i))}><Close fontSize="small" /></IconButton>
            )}
          </Box>
        ))}
        {list.length < 8 && (
          <Button size="small" startIcon={<Add />} onClick={() => setShared(key, [...list, ''])} sx={{ justifySelf: 'start', textTransform: 'none' }}>Add a name</Button>
        )}
      </Box>
    );
  }

  if (f.type === 'choice') {
    return (
      <Box>
        <Typography id={`${inputId}-label`} sx={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600, mb: 0.5 }}>{f.label}</Typography>
        <ToggleButtonGroup exclusive size="small" value={String(form[f.key] ?? '')} aria-labelledby={`${inputId}-label`}
          onChange={(_, v) => { if (v) setForm(f.key, v); }}>
          {f.options!.map(o => <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', px: 1.5 }}>{o.label}</ToggleButton>)}
        </ToggleButtonGroup>
        {f.hint && <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.25 }}>{f.hint}</Typography>}
      </Box>
    );
  }

  if (f.type === 'service') {
    const resp = cleanNames(state.shared.respondents);
    const methods = (form.serviceMethods as ServiceMethod[]) ?? [];
    const set = (i: number, m: ServiceMethod) => { const next = resp.map((_, j) => (j === i ? m : methods[j] ?? '')); setForm('serviceMethods', next); };
    const uses = (m: string) => resp.some((_, i) => methods[i] === m);
    return (
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography sx={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>{f.label}</Typography>
        {!resp.length && <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>Add the respondents under Parties first.</Typography>}
        {resp.map((name, i) => (
          <TextField key={i} select size="small" fullWidth label={name} value={methods[i] ?? ''} onFocus={onFocus} onBlur={onBlur}
            onChange={e => set(i, e.target.value as ServiceMethod)} id={`${inputId}-${i}`}>
            <MenuItem value="">Not served / not yet</MenuItem>
            <MenuItem value="1">1. Personal na pagbibigay sa kanya</MenuItem>
            <MenuItem value="2">2. Ibinigay sa kanya subalit tumanggi siya</MenuItem>
            <MenuItem value="3">3. Iniwan sa taong nakatira sa kanyang bahay</MenuItem>
            <MenuItem value="4">4. Iniwan sa namamahala sa kanyang tanggapan</MenuItem>
          </TextField>
        ))}
        {uses('3') && <TextField size="small" fullWidth id={`kp-${formId}-leftWithPerson3`} label="Iniwan ang Patawag kay (method 3)" value={String(form.leftWithPerson3 ?? '')}
          onFocus={onFocus} onBlur={onBlur} onChange={e => setForm('leftWithPerson3', e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />}
        {uses('4') && <TextField size="small" fullWidth id={`kp-${formId}-leftWithPerson4`} label="Iniwan ang Patawag kay (method 4)" value={String(form.leftWithPerson4 ?? '')}
          onFocus={onFocus} onBlur={onBlur} onChange={e => setForm('leftWithPerson4', e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />}
      </Box>
    );
  }

  if (f.type === 'received') {
    const rows = (form.receivedBy as { name: string; date: string }[]) ?? [];
    const set = (i: number, k: 'name' | 'date', v: string) => setForm('receivedBy', rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    return (
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Typography sx={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>{f.label}</Typography>
        {rows.map((r, i) => (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 150px auto', gap: 0.5 }}>
            <TextField size="small" label="Lagda (name)" value={r.name} id={`${inputId}-name-${i}`} onFocus={onFocus} onBlur={onBlur}
              onChange={e => set(i, 'name', e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField size="small" type="date" label="Petsa" value={r.date} id={`${inputId}-date-${i}`} onFocus={onFocus} onBlur={onBlur}
              onChange={e => set(i, 'date', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <IconButton aria-label={`Remove row ${i + 1}`} onClick={() => setForm('receivedBy', rows.filter((_, j) => j !== i))}><Close fontSize="small" /></IconButton>
          </Box>
        ))}
        {rows.length < 4 && <Button size="small" startIcon={<Add />} onClick={() => setForm('receivedBy', [...rows, { name: '', date: '' }])} sx={{ justifySelf: 'start', textTransform: 'none' }}>Add a row</Button>}
      </Box>
    );
  }

  // Text, textarea, date, time.
  let value: string;
  if (f.scope === 'shared') value = String((state.shared as unknown as Record<string, unknown>)[f.key] ?? '');
  else if (f.auto && f.key === 'recipientName' && (formId === 'KP8' || formId === 'KP18' || formId === 'KP19')) value = effectiveRecipient(formId, state.shared, state.forms);
  else if (f.auto && f.key === 'signatoryName') value = effectiveSignatory(state.shared, form.signatoryName as string | null);
  else if (f.auto && f.key === 'punongBarangay' && formId === 'KP16') value = effectiveKp16Name(state.shared, state.forms.KP16.punongBarangay);
  else value = String(form[f.key] ?? '');
  const own = f.auto ? form[f.key] !== null : true;
  const set = (v: string) => (f.scope === 'shared' ? setShared(f.key as 'caseNo', v) : setForm(f.key, v));

  return (
    <Box>
      <TextField {...common} value={value} onChange={e => set(e.target.value)}
        type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'} multiline={f.type === 'textarea'} minRows={f.type === 'textarea' ? f.rows : undefined}
        slotProps={{ htmlInput: { maxLength: f.maxLength }, inputLabel: f.type === 'date' || f.type === 'time' ? { shrink: true } : undefined }} />
      {f.auto && own && (
        <Button size="small" onClick={() => setForm(f.key, null)} sx={{ textTransform: 'none', fontSize: '0.74rem', px: 0.5, minHeight: 0 }}>
          Use the name from {f.key === 'recipientName' ? 'the parties' : 'the Punong Barangay field'}
        </Button>
      )}
    </Box>
  );
}
