'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Alert, Chip, Skeleton, ToggleButtonGroup, ToggleButton,
  Accordion, AccordionSummary, AccordionDetails, CircularProgress, useMediaQuery,
} from '@mui/material';
import { ExpandMore, Phone, MarkEmailUnread, Edit } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { FIELD_STATUSES, type FieldStatus } from '@/lib/reportTemplates';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';
import ContactCopyButton from '@/components/shared/ContactCopyButton';

/**
 * Edit / Add Information - a resident's own report. Nothing they first wrote
 * is changed: a correction, an addition, an answer or a clarification is a
 * new version the barangay sees beside the original. Every question can be
 * skipped. SafeComm AI's organized draft is shown for them to check, marked
 * by where each detail came from.
 */

const NAVY = '#0c1e46';
const TEAL = '#0f766e';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;
const STATUS_COLOR: Record<FieldStatus, { bg: string; fg: string }> = {
  RESIDENT_CONFIRMED: { bg: '#ecfdf5', fg: '#047857' }, ORIGINAL: { bg: '#eff6ff', fg: '#1d4ed8' }, NEW: { bg: '#f0fdfa', fg: TEAL },
  AI_ORGANIZED: { bg: '#f5f3ff', fg: '#6d28d9' }, UNVERIFIED: { bg: '#fffbeb', fg: '#b45309' }, RECORDED: { bg: '#f1f5f9', fg: '#475569' },
  OFFICIAL: { bg: '#f1f5f9', fg: '#475569' }, NEEDS_CONFIRMATION: { bg: '#fef2f2', fg: '#b91c1c' },
};
const getJson = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load your report');
  return body.data;
};
async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Could not save');
  return json.data;
}
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function StatusChip({ status, resident = true }: { status: FieldStatus; resident?: boolean }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.RECORDED;
  return <Chip size="small" label={resident ? FIELD_STATUSES[status]?.resident : FIELD_STATUSES[status]?.label}
    sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: c.bg, color: c.fg, '& .MuiChip-label': { px: 0.75 } }} />;
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Typography component="h3" sx={{ fontWeight: 800, color: NAVY, fontSize: '0.92rem', mb: note ? 0.25 : 1 }}>{title}</Typography>
      {note && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mb: 1.25 }}>{note}</Typography>}
      {children}
    </Box>
  );
}

function AnswerInput({ kind, value, onChange, label }: { kind: 'text' | 'date' | 'time'; value: string; onChange: (v: string) => void; label: string }) {
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  if (kind === 'date') return <TextField size="small" type="date" value={value} onChange={e => onChange(e.target.value)} slotProps={{ htmlInput: { max: today, 'aria-label': label } }} />;
  return <TextField size="small" fullWidth multiline={kind === 'text'} minRows={kind === 'text' ? 2 : undefined} value={value} onChange={e => onChange(e.target.value)}
    placeholder={kind === 'time' ? 'e.g. around 9 PM' : 'Your answer, in your own words'} slotProps={{ htmlInput: { maxLength: kind === 'time' ? 60 : 500, 'aria-label': label } }} />;
}

export default function ReportEditor({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const phone = useMediaQuery('(max-width:600px)');
  const url = `/api/resident/cases/${caseId}/report`;
  const { data, error, isLoading, mutate } = useSWR<Data>(url, getJson);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [reqAnswers, setReqAnswers] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<'correction' | 'addition' | 'clarification'>('addition');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);

  const done = async (r: { version: number; emergency: boolean }, msg: string) => {
    toast.success(`${msg} - saved as version ${r.version}`);
    if (r.emergency) setEmergency(true);
    await mutate();
  };
  const sendAnswers = async () => {
    const list = (data?.questions ?? []).flatMap((q: Data) => skipped[q.key] ? [{ key: q.key, skipped: true }] : answers[q.key]?.trim() ? [{ key: q.key, value: answers[q.key].trim() }] : []);
    if (!list.length) { toast.error('Answer or skip at least one question'); return; }
    setBusy('answers');
    try { await done(await post(url, { kind: 'answers', answers: list }), 'Answers saved'); setAnswers({}); setSkipped({}); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(null); }
  };
  const sendRequest = async (r: Data) => {
    const list = (r.items as Data[]).map(i => reqAnswers[`${r.id}:${i.key}`]?.trim() ? { key: i.key, value: reqAnswers[`${r.id}:${i.key}`].trim() } : { key: i.key, skipped: true });
    setBusy(r.id);
    try { await done(await post(url, { kind: 'clarification', requestId: r.id, answers: list }), 'Your answer was sent to the barangay'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send'); } finally { setBusy(null); }
  };
  const sendText = async () => {
    setBusy('text');
    try { await done(await post(url, { kind, text: text.trim(), reason: reason.trim() || undefined }), kind === 'correction' ? 'Correction saved' : 'Added to your report'); setText(''); setReason(''); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(null); }
  };

  const openRequests = (data?.requests ?? []).filter((r: Data) => r.status === 'OPEN');
  const draftSections: string[] = data?.draft ? [...new Set<string>(data.draft.rows.map((r: Data) => r.section))] : [];

  return (
    <Dialog open onClose={onClose} fullScreen={phone} fullWidth maxWidth="md" scroll="paper" aria-labelledby="report-editor-title">
      <DialogTitle id="report-editor-title" sx={{ fontWeight: 800, color: NAVY, pb: 0.5 }}>
        Edit / Add Information{data?.caseNumber ? ` · #${data.caseNumber}` : ''}
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 400 }}>
          What you first wrote is never changed. Each correction or addition is saved as a new version that the barangay sees beside it. You can skip any question.
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {emergency && (
          <Alert severity="error" icon={<Phone />} sx={{ borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', mb: 0.75 }}>What you wrote sounds like someone may be in danger now. Your report was marked urgent for the barangay - if you can, call now:</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {EMERGENCY_CONTACTS.map(c => (
                <ContactCopyButton key={c.label} name={c.label} number={c.number} size="small" variant="outlined" color="error" sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700 }}>
                  {c.label}: {c.number}
                </ContactCopyButton>
              ))}
            </Box>
          </Alert>
        )}
        {error ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{error.message}</Alert> : isLoading || !data ? <Skeleton variant="rounded" height={240} /> : (
          <>
            {!data.open && <Alert severity="info" sx={{ borderRadius: 2 }}>This case is closed. You can read your report here; contact the barangay if something needs to be added.</Alert>}

            {openRequests.map((r: Data) => (
              <Section key={r.id} title="The barangay asked for more information"
                note={<>Asked {when(r.createdAt)}. Answer what you can and leave the rest blank - blank answers are sent as skipped.{r.message ? <><br />&ldquo;{r.message}&rdquo;</> : null}</>}>
                <Box sx={{ display: 'grid', gap: 1.25 }}>
                  {(r.items as Data[]).map(i => (
                    <Box key={i.key}>
                      <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY, mb: 0.5 }}>{i.question}</Typography>
                      <AnswerInput kind="text" label={i.question} value={reqAnswers[`${r.id}:${i.key}`] ?? ''} onChange={v => setReqAnswers(a => ({ ...a, [`${r.id}:${i.key}`]: v }))} />
                    </Box>
                  ))}
                  <Box><Button variant="contained" disabled={!data.open || busy === r.id} startIcon={<MarkEmailUnread />} onClick={() => sendRequest(r)} sx={{ textTransform: 'none', bgcolor: TEAL }}>
                    {busy === r.id ? <CircularProgress size={16} color="inherit" /> : 'Send my answer'}</Button></Box>
                </Box>
              </Section>
            ))}

            {data.open && data.questions.length > 0 && (
              <Section title="Questions that would help" note="Only what your report does not say yet. Skip anything you do not know or would rather not answer.">
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                  {data.questions.map((q: Data) => (
                    <Box key={q.key} sx={{ opacity: skipped[q.key] ? 0.55 : 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>{q.question}</Typography>
                        {q.optional && <Chip size="small" label="Optional" sx={{ height: 20, fontSize: '0.68rem' }} />}
                        <Button size="small" onClick={() => setSkipped(s => ({ ...s, [q.key]: !s[q.key] }))} sx={{ ml: 'auto', textTransform: 'none' }}>
                          {skipped[q.key] ? 'Answer instead' : 'Skip'}</Button>
                      </Box>
                      {!skipped[q.key] && <AnswerInput kind={q.kind} label={q.question} value={answers[q.key] ?? ''} onChange={v => setAnswers(a => ({ ...a, [q.key]: v }))} />}
                    </Box>
                  ))}
                  <Box><Button variant="contained" disabled={busy === 'answers'} onClick={sendAnswers} sx={{ textTransform: 'none', bgcolor: TEAL }}>
                    {busy === 'answers' ? <CircularProgress size={16} color="inherit" /> : 'Save answers'}</Button></Box>
                </Box>
              </Section>
            )}

            {data.open && (
              <Section title="Correct or add something" note="Write it in your own words. It is added beside what you first wrote, not over it.">
                <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => v && setKind(v)} sx={{ mb: 1.25, flexWrap: 'wrap' }} aria-label="What kind of change">
                  <ToggleButton value="addition" sx={{ textTransform: 'none' }}>Add information</ToggleButton>
                  <ToggleButton value="correction" sx={{ textTransform: 'none' }}>Correct a detail</ToggleButton>
                  <ToggleButton value="clarification" sx={{ textTransform: 'none' }}>Clarify what I wrote</ToggleButton>
                </ToggleButtonGroup>
                <TextField fullWidth multiline minRows={3} value={text} onChange={e => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': 'Your correction or addition' } }}
                  placeholder={kind === 'correction' ? 'What should be corrected, and what is right?' : kind === 'clarification' ? 'What do you want to make clearer?' : 'What else happened, or what should the barangay know?'} />
                {kind === 'correction' && (
                  <TextField fullWidth size="small" label="Why is it being corrected? (optional)" value={reason} onChange={e => setReason(e.target.value)} sx={{ mt: 1 }} slotProps={{ htmlInput: { maxLength: 300 } }} />
                )}
                <Box sx={{ mt: 1 }}><Button variant="contained" disabled={busy === 'text' || !text.trim()} startIcon={<Edit />} onClick={sendText} sx={{ textTransform: 'none', bgcolor: NAVY }}>
                  {busy === 'text' ? <CircularProgress size={16} color="inherit" /> : 'Submit for officer review'}</Button></Box>
              </Section>
            )}

            {data.draft && (
              <Section title="Your report, organized by SafeComm AI"
                note={<>Check it - you can correct anything above. Each detail shows where it came from. This is a draft until a barangay official reviews and approves it.
                  {data.draft.generator !== 'ai' ? ' SafeComm AI has not organized the latest version yet; what you entered is shown.' : ''}</>}>
                {data.draft.summary && (
                  <Box sx={{ bgcolor: '#f5f3ff', borderRadius: 2, p: 1.25, mb: 1.25 }}>
                    <StatusChip status="AI_ORGANIZED" />
                    <Typography sx={{ fontSize: '0.84rem', color: '#334155', mt: 0.5 }}>{data.draft.summary}</Typography>
                  </Box>
                )}
                {draftSections.map(sec => (
                  <Accordion key={sec} disableGutters defaultExpanded={sec === draftSections[0] || /Incident/.test(sec)} sx={{ boxShadow: 'none', border: '1px solid #e2e8f0', '&:before': { display: 'none' }, mb: 0.75, borderRadius: '8px !important' }}>
                    <AccordionSummary expandIcon={<ExpandMore />}><Typography sx={{ fontWeight: 700, fontSize: '0.86rem', color: NAVY }}>{sec}</Typography></AccordionSummary>
                    <AccordionDetails sx={{ display: 'grid', gap: 1, pt: 0 }}>
                      {data.draft.rows.filter((r: Data) => r.section === sec).map((r: Data) => (
                        <Box key={r.key} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: { xs: 0.25, sm: 1.5 } }}>
                          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{r.label}</Typography>
                          <Box>
                            <StatusChip status={r.status} />
                            {r.value && <Typography sx={{ fontSize: '0.86rem', color: NAVY, mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.value}</Typography>}
                            {(r.additions ?? []).map((a: Data) => (
                              <Typography key={a.version} sx={{ fontSize: '0.8rem', color: TEAL, mt: 0.5, whiteSpace: 'pre-wrap' }}>Added (version {a.version}): {a.text}</Typography>
                            ))}
                          </Box>
                        </Box>
                      ))}
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Section>
            )}

            <Section title="What you first wrote" note={`Filed ${when(data.original.filedAt)} - kept exactly as you wrote it.`}>
              <Typography sx={{ fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap', bgcolor: '#f8fafc', p: 1.5, borderRadius: 2 }}>{data.original.text}</Typography>
            </Section>

            {data.versions.length > 0 && (
              <Section title="Your updates">
                <Box sx={{ display: 'grid', gap: 0.75 }}>
                  {data.versions.map((v: Data) => (
                    <Box key={v.version} sx={{ borderLeft: `3px solid ${TEAL}`, pl: 1.25 }}>
                      <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Version {v.version} · {v.sourceLabel} · {when(v.createdAt)}</Typography>
                      {v.text && <Typography sx={{ fontSize: '0.84rem', color: NAVY, whiteSpace: 'pre-wrap' }}>{v.text}</Typography>}
                      {(v.fields as Data[]).map(f => <Typography key={f.key} sx={{ fontSize: '0.8rem', color: '#334155' }}>{f.label}: {f.skipped ? <i>skipped</i> : f.value}</Typography>)}
                      {v.reason && <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>Reason: {v.reason}</Typography>}
                    </Box>
                  ))}
                </Box>
              </Section>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', bgcolor: '#14b8a6', '&:hover': { bgcolor: '#0d9488' } }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
