'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Chip, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Checkbox, FormControlLabel, IconButton, CircularProgress, Collapse, ListSubheader, useMediaQuery,
} from '@mui/material';
import { Edit, Add, Delete, ExpandMore, ExpandLess, Check } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { TEMPLATES, FIELD_MARKERS, type DraftField, type FieldStatus, type TemplateName, type Attention } from '@/lib/reportTemplates';
import { interviewFields, interviewFieldOf, checkAnswer, type InterviewField } from '@/lib/interviewAnswers';
import InterviewAnswerField from '@/components/cases/InterviewAnswerField';

/**
 * Report Review and Clarification - the resident's original report, SafeComm
 * AI's organized draft in the case's intake template, what still needs an
 * official's attention, and the review actions. An internal SafeComm review:
 * the draft becomes the official report only when an official approves it,
 * and it is not a government form or a Katarungang Pambarangay proceeding.
 */

const NAVY = '#0c1e46';
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
const small = { fontSize: '0.76rem', color: '#64748b' };

/** One short tag for where a value came from - resident, AI, official, record - or that it is missing. */
function tagOf(v: DraftField | undefined): { label: string; color: string; bg: string } {
  const s = v?.status ?? 'NEEDS_CONFIRMATION';
  if (s === 'OFFICIAL') return v?.source === 'official_confirm' ? { label: 'Confirmed', color: '#047857', bg: '#ecfdf5' }
    : v?.source === 'official_edit' ? { label: 'Edited', color: '#047857', bg: '#ecfdf5' } : { label: 'Official', color: '#047857', bg: '#ecfdf5' };
  if (s === 'RESIDENT_CONFIRMED') return { label: 'Resident', color: '#0f766e', bg: '#f0fdfa' };
  if (s === 'RECORDED') return { label: 'Record', color: '#475569', bg: '#f1f5f9' };
  if (s === 'NEW' && v?.note === 'From a recorded interview') return { label: 'Interview', color: '#6d28d9', bg: '#f5f3ff' };
  if (s === 'ORIGINAL' || s === 'NEW' || s === 'AI_ORGANIZED') return { label: 'AI', color: '#7c3aed', bg: '#f5f3ff' };
  if (s === 'UNVERIFIED') return { label: 'Unclear', color: '#a16207', bg: '#fefce8' };
  return { label: 'Missing', color: '#b91c1c', bg: '#fef2f2' };
}
const Tag = ({ v }: { v: DraftField | undefined }) => { const t = tagOf(v); return <Chip size="small" label={t.label} sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, color: t.color, bgcolor: t.bg }} />; };
const REASON: Record<Attention['reason'], { label: string; color: string }> = {
  missing: { label: 'Missing', color: '#b91c1c' }, unclear: { label: 'Unclear', color: '#a16207' }, conflict: { label: 'Conflicts', color: '#c2410c' }, verify: { label: 'Check', color: '#7c3aed' },
  response: { label: 'Resident answer', color: '#0f766e' },
};
/** A clarification request's own progress - separate from the case status. */
const REQUEST_STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Awaiting resident response', color: '#0369a1' }, ANSWERED: { label: 'Resident responded', color: '#0f766e' },
  IN_REVIEW: { label: 'Under official review', color: '#a16207' }, COMPLETED: { label: 'Clarification completed', color: '#047857' }, CANCELLED: { label: 'Withdrawn', color: '#64748b' },
};

/** A section with a heading that opens and closes it. */
function Section({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Box sx={{ borderTop: '1px solid #e2e8f0', pt: 1.25, mt: 1.25 }}>
      <Box component="button" type="button" onClick={onToggle} aria-expanded={open}
        sx={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, width: '100%', '&:focus-visible': { outline: '2px solid #0369a1', borderRadius: 1 } }}>
        <Typography component="h3" sx={{ fontWeight: 800, color: NAVY, fontSize: '0.95rem', flex: 1 }}>
          {title}{typeof count === 'number' ? ` (${count})` : ''}
        </Typography>
        {open ? <ExpandLess sx={{ color: '#64748b' }} /> : <ExpandMore sx={{ color: '#64748b' }} />}
      </Box>
      <Collapse in={open}><Box sx={{ pt: 1 }}>{children}</Box></Collapse>
    </Box>
  );
}

export default function ReportReviewPanel({ caseId }: { caseId: string }) {
  const url = `/api/cases/${caseId}/report-review`;
  const { data, error, isLoading, mutate } = useSWR<Data>(url, getJson);
  const [dialog, setDialog] = useState<null | 'request' | 'interview' | 'changes' | 'approve'>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState({ original: true, organized: true, confirm: true, requests: true, history: false, added: false, optional: false });
  const toggle = (k: keyof typeof open) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const run = async (body: unknown, msg: string) => {
    setBusy(true);
    try { const r = await act(url, body); toast.success(msg); await mutate(); return r ?? {}; }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return null; } finally { setBusy(false); }
  };

  const d = data?.latestDraft;
  const t: TemplateName = data?.template ?? 'BLOTTER';
  const canChange = Boolean(data?.canEdit && d && d.status === 'DRAFT');
  const attention: Attention[] = data?.attention ?? [];
  const optionalMissing = attention.filter(a => a.reason === 'missing' && !a.required);
  const toConfirm = attention.filter(a => !(a.reason === 'missing' && !a.required));

  const fieldRow = (key: string, label: string, v: DraftField | undefined, extra?: ReactNode) => (
    <Box key={key} sx={{ py: 0.75, borderBottom: '1px solid #f1f5f9' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: '190px minmax(0, 1fr) auto' }, gap: { xs: 0.25, sm: 1 }, alignItems: 'start' }}>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b', gridColumn: { xs: '1 / -1', sm: 'auto' } }}>{label}</Typography>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag v={v} />
            {v?.value && <Typography sx={{ fontSize: '0.86rem', color: NAVY, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v.value}</Typography>}
          </Box>
          {v?.byName && v.at && <Typography sx={small}>{v.source === 'official_confirm' ? 'Confirmed' : 'Edited'} by {v.byName}, {when(v.at)}</Typography>}
          {extra}
        </Box>
        {canChange && editing !== key && (
          <IconButton size="small" aria-label={`Edit ${label}`} onClick={() => setEditing(key)}><Edit sx={{ fontSize: 16 }} /></IconButton>
        )}
      </Box>
      {editing === key && d && (
        <FieldEditor label={label} start={v?.value ?? ''} busy={busy} onCancel={() => setEditing(null)}
          onSave={body => run({ action: 'edit_field', draftId: d.id, key, ...body }, 'Saved').then(r => { if (r) setEditing(null); })} />
      )}
    </Box>
  );

  return (
    <Card id="report-review" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem', flex: 1 }}>Report Review and Clarification</Typography>
          {d && (d.status === 'APPROVED'
            ? <Chip size="small" label={`Approved ${d.approvedAt ? when(d.approvedAt) : ''}`} sx={{ fontWeight: 700, bgcolor: '#ecfdf5', color: '#047857' }} />
            : <Chip size="small" label="Draft" sx={{ fontWeight: 700, bgcolor: '#f1f5f9', color: '#475569' }} />)}
        </Box>
        {error ? <Alert severity="warning" sx={{ borderRadius: 2, mt: 1 }}>{error.message}</Alert> : isLoading || !data ? <Skeleton variant="rounded" height={220} sx={{ mt: 1 }} /> : (
          <>
            {!data.canEdit && <Typography sx={{ ...small, mt: 0.5 }}>View only - the officer assigned to this case reviews it.</Typography>}

            {/* A. The resident's report, as filed */}
            <Section title="Original Resident Report" open={open.original} onToggle={() => toggle('original')}>
              <Typography sx={small}>{data.caseNumber} · Submitted {when(data.original.filedAt)}</Typography>
              <Narrative text={data.original.text} />
              {data.versions.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Button size="small" onClick={() => toggle('added')} endIcon={open.added ? <ExpandLess /> : <ExpandMore />} sx={{ textTransform: 'none', px: 0 }}>
                    Added later ({data.versions.length})
                  </Button>
                  <Collapse in={open.added}>
                    {data.versions.map((v: Data) => (
                      <Box key={v.id} sx={{ borderLeft: `3px solid ${v.source === 'INTERVIEW' ? '#7c3aed' : '#0f766e'}`, pl: 1.25, my: 1 }}>
                        <Typography sx={small}>{v.source === 'INTERVIEW' ? 'Interview' : 'Resident'} · {v.sourceLabel} · {v.by} · {when(v.createdAt)}</Typography>
                        {v.text && <Typography sx={{ fontSize: '0.84rem', color: NAVY, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v.text}</Typography>}
                        {(v.fields as Data[]).map(f => <Typography key={f.key} sx={{ fontSize: '0.8rem', color: '#334155' }}>{f.label}: {f.skipped ? <i>skipped</i> : f.value}</Typography>)}
                      </Box>
                    ))}
                  </Collapse>
                </Box>
              )}
            </Section>

            {/* B. SafeComm AI's organized draft, in the case's intake template */}
            <Section title={`AI-Organized Report - ${TEMPLATES[t].title}`} open={open.organized} onToggle={() => toggle('organized')}>
              {!d ? <Typography sx={small}>No draft yet.</Typography> : (
                <>
                  <Typography sx={small}>Prepared in SafeComm for review - not an official government form.</Typography>
                  {TEMPLATES[t].sections.map(sec => (
                    <Box key={sec} sx={{ mt: 1.25 }}>
                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>{sec}</Typography>
                      {TEMPLATES[t].fields.filter(f => f.section === sec).map(f => (f.key === 'narrative' || f.key === 'description')
                        ? (
                          <Box key={f.key} sx={{ py: 0.75, borderBottom: '1px solid #f1f5f9', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px 1fr' }, gap: 1 }}>
                            <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{f.label}</Typography>
                            <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>
                              The original report, unchanged{(d.fields[f.key]?.additions ?? []).length ? ` - plus ${(d.fields[f.key].additions as Data[]).length} later addition${d.fields[f.key].additions.length === 1 ? '' : 's'}` : ''}
                            </Typography>
                          </Box>
                        )
                        : fieldRow(f.key, f.label, d.fields[f.key]))}
                    </Box>
                  ))}
                </>
              )}
            </Section>

            {/* C. Only what is missing, unclear, conflicting, or not yet confirmed */}
            <Section title="Information to Confirm" count={toConfirm.length} open={open.confirm} onToggle={() => toggle('confirm')}>
              {toConfirm.length === 0 && <Typography sx={small}>Nothing to confirm.</Typography>}
              {toConfirm.map(a => (
                <Box key={a.key} sx={{ py: 0.75, borderBottom: '1px solid #f1f5f9' }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Box sx={{ flex: 1, minWidth: 180 }}>
                      <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: NAVY }}>
                        {a.label}{a.required ? ' *' : ''} <Box component="span" sx={{ fontSize: '0.74rem', fontWeight: 500, color: '#64748b' }}>· {a.section}</Box>{' '}
                        <Box component="span" sx={{ fontSize: '0.74rem', fontWeight: 700, color: REASON[a.reason].color }}>· {REASON[a.reason].label}</Box>
                      </Typography>
                      {a.field.value
                        ? <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mt: 0.25 }}><Tag v={a.field} /><Typography sx={{ fontSize: '0.84rem', color: '#334155', overflowWrap: 'anywhere' }}>{a.field.value}</Typography></Box>
                        : <Typography sx={small}>Not provided</Typography>}
                      {a.field.conflictWith && <Typography sx={{ fontSize: '0.78rem', color: '#c2410c' }}>{a.field.conflictWith}</Typography>}
                    </Box>
                    {canChange && editing !== `c:${a.key}` && (
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {a.field.value && (
                          <Button size="small" variant="outlined" startIcon={<Check />} disabled={busy}
                            onClick={() => void run({ action: 'confirm_field', draftId: d.id, key: a.key }, `${a.label} confirmed`)} sx={{ textTransform: 'none', minHeight: 32 }}>Confirm</Button>
                        )}
                        <Button size="small" startIcon={<Edit />} onClick={() => setEditing(`c:${a.key}`)} sx={{ textTransform: 'none', minHeight: 32 }}>Edit</Button>
                      </Box>
                    )}
                  </Box>
                  {editing === `c:${a.key}` && d && (
                    <FieldEditor label={a.label} start={a.field.value ?? ''} busy={busy} onCancel={() => setEditing(null)}
                      onSave={body => run({ action: 'edit_field', draftId: d.id, key: a.key, ...body }, 'Saved').then(r => { if (r) setEditing(null); })} />
                  )}
                </Box>
              ))}
              {optionalMissing.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Button size="small" onClick={() => toggle('optional')} endIcon={open.optional ? <ExpandLess /> : <ExpandMore />} sx={{ textTransform: 'none', px: 0 }}>
                    Optional, not provided ({optionalMissing.length})
                  </Button>
                  <Collapse in={open.optional}>{optionalMissing.map(a => fieldRow(`o:${a.key}`, a.label, a.field))}</Collapse>
                </Box>
              )}
            </Section>

            {/* Requests to the resident, and what they answered - kept, newest first */}
            {data.requests.length > 0 && (
              <Section title="Clarification Requests" count={data.requests.length} open={open.requests} onToggle={() => toggle('requests')}>
                {data.requests.map((r: Data) => (
                  <Box key={r.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, mb: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip size="small" label={REQUEST_STATUS[r.status]?.label ?? r.status} sx={{ height: 22, fontSize: '0.72rem', fontWeight: 700, color: REQUEST_STATUS[r.status]?.color, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }} />
                      <Typography sx={{ ...small, flex: 1 }}>Sent {when(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}</Typography>
                      {data.canEdit && r.status === 'OPEN' && (
                        <Button size="small" disabled={busy} onClick={() => { const reason = window.prompt('Why is the request withdrawn?'); if (reason) void run({ action: 'cancel_request', requestId: r.id, reason }, 'Request withdrawn'); }} sx={{ textTransform: 'none' }}>Withdraw</Button>
                      )}
                      {data.canEdit && r.status === 'ANSWERED' && (
                        <Button size="small" variant="outlined" disabled={busy} onClick={() => void run({ action: 'review_request', requestId: r.id }, 'Review started')} sx={{ textTransform: 'none' }}>Start review</Button>
                      )}
                      {data.canEdit && (r.status === 'ANSWERED' || r.status === 'IN_REVIEW') && (
                        <Button size="small" variant="contained" disabled={busy} onClick={() => void run({ action: 'complete_request', requestId: r.id }, 'Clarification completed')} sx={{ textTransform: 'none', bgcolor: '#047857' }}>Mark complete</Button>
                      )}
                    </Box>
                    {r.message && <Typography sx={{ fontSize: '0.8rem', color: '#475569', mt: 0.5 }}>&ldquo;{r.message}&rdquo;</Typography>}
                    {(r.items as Data[]).map(i => {
                      const ans = (r.response?.fields as Data[] | undefined)?.find(f => f.key === i.key);
                      return (
                        <Box key={i.key} sx={{ mt: 0.75 }}>
                          <Typography sx={{ fontSize: '0.82rem', color: NAVY, fontWeight: 600 }}>{i.question}</Typography>
                          {r.response && (
                            <Typography sx={{ fontSize: '0.84rem', color: ans?.value ? '#0f766e' : '#94a3b8', overflowWrap: 'anywhere' }}>
                              {ans?.value ? ans.value : ans?.skipped ? 'Skipped by the resident' : 'No answer'}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                    {r.response && (
                      <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px dashed #e2e8f0' }}>
                        <Typography sx={small}>Resident&apos;s response · {when(r.response.at)} · report version {r.response.version}</Typography>
                        {r.response.text && <Typography sx={{ fontSize: '0.86rem', color: '#0f766e', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.response.text}</Typography>}
                      </Box>
                    )}
                    {(r.reviewStartedAt || r.completedAt || r.cancelledAt) && (
                      <Typography sx={{ ...small, mt: 0.5 }}>
                        {r.reviewStartedAt ? `Review started by ${r.reviewStartedBy ?? 'an official'}, ${when(r.reviewStartedAt)}. ` : ''}
                        {r.completedAt ? `Completed by ${r.completedBy ?? 'an official'}, ${when(r.completedAt)}${r.completionNote ? ` - "${r.completionNote}"` : ''}. ` : ''}
                        {r.cancelledAt ? `Withdrawn by ${r.cancelledBy ?? 'an official'}, ${when(r.cancelledAt)}${r.cancelReason ? ` - "${r.cancelReason}"` : ''}.` : ''}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Section>
            )}

            {/* D. Review actions */}
            {data.canEdit && (
              <Box sx={{ borderTop: '1px solid #e2e8f0', pt: 1.25, mt: 1.25 }}>
                <Typography component="h3" sx={{ fontWeight: 800, color: NAVY, fontSize: '0.95rem', mb: 1 }}>Review Actions</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button size="small" variant="outlined" onClick={() => setDialog('request')} disabled={!data.residentLinked || busy} sx={{ textTransform: 'none' }}>Request Resident Clarification</Button>
                  <Button size="small" variant="outlined" onClick={() => setDialog('interview')} disabled={busy} sx={{ textTransform: 'none' }}>Record Interview</Button>
                  <Button size="small" variant="outlined" onClick={() => setDialog('changes')} disabled={!d} sx={{ textTransform: 'none' }}>Review Changes</Button>
                  <Button size="small" variant="contained" onClick={() => setDialog('approve')} disabled={!canChange || busy} sx={{ textTransform: 'none', bgcolor: '#047857' }}>Approve Official Report</Button>
                </Box>
                {!data.residentLinked && <Typography sx={{ ...small, mt: 0.75 }}>Not filed through a resident account - use Record Interview.</Typography>}
                {data.reassessDue.length > 0 && <Typography sx={{ ...small, mt: 0.75 }}>New information since the last AI assessment - re-run it in the AI Assessment card.</Typography>}
              </Box>
            )}

            {/* The record of how the report got here */}
            <Section title="History" open={open.history} onToggle={() => toggle('history')}>
              <History title="Drafts" rows={data.drafts.map((x: Data) => `Draft ${x.draftNumber} · ${x.status.toLowerCase()} · ${x.createdBy ?? ''}, ${when(x.createdAt)}${x.approvedAt ? ` · approved by ${x.approvedBy}, ${when(x.approvedAt)}${x.approvalNote ? ` - "${x.approvalNote}"` : ''}` : ''}`)} />
              <History title="Interviews" rows={data.interviews.map((i: Data) => `${when(i.interviewedAt)} · ${CONTACT[i.contactMethod as keyof typeof CONTACT] ?? i.contactMethod} · ${i.interviewer ?? 'an official'}`)} />
            </Section>
          </>
        )}
      </CardContent>
      {data && dialog === 'request' && <RequestDialog data={data} onClose={() => setDialog(null)} onSend={b => run(b, 'Request sent to the resident').then(r => { if (r) setDialog(null); })} busy={busy} />}
      {data && dialog === 'interview' && <InterviewDialog data={data} onClose={() => setDialog(null)} busy={busy}
        onSend={b => run(b, 'Interview recorded - the report is updated').then(r => {
          if (!r) return;
          setDialog(null);
          if (r.reassessment && !r.reassessment.skipped) toast('AI assessment re-run with the new information - see the AI Assessment card', { icon: 'ℹ️' });
        })} />}
      {data && dialog === 'changes' && <ChangesDialog data={data} onClose={() => setDialog(null)} />}
      {data && dialog === 'approve' && <ApproveDialog data={data} onClose={() => setDialog(null)} onSend={b => run(b, 'Official report approved').then(r => { if (r) setDialog(null); })} busy={busy} />}
    </Card>
  );
}

/** The narrative as filed; a long one is shortened until "Show all". */
function Narrative({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 600;
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography sx={{ fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...(long && !all ? { maxHeight: 150, overflow: 'hidden' } : {}) }}>{text}</Typography>
      {long && <Button size="small" onClick={() => setAll(a => !a)} sx={{ textTransform: 'none', px: 0 }}>{all ? 'Show less' : 'Show all'}</Button>}
    </Box>
  );
}

/** Edit one field in place: a value, or the form's own answer when there is none. */
function FieldEditor({ label, start, busy, onSave, onCancel }: { label: string; start: string; busy: boolean; onSave: (b: { value?: string; marker?: string; reason?: string }) => void; onCancel: () => void }) {
  const [value, setValue] = useState(start);
  const [reason, setReason] = useState('');
  return (
    <Box sx={{ mt: 1, p: 1.25, bgcolor: '#f8fafc', borderRadius: 2, display: 'grid', gap: 1 }}>
      <TextField size="small" fullWidth multiline maxRows={6} label={label} value={value} onChange={e => setValue(e.target.value)} autoFocus slotProps={{ htmlInput: { maxLength: 1000 } }} />
      <TextField size="small" fullWidth label="Note (optional)" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" variant="contained" disabled={busy || !value.trim()} onClick={() => onSave({ value: value.trim(), reason: reason.trim() || undefined })} sx={{ textTransform: 'none', bgcolor: NAVY }}>Save</Button>
        <Button size="small" onClick={onCancel} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        {(Object.entries(FIELD_MARKERS) as [string, string][]).map(([k, l]) => (
          <Button key={k} size="small" disabled={busy} onClick={() => onSave({ marker: k, reason: reason.trim() || undefined })} sx={{ textTransform: 'none', color: '#475569' }}>{l}</Button>
        ))}
      </Box>
    </Box>
  );
}

function History({ title, rows }: { title: string; rows: string[] }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155' }}>{title}</Typography>
      {rows.length === 0 ? <Typography sx={small}>None.</Typography>
        : rows.map((r, i) => <Typography key={i} sx={{ fontSize: '0.8rem', color: '#334155', overflowWrap: 'anywhere' }}>{r}</Typography>)}
    </Box>
  );
}

function Shell({ title, children, onClose, actions, closeLabel = 'Cancel' }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode; closeLabel?: string }) {
  const phone = useMediaQuery('(max-width:600px)');
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper" fullScreen={phone}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5 }}>{children}</DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}><Button onClick={onClose} sx={{ textTransform: 'none' }}>{closeLabel}</Button>{actions}</DialogActions>
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
      <Typography sx={small}>Sent inside SafeComm only - never by text or call. The resident can skip any question.</Typography>
      {(data.suggestions as Data[]).map(s => (
        <Box key={s.key}>
          <FormControlLabel control={<Checkbox size="small" checked={s.key in picked} onChange={e => setPicked(p => { const n = { ...p }; if (e.target.checked) n[s.key] = s.question; else delete n[s.key]; return n; })} />}
            label={<Typography sx={{ fontSize: '0.84rem' }}>{s.label}</Typography>} />
          {s.key in picked && <TextField size="small" fullWidth value={picked[s.key]} onChange={e => setPicked(p => ({ ...p, [s.key]: e.target.value }))} slotProps={{ htmlInput: { maxLength: 300, 'aria-label': `Question about ${s.label}` } }} />}
        </Box>
      ))}
      <TextField size="small" label="Another question (optional)" value={custom} onChange={e => setCustom(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
      <TextField size="small" label="Message to the resident (optional)" multiline minRows={2} value={message} onChange={e => setMessage(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
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
      actions={<Button variant="contained" disabled={busy || !valid} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined} sx={{ textTransform: 'none', bgcolor: NAVY }}
        onClick={() => onSend({ action: 'record_interview', interviewedAt: at, contactMethod: method, interviewerId: interviewer || undefined, safetyConfirmed: safe || undefined,
          questions: qs.filter(q => q.question.trim().length >= 3).map(q => ({ question: q.question.trim(), answer: q.answer.trim(), fieldKey: q.fieldKey || undefined })),
          notes: notes.trim() || undefined, followUpActions: follow.trim() || undefined })}>{busy ? 'Saving…' : 'Save interview'}</Button>}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
        <TextField size="small" type="datetime-local" label="Date and time" value={at} onChange={e => setAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
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
          This reporter asked not to be called.
          <FormControlLabel control={<Checkbox size="small" checked={safe} onChange={e => setSafe(e.target.checked)} />} label={<Typography sx={{ fontSize: '0.8rem' }}>The call was arranged safely with the reporter</Typography>} />
        </Alert>
      )}
      {qs.map((q, i) => {
        const field = q.fieldKey ? interviewFieldOf(t, q.fieldKey) : null;
        const err = errs[i];
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
            <TextField size="small" fullWidth label="Question asked" value={q.question} onChange={e => setQs(a => a.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} slotProps={{ htmlInput: { maxLength: 300 } }} />
            <InterviewAnswerField field={field} value={q.answer} today={today} error={q.answer.trim() ? err : null}
              onChange={v => setQs(a => a.map((x, j) => j === i ? { ...x, answer: v } : x))} />
            {field && <Typography sx={small}>From the {field.basis}.</Typography>}
          </Box>
        );
      })}
      <Box><Button size="small" startIcon={<Add />} onClick={() => setQs(a => [...a, { question: '', answer: '', fieldKey: '' }])} sx={{ textTransform: 'none' }}>Add a question</Button></Box>
      <TextField size="small" multiline minRows={2} label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
      <TextField size="small" multiline minRows={2} label="Follow-up actions (optional)" value={follow} onChange={e => setFollow(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
    </Shell>
  );
}

const show = (v: string | null, status: FieldStatus) => v ?? (status === 'NEEDS_CONFIRMATION' ? 'Not provided' : '-');

function ChangesDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const changes = data.changes as Data[];
  return (
    <Shell title="Review Changes" onClose={onClose} actions={null} closeLabel="Close">
      {changes.length === 0 ? <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>No changes since the first draft.</Typography> : changes.map(ch => (
        <Box key={ch.key} sx={{ borderBottom: '1px solid #f1f5f9', pb: 1 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>{ch.label}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 0.25, sm: 1.5 }, mt: 0.25 }}>
            <Box>
              <Typography sx={small}>Original</Typography>
              <Typography sx={{ fontSize: '0.84rem', color: '#64748b', textDecoration: ch.before.value ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>{show(ch.before.value, ch.before.status)}</Typography>
            </Box>
            <Box>
              <Typography sx={small}>Now</Typography>
              <Typography sx={{ fontSize: '0.84rem', color: NAVY, fontWeight: 600, overflowWrap: 'anywhere' }}>{show(ch.after.value, ch.after.status)}</Typography>
              {(ch.added as Data[]).map((x, i) => <Typography key={i} sx={{ fontSize: '0.8rem', color: '#0f766e' }}>+ {x.source}: {x.text}</Typography>)}
            </Box>
          </Box>
          <Typography sx={{ ...small, mt: 0.25 }}>{ch.by} · {when(ch.at)}{ch.note ? ` · "${ch.note}"` : ''}</Typography>
        </Box>
      ))}
    </Shell>
  );
}

function ApproveDialog({ data, onClose, onSend, busy }: { data: Data; onClose: () => void; onSend: (b: unknown) => void; busy: boolean }) {
  const d = data.latestDraft;
  const attention = data.attention as Attention[];
  const requiredMissing = attention.filter(a => a.reason === 'missing' && a.required);
  const unconfirmed = attention.filter(a => a.reason !== 'missing');
  const optionalMissing = attention.filter(a => a.reason === 'missing' && !a.required).length;
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const blocked = requiredMissing.length > 0;
  return (
    <Shell title="Approve Official Report" onClose={onClose} closeLabel={blocked ? 'Keep as draft' : 'Cancel'}
      actions={blocked ? null : (
        <Button variant="contained" disabled={busy || (unconfirmed.length > 0 && !checked)} sx={{ textTransform: 'none', bgcolor: '#047857' }}
          onClick={() => onSend({ action: 'approve', draftId: d.id, note: note.trim() || undefined, acknowledgeOutstanding: unconfirmed.length ? true : undefined })}>Approve</Button>
      )}>
      {blocked ? (
        <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.84rem' }}>
          Still needed: {requiredMissing.map(a => a.label).join(', ')}.
          <br />Record them, or mark them Unknown, Declined or N/A. Otherwise keep the draft and continue clarifying.
        </Alert>
      ) : (
        <>
          <Typography sx={{ fontSize: '0.86rem', color: '#334155' }}>
            Draft {d.draftNumber} becomes the official report, with your name and the time. The original report and every draft are kept.
          </Typography>
          {unconfirmed.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: '0.84rem', color: '#a16207' }}>Not yet confirmed: {unconfirmed.map(a => a.label).join(', ')}.</Typography>
              <FormControlLabel control={<Checkbox size="small" checked={checked} onChange={e => setChecked(e.target.checked)} />}
                label={<Typography sx={{ fontSize: '0.84rem' }}>I checked these values</Typography>} />
            </Box>
          )}
          {optionalMissing > 0 && <Typography sx={small}>{optionalMissing} optional field{optionalMissing === 1 ? '' : 's'} not provided - kept as not provided.</Typography>}
          <TextField size="small" multiline minRows={2} label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          <Typography sx={small}>
            {data.vawc ? 'VAWC cases are not referred to barangay mediation or conciliation (RA 9262).' : 'Approval does not decide Katarungang Pambarangay eligibility.'}
          </Typography>
        </>
      )}
    </Shell>
  );
}
