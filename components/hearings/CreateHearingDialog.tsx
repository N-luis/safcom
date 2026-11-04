'use client';

import { useMemo, useState, type ReactNode } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Alert, Autocomplete,
  CircularProgress, Skeleton, Chip, useMediaQuery, useTheme,
} from '@mui/material';
import { Gavel } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { phDay, phTime, type ScheduleConflict } from '@/lib/hearings';
import { REFERRAL_AGENCIES, type ReferralAgency } from '@/lib/caseRecords';
import type { HearingCaseRow } from '@/lib/hearingCasesServer';
import ConflictWarnings, { ConflictList } from './ConflictWarnings';
import KpReviewForm from './KpReviewForm';
import { PartyAccount } from './HearingDetailsDialog';
import { NAVY, getJson, send, todayPh, conflictsOf, chipSx, type CaseHearingsData } from './hearingUi';

export const ELIGIBILITY_COLOR: Record<HearingCaseRow['eligibility']['state'], string> = {
  ELIGIBLE: '#15803d', NOT_ELIGIBLE: '#b91c1c', NEEDS_VERIFICATION: '#b45309', PENDING_REVIEW: '#64748b',
};
const ELIGIBILITY_TITLE: Record<HearingCaseRow['eligibility']['state'], string> = {
  PENDING_REVIEW: 'Eligibility review pending', NEEDS_VERIFICATION: 'Eligibility needs verification',
  NOT_ELIGIBLE: 'Not eligible for barangay mediation or conciliation', ELIGIBLE: 'Not ready for a hearing yet',
};

interface CaseListData { rows: HearingCaseRow[]; vawc: { id: string; caseNumber: string; caseType: string; status: string; reason: string } | null }

/**
 * Create the next Katarungang Pambarangay proceeding on a blotter case.
 * The case is chosen first (or given) and its records load with it: the
 * reference, the complainant, the respondent, the category and the status.
 * Whatever still stands in the way is shown and can be done here by the
 * officer the case is assigned to - taking an unassigned case, confirming
 * its category, the eligibility review, recording the respondent - so a
 * hearing is never refused without saying why. The stage is always the
 * case's next one - mediation, then the constitution of the Pangkat, then
 * conciliation - and the dialog says which KP forms scheduling makes, and
 * how each party gets theirs.
 */
export default function CreateHearingDialog({ caseId: fixedCase, initialDate, onClose, onCreated, classificationHref }: {
  caseId?: string; onClose: () => void; onCreated: (caseId: string) => void;
  /** A day picked on the calendar (YYYY-MM-DD). */
  initialDate?: string;
  /** Where an official changes the category, when the one on file is wrong. */
  classificationHref?: (caseId: string) => string;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<HearingCaseRow | null>(null);
  const caseId = fixedCase ?? picked?.id ?? null;
  const candidates = useSWR<CaseListData>(fixedCase ? null : `/api/hearings/cases?pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`, getJson, { keepPreviousData: true });
  const detail = useSWR<CaseHearingsData>(caseId ? `/api/cases/${caseId}/hearings` : null, getJson);
  const d = detail.data;
  const { mutate: mutateAll } = useSWRConfig();
  // A review, a respondent or a claim changes the case list behind the dialog too.
  const refresh = () => { void detail.mutate(); void mutateAll((key: unknown) => typeof key === 'string' && key.startsWith('/api/hearings/cases')); };

  // null = not touched yet: the field shows the case's default until the official changes it.
  const [dateIn, setDate] = useState<string | null>(null);
  const [timeIn, setTime] = useState<string | null>(null);
  const [venue, setVenue] = useState('Barangay Hall');
  const [officialIn, setOfficial] = useState<string | null>(null);
  const [complainantIn, setComplainant] = useState<string | null>(null);
  const [respondentIn, setRespondent] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<'draft' | 'schedule' | null>(null);
  const [busy, setBusy] = useState<'claim' | 'category' | null>(null);
  const [reviewAgain, setReviewAgain] = useState(false);
  // Set when the server found a clash: shown with the choice to go ahead.
  const [clash, setClash] = useState<{ conflicts: ScheduleConflict[]; asDraft: boolean } | null>(null);

  // Defaults from the case: the proposed date from the last hearing, the first person reported.
  const proposed = useMemo(() => d?.hearings.filter(h => h.status === 'COMPLETED').at(-1)?.nextHearingAt ?? null, [d]);
  const firstRespondent = d?.parties.respondents[0]?.id ?? '';
  const last = d?.hearings.filter(h => h.status !== 'CANCELLED').at(-1);
  const lastOfficial = last?.assignedOfficialId ?? '';
  const date = dateIn ?? (initialDate && initialDate >= todayPh() ? initialDate : proposed ? phDay(proposed) : '');
  const time = timeIn ?? (proposed && phTime(proposed) !== '00:00' ? phTime(proposed) : '09:00');
  const official = officialIn ?? lastOfficial;
  // The parties carry over from the stage before: the same dispute, the same people.
  const respondent = respondentIn ?? last?.respondent.partyId ?? firstRespondent;
  const complainant = complainantIn ?? last?.complainant.partyId ?? 'reporter';
  const cParty = d?.parties.complainants.find(p => (p.id ?? 'reporter') === complainant);
  const rParty = d?.parties.respondents.find(p => p.id === respondent);

  const next = d?.next ?? null;
  const ready = Boolean(d && d.canEdit && d.eligibility.eligible && next && !d.blocked);
  const hasAnswers = Boolean(d?.eligibility.answers && Object.keys(d.eligibility.answers).length);
  const detailError = detail.error as (Error & { status?: number; canClaim?: boolean }) | undefined;

  const claim = async () => {
    if (!caseId) return;
    setBusy('claim');
    try { await send(`/api/cases/${caseId}/claim`, 'POST', {}); toast.success('The case is now assigned to you'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not take the case'); } finally { setBusy(null); }
  };
  const confirmCategory = async () => {
    if (!d) return;
    setBusy('category');
    try {
      await send(`/api/cases/${d.case.id}/classification`, 'PATCH', { caseType: d.case.caseType, confirm: true });
      toast.success(`Category confirmed: ${d.case.caseType}`); refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not confirm the category'); } finally { setBusy(null); }
  };

  const save = async (asDraft: boolean, confirmConflicts = false) => {
    if (!caseId || !next || saving) return;
    if (!date || !time) { toast.error('Choose the hearing date and time'); return; }
    if (!venue.trim()) { toast.error('Enter the venue'); return; }
    setSaving(asDraft ? 'draft' : 'schedule');
    try {
      await send(`/api/cases/${caseId}/hearings`, 'POST', {
        stage: next.stage, date, time, venue: venue.trim(), asDraft, confirmConflicts,
        assignedOfficialId: official || null,
        complainantPartyId: complainant === 'reporter' ? null : complainant,
        respondentPartyId: respondent || null,
        residentInstructions: instructions.trim() || undefined, notes: notes.trim() || undefined,
      });
      toast.success(asDraft ? `${next.title} saved as a draft` : `${next.title} scheduled - ${next.forms.map(f => `KP Form No. ${f.formNo}`).filter((x, i, a) => a.indexOf(x) === i).join(' and ')} made for the parties`);
      setClash(null);
      onCreated(caseId);
    } catch (e) {
      const conflicts = conflictsOf(e);
      if (conflicts) setClash({ conflicts, asDraft });
      else toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(null); }
  };

  const options = [
    ...(candidates.data?.vawc ? [{ ...candidates.data.vawc, vawcOnly: true as const }] : []),
    ...(candidates.data?.rows ?? []),
  ];

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Gavel sx={{ color: '#0369a1' }} /> Create hearing
        {next && d?.eligibility.eligible && <Chip size="small" label={next.label + (next.session > 1 ? ` - session ${next.session}` : '')} sx={{ ml: 1, fontWeight: 700, bgcolor: '#e0f2fe', color: '#0369a1' }} />}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.75 }}>
        {!fixedCase && (
          <Autocomplete
            options={options}
            loading={candidates.isLoading}
            value={picked}
            onChange={(_, v) => { if (v && 'vawcOnly' in v) return; setPicked(v as HearingCaseRow | null); setReviewAgain(false); }}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ(v.trim()); }}
            filterOptions={x => x}
            getOptionLabel={o => `${o.caseNumber} - ${o.caseType}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            getOptionDisabled={o => 'vawcOnly' in o}
            noOptionsText={candidates.error ? candidates.error.message : 'No blotter case matches.'}
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                {'vawcOnly' in o ? (
                  <Box><Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: NAVY }}>{o.caseNumber} - {o.caseType}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: '#b91c1c' }}>{o.reason}</Typography></Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: NAVY }}>{o.caseNumber}</Typography>
                    <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{o.caseType} · {o.complainant}{o.respondents[0] ? ` vs ${o.respondents[0].name}` : ''}</Typography>
                    <Chip size="small" label={o.eligibility.state === 'ELIGIBLE' && o.next ? `Next: ${o.next.title}` : o.eligibility.label}
                      sx={{ ml: 'auto', ...chipSx(ELIGIBILITY_COLOR[o.eligibility.state]) }} />
                  </Box>
                )}
              </li>
            )}
            renderInput={params => <TextField {...params} size="small" label="Case" placeholder="Case number, complainant or respondent" />}
          />
        )}

        {caseId && detail.isLoading && <Skeleton height={120} />}
        {caseId && detailError && (
          <Alert severity={detailError.status === 403 ? 'info' : 'error'} sx={{ borderRadius: 2 }}
            action={detailError.canClaim ? (
              <Button color="inherit" size="small" onClick={claim} disabled={busy !== null} sx={{ textTransform: 'none', fontWeight: 700 }}>
                {busy === 'claim' ? <CircularProgress size={14} color="inherit" /> : 'Take this case'}
              </Button>
            ) : undefined}>
            {detailError.message}
          </Alert>
        )}

        {d && (
          <>
            <CaseInfo d={d} />
            {d.eligibility.warnings.map(w => <Alert key={w} severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{w}</Alert>)}
            {!d.eligibility.eligible && !(d.eligibility.state === 'NOT_ELIGIBLE' && d.eligibility.exclusions.length > 0 && !d.vawc && !reviewAgain) && (
              <Alert severity={d.vawc || d.eligibility.state === 'NOT_ELIGIBLE' ? 'error' : d.eligibility.state === 'NEEDS_VERIFICATION' ? 'warning' : 'info'} sx={{ borderRadius: 2, fontSize: '0.82rem' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', mb: 0.25 }}>{d.vawc ? 'No ordinary barangay hearing for this case' : ELIGIBILITY_TITLE[d.eligibility.state]}</Typography>
                {d.eligibility.reasons.map(r => <Box key={r}>{r}</Box>)}
                {!d.eligibility.categoryVerified && !d.vawc && d.canEdit && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
                    <Button size="small" variant="outlined" onClick={confirmCategory} disabled={busy !== null} sx={{ textTransform: 'none' }}>
                      {busy === 'category' ? <CircularProgress size={14} /> : `Confirm the category "${d.case.caseType}"`}
                    </Button>
                    {classificationHref && <Button size="small" href={classificationHref(d.case.id)} sx={{ textTransform: 'none' }}>The category is wrong - change it on the case</Button>}
                  </Box>
                )}
              </Alert>
            )}
            {!d.vawc && d.canEdit && d.eligibility.categoryVerified && (reviewAgain || (d.eligibility.needsReview && !hasAnswers)) && (
              <KpReviewForm key={d.eligibility.review ? String(d.eligibility.review.at) : 'new'} caseId={d.case.id} caseType={d.case.caseType}
                initial={d.eligibility.answers} onSaved={() => { setReviewAgain(false); refresh(); }} />
            )}
            {!d.vawc && d.canEdit && d.eligibility.categoryVerified && d.eligibility.needsReview && hasAnswers && !reviewAgain && (
              <Box><Button variant="contained" color="warning" onClick={() => setReviewAgain(true)} sx={{ textTransform: 'none' }}>Continue eligibility review</Button></Box>
            )}
            {!d.vawc && d.eligibility.state === 'NOT_ELIGIBLE' && d.eligibility.exclusions.length > 0 && !reviewAgain && (
              <NotEligible d={d} onReviewAgain={d.canEdit ? () => setReviewAgain(true) : undefined} />
            )}
            {d.eligibility.eligible && d.blocked && <Alert severity="info" sx={{ borderRadius: 2 }}>{d.blocked}</Alert>}
            {!d.canEdit && <Alert severity="info" sx={{ borderRadius: 2 }}>{d.accessMessage ?? 'You can view this case\'s hearings but not create one.'}</Alert>}

            {!d.vawc && d.canEdit && !d.parties.respondents.length && <RecordRespondent caseId={d.case.id} onSaved={refresh} />}
            {!d.vawc && d.canEdit && rParty && !rParty.account && (
              <Box>
                <Typography sx={{ fontSize: '0.78rem', color: '#475569', mb: 0.75 }}>
                  If the respondent has a SafeComm account, link it so the summons reaches them in My Hearings &amp; Notices. Otherwise an officer serves it and records the delivery.
                </Typography>
                <PartyAccount caseId={d.case.id} role="RESPONDENT" party={rParty} canEdit refresh={refresh} />
              </Box>
            )}

            {ready && next && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <Alert severity="info" icon={false} sx={{ gridColumn: { sm: '1 / -1' }, borderRadius: 2, fontSize: '0.8rem' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', mb: 0.5 }}>Scheduling makes these notices, for this one date and time</Typography>
                  {next.forms.map(f => {
                    const party = f.recipientRole === 'COMPLAINANT' ? cParty : rParty;
                    return (
                      <Box key={f.recipientRole}>
                        <b>{f.name}</b> - to the {f.recipientRole.toLowerCase()}{party ? ` (${party.name})` : ''}:{' '}
                        {party?.account ? 'delivered to their SafeComm account at once.' : 'no SafeComm account linked - an officer hands it over or serves it, and records the delivery.'}
                      </Box>
                    );
                  })}
                  {next.stage === 'CONSTITUTION' && <Box sx={{ mt: 0.5 }}>KP Form No. 11 goes to each Pangkat member once they are recorded on the proceeding.</Box>}
                  <Box sx={{ mt: 0.5, color: '#64748b' }}>Nothing is sent by text message or email.</Box>
                </Alert>
                <TextField size="small" label="Proceeding stage" value={next.title} disabled
                  helperText="The case's next stage - each comes only after the one before it" />
                <TextField select size="small" label="Issuing / presiding official" value={official} onChange={e => { setOfficial(e.target.value); setClash(null); }}
                  slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} helperText="Presides over or handles the hearing">
                  <MenuItem value=""><em>Me</em></MenuItem>
                  {d.officials.map(o => <MenuItem key={o.id} value={o.id}>{o.name}{o.role === 'admin' ? ' (Barangay Captain)' : ''}</MenuItem>)}
                </TextField>
                <TextField size="small" type="date" label="Hearing date *" value={date} onChange={e => { setDate(e.target.value); setClash(null); }}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }}
                  helperText={proposed ? `Proposed at the last proceeding: ${phDay(proposed)}` : ' '} />
                <TextField size="small" type="time" label="Start time *" value={time} onChange={e => { setTime(e.target.value); setClash(null); }} slotProps={{ inputLabel: { shrink: true } }} helperText="Philippine time" />
                <TextField size="small" label="Venue *" value={venue} onChange={e => { setVenue(e.target.value); setClash(null); }} slotProps={{ htmlInput: { maxLength: 200 } }}
                  sx={{ gridColumn: { sm: '1 / -1' } }} />
                <TextField select size="small" label="Complainant / requesting party" value={complainant} onChange={e => setComplainant(e.target.value)}>
                  {d.parties.complainants.map(p => <MenuItem key={p.id ?? 'reporter'} value={p.id ?? 'reporter'}>{p.name} - {p.label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Respondent" value={respondent} onChange={e => setRespondent(e.target.value)}
                  error={!respondent}
                  helperText={d.parties.respondents.length ? 'From the people recorded on the case - the summons and notices are addressed to them' : 'Record the respondent above first (a draft can be saved without)'}>
                  <MenuItem value=""><em>Not named yet (draft only)</em></MenuItem>
                  {d.parties.respondents.map(p => <MenuItem key={p.id} value={p.id!}>{p.name} - {p.label}</MenuItem>)}
                </TextField>
                <TextField size="small" multiline minRows={2} label="Instructions for the parties (optional)" value={instructions}
                  onChange={e => setInstructions(e.target.value)} slotProps={{ htmlInput: { maxLength: 600 } }} sx={{ gridColumn: { sm: '1 / -1' } }}
                  helperText="Shown to both parties in My Hearings & Notices, with the standard instructions" />
                <TextField size="small" multiline minRows={2} label="Internal note (officials only, optional)" value={notes}
                  onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
                <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
                  {clash ? <ConflictList conflicts={clash.conflicts} footer="Nothing was saved. Change the time or venue, or schedule anyway if both hearings can really happen." />
                    : <ConflictWarnings date={date} time={time} venue={venue} officialId={official || null} />}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
        {ready && (
          <>
            {clash && (
              <Button color="warning" variant="outlined" onClick={() => save(clash.asDraft, true)} disabled={saving !== null} sx={{ textTransform: 'none' }}>
                {clash.asDraft ? 'Save draft anyway' : 'Schedule anyway'}
              </Button>
            )}
            <Button variant="outlined" onClick={() => save(true)} disabled={saving !== null} sx={{ textTransform: 'none' }}>
              {saving === 'draft' ? <CircularProgress size={16} /> : 'Save as draft'}
            </Button>
            <Button variant="contained" onClick={() => save(false)} disabled={saving !== null || !respondent} sx={{ textTransform: 'none', bgcolor: NAVY }}>
              {saving === 'schedule' ? <CircularProgress size={16} color="inherit" /> : `Schedule ${next?.title.toLowerCase()}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * A case an official found not eligible: the exclusion, in the law's terms,
 * and where to send the parties instead - recorded as a referral on the
 * case (Case records). The exclusion is never bypassed here: only a new
 * review that says what changed can clear it.
 */
function NotEligible({ d, onReviewAgain }: { d: CaseHearingsData; onReviewAgain?: () => void }) {
  const agencies = (Object.keys(REFERRAL_AGENCIES) as ReferralAgency[]).filter(a => a !== 'LUPON' && (REFERRAL_AGENCIES[a].desks as readonly string[]).includes('BLOTTER'));
  const directCourt = d.eligibility.exclusions.some(e => e.key === 'no_direct_court' || e.key === 'offence_limit' || e.key === 'private_party');
  const [agency, setAgency] = useState<ReferralAgency>(directCourt ? 'LEGAL_AID' : 'OTHER');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const refer = async () => {
    setBusy(true);
    try {
      await send(`/api/cases/${d.case.id}/referrals`, 'POST', {
        agency, agencyOther: agency === 'OTHER' ? other.trim() : undefined, referredAt: todayPh(),
        reason: `Not eligible for barangay conciliation: ${d.eligibility.exclusions.map(e => `${e.exclusion} (${e.basis})`).join(' ')}`.slice(0, 500),
      });
      setDone(REFERRAL_AGENCIES[agency].label); toast.success('Referral recorded on the case');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not record the referral'); } finally { setBusy(false); }
  };
  return (
    <Box sx={{ border: '1px solid #fecaca', bgcolor: '#fef2f2', borderRadius: 2, p: 1.5, display: 'grid', gap: 1 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: '#991b1b' }}>Why no KP proceeding can be created</Typography>
      {d.eligibility.exclusions.map(e => (
        <Typography key={e.key} sx={{ fontSize: '0.8rem', color: '#7f1d1d' }}>{e.exclusion} <span style={{ color: '#b91c1c' }}>({e.basis})</span></Typography>
      ))}
      {d.eligibility.review?.note && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>Official&apos;s basis: {d.eligibility.review.note}{d.eligibility.review.by ? ` - ${d.eligibility.review.by}` : ''}</Typography>}
      <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>
        {directCourt ? "The parties may take the matter directly to the court or the prosecutor's office. " : ''}
        Refer the parties to the office that can act on it. The referral is saved to the case records.
      </Typography>
      {done ? <Alert severity="success" sx={{ borderRadius: 2, fontSize: '0.8rem', py: 0 }}>Referred to {done}.</Alert> : d.canEdit && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField select size="small" label="Refer to" value={agency} onChange={e => setAgency(e.target.value as ReferralAgency)} sx={{ minWidth: 260 }}>
            {agencies.map(a => <MenuItem key={a} value={a}>{REFERRAL_AGENCIES[a].label}</MenuItem>)}
          </TextField>
          {agency === 'OTHER' && <TextField size="small" label="Office *" placeholder="e.g. Office of the City Prosecutor" value={other} onChange={e => setOther(e.target.value)} slotProps={{ htmlInput: { maxLength: 160 } }} />}
          <Button variant="outlined" color="error" onClick={refer} disabled={busy || (agency === 'OTHER' && other.trim().length < 2)} sx={{ textTransform: 'none', mt: 0.25 }}>
            {busy ? <CircularProgress size={16} /> : 'Record referral'}
          </Button>
        </Box>
      )}
      {onReviewAgain && (
        <Box><Button size="small" onClick={onReviewAgain} sx={{ textTransform: 'none', px: 0 }}>The facts have changed - review eligibility again</Button></Box>
      )}
    </Box>
  );
}

/** The case the hearing is for, from its records. */
function CaseInfo({ d }: { d: CaseHearingsData }) {
  const reporter = d.parties.complainants[0];
  const items: [string, ReactNode][] = [
    ['Case reference', <b key="r">{d.case.caseNumber}</b>],
    ['Complainant', reporter ? reporter.name : 'Not recorded'],
    ['Respondent', d.parties.respondents.length ? d.parties.respondents.map(p => p.name).join(', ') : <span key="n" style={{ color: '#b45309' }}>Not recorded yet</span>],
    ['Case category', <span key="c">{d.case.caseType}{' '}
      <Chip size="small" label={d.eligibility.categoryVerified ? 'Confirmed' : 'Not confirmed'} sx={{ ...chipSx(d.eligibility.categoryVerified ? '#15803d' : '#b45309'), height: 18 }} /></span>],
    ['Case status', d.case.status],
  ];
  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(5, auto)' }, gap: 1.25, justifyContent: 'space-between' }}>
      {items.map(([k, v]) => (
        <Box key={k} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</Typography>
          <Typography component="div" sx={{ fontSize: '0.84rem', color: NAVY }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Record the person reported - the respondent - on the case, as an
 * official's record (Case records, PUT /api/cases/:id/records). The summons
 * is addressed to them; it is never guessed from the narrative.
 */
function RecordRespondent({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const [fullName, setName] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (fullName.trim().length < 2) { toast.error('Enter the respondent\'s name'); return; }
    setBusy(true);
    try {
      await send(`/api/cases/${caseId}/records`, 'PUT', { role: 'REPORTED', party: {
        fullName: fullName.trim(), age: age.trim() || undefined, address: address.trim() || undefined, relationship: relationship.trim() || undefined,
      } });
      toast.success('Respondent recorded on the case');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  return (
    <Box sx={{ border: '1px solid #fcd34d', bgcolor: '#fffbeb', borderRadius: 2, p: 1.5, display: 'grid', gap: 1 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: NAVY }}>Record the respondent</Typography>
      <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>
        No person reported is recorded on this case. The summons (KP Form No. 9) is addressed to the respondent, so record them as the complainant names them.
        This is saved to the case records.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 1 }}>
        <TextField size="small" label="Full name *" value={fullName} onChange={e => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
        <TextField size="small" label="Age (optional)" value={age} onChange={e => setAge(e.target.value.replace(/[^\d]/g, ''))} slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 3 } }} />
        <TextField size="small" label="Address (optional)" value={address} onChange={e => setAddress(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
        <TextField size="small" label="Relationship to the complainant (optional)" value={relationship} onChange={e => setRelationship(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
      </Box>
      <Box><Button variant="contained" onClick={save} disabled={busy || fullName.trim().length < 2} sx={{ textTransform: 'none', bgcolor: NAVY }}>
        {busy ? <CircularProgress size={16} color="inherit" /> : 'Save respondent'}
      </Button></Box>
    </Box>
  );
}
