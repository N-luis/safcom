'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Alert, Chip, Tabs, Tab,
  Skeleton, CircularProgress, Divider, IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import { Close, Gavel, PictureAsPdf, Visibility, Event, AttachFile, Add } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  HEARING_STATUSES, HEARING_OUTCOMES, ATTENDANCE, NOTICE_STATUSES, NOTICE_METHODS, NOTICE_RECIPIENTS, STAGE_OUTCOMES, KP_STAGES, PANGKAT_CHOSEN_BY, PANGKAT_SIZE,
  HEARING_EVENT_LABELS, allowedFrom, hasDayArrived, isLive, phDay, phTime, phInstant, formatHearingWhen, formatHearingDate, formatHearingTime, outcomeLabel,
  outcomeLeadsTo, partyFormsFor, kpFormName, sessionTitle,
  type HearingOutcome, type Attendance, type NoticeRecipient, type NoticeMethod, type ScheduleConflict, type PangkatChosenBy, type PartyRole,
} from '@/lib/hearings';
import ConflictWarnings, { ConflictList } from './ConflictWarnings';
import { MAX_IMAGE_EDGE } from '@/lib/attachments';
import {
  NAVY, STATUS_COLOR, NOTICE_COLOR, ATTENDANCE_COLOR, chipSx, getJson, send, todayPh, conflictsOf,
  type CaseHearingsData, type Hearing, type HearingNotice, type PartyOption,
} from './hearingUi';

const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');

/**
 * One Katarungang Pambarangay proceeding, for the officials: its details,
 * its KP notices, the parties and their SafeComm accounts, the Pangkat (from
 * the constitution stage on), attendance and proceedings, the outcome its
 * stage allows, and the full history - and, for an official who may run it,
 * every action the proceeding allows at its status. Earlier proceedings on
 * the case are shown beside it, read-only.
 */
export default function HearingDetailsDialog({ caseId, hearingId, onClose, onChanged, onScheduleNext, caseHref }: {
  caseId: string; hearingId: string; onClose: () => void; onChanged?: () => void;
  /** Opens Create Hearing for this case, when the next hearing may follow. */
  onScheduleNext?: (caseId: string) => void;
  caseHref?: string;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { data, error, isLoading, mutate } = useSWR<CaseHearingsData>(`/api/cases/${caseId}/hearings`, getJson);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<null | { kind: 'edit' | 'reschedule' | 'details' | 'cancel'; requestId?: string } | { kind: 'decline'; requestId: string }
    | { kind: 'issue' | 'delivery' | 'ack'; notice: HearingNotice }>(null);
  const h = data?.hearings.find(x => x.id === hearingId) ?? null;
  const refresh = () => { void mutate(); onChanged?.(); };
  const can = (action: string) => Boolean(data?.canEdit && h && allowedFrom(action, h.status));
  const act = async (body: Record<string, unknown>, ok: string) => {
    try { await send(`/api/cases/${caseId}/hearings/${hearingId}`, 'PATCH', body); toast.success(ok); refresh(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return false; }
  };
  // Every change to a hearing's schedule is confirmed first, with what changes and what is kept.
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const ask = (p: Omit<Pending, 'conflicts'>) => setConfirm({ ...p, conflicts: null });
  const runConfirmed = async () => {
    if (!confirm) return;
    try {
      await send(`/api/cases/${caseId}/hearings/${hearingId}`, 'PATCH', { ...confirm.body, ...(confirm.conflicts && { confirmConflicts: true }) });
      toast.success(confirm.ok); setConfirm(null); setDialog(null); refresh();
    } catch (e) {
      const conflicts = conflictsOf(e);
      if (conflicts) setConfirm(c => (c ? { ...c, conflicts } : c));
      else toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const whenOf = (body: Record<string, unknown>) => {
    const at = typeof body.date === 'string' && typeof body.time === 'string' ? phInstant(body.date, body.time) : null;
    return at ? formatHearingWhen(at) : '-';
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle sx={{ pr: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Gavel sx={{ color: '#0369a1' }} />
          <Typography component="span" sx={{ fontWeight: 800, color: NAVY, fontSize: '1.05rem' }}>
            {h ? `${KP_STAGES[h.stage].letter}. ${KP_STAGES[h.stage].label}${h.session > 1 ? ` - session ${h.session}` : ''}` : 'Hearing'}
          </Typography>
          {h && <Chip size="small" label={HEARING_STATUSES[h.status]} sx={chipSx(STATUS_COLOR[h.status])} />}
        </Box>
        {h && data && (
          <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25 }}>
            {h.reference} · Case {caseHref ? <a href={caseHref} style={{ color: '#0369a1' }}>{data.case.caseNumber}</a> : data.case.caseNumber} · {data.case.caseType}
          </Typography>
        )}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {isLoading && <Box sx={{ p: 2 }}><Skeleton height={200} /></Box>}
        {error && !data && <Alert severity="error" sx={{ m: 2, borderRadius: 2 }}>{error.message}</Alert>}
        {data && !h && <Alert severity="warning" sx={{ m: 2, borderRadius: 2 }}>This hearing is no longer on the case. Reload the list.</Alert>}
        {data && h && (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid #e2e8f0', px: 1 }}>
              <Tab value="overview" label="Overview" sx={{ textTransform: 'none' }} />
              <Tab value="notices" label={`KP notices (${h.notices.filter(n => n.status !== 'SUPERSEDED' && n.recipientRole !== 'PANGKAT_MEMBER').length})`} sx={{ textTransform: 'none' }} />
              <Tab value="parties" label="Parties & accounts" sx={{ textTransform: 'none' }} />
              {h.stage !== 'MEDIATION' && <Tab value="pangkat" label="Pangkat" sx={{ textTransform: 'none' }} />}
              <Tab value="proceedings" label="Attendance & proceedings" sx={{ textTransform: 'none' }} />
              <Tab value="outcome" label="Outcome" sx={{ textTransform: 'none' }} />
              <Tab value="history" label={`History (${h.events.length})`} sx={{ textTransform: 'none' }} />
            </Tabs>
            <Box sx={{ p: 2 }}>
              {!data.canEdit && data.accessMessage && <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>{data.accessMessage}</Alert>}
              {tab === 'overview' && <Overview data={data} h={h} can={can} onDialog={setDialog}
                onSchedule={() => ask({ title: `Schedule the ${h.title.toLowerCase()}?`, ok: `${h.title} scheduled - the KP notices were made for both parties`,
                  lines: [`${formatHearingWhen(h.scheduledAt)} at ${h.venue ?? 'Barangay Hall'}`,
                    ...partyFormsFor(h.stage).map(f => `${kpFormName(f.formNo)} to the ${f.recipientRole.toLowerCase()}: ${(f.recipientRole === 'COMPLAINANT' ? h.complainant.hasAccount : h.respondent.hasAccount) ? 'delivered to their SafeComm account' : 'to be handed over or served by an officer'}`),
                    'Both parties are told the date, time and venue in SafeComm when they have an account.'], body: { action: 'schedule' } })} />}
              {tab === 'notices' && <Notices caseId={caseId} h={h} canEdit={can('notice')} refresh={refresh} onDialog={n => setDialog(n)} />}
              {tab === 'parties' && <Parties data={data} h={h} canEdit={data.canEdit} refresh={refresh} />}
              {tab === 'pangkat' && <PangkatPanel data={data} h={h} canEdit={data.canEdit} refresh={refresh} />}
              {tab === 'proceedings' && <Proceedings caseId={caseId} h={h} can={can} act={act} refresh={refresh} />}
              {tab === 'outcome' && <Outcome data={data} h={h} can={can} act={act} onScheduleNext={onScheduleNext} />}
              {tab === 'history' && <History h={h} officials={data.officials} />}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
      </DialogActions>

      {h && data && dialog && (dialog.kind === 'edit' || dialog.kind === 'reschedule') && (
        <ScheduleDialog data={data} h={h} mode={dialog.kind} requestId={'requestId' in dialog ? dialog.requestId : undefined}
          onClose={() => setDialog(null)} onSave={async body => ask(dialog.kind === 'edit'
            ? { title: `Save the changes to the draft of the ${h.title.toLowerCase()}?`, ok: 'Draft updated', body,
                lines: [`Date and time: ${whenOf(body)}`, `Venue: ${String(body.venue ?? h.venue ?? 'Barangay Hall')}`, 'The earlier details are kept in the history.'] }
            : { title: `Change the schedule of the ${h.title.toLowerCase()}?`, ok: 'New date set - new KP notices were made for both parties', body,
                lines: [`From: ${formatHearingWhen(h.scheduledAt)} at ${h.venue ?? 'Barangay Hall'}`, `To: ${whenOf(body)} at ${String(body.venue ?? h.venue ?? 'Barangay Hall')}`,
                  `Reason: ${String(body.reason ?? '')}`, 'The previous schedule stays in the history under your name. The notices for the old date are marked replaced and new ones are made for the new date; both parties are told.'] })} />
      )}
      {h && data && dialog?.kind === 'details' && (
        <DetailsDialog data={data} h={h} onClose={() => setDialog(null)} onSave={async body => ask({ title: `Change the official or instructions for the ${h.title.toLowerCase()}?`, ok: 'Details updated', body,
          lines: [`Assigned official: ${h.assignedOfficial?.name ?? 'Not assigned'} → ${data.officials.find(o => o.id === body.assignedOfficialId)?.name ?? 'Not assigned'}`, 'The change is kept in the history under your name.'] })} />
      )}
      {h && dialog?.kind === 'cancel' && (
        <ReasonDialog title={`Cancel the ${h.title.toLowerCase()}`} label="Why it is cancelled *" confirm="Cancel hearing"
          hint={h.status === 'DRAFT' ? 'The draft was never shown to the parties.' : 'Both parties are told the hearing was cancelled - not the reason.'}
          onClose={() => setDialog(null)} onSave={async reason => ask({ title: `Cancel the ${h.title.toLowerCase()}?`, ok: 'Hearing cancelled', body: { action: 'cancel', reason }, danger: true,
            lines: [`${formatHearingWhen(h.scheduledAt)} at ${h.venue ?? 'Barangay Hall'}`, `Reason: ${reason}`, 'The cancelled hearing stays on record with its history; its notices are marked replaced. This cannot be undone - a new hearing would be created instead.'] })} />
      )}
      {h && dialog?.kind === 'decline' && (
        <ReasonDialog title="Decline the request for a new date" label="Your answer to the party *" confirm="Decline request"
          hint="The party who asked sees this answer in My Hearings & Notices."
          onClose={() => setDialog(null)} onSave={async note => { if (await act({ action: 'decline_request', requestId: dialog.requestId, note }, 'Request declined')) setDialog(null); }} />
      )}
      {h && dialog && (dialog.kind === 'issue' || dialog.kind === 'delivery' || dialog.kind === 'ack') && (
        <NoticeDialog caseId={caseId} h={h} notice={dialog.notice} kind={dialog.kind}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      )}
      {confirm && <ConfirmChange pending={confirm} onBack={() => setConfirm(null)} onConfirm={runConfirmed} />}
    </Dialog>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
      <Box sx={{ fontSize: '0.88rem', color: NAVY, fontWeight: 500 }}>{children}</Box>
    </Box>
  );
}

type Opener = (d: { kind: 'edit' | 'reschedule' | 'details' | 'cancel'; requestId?: string } | { kind: 'decline'; requestId: string }) => void;

function Overview({ data, h, can, onDialog, onSchedule }: { data: CaseHearingsData; h: Hearing; can: (a: string) => boolean; onDialog: Opener; onSchedule: () => void }) {
  const current = (r: NoticeRecipient) => h.notices.filter(n => n.recipientRole === r && n.status !== 'SUPERSEDED').at(-1);
  const earlier = data.hearings.filter(x => x.hearingNumber < h.hearingNumber || (x.hearingNumber === h.hearingNumber && x.id !== h.id && x.status === 'CANCELLED'));
  const pending = h.requests.filter(r => r.status === 'PENDING');
  const later = data.hearings.find(x => x.hearingNumber === h.hearingNumber + 1 && x.status !== 'CANCELLED');
  const nextInfo = later ? `${later.title} - ${formatHearingWhen(later.scheduledAt)} (${HEARING_STATUSES[later.status].toLowerCase()})`
    : h.nextHearingAt ? `Proposed for ${formatHearingDate(h.nextHearingAt)} - not yet scheduled`
      : h.outcome && !outcomeLeadsTo(h.stage, h.outcome) ? 'None - the barangay proceedings ended here' : 'Not set';
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {pending.map(r => (
        <Alert key={r.id} severity="warning" sx={{ borderRadius: 2 }}
          action={can('reschedule') ? (
            <Box sx={{ display: 'flex', gap: 0.5, flexDirection: { xs: 'column', sm: 'row' } }}>
              <Button size="small" color="inherit" onClick={() => onDialog({ kind: 'reschedule', requestId: r.id })} sx={{ textTransform: 'none' }}>Approve - set new date</Button>
              <Button size="small" color="inherit" onClick={() => onDialog({ kind: 'decline', requestId: r.id })} sx={{ textTransform: 'none' }}>Decline</Button>
            </Box>
          ) : undefined}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.84rem' }}>The {NOTICE_RECIPIENTS[r.requesterRole].toLowerCase()} asked for a new date ({when(r.createdAt)})</Typography>
          <Typography sx={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{r.reason}</Typography>
          {r.preferredSchedule && <Typography sx={{ fontSize: '0.8rem' }}>Would suit them: {r.preferredSchedule}</Typography>}
          <Typography sx={{ fontSize: '0.75rem', mt: 0.5 }}>The date does not change unless you approve and set it.</Typography>
        </Alert>
      ))}
      {isLive(h.status) && new Date(h.scheduledAt) < new Date() && (
        <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>This hearing&apos;s time has passed. Record attendance and the outcome, or set a new date.</Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.75 }}>
        <Field label="Hearing ID">{h.reference}</Field>
        <Field label="Stage">{KP_STAGES[h.stage].label}{h.session > 1 ? `, session ${h.session}` : ''}</Field>
        <Field label="Case reference">{data.case.caseNumber}</Field>
        <Field label="Date">{formatHearingDate(h.scheduledAt)}</Field>
        <Field label="Time">{formatHearingTime(h.scheduledAt)}</Field>
        <Field label="Venue">{h.venue || 'Barangay Hall'}</Field>
        <Field label="Assigned official">{h.assignedOfficial?.name ?? 'Not assigned'}</Field>
        <Field label="Complainant">{h.complainant.name}<Box component="span" sx={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>{h.complainant.hasAccount ? 'SafeComm account' : 'No SafeComm account'}</Box></Field>
        <Field label="Respondent">{h.respondent.name}<Box component="span" sx={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>{h.respondent.hasAccount ? 'SafeComm account' : 'No SafeComm account'}</Box></Field>
        {(['COMPLAINANT', 'RESPONDENT'] as const).map(r => (
          <Field key={r} label={`${NOTICE_RECIPIENTS[r]}'s notice`}>{(() => {
            const n = current(r);
            return n ? <><Chip size="small" label={NOTICE_STATUSES[n.status]} sx={chipSx(NOTICE_COLOR[n.status])} /><Box component="span" sx={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>KP Form No. {n.formNo}</Box></> : 'Not made';
          })()}</Field>
        ))}
        <Field label="Complainant's reply">{h.residentIntent === 'WILL_ATTEND' ? 'Will attend' : h.residentIntent === 'CANNOT_ATTEND' ? 'Cannot attend' : 'No reply yet'}</Field>
        <Field label="Attendance">
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Chip size="small" label={`C: ${ATTENDANCE[h.complainantAttendance]}`} sx={chipSx(ATTENDANCE_COLOR[h.complainantAttendance])} />
            <Chip size="small" label={`R: ${ATTENDANCE[h.respondentAttendance]}`} sx={chipSx(ATTENDANCE_COLOR[h.respondentAttendance])} />
          </Box>
        </Field>
        <Field label="Created">{when(h.createdAt)}{h.createdBy ? ` by ${h.createdBy}` : ''}</Field>
        <Field label="Last updated">{when(h.updatedAt)}</Field>
        <Field label="Times rescheduled">{h.rescheduleCount}</Field>
        {h.outcome && <Field label="Outcome">{outcomeLabel(h.outcome)}</Field>}
        <Field label="Next hearing">{nextInfo}</Field>
      </Box>
      {h.statusReason && <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}><b>{h.status === 'CANCELLED' ? 'Cancelled because' : 'Last new date because'}:</b> {h.statusReason}</Typography>}
      {h.residentInstructions && <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}><b>Instructions for the parties:</b> {h.residentInstructions}</Typography>}
      {h.notes && <Typography sx={{ fontSize: '0.82rem', color: '#475569', whiteSpace: 'pre-wrap' }}><b>Internal note:</b> {h.notes}</Typography>}

      {data.canEdit && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {can('update') && <Button size="small" variant="outlined" onClick={() => onDialog({ kind: 'edit' })} sx={{ textTransform: 'none' }}>Edit draft</Button>}
          {can('schedule') && (
            <Button size="small" variant="contained" sx={{ textTransform: 'none', bgcolor: NAVY }} onClick={onSchedule} disabled={!h.respondent.partyId}>
              Schedule (make the KP notices)
            </Button>
          )}
          {can('reschedule') && <Button size="small" variant="outlined" startIcon={<Event />} onClick={() => onDialog({ kind: 'reschedule' })} sx={{ textTransform: 'none' }}>Edit schedule (new date)</Button>}
          {can('details') && <Button size="small" variant="outlined" onClick={() => onDialog({ kind: 'details' })} sx={{ textTransform: 'none' }}>Change official or instructions</Button>}
          {can('cancel') && <Button size="small" color="error" onClick={() => onDialog({ kind: 'cancel' })} sx={{ textTransform: 'none' }}>Cancel hearing</Button>}
        </Box>
      )}

      {earlier.length > 0 && (
        <Box>
          <Divider sx={{ mb: 1.5 }} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: NAVY, mb: 1 }}>Earlier proceedings on this case</Typography>
          <Box sx={{ display: 'grid', gap: 1 }}>
            {earlier.map(x => {
              const notes = x.events.filter(e => e.kind === 'proceedings_note');
              return (
                <Box key={x.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: NAVY }}>{x.title}</Typography>
                    <Chip size="small" label={HEARING_STATUSES[x.status]} sx={chipSx(STATUS_COLOR[x.status])} />
                    <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{formatHearingWhen(x.scheduledAt)} · {x.venue ?? 'Barangay Hall'}</Typography>
                  </Box>
                  {x.outcome && <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.5 }}><b>Outcome:</b> {outcomeLabel(x.outcome)}</Typography>}
                  <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Attendance - complainant: {ATTENDANCE[x.complainantAttendance]}, respondent: {ATTENDANCE[x.respondentAttendance]}</Typography>
                  {x.agreements && <Typography sx={{ fontSize: '0.8rem', color: '#334155', whiteSpace: 'pre-wrap' }}><b>Agreements / developments:</b> {x.agreements}</Typography>}
                  {x.nextAction && <Typography sx={{ fontSize: '0.8rem', color: '#334155' }}><b>Next action:</b> {x.nextAction}</Typography>}
                  {notes.length > 0 && (
                    <Box sx={{ mt: 0.5, pl: 1, borderLeft: '2px solid #e2e8f0' }}>
                      {notes.map(n => <Typography key={n.id} sx={{ fontSize: '0.78rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{n.note} <span style={{ color: '#94a3b8' }}>- {n.by}, {when(n.createdAt)}</span></Typography>)}
                    </Box>
                  )}
                  {x.statusReason && x.status === 'CANCELLED' && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Cancelled: {x.statusReason}</Typography>}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Notices ─────────────────────────────────────────────────────────────────

function Notices({ caseId, h, canEdit, refresh, onDialog }: { caseId: string; h: Hearing; canEdit: boolean; refresh: () => void; onDialog: (d: { kind: 'issue' | 'delivery' | 'ack'; notice: HearingNotice }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/cases/${caseId}/hearings/${h.id}/notices`;
  const generate = async (recipient: NoticeRecipient) => {
    setBusy(recipient);
    try { await send(base, 'POST', { recipient }); toast.success(`Notice to the ${NOTICE_RECIPIENTS[recipient].toLowerCase()} made`); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not generate'); } finally { setBusy(null); }
  };
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
        Scheduling makes the stage&apos;s KP notices for both parties, for the one date. A party with a SafeComm account gets theirs there at once;
        for a party without one, the notice waits here until you record that it was handed over or served. A new date replaces the notices for the old one.
        SafeComm sends no text message or email.
      </Alert>
      {partyFormsFor(h.stage).map(f => f.recipientRole as PartyRole).map(r => {
        const form = partyFormsFor(h.stage).find(f => f.recipientRole === r)!;
        const all = h.notices.filter(n => n.recipientRole === r);
        const cur = all.filter(n => n.status !== 'SUPERSEDED').at(-1);
        const old = all.filter(n => n.status === 'SUPERSEDED');
        return (
          <Box key={r} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>{kpFormName(form.formNo)} - to the {NOTICE_RECIPIENTS[r].toLowerCase()}</Typography>
              <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{r === 'COMPLAINANT' ? h.complainant.name : h.respondent.name}</Typography>
              <Button size="small" startIcon={<Visibility sx={{ fontSize: 16 }} />} href={`${base}?recipient=${r}`} target="_blank" rel="noopener" sx={{ ml: 'auto', textTransform: 'none' }}>Preview</Button>
            </Box>
            {!cur ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>{h.status === 'DRAFT' ? 'Made when the draft is scheduled.' : 'No notice for this date.'}</Typography>
                {canEdit && <Button size="small" variant="contained" disabled={busy !== null} onClick={() => generate(r)} sx={{ textTransform: 'none', bgcolor: NAVY }}>
                  {busy === r ? <CircularProgress size={14} color="inherit" /> : 'Make the notice'}
                </Button>}
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: NAVY }}>{cur.noticeNumber}</Typography>
                  <Chip size="small" label={NOTICE_STATUSES[cur.status]} sx={chipSx(NOTICE_COLOR[cur.status])} />
                  <Chip size="small" label={cur.channel === 'SAFECOMM_ACCOUNT' ? 'In their SafeComm account' : 'Handed over or served by an officer'}
                    sx={chipSx(cur.channel === 'SAFECOMM_ACCOUNT' ? '#0f766e' : '#64748b')} />
                  <Button size="small" startIcon={<PictureAsPdf sx={{ fontSize: 16 }} />} href={`${base}/${cur.id}/pdf?inline=1`} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>View / print</Button>
                  <Button size="small" href={`${base}/${cur.id}/pdf`} sx={{ textTransform: 'none' }}>Download PDF</Button>
                </Box>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Generated {when(cur.generatedAt)}{cur.generatedBy ? ` by ${cur.generatedBy}` : ''}
                  {cur.issuedAt && ` · issued ${when(cur.issuedAt)}${cur.issuedBy ? ` by ${cur.issuedBy}` : ''} (${NOTICE_METHODS[cur.issueMethod as NoticeMethod] ?? cur.issueMethod})`}
                  {cur.deliveryRecordedAt && cur.status !== 'ACKNOWLEDGED' && ` · ${cur.status === 'DELIVERED' ? 'delivered' : 'not delivered'} (recorded ${when(cur.deliveryRecordedAt)})`}
                  {cur.seenAt && ` · opened in SafeComm ${when(cur.seenAt)}`}
                  {cur.acknowledgedAt && ` · acknowledged ${when(cur.acknowledgedAt)} ${cur.acknowledgedVia === 'RESIDENT_APP' ? `by the ${NOTICE_RECIPIENTS[r].toLowerCase()} in SafeComm` : '(signed receipt recorded)'}`}
                </Typography>
                {cur.deliveryNote && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>Note: {cur.deliveryNote}</Typography>}
                {canEdit && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {cur.status === 'GENERATED' && <Button size="small" variant="contained" onClick={() => onDialog({ kind: 'issue', notice: cur })} sx={{ textTransform: 'none', bgcolor: NAVY }}>Record issuance</Button>}
                    {['ISSUED', 'DELIVERED', 'UNDELIVERED'].includes(cur.status) && <Button size="small" variant="outlined" onClick={() => onDialog({ kind: 'delivery', notice: cur })} sx={{ textTransform: 'none' }}>Record delivery</Button>}
                    {['ISSUED', 'DELIVERED', 'UNDELIVERED'].includes(cur.status) && <Button size="small" variant="outlined" onClick={() => onDialog({ kind: 'ack', notice: cur })} sx={{ textTransform: 'none' }}>Record acknowledgement</Button>}
                  </Box>
                )}
              </Box>
            )}
            {old.length > 0 && (
              <Typography sx={{ fontSize: '0.75rem', color: '#94a3b8', mt: 1 }}>
                Replaced notices: {old.map(n => <a key={n.id} href={`${base}/${n.id}/pdf?inline=1`} target="_blank" rel="noopener" style={{ color: '#64748b', marginRight: 8 }}>{n.noticeNumber} ({formatHearingDate(n.scheduledAt)})</a>)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function NoticeDialog({ caseId, h, notice, kind, onClose, onDone }: { caseId: string; h: Hearing; notice: HearingNotice; kind: 'issue' | 'delivery' | 'ack'; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<NoticeMethod | ''>('');
  const [delivered, setDelivered] = useState<'yes' | 'no' | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // In the party's own account only when they have one linked; a Pangkat member's notice is handed over.
  const hasAccount = notice.recipientRole === 'COMPLAINANT' ? h.complainant.hasAccount : notice.recipientRole === 'RESPONDENT' ? h.respondent.hasAccount : false;
  const methods = (Object.keys(NOTICE_METHODS) as NoticeMethod[]).filter(m => m !== 'SAFECOMM' || hasAccount);
  const save = async () => {
    setSaving(true);
    try {
      const body = kind === 'issue' ? { action: 'issue', method } : kind === 'delivery' ? { action: 'delivery', delivered: delivered === 'yes', note: note.trim() || undefined } : { action: 'acknowledge', note: note.trim() || undefined };
      await send(`/api/cases/${caseId}/hearings/${h.id}/notices/${notice.id}`, 'PATCH', body);
      toast.success(kind === 'issue' ? 'Issuance recorded' : kind === 'delivery' ? 'Delivery recorded' : 'Acknowledgement recorded');
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(false); }
  };
  const disabled = saving || (kind === 'issue' && !method) || (kind === 'delivery' && !delivered);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>
        {kind === 'issue' ? 'Record issuance' : kind === 'delivery' ? 'Record delivery' : 'Record acknowledgement'} - {notice.noticeNumber}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        {kind === 'issue' && (
          <TextField select size="small" label="How it was issued *" value={method} onChange={e => setMethod(e.target.value as NoticeMethod)}>
            {methods.map(m => <MenuItem key={m} value={m}>{NOTICE_METHODS[m]}</MenuItem>)}
          </TextField>
        )}
        {kind === 'delivery' && (
          <TextField select size="small" label="Was it delivered? *" value={delivered} onChange={e => setDelivered(e.target.value as 'yes' | 'no')}>
            <MenuItem value="yes">Delivered to the recipient</MenuItem>
            <MenuItem value="no">Not delivered</MenuItem>
          </TextField>
        )}
        {kind === 'ack' && <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>Record this only when the recipient has signed or otherwise acknowledged receipt.</Typography>}
        {kind !== 'issue' && <TextField size="small" multiline minRows={2} label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" onClick={save} disabled={disabled} sx={{ textTransform: 'none', bgcolor: NAVY }}>{saving ? <CircularProgress size={16} color="inherit" /> : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Parties and their SafeComm accounts ─────────────────────────────────────

function Parties({ data, h, canEdit, refresh }: { data: CaseHearingsData; h: Hearing; canEdit: boolean; refresh: () => void }) {
  const complainant = data.parties.complainants.find(p => p.id === h.complainant.partyId) ?? data.parties.complainants[0];
  const respondent = data.parties.respondents.find(p => p.id === h.respondent.partyId) ?? null;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
        A party with a SafeComm account sees this proceeding and their own notices in My Hearings &amp; Notices. Link an account only with the
        resident number the person gives you - SafeComm never matches people by name. A party without an account gets their notice handed over or served by an officer.
      </Alert>
      <PartyAccount caseId={data.case.id} role="COMPLAINANT" party={complainant} canEdit={canEdit} refresh={refresh} />
      {respondent ? <PartyAccount caseId={data.case.id} role="RESPONDENT" party={respondent} canEdit={canEdit} refresh={refresh} />
        : <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>No respondent is chosen for this proceeding. Record the person reported in Case records, then choose them on the draft.</Alert>}
    </Box>
  );
}

function PartyAccount({ caseId, role, party, canEdit, refresh }: { caseId: string; role: PartyRole; party: PartyOption | undefined; canEdit: boolean; refresh: () => void }) {
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  if (!party) return null;
  const reporter = party.id === null;
  const url = `/api/cases/${caseId}/parties/${party.id}/account`;
  const link = async () => {
    setBusy(true);
    try {
      const r = await send<{ residentNumber: string; noticesDelivered: number }>(url, 'POST', { residentNumber: number.trim() });
      toast.success(`Linked to ${r?.residentNumber ?? 'the account'}${r?.noticesDelivered ? ` - ${r.noticesDelivered} waiting notice(s) delivered to it` : ''}`);
      setNumber(''); refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not link'); } finally { setBusy(false); }
  };
  const unlink = async () => {
    setBusy(true);
    try { await send(url, 'DELETE', { reason: reason.trim() }); toast.success('Account unlinked'); setUnlinking(false); setReason(''); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not unlink'); } finally { setBusy(false); }
  };
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>{NOTICE_RECIPIENTS[role]}</Typography>
        <Typography sx={{ fontSize: '0.82rem', color: '#334155' }}>{party.name}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: '#94a3b8' }}>{party.label}</Typography>
        <Chip size="small" sx={{ ml: 'auto', ...chipSx(party.account ? '#0f766e' : '#64748b') }}
          label={party.account ? (party.account.reporter ? 'Filed through SafeComm' : `Linked: ${party.account.residentNumber}`) : 'No SafeComm account'} />
      </Box>
      {reporter && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>The reporter&apos;s own account receives the complainant&apos;s notices unless the person affected is linked to an account of their own.</Typography>}
      {!reporter && canEdit && !party.account && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField size="small" label="Resident number" value={number} onChange={e => setNumber(e.target.value)} slotProps={{ htmlInput: { maxLength: 40 } }}
            helperText="Exactly as shown on the person's SafeComm profile" sx={{ minWidth: 240 }} />
          <Button variant="contained" disabled={busy || number.trim().length < 3} onClick={link} sx={{ textTransform: 'none', bgcolor: NAVY, mt: 0.25 }}>
            {busy ? <CircularProgress size={16} color="inherit" /> : 'Link account'}
          </Button>
        </Box>
      )}
      {!reporter && canEdit && party.account && (
        unlinking ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField size="small" label="Why it is unlinked *" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} sx={{ minWidth: 260 }} />
            <Button color="error" variant="outlined" disabled={busy || reason.trim().length < 3} onClick={unlink} sx={{ textTransform: 'none', mt: 0.25 }}>Unlink</Button>
            <Button onClick={() => setUnlinking(false)} sx={{ textTransform: 'none', mt: 0.25 }}>Back</Button>
          </Box>
        ) : <Box><Button size="small" color="error" onClick={() => setUnlinking(true)} sx={{ textTransform: 'none' }}>Unlink account</Button></Box>
      )}
    </Box>
  );
}

// ── The Pangkat ─────────────────────────────────────────────────────────────

interface PangkatData {
  pangkat: CaseHearingsData['pangkat']; constitutionHearing: { id: string; reference: string; status: string } | null;
  notices: { id: string; hearingId: string; noticeNumber: string; pangkatMemberId: string | null; status: string; generatedAt: string; issuedAt: string | null; acknowledgedAt: string | null }[];
  canEdit: boolean; refusal: string | null; constituted: boolean;
}

function PangkatPanel({ data, h, canEdit, refresh }: { data: CaseHearingsData; h: Hearing; canEdit: boolean; refresh: () => void }) {
  const url = `/api/cases/${data.case.id}/pangkat`;
  const p = useSWR<PangkatData>(url, getJson);
  const [name, setName] = useState('');
  const [chosenBy, setChosenBy] = useState<PangkatChosenBy | ''>('');
  const [chair, setChair] = useState<string | null>(null);
  const [sec, setSec] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try { await send(url, 'POST', body); toast.success(ok); await p.mutate(); refresh(); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return false; } finally { setBusy(false); }
  };
  if (p.isLoading) return <Skeleton height={160} />;
  if (p.error) return <Alert severity="error" sx={{ borderRadius: 2 }}>{p.error.message}</Alert>;
  const d = p.data!;
  const members = d.pangkat?.members ?? [];
  const serving = members.filter(m => !m.removedAt);
  const edit = canEdit && d.canEdit;
  const chairman = chair ?? d.pangkat?.chairmanMemberId ?? '';
  const secretary = sec ?? d.pangkat?.secretaryMemberId ?? '';
  const kp11 = (memberId: string) => d.notices.filter(n => n.pangkatMemberId === memberId && n.status !== 'SUPERSEDED').at(-1);
  const pdf = (n: PangkatData['notices'][number]) => `/api/cases/${data.case.id}/hearings/${n.hearingId}/notices/${n.id}/pdf`;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Alert severity={d.constituted ? 'success' : 'info'} sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
        {d.constituted
          ? `The Pangkat ng Tagapagkasundo was constituted ${when(d.pangkat?.constitutedAt ?? null)}. Conciliation hearings are held before it (KP Form No. 12).`
          : `The Pangkat has ${PANGKAT_SIZE} members chosen from the Lupon by the parties - or, when they do not agree, drawn by lot by the Punong Barangay - with a chairman and a secretary from among them (RA 7160 sec. 410). Record them here, give each member KP Form No. 11, then record the constitution proceeding as held with "Pangkat constituted".`}
      </Alert>
      {!d.constitutionHearing && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>Schedule the constitution of the Pangkat first.</Alert>}
      {d.constitutionHearing && h.stage === 'CONCILIATION' && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Recorded on {d.constitutionHearing.reference}.</Typography>}

      <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY, mb: 1 }}>Members ({serving.length} of {PANGKAT_SIZE})</Typography>
        {members.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No member recorded yet.</Typography>}
        <Box sx={{ display: 'grid', gap: 1 }}>
          {members.map(m => {
            const n = kp11(m.id);
            const office = d.pangkat?.chairmanMemberId === m.id ? 'Chairman' : d.pangkat?.secretaryMemberId === m.id ? 'Secretary' : null;
            return (
              <Box key={m.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', opacity: m.removedAt ? 0.6 : 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: NAVY }}>{m.name}</Typography>
                {office && <Chip size="small" label={office} sx={chipSx('#4f46e5')} />}
                <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>{PANGKAT_CHOSEN_BY[m.chosenBy]}{m.addedBy ? ` · recorded by ${m.addedBy}` : ''}</Typography>
                {m.removedAt && <Typography sx={{ fontSize: '0.76rem', color: '#b91c1c' }}>Removed {when(m.removedAt)}: {m.removedReason}</Typography>}
                {!m.removedAt && (
                  <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    {n ? (
                      <>
                        <Chip size="small" label={`KP 11 ${n.noticeNumber} - ${NOTICE_STATUSES[n.status as keyof typeof NOTICE_STATUSES] ?? n.status}`} sx={chipSx(NOTICE_COLOR[n.status] ?? '#64748b')} />
                        <Button size="small" href={`${pdf(n)}?inline=1`} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>View / print</Button>
                      </>
                    ) : edit && <Button size="small" variant="outlined" disabled={busy} onClick={() => post({ action: 'kp11', memberId: m.id }, 'KP Form No. 11 made - hand it to the member')} sx={{ textTransform: 'none' }}>Make KP Form No. 11</Button>}
                    {edit && !office && <Button size="small" color="error" onClick={() => setRemoving({ id: m.id, reason: '' })} sx={{ textTransform: 'none' }}>Remove</Button>}
                  </Box>
                )}
                {removing?.id === m.id && (
                  <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                    <TextField size="small" label="Why the member is removed *" value={removing.reason} onChange={e => setRemoving({ id: m.id, reason: e.target.value })} sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 300 } }} />
                    <Button color="error" variant="outlined" disabled={busy || removing.reason.trim().length < 3}
                      onClick={async () => { if (await post({ action: 'remove_member', memberId: m.id, reason: removing.reason.trim() }, 'Member removed - kept in the record')) setRemoving(null); }} sx={{ textTransform: 'none' }}>Remove</Button>
                    <Button onClick={() => setRemoving(null)} sx={{ textTransform: 'none' }}>Back</Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        {edit && serving.length < PANGKAT_SIZE && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 2fr auto' }, gap: 1, mt: 1.5 }}>
            <TextField size="small" label="Lupon member's full name *" value={name} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
            <TextField select size="small" label="How chosen *" value={chosenBy} onChange={e => setChosenBy(e.target.value as PangkatChosenBy)}>
              {(Object.keys(PANGKAT_CHOSEN_BY) as PangkatChosenBy[]).map(k => <MenuItem key={k} value={k}>{PANGKAT_CHOSEN_BY[k]}</MenuItem>)}
            </TextField>
            <Button variant="contained" startIcon={<Add />} disabled={busy || name.trim().length < 3 || !chosenBy} sx={{ textTransform: 'none', bgcolor: NAVY }}
              onClick={async () => { if (await post({ action: 'add_member', name: name.trim(), chosenBy }, 'Member recorded')) { setName(''); setChosenBy(''); } }}>Add member</Button>
          </Box>
        )}
      </Box>

      {serving.length >= 2 && (
        <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY, mb: 1 }}>Chairman and secretary</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, gap: 1 }}>
            <TextField select size="small" label="Pangkat chairman" value={chairman} disabled={!edit} onChange={e => setChair(e.target.value)}>
              {serving.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Pangkat secretary" value={secretary} disabled={!edit} onChange={e => setSec(e.target.value)}>
              {serving.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
            {edit && (
              <Button variant="outlined" disabled={busy || !chairman || !secretary || chairman === secretary
                || (chairman === d.pangkat?.chairmanMemberId && secretary === d.pangkat?.secretaryMemberId)} sx={{ textTransform: 'none' }}
                onClick={async () => { if (await post({ action: 'officers', chairmanMemberId: chairman, secretaryMemberId: secretary }, 'Chairman and secretary recorded')) { setChair(null); setSec(null); } }}>
                Save
              </Button>
            )}
          </Box>
          {chairman && chairman === secretary && <Typography sx={{ fontSize: '0.76rem', color: '#b91c1c', mt: 0.5 }}>The chairman and the secretary must be different members.</Typography>}
        </Box>
      )}
      {!d.constituted && d.refusal && <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Before it can be recorded as constituted: {d.refusal}</Typography>}
      <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{sessionTitle('CONSTITUTION')} notices to the parties are KP Form No. 10, under KP notices.</Typography>
    </Box>
  );
}

// ── Attendance and proceedings ──────────────────────────────────────────────

function Proceedings({ caseId, h, can, act, refresh }: { caseId: string; h: Hearing; can: (a: string) => boolean; act: (b: Record<string, unknown>, ok: string) => Promise<boolean>; refresh: () => void }) {
  const [cA, setCA] = useState<Attendance>(h.complainantAttendance);
  const [rA, setRA] = useState<Attendance>(h.respondentAttendance);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const notes = h.events.filter(e => e.kind === 'proceedings_note');
  const changed = cA !== h.complainantAttendance || rA !== h.respondentAttendance;
  const upload = async (file: File) => {
    setBusy('file');
    try {
      const dataUrl = await shrink(file);
      await send(`/api/cases/${caseId}/hearings/${h.id}/attachments`, 'POST', { dataUrl, filename: file.name });
      toast.success('Attachment added'); refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not attach'); } finally { setBusy(null); }
  };
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY, mb: 1 }}>Attendance</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {[{ label: `Complainant - ${h.complainant.name}`, v: cA, set: setCA }, { label: `Respondent - ${h.respondent.name}`, v: rA, set: setRA }].map(f => (
            <TextField key={f.label} select size="small" label={f.label} value={f.v} disabled={!can('attendance')} onChange={e => f.set(e.target.value as Attendance)}>
              {(Object.keys(ATTENDANCE) as Attendance[]).map(k => <MenuItem key={k} value={k}>{ATTENDANCE[k]}</MenuItem>)}
            </TextField>
          ))}
        </Box>
        {h.residentIntent && <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 1 }}>The complainant said beforehand they {h.residentIntent === 'WILL_ATTEND' ? 'will attend' : 'cannot attend'} - that is their reply, not this record. An acknowledged notice is not attendance either.</Typography>}
        {can('attendance') && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" variant="contained" disabled={!changed || busy !== null} sx={{ textTransform: 'none', bgcolor: NAVY }}
              onClick={async () => { setBusy('att'); await act({ action: 'attendance', complainant: cA, respondent: rA }, 'Attendance recorded'); setBusy(null); }}>
              Record attendance
            </Button>
          </Box>
        )}
      </Box>

      <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>Proceedings notes</Typography>
        <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 1 }}>Officials only. Each note is kept as written - add a new note to correct or follow up.</Typography>
        {notes.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No proceedings notes yet.</Typography>}
        <Box sx={{ display: 'grid', gap: 1 }}>
          {notes.map(n => (
            <Box key={n.id} sx={{ pl: 1.25, borderLeft: '3px solid #bae6fd' }}>
              <Typography sx={{ fontSize: '0.84rem', color: '#1e293b', whiteSpace: 'pre-wrap' }}>{n.note}</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{n.by} · {when(n.createdAt)}</Typography>
            </Box>
          ))}
        </Box>
        {can('proceedings') && (
          <Box sx={{ mt: 1.5 }}>
            <TextField fullWidth size="small" multiline minRows={3} label="Add a proceedings note" value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 3000 } }} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
              <Button size="small" variant="contained" startIcon={<Add />} disabled={note.trim().length < 3 || busy !== null} sx={{ textTransform: 'none', bgcolor: NAVY }}
                onClick={async () => { setBusy('note'); if (await act({ action: 'proceedings', note: note.trim() }, 'Note added')) setNote(''); setBusy(null); }}>
                Add proceedings note
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>Attachments</Typography>
          {can('proceedings') && (
            <Button size="small" component="label" startIcon={busy === 'file' ? <CircularProgress size={14} /> : <AttachFile sx={{ fontSize: 16 }} />} disabled={busy !== null || h.attachments.length >= 5} sx={{ ml: 'auto', textTransform: 'none' }}>
              Attach image
              <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            </Button>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 0.5 }}>For example a signed attendance sheet or settlement page. Officials only - never shown to a resident.</Typography>
        {h.attachments.length === 0 ? <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No attachments.</Typography> : (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {h.attachments.map(a => <Button key={a.id} size="small" href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>{a.filename}</Button>)}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Shrink an image in the browser before it is sent, as the report form does. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be read')); i.src = url; });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

// ── Outcome ─────────────────────────────────────────────────────────────────

function Outcome({ data, h, can, act, onScheduleNext }: { data: CaseHearingsData; h: Hearing; can: (a: string) => boolean; act: (b: Record<string, unknown>, ok: string) => Promise<boolean>; onScheduleNext?: (caseId: string) => void }) {
  const [outcome, setOutcome] = useState<HearingOutcome | ''>('');
  const [cA, setCA] = useState<Attendance>(h.complainantAttendance);
  const [rA, setRA] = useState<Attendance>(h.respondentAttendance);
  const [agreements, setAgreements] = useState('');
  const [summary, setSummary] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [busy, setBusy] = useState(false);
  const leadsTo = outcome ? outcomeLeadsTo(h.stage, outcome) : null;
  const ends = Boolean(outcome) && !leadsTo;
  const constitutes = h.stage === 'CONSTITUTION' && outcome === 'PANGKAT_CONSTITUTED';
  const serving = (data.pangkat?.members ?? []).filter(m => !m.removedAt);
  const pangkatReady = serving.length === PANGKAT_SIZE && Boolean(data.pangkat?.chairmanMemberId && data.pangkat.secretaryMemberId);

  if (h.status === 'COMPLETED') {
    const latest = h.hearingNumber === Math.max(...data.hearings.filter(x => x.status === 'COMPLETED').map(x => x.hearingNumber));
    const nextOk = latest && data.next && !data.blocked && data.canEdit && !data.hearings.some(x => isLive(x.status) || x.status === 'DRAFT');
    return (
      <Box sx={{ display: 'grid', gap: 1.25 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip label={outcomeLabel(h.outcome)} sx={{ fontWeight: 700, bgcolor: '#dcfce7', color: '#15803d' }} />
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Recorded {when(h.completedAt)}{h.completedBy ? ` by ${h.completedBy}` : ''}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>A completed hearing does not resolve the case - the case status is changed separately with a follow-up. A settlement or a certification to file action is not generated by SafeComm; record and file the signed document as the barangay does.</Typography>
        {h.agreements && <Field label="Agreements or developments"><Box sx={{ whiteSpace: 'pre-wrap' }}>{h.agreements}</Box></Field>}
        <Field label="Summary shown to the parties">{h.outcomeSummary || <span style={{ color: '#94a3b8' }}>None - they see the outcome only</span>}</Field>
        <Field label="Next action">{h.nextAction || '-'}</Field>
        {h.nextHearingAt && <Field label="Proposed next hearing date">{formatHearingDate(h.nextHearingAt)}</Field>}
        {nextOk && onScheduleNext && (
          <Box><Button variant="contained" onClick={() => onScheduleNext(data.case.id)} sx={{ textTransform: 'none', bgcolor: NAVY }}>Schedule the {data.next!.title.toLowerCase()}</Button></Box>
        )}
        {data.blocked && latest && (
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{data.blocked}</Typography>
        )}
      </Box>
    );
  }
  if (h.status === 'CANCELLED') return <Typography sx={{ fontSize: '0.85rem', color: '#64748b' }}>This hearing was cancelled{h.cancelledBy ? ` by ${h.cancelledBy}` : ''}: {h.statusReason}</Typography>;
  if (h.status === 'DRAFT') return <Typography sx={{ fontSize: '0.85rem', color: '#64748b' }}>A draft is scheduled before it can be held.</Typography>;
  if (!can('complete')) return <Typography sx={{ fontSize: '0.85rem', color: '#64748b' }}>No outcome recorded yet.</Typography>;
  if (!hasDayArrived(h.scheduledAt)) {
    return <Alert severity="info" sx={{ borderRadius: 2 }}>The {h.title.toLowerCase()} is set for {formatHearingWhen(h.scheduledAt)}. The outcome can be recorded from that day.</Alert>;
  }
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <TextField select size="small" label="Complainant attendance *" value={cA} onChange={e => setCA(e.target.value as Attendance)}>
          {(Object.keys(ATTENDANCE) as Attendance[]).map(k => <MenuItem key={k} value={k}>{ATTENDANCE[k]}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Respondent attendance *" value={rA} onChange={e => setRA(e.target.value as Attendance)}>
          {(Object.keys(ATTENDANCE) as Attendance[]).map(k => <MenuItem key={k} value={k}>{ATTENDANCE[k]}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Outcome *" value={outcome} onChange={e => setOutcome(e.target.value as HearingOutcome)} sx={{ gridColumn: { sm: '1 / -1' } }}
          helperText={outcome ? (ends ? 'This ends the barangay proceedings - no further proceeding follows.' : `Next: ${KP_STAGES[leadsTo!].label.toLowerCase()}.`) : `The outcomes of the ${KP_STAGES[h.stage].label.toLowerCase()}. Separate from the case status.`}>
          {STAGE_OUTCOMES[h.stage].map(k => <MenuItem key={k} value={k}>{HEARING_OUTCOMES[k].label}</MenuItem>)}
        </TextField>
        {constitutes && !pangkatReady && (
          <Alert severity="warning" sx={{ gridColumn: { sm: '1 / -1' }, borderRadius: 2, fontSize: '0.8rem' }}>
            Record the {PANGKAT_SIZE} Pangkat members and choose its chairman and secretary first (Pangkat tab) - {serving.length} of {PANGKAT_SIZE} members recorded.
          </Alert>
        )}
        <TextField size="small" multiline minRows={2} label="Agreements or developments (officials only)" value={agreements} onChange={e => setAgreements(e.target.value)} slotProps={{ htmlInput: { maxLength: 3000 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
        <TextField size="small" multiline minRows={2} label="Summary for the parties (optional)" value={summary} onChange={e => setSummary(e.target.value)} slotProps={{ htmlInput: { maxLength: 600 } }} sx={{ gridColumn: { sm: '1 / -1' } }}
          helperText="Shown to both parties in My Hearings & Notices with the outcome. Do not include either party's private details." />
        <TextField size="small" label="Next action for the case" value={nextAction} onChange={e => setNextAction(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }}
          placeholder={h.stage === 'CONCILIATION' ? 'e.g. Issue certification to file action' : h.stage === 'MEDIATION' ? 'e.g. Constitute the Pangkat' : 'e.g. First conciliation hearing'} />
        <TextField size="small" type="date" label="Proposed next hearing date" value={nextDate} onChange={e => setNextDate(e.target.value)} disabled={ends}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }} helperText="Optional - the next hearing is still scheduled separately" />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" disabled={!outcome || busy || cA === 'NOT_RECORDED' || rA === 'NOT_RECORDED' || (constitutes && !pangkatReady)} sx={{ textTransform: 'none', bgcolor: NAVY }}
          onClick={async () => {
            setBusy(true);
            await act({ action: 'complete', outcome, complainantAttendance: cA, respondentAttendance: rA, agreements: agreements.trim() || undefined,
              outcomeSummary: summary.trim() || undefined, nextAction: nextAction.trim() || undefined, nextHearingDate: !ends && nextDate ? nextDate : undefined },
            constitutes ? 'Pangkat constituted - conciliation hearings can now be scheduled' : `${h.title} recorded as held`);
            setBusy(false);
          }}>
          {busy ? <CircularProgress size={16} color="inherit" /> : 'Record outcome'}
        </Button>
      </Box>
    </Box>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function History({ h, officials }: { h: Hearing; officials: { id: string; name: string }[] }) {
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '-';
    if (k === 'scheduledAt' && typeof v === 'string') return formatHearingWhen(v);
    if ((k === 'complainantAttendance' || k === 'respondentAttendance') && typeof v === 'string') return ATTENDANCE[v as Attendance] ?? v;
    if (k === 'assignedOfficialId' && typeof v === 'string') return officials.find(o => o.id === v)?.name ?? 'Another official';
    if (k === 'status' && typeof v === 'string') return (HEARING_STATUSES as Record<string, string>)[v] ?? (NOTICE_STATUSES as Record<string, string>)[v] ?? v;
    return String(v);
  };
  const LABEL: Record<string, string> = { scheduledAt: 'Date and time', venue: 'Venue', complainantAttendance: 'Complainant', respondentAttendance: 'Respondent',
    assignedOfficialId: 'Assigned official', residentInstructions: 'Instructions', notes: 'Internal note', status: 'Status', complainantPartyId: 'Complainant record', respondentPartyId: 'Respondent record' };
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>Every change is kept here, oldest first. Nothing in this history can be edited.</Typography>
      {h.events.map(e => {
        const before = (e.before ?? {}) as Record<string, unknown>;
        const after = (e.after ?? {}) as Record<string, unknown>;
        const keys = Object.keys(before).filter(k => k in LABEL);
        return (
          <Box key={e.id} sx={{ display: 'flex', gap: 1.25 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: e.actorType === 'resident' ? '#14b8a6' : '#0369a1', mt: 0.8, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: NAVY }}>
                {HEARING_EVENT_LABELS[e.kind] ?? e.kind}
                {e.kind === 'outcome' && typeof after.outcome === 'string' ? ` - ${outcomeLabel(after.outcome)}` : ''}
                {e.kind.startsWith('notice_') && typeof after.noticeNumber === 'string' ? ` - ${typeof after.formNo === 'number' ? `KP Form No. ${after.formNo}, ` : ''}${after.noticeNumber}` : ''}
                {e.kind.startsWith('notice_') && after.channel === 'SAFECOMM_ACCOUNT' ? ' (SafeComm account)' : ''}
                {e.kind === 'resident_intent' ? ` - ${after.intent === 'WILL_ATTEND' ? 'will attend' : 'cannot attend'}` : ''}
                {e.kind === 'scheduled' && typeof after.scheduledAt === 'string' ? ` for ${formatHearingWhen(after.scheduledAt)}` : ''}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{e.by ?? 'SafeComm'} · {when(e.createdAt)}</Typography>
              {keys.map(k => (
                <Typography key={k} sx={{ fontSize: '0.78rem', color: '#475569' }}>{LABEL[k]}: {show(k, before[k])} → {show(k, after[k])}</Typography>
              ))}
              {e.note && <Typography sx={{ fontSize: '0.8rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{e.note}</Typography>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Small dialogs ───────────────────────────────────────────────────────────

function ScheduleDialog({ data, h, mode, requestId, onClose, onSave }: { data: CaseHearingsData; h: Hearing; mode: 'edit' | 'reschedule'; requestId?: string; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [date, setDate] = useState(phDay(h.scheduledAt) < todayPh() ? '' : phDay(h.scheduledAt));
  const [time, setTime] = useState(phTime(h.scheduledAt));
  const [venue, setVenue] = useState(h.venue ?? 'Barangay Hall');
  const [reason, setReason] = useState(requestId ? `At the ${h.requests.find(r => r.id === requestId)?.requesterRole === 'RESPONDENT' ? 'respondent' : 'complainant'}'s request` : '');
  const [official, setOfficial] = useState(h.assignedOfficialId ?? '');
  const [complainant, setComplainant] = useState(h.complainant.partyId ?? 'reporter');
  const [respondent, setRespondent] = useState(h.respondent.partyId ?? '');
  const [instructions, setInstructions] = useState(h.residentInstructions ?? '');
  const [notes, setNotes] = useState(h.notes ?? '');
  const [saving, setSaving] = useState(false);
  const request = requestId ? h.requests.find(r => r.id === requestId) : null;
  const save = async () => {
    setSaving(true);
    await onSave(mode === 'reschedule'
      ? { action: 'reschedule', date, time, venue: venue.trim() || undefined, reason: reason.trim(), requestId }
      : { action: 'update', date, time, venue: venue.trim() || undefined, assignedOfficialId: official || null,
          complainantPartyId: complainant === 'reporter' ? null : complainant, respondentPartyId: respondent || null,
          residentInstructions: instructions.trim(), notes: notes.trim() });
    setSaving(false);
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>{mode === 'edit' ? `Edit draft - ${h.title.toLowerCase()}` : requestId ? 'Approve the request - set the new date' : `New date for the ${h.title.toLowerCase()}`}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        {request && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{request.reason}{request.preferredSchedule ? ` - would suit them: ${request.preferredSchedule}` : ''}</Alert>}
        {mode === 'reschedule' && <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>Now {formatHearingWhen(h.scheduledAt)}. The old date stays in the history, its notices are marked replaced, new KP notices are made for the new date, and both parties are told.</Typography>}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <TextField size="small" type="date" label="Date *" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }} />
          <TextField size="small" type="time" label="Time *" value={time} onChange={e => setTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Box>
        <TextField size="small" label="Venue" value={venue} onChange={e => setVenue(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
        {mode === 'reschedule' && <TextField size="small" label="Reason for the new date *" value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />}
        <ConflictWarnings date={date} time={time} venue={venue} officialId={mode === 'edit' ? official || null : h.assignedOfficialId} excludeId={h.id} />
        {mode === 'edit' && (
          <>
            <TextField select size="small" label="Assigned official" value={official} onChange={e => setOfficial(e.target.value)}>
              <MenuItem value=""><em>Not assigned</em></MenuItem>
              {data.officials.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Complainant" value={complainant} onChange={e => setComplainant(e.target.value)}>
              {data.parties.complainants.map(p => <MenuItem key={p.id ?? 'reporter'} value={p.id ?? 'reporter'}>{p.name} - {p.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Respondent" value={respondent} onChange={e => setRespondent(e.target.value)}>
              <MenuItem value=""><em>Not named yet</em></MenuItem>
              {data.parties.respondents.map(p => <MenuItem key={p.id} value={p.id!}>{p.name} - {p.label}</MenuItem>)}
            </TextField>
            <TextField size="small" multiline minRows={2} label="Instructions for the parties" value={instructions} onChange={e => setInstructions(e.target.value)} slotProps={{ htmlInput: { maxLength: 600 } }} />
            <TextField size="small" multiline minRows={2} label="Internal note" value={notes} onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" onClick={save} disabled={saving || !date || !time || (mode === 'reschedule' && reason.trim().length < 3)} sx={{ textTransform: 'none', bgcolor: NAVY }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : mode === 'edit' ? 'Save draft' : 'Set new date'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DetailsDialog({ data, h, onClose, onSave }: { data: CaseHearingsData; h: Hearing; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [official, setOfficial] = useState(h.assignedOfficialId ?? '');
  const [instructions, setInstructions] = useState(h.residentInstructions ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>Official and instructions - {h.title.toLowerCase()}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <TextField select size="small" label="Assigned official" value={official} onChange={e => setOfficial(e.target.value)}>
          <MenuItem value=""><em>Not assigned</em></MenuItem>
          {data.officials.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
        </TextField>
        <TextField size="small" multiline minRows={2} label="Instructions for the parties" value={instructions} onChange={e => setInstructions(e.target.value)} slotProps={{ htmlInput: { maxLength: 600 } }} />
        {official && official !== h.assignedOfficialId && <ConflictWarnings date={phDay(h.scheduledAt)} time={phTime(h.scheduledAt)} venue={h.venue ?? ''} officialId={official} excludeId={h.id} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" disabled={saving} sx={{ textTransform: 'none', bgcolor: NAVY }}
          onClick={async () => { setSaving(true); await onSave({ action: 'details', assignedOfficialId: official || null, residentInstructions: instructions.trim() }); setSaving(false); }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ReasonDialog({ title, label, confirm, hint, onClose, onSave }: { title: string; label: string; confirm: string; hint?: string; onClose: () => void; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1 }}>
        {hint && <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>{hint}</Typography>}
        <TextField autoFocus size="small" multiline minRows={2} label={label} value={v} onChange={e => setV(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" color="error" disabled={saving || v.trim().length < 3} sx={{ textTransform: 'none' }}
          onClick={async () => { setSaving(true); await onSave(v.trim()); setSaving(false); }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Confirmation ────────────────────────────────────────────────────────────

interface Pending {
  title: string; lines: string[]; body: Record<string, unknown>; ok: string; danger?: boolean;
  /** Set when the server found a clash: the official may go ahead knowingly. */
  conflicts: ScheduleConflict[] | null;
}

function ConfirmChange({ pending, onBack, onConfirm }: { pending: Pending; onBack: () => void; onConfirm: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onClose={onBack} fullWidth maxWidth="xs" aria-labelledby="confirm-change-title">
      <DialogTitle id="confirm-change-title" sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem' }}>{pending.title}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 0.75 }}>
        {pending.lines.map(l => <Typography key={l} sx={{ fontSize: '0.84rem', color: '#334155' }}>{l}</Typography>)}
        {pending.conflicts && <ConflictList conflicts={pending.conflicts} footer="Nothing was changed. Go back to pick another time, or go ahead only if both hearings can really happen." />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.25 }}>
        <Button onClick={onBack} sx={{ textTransform: 'none' }}>Back</Button>
        <Button variant="contained" color={pending.conflicts ? 'warning' : pending.danger ? 'error' : 'primary'} disabled={saving}
          sx={{ textTransform: 'none', ...(!pending.conflicts && !pending.danger && { bgcolor: NAVY }) }}
          onClick={async () => { setSaving(true); await onConfirm(); setSaving(false); }}>
          {saving ? <CircularProgress size={16} color="inherit" /> : pending.conflicts ? 'Go ahead anyway' : 'Confirm'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
