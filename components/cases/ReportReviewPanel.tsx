'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Chip, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Checkbox, FormControlLabel, IconButton, Tooltip, CircularProgress, Divider, Collapse, ListSubheader,
} from '@mui/material';
import { FactCheck, QuestionAnswer, RecordVoiceOver, AutoAwesome, CompareArrows, Verified, Edit, Add, Delete, ExpandMore, ExpandLess } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { TEMPLATES, FIELD_STATUSES, type FieldStatus, type TemplateName } from '@/lib/reportTemplates';
import { interviewFields, interviewFieldOf, checkAnswer, type InterviewField } from '@/lib/interviewAnswers';
import InterviewAnswerField from '@/components/cases/InterviewAnswerField';
import { StatusChip } from '@/components/forms/ReportEditor';

/**
 * Report Review and Clarification - Case Monitoring. The original report
 * beside SafeComm AI's organized draft, every later version, requests to the
 * resident, recorded interviews, and approval. A draft becomes the official
 * report only when an official approves it.
 */

const NAVY = '#0c1e46';
const TEAL = '#0f766e';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;
const CONTACT = { IN_PERSON: 'In person', PHONE: 'Phone call', SAFECOMM_MESSAGE: 'SafeComm message', HOME_VISIT: 'Home visit', OTHER: 'Other' } as const;
const getJson = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load the report review');
  return body.data;
};
async function act(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
  return json.data;
}
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const label = { fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.04em' };

export default function ReportReviewPanel({ caseId }: { caseId: string }) {
  const url = `/api/cases/${caseId}/report-review`;
  const { data, error, isLoading, mutate } = useSWR<Data>(url, getJson);
  const [dialog, setDialog] = useState<null | 'request' | 'interview' | 'changes' | 'approve' | { edit: string }>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const run = async (body: unknown, msg: string) => {
    setBusy(true);
    try { const r = await act(url, body); toast.success(msg); await mutate(); return r; }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return null; } finally { setBusy(false); }
  };
  const regenerate = async () => {
    const r = await run({ action: 'regenerate' }, 'New draft generated');
    if (r && r.generator !== 'ai') toast(`SafeComm AI was unavailable (${r.aiStatus}) - the draft uses the records and answers only. Try again later.`, { icon: 'ℹ️' });
  };

  const d = data?.latestDraft;
  const t: TemplateName = data?.template ?? 'BLOTTER';
  const meta = d?.meta as Data;
  return (
    <Card id="report-review" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
          <FactCheck sx={{ color: TEAL, fontSize: 20 }} />
          <Typography component="h2" sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>Report Review and Clarification</Typography>
          {data?.approved && <Chip size="small" icon={<Verified sx={{ fontSize: '14px !important' }} />} label={`Official report: draft ${data.approved.draftNumber}`} sx={{ fontWeight: 700, bgcolor: '#ecfdf5', color: '#047857' }} />}
          {d && <Chip size="small" label={`Draft ${d.draftNumber} · ${d.needsConfirmation} to confirm`} sx={{ fontWeight: 700, bgcolor: d.needsConfirmation ? '#fef2f2' : '#f1f5f9', color: d.needsConfirmation ? '#b91c1c' : '#475569' }} />}
        </Box>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b', mb: 1.5 }}>
          The resident&apos;s original report beside SafeComm AI&apos;s organized draft in the {data ? TEMPLATES[t].title : 'intake'} template. Nothing the AI drafts is official until you approve it; the original is never changed.
        </Typography>
        {error ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{error.message}</Alert> : isLoading || !data ? <Skeleton variant="rounded" height={220} /> : (
          <>
            {data.canEdit && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                <Button size="small" variant="outlined" startIcon={<QuestionAnswer />} onClick={() => setDialog('request')} disabled={!data.residentLinked || busy} sx={{ textTransform: 'none' }}>Request Resident Clarification</Button>
                <Button size="small" variant="outlined" startIcon={<RecordVoiceOver />} onClick={() => setDialog('interview')} disabled={busy} sx={{ textTransform: 'none' }}>Record Interview</Button>
                <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <AutoAwesome />} onClick={regenerate} disabled={busy} sx={{ textTransform: 'none' }}>Regenerate AI Draft</Button>
                <Button size="small" variant="outlined" startIcon={<CompareArrows />} onClick={() => setDialog('changes')} disabled={!d} sx={{ textTransform: 'none' }}>Review Changes</Button>
                <Button size="small" variant="contained" startIcon={<Verified />} onClick={() => setDialog('approve')} disabled={!d || d.status !== 'DRAFT' || busy} sx={{ textTransform: 'none', bgcolor: '#047857' }}>Approve Official Report</Button>
              </Box>
            )}
            {!data.canEdit && <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>You can read this report review. Requests, interviews, drafts and approval are for the officer the case is assigned to.</Alert>}
            {!data.residentLinked && data.canEdit && <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>This report was not filed through a resident account - record an interview to add information.</Alert>}
            {data.reassessDue.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>
                New information in version{data.reassessDue.length === 1 ? '' : 's'} {data.reassessDue.join(', ')} may change what the report describes. Regenerate AI Draft also re-runs the AI assessment; the official category and risk level stay as they are until reviewed.
              </Alert>
            )}
            {meta?.reassessment && <Reassessment r={meta.reassessment} />}
            {data.requests.filter((r: Data) => r.status === 'OPEN').map((r: Data) => (
              <Alert key={r.id} severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}
                action={data.canEdit ? <Button size="small" color="inherit" onClick={() => { const reason = window.prompt('Why is the request withdrawn?'); if (reason) void run({ action: 'cancel_request', requestId: r.id, reason }, 'Request withdrawn'); }}>Withdraw</Button> : undefined}>
                Waiting for the resident since {when(r.createdAt)}: {(r.items as Data[]).map(i => i.question).join(' · ')}
              </Alert>
            ))}

            {/* Compare: the original and the organized draft */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5 }}>
              <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, maxHeight: 420, overflowY: 'auto' }}>
                <Typography sx={label}>Original report · version 1 · {when(data.original.filedAt)}</Typography>
                <Typography sx={{ fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap', mt: 0.75, wordBreak: 'break-word' }}>{data.original.text}</Typography>
                {data.versions.length > 0 && <Divider sx={{ my: 1.5 }} />}
                {data.versions.map((v: Data) => (
                  <Box key={v.id} sx={{ borderLeft: `3px solid ${v.source === 'INTERVIEW' ? '#7c3aed' : TEAL}`, pl: 1.25, mb: 1 }}>
                    <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>Version {v.version} (after {v.previousVersion}) · {v.sourceLabel} · {v.by} · {when(v.createdAt)}{v.material ? ' · changes what happened' : ''}</Typography>
                    {v.text && <Typography sx={{ fontSize: '0.84rem', color: NAVY, whiteSpace: 'pre-wrap' }}>{v.text}</Typography>}
                    {(v.fields as Data[]).map(f => <Typography key={f.key} sx={{ fontSize: '0.8rem', color: '#334155' }}>{f.label}: {f.skipped ? <i>skipped by the resident</i> : f.value}</Typography>)}
                    {v.reason && <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>Reason given: {v.reason}</Typography>}
                  </Box>
                ))}
              </Box>
              <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
                {!d ? <Typography sx={{ fontSize: '0.84rem', color: '#94a3b8' }}>No draft yet - Regenerate AI Draft to make one.</Typography> : (
                  <>
                    <Typography sx={label}>Draft {d.draftNumber} · {d.generator === 'ai' ? `SafeComm AI (${d.model ?? 'model'})` : d.generator === 'official_edit' ? 'official correction' : `records only${d.aiStatus && d.aiStatus !== 'not_requested' ? ` - AI ${d.aiStatus}` : ''}`} · based on version {d.basedOnVersion} · {when(d.createdAt)} · {d.status.toLowerCase()}</Typography>
                    {d.summary && (
                      <Box sx={{ bgcolor: '#f5f3ff', borderRadius: 2, p: 1.25, my: 1 }}>
                        <StatusChip status="AI_ORGANIZED" resident={false} />
                        <Typography sx={{ fontSize: '0.84rem', color: '#334155', mt: 0.5 }}>{d.summary}</Typography>
                      </Box>
                    )}
                    {TEMPLATES[t].sections.map(sec => (
                      <Box key={sec} sx={{ mt: 1.25 }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY, mb: 0.5 }}>{sec}</Typography>
                        {TEMPLATES[t].fields.filter(f => f.section === sec).map(f => {
                          const v = d.fields[f.key] ?? { status: 'NEEDS_CONFIRMATION', value: null };
                          return (
                            <Box key={f.key} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px 1fr auto' }, gap: { xs: 0.25, sm: 1 }, py: 0.5, borderBottom: '1px dashed #f1f5f9' }}>
                              <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{f.label}</Typography>
                              <Box>
                                <Tooltip title={v.quote ? `The resident's words: "${v.quote}" (${v.source})` : v.source ? `Source: ${v.source}` : ''}>
                                  <span><StatusChip status={v.status as FieldStatus} resident={false} /></span>
                                </Tooltip>
                                {v.value && <Typography sx={{ fontSize: '0.84rem', color: NAVY, whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.25, maxHeight: f.key === 'narrative' || f.key === 'description' ? 90 : undefined, overflow: 'hidden' }}>{v.value}</Typography>}
                                {(v.additions ?? []).length > 0 && <Typography sx={{ fontSize: '0.76rem', color: TEAL }}>+ {(v.additions as Data[]).length} later addition{v.additions.length === 1 ? '' : 's'} (see versions)</Typography>}
                                {v.note && <Typography sx={{ fontSize: '0.74rem', color: '#b45309' }}>{v.note}</Typography>}
                              </Box>
                              {data.canEdit && d.status === 'DRAFT' && f.key !== 'narrative' && f.key !== 'description' && (
                                <IconButton size="small" aria-label={`Correct ${f.label}`} onClick={() => setDialog({ edit: f.key })}><Edit sx={{ fontSize: 16 }} /></IconButton>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    ))}
                  </>
                )}
              </Box>
            </Box>

            <Button size="small" onClick={() => setShowHistory(s => !s)} endIcon={showHistory ? <ExpandLess /> : <ExpandMore />} sx={{ mt: 1.25, textTransform: 'none' }}>
              History - {data.drafts.length} draft{data.drafts.length === 1 ? '' : 's'}, {data.requests.length} request{data.requests.length === 1 ? '' : 's'}, {data.interviews.length} interview{data.interviews.length === 1 ? '' : 's'}
            </Button>
            <Collapse in={showHistory}>
              <Box sx={{ display: 'grid', gap: 1.25, mt: 1 }}>
                <History title="Drafts" rows={data.drafts.map((x: Data) => `Draft ${x.draftNumber} · ${x.generator}${x.aiStatus && x.generator !== 'ai' ? ` (AI ${x.aiStatus})` : ''} · version ${x.basedOnVersion} · ${x.status.toLowerCase()} · ${x.createdBy ?? ''} ${when(x.createdAt)}${x.approvedAt ? ` · approved by ${x.approvedBy} ${when(x.approvedAt)}${x.approvalNote ? ` - "${x.approvalNote}"` : ''}` : ''}`)} />
                <History title="Requests to the resident" rows={data.requests.map((r: Data) => `${when(r.createdAt)} by ${r.requestedBy ?? 'an official'} · ${r.status.toLowerCase()}${r.answeredAt ? ` ${when(r.answeredAt)}` : ''}${r.cancelReason ? ` - ${r.cancelReason}` : ''} · ${(r.items as Data[]).map(i => i.question).join(' / ')}`)} />
                <History title="Interviews" rows={data.interviews.map((i: Data) => `${when(i.interviewedAt)} · ${CONTACT[i.contactMethod as keyof typeof CONTACT] ?? i.contactMethod} · by ${i.interviewer ?? 'an official'} · ${(i.questions as Data[]).length} question(s)${i.followUpActions ? ` · follow-up: ${i.followUpActions}` : ''}`)} />
              </Box>
            </Collapse>
          </>
        )}
      </CardContent>
      {data && dialog === 'request' && <RequestDialog data={data} onClose={() => setDialog(null)} onSend={b => run(b, 'Request sent to the resident in SafeComm').then(r => { if (r) setDialog(null); })} busy={busy} />}
      {data && dialog === 'interview' && <InterviewDialog data={data} onClose={() => setDialog(null)} onSend={b => run(b, 'Interview recorded').then(r => { if (r) setDialog(null); })} busy={busy} />}
      {data && dialog === 'changes' && <ChangesDialog data={data} onClose={() => setDialog(null)} />}
      {data && dialog === 'approve' && <ApproveDialog data={data} onClose={() => setDialog(null)} onSend={b => run(b, 'Official report approved').then(r => { if (r) setDialog(null); })} busy={busy} />}
      {data && dialog && typeof dialog === 'object' && <EditFieldDialog data={data} fieldKey={dialog.edit} onClose={() => setDialog(null)} onSend={b => run(b, 'Field corrected - saved as a new draft').then(r => { if (r) setDialog(null); })} busy={busy} />}
    </Card>
  );
}

function History({ title, rows }: { title: string; rows: string[] }) {
  return (
    <Box>
      <Typography sx={label}>{title}</Typography>
      {rows.length === 0 ? <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>None.</Typography>
        : rows.map((r, i) => <Typography key={i} sx={{ fontSize: '0.8rem', color: '#334155' }}>{r}</Typography>)}
    </Box>
  );
}

function Reassessment({ r }: { r: Data }) {
  if (r.skipped) return <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>The AI assessment was not re-run: {r.skipped}</Alert>;
  return (
    <Alert severity={r.flaggedUrgent ? 'error' : 'info'} icon={<AutoAwesome />} sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>
      AI assessment re-run on the new information in version{r.versions.length === 1 ? '' : 's'} {r.versions.join(', ')} ({r.at ? when(r.at) : ''}):{' '}
      level {r.before.level ?? 'none'} → {r.after.level ? `Level ${r.after.level} ${r.after.label ?? ''}` : 'no level'}; suggested category {r.before.category ?? '-'} → {r.after.category ?? '-'}.
      {' '}{(r.references ?? []).length} knowledge-base source{(r.references ?? []).length === 1 ? '' : 's'}. {r.note} See the AI assessment history to confirm or override it.
    </Alert>
  );
}

function Shell({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5 }}>{children}</DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}><Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>{actions}</DialogActions>
    </Dialog>
  );
}

function RequestDialog({ data, onClose, onSend, busy }: { data: Data; onClose: () => void; onSend: (b: unknown) => void; busy: boolean }) {
  // Nothing pre-selected: the official chooses what to ask - only what is needed.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState('');
  const items = [...Object.entries(picked).filter(([, q]) => q.trim()).map(([key, question]) => ({ key, question })), ...(custom.trim() ? [{ key: 'other', question: custom.trim() }] : [])];
  return (
    <Shell title="Request Resident Clarification" onClose={onClose}
      actions={<Button variant="contained" disabled={busy || !items.length} onClick={() => onSend({ action: 'request_clarification', items, message: message.trim() || undefined })} sx={{ textTransform: 'none', bgcolor: NAVY }}>Send request</Button>}>
      <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
        The resident is told only inside SafeComm, in general words - the questions are in their report details, behind their login. Nothing is sent by text message or call.
        {data.vawc ? ' For a VAWC report this keeps the request away from anyone who may see their phone.' : ''} They can skip any question.
      </Alert>
      <Typography sx={label}>What needs clarifying</Typography>
      {(data.suggestions as Data[]).map(s => (
        <Box key={s.key}>
          <FormControlLabel control={<Checkbox size="small" checked={s.key in picked} onChange={e => setPicked(p => { const n = { ...p }; if (e.target.checked) n[s.key] = s.question; else delete n[s.key]; return n; })} />}
            label={<Typography sx={{ fontSize: '0.84rem' }}>{s.label}</Typography>} />
          {s.key in picked && <TextField size="small" fullWidth value={picked[s.key]} onChange={e => setPicked(p => ({ ...p, [s.key]: e.target.value }))} slotProps={{ htmlInput: { maxLength: 300, 'aria-label': `Question about ${s.label}` } }} />}
        </Box>
      ))}
      <TextField size="small" label="Another question (optional)" value={custom} onChange={e => setCustom(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
      <TextField size="small" label="A short message to the resident (optional)" multiline minRows={2} value={message} onChange={e => setMessage(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
    </Shell>
  );
}

function InterviewDialog({ data, onClose, onSend, busy }: { data: Data; onClose: () => void; onSend: (b: unknown) => void; busy: boolean }) {
  const [at, setAt] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16));
  const [method, setMethod] = useState<keyof typeof CONTACT>('IN_PERSON');
  const [interviewer, setInterviewer] = useState('');
  const [qs, setQs] = useState([{ question: '', answer: '', fieldKey: '' }]);
  const [notes, setNotes] = useState('');
  const [follow, setFollow] = useState('');
  const [safe, setSafe] = useState(false);
  const t: TemplateName = data.template;
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  // The fields an answer may fill - from the official form, in its sections and order.
  const fieldsBySection = Object.entries(interviewFields(t).reduce<Record<string, InterviewField[]>>((acc, f) => { (acc[f.section] ??= []).push(f); return acc; }, {}));
  // Choosing a field starts the question with neutral wording (kept if the official already wrote one) and clears an answer in another shape.
  const pickField = (i: number, key: string) => setQs(a => a.map((x, j) => {
    if (j !== i) return x;
    const before = x.fieldKey ? interviewFieldOf(t, x.fieldKey) : null;
    const next = key ? interviewFieldOf(t, key) : null;
    const ownWords = x.question.trim() && x.question !== before?.question;
    const freeText = (f: InterviewField | null) => !f || f.input.kind === 'text';
    return { fieldKey: key, question: ownWords ? x.question : next?.question ?? '', answer: freeText(before) && freeText(next) ? x.answer : '' };
  }));
  const errs = qs.map(q => { const f = q.fieldKey ? interviewFieldOf(t, q.fieldKey) : null; return f ? checkAnswer(f, q.answer, today) : null; });
  const unsafeCall = data.vawc && method === 'PHONE' && data.contactPreference === 'no_phone';
  const valid = qs.some(q => q.question.trim().length >= 3) && errs.every(e => !e) && (!unsafeCall || safe);
  return (
    <Shell title="Record Interview" onClose={onClose}
      actions={<Button variant="contained" disabled={busy || !valid} sx={{ textTransform: 'none', bgcolor: NAVY }}
        onClick={() => onSend({ action: 'record_interview', interviewedAt: at, contactMethod: method, interviewerId: interviewer || undefined, safetyConfirmed: safe || undefined,
          questions: qs.filter(q => q.question.trim().length >= 3).map(q => ({ question: q.question.trim(), answer: q.answer.trim(), fieldKey: q.fieldKey || undefined })),
          notes: notes.trim() || undefined, followUpActions: follow.trim() || undefined })}>Save interview</Button>}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
        <TextField size="small" type="datetime-local" label="Date and time (Philippine time)" value={at} onChange={e => setAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField select size="small" label="Contact method" value={method} onChange={e => setMethod(e.target.value as keyof typeof CONTACT)}>
          {Object.entries(CONTACT).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Interviewing official" value={interviewer} onChange={e => setInterviewer(e.target.value)} sx={{ gridColumn: { sm: '1 / -1' } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          <MenuItem value=""><em>Me</em></MenuItem>
          {(data.officials as Data[]).map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
        </TextField>
      </Box>
      {unsafeCall && (
        <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
          This reporter asked not to be called. Record a call only if it was arranged safely with them.
          <FormControlLabel control={<Checkbox size="small" checked={safe} onChange={e => setSafe(e.target.checked)} />} label={<Typography sx={{ fontSize: '0.8rem' }}>The call was arranged safely with the reporter</Typography>} />
        </Alert>
      )}
      <Typography sx={label}>Questions and answers</Typography>
      {qs.map((q, i) => {
        const field = q.fieldKey ? interviewFieldOf(t, q.fieldKey) : null;
        const err = errs[i];
        const now = field ? data.latestDraft?.fields?.[field.key] as { value: string | null; status: FieldStatus } | undefined : undefined;
        const usedElsewhere = new Set(qs.filter((_, j) => j !== i).map(x => x.fieldKey).filter(Boolean));
        return (
          <Box key={i} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
              <TextField select fullWidth size="small" label={`Question ${i + 1} - what does the answer fill?`} value={q.fieldKey}
                onChange={e => pickField(i, e.target.value)}
                slotProps={{ select: { displayEmpty: true, renderValue: v => (v ? (() => { const f = interviewFieldOf(t, String(v)); return f ? `${f.no ? `${f.no}. ` : ''}${f.label} - ${f.section}` : String(v); })() : <em>None - added as information</em>),
                  MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } } }, inputLabel: { shrink: true } }}>
                {[
                  <MenuItem key="" value=""><em>None - added as information</em></MenuItem>,
                  ...fieldsBySection.flatMap(([section, fs]) => [
                    <ListSubheader key={`h-${section}`} sx={{ fontSize: '0.74rem', fontWeight: 800, color: NAVY, lineHeight: '30px' }}>{section}</ListSubheader>,
                    ...fs.map(f => (
                      <MenuItem key={f.key} value={f.key} disabled={usedElsewhere.has(f.key)} sx={{ pl: 3, fontSize: '0.88rem' }}>
                        {f.no ? `${f.no}. ` : ''}{f.label}{usedElsewhere.has(f.key) ? ' (in another question)' : ''}
                      </MenuItem>
                    )),
                  ]),
                ]}
              </TextField>
              {qs.length > 1 && <IconButton aria-label="Remove question" onClick={() => setQs(a => a.filter((_, j) => j !== i))}><Delete fontSize="small" /></IconButton>}
            </Box>
            <TextField size="small" fullWidth label="Question asked" value={q.question} onChange={e => setQs(a => a.map((x, j) => j === i ? { ...x, question: e.target.value } : x))}
              helperText={field ? 'A neutral starting question - reword it to what was actually asked' : undefined} slotProps={{ htmlInput: { maxLength: 300 } }} />
            <InterviewAnswerField field={field} value={q.answer} today={today} error={q.answer.trim() ? err : null}
              onChange={v => setQs(a => a.map((x, j) => j === i ? { ...x, answer: v } : x))} />
            {field && (
              <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>
                From the {field.basis}.{' '}
                {now?.value ? <>Now in the draft: <b>{now.value}</b> ({FIELD_STATUSES[now.status]?.label.toLowerCase() ?? now.status}).</> : 'Not in the draft yet.'}
              </Typography>
            )}
          </Box>
        );
      })}
      <Box><Button size="small" startIcon={<Add />} onClick={() => setQs(a => [...a, { question: '', answer: '', fieldKey: '' }])} sx={{ textTransform: 'none' }}>Add a question</Button></Box>
      <TextField size="small" multiline minRows={2} label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
      <TextField size="small" multiline minRows={2} label="Follow-up actions (optional)" value={follow} onChange={e => setFollow(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
      <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>The answers are kept as a new report version, marked as from an interview, and used by the next draft.</Typography>
    </Shell>
  );
}

function ChangesDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const changes = data.changes as Data[];
  return (
    <Shell title={`Review Changes - draft ${data.latestDraft?.draftNumber}${data.drafts[1] ? ` against draft ${data.drafts[1].draftNumber}` : ''}`} onClose={onClose} actions={null}>
      {changes.length === 0 ? <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>Nothing changed from the previous draft.</Typography> : changes.map(ch => (
        <Box key={ch.key} sx={{ borderBottom: '1px solid #f1f5f9', pb: 1 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: NAVY }}>{ch.label}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 1, alignItems: 'start' }}>
            <Box>{ch.before ? <><StatusChip status={ch.before.status} resident={false} /><Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{ch.before.value ?? '—'}</Typography></> : <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>(first draft)</Typography>}</Box>
            <CompareArrows sx={{ color: '#94a3b8', mt: 0.5 }} />
            <Box><StatusChip status={ch.after.status} resident={false} /><Typography sx={{ fontSize: '0.8rem', color: NAVY }}>{ch.after.value ?? '—'}</Typography></Box>
          </Box>
          {(ch.addedText as string[]).map((x, i) => <Typography key={i} sx={{ fontSize: '0.78rem', color: TEAL, mt: 0.5 }}>Added: {x}</Typography>)}
        </Box>
      ))}
    </Shell>
  );
}

function ApproveDialog({ data, onClose, onSend, busy }: { data: Data; onClose: () => void; onSend: (b: unknown) => void; busy: boolean }) {
  const d = data.latestDraft;
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const t: TemplateName = data.template;
  const missing = TEMPLATES[t].fields.filter(f => (d.fields[f.key]?.status ?? 'NEEDS_CONFIRMATION') === 'NEEDS_CONFIRMATION');
  const unverified = TEMPLATES[t].fields.filter(f => d.fields[f.key]?.status === 'UNVERIFIED' || d.fields[f.key]?.status === 'AI_ORGANIZED');
  const ready = missing.length === 0 || (ack && note.trim().length >= 5);
  return (
    <Shell title={`Approve Official Report - draft ${d.draftNumber}`} onClose={onClose}
      actions={<Button variant="contained" disabled={busy || !ready} onClick={() => onSend({ action: 'approve', draftId: d.id, note: note.trim() || undefined, acknowledgeOutstanding: ack || undefined })} sx={{ textTransform: 'none', bgcolor: '#047857' }}>Approve</Button>}>
      <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>
        Approving makes this draft the official report, recorded with your name and the time. Earlier drafts and every version stay on record. The original narrative is kept as filed.
      </Typography>
      {unverified.length > 0 && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>Check before approving - organized by the AI or stated with uncertainty: {unverified.map(f => f.label).join(', ')}.</Alert>}
      {missing.length > 0 && (
        <Alert severity="error" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
          Still needs confirmation: {missing.map(f => f.label).join(', ')}.
          <FormControlLabel control={<Checkbox size="small" checked={ack} onChange={e => setAck(e.target.checked)} />} label={<Typography sx={{ fontSize: '0.8rem' }}>I reviewed these and approve the report with them unconfirmed</Typography>} />
        </Alert>
      )}
      <TextField size="small" multiline minRows={2} label={missing.length ? 'Approval note (required - why it is approved as it is)' : 'Approval note (optional)'} value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
    </Shell>
  );
}

function EditFieldDialog({ data, fieldKey, onClose, onSend, busy }: { data: Data; fieldKey: string; onClose: () => void; onSend: (b: unknown) => void; busy: boolean }) {
  const d = data.latestDraft;
  const f = TEMPLATES[data.template as TemplateName].fields.find(x => x.key === fieldKey)!;
  const [value, setValue] = useState<string>(d.fields[fieldKey]?.value ?? '');
  const [reason, setReason] = useState('');
  return (
    <Shell title={`Correct: ${f.label}`} onClose={onClose}
      actions={<Button variant="contained" disabled={busy || reason.trim().length < 3} onClick={() => onSend({ action: 'edit_field', draftId: d.id, key: fieldKey, value: value.trim(), reason: reason.trim() })} sx={{ textTransform: 'none', bgcolor: NAVY }}>Save as a new draft</Button>}>
      <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Your correction is saved in a new draft and marked as recorded by an official. Leave it empty to mark the field as needing confirmation.</Typography>
      <TextField size="small" multiline minRows={2} label={f.label} value={value} onChange={e => setValue(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
      <TextField size="small" label="Why it is corrected *" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
    </Shell>
  );
}
