'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Alert, Autocomplete,
  CircularProgress, Skeleton, Chip, useMediaQuery, useTheme,
} from '@mui/material';
import { Gavel } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { HEARING_TITLES, phDay, phTime } from '@/lib/hearings';
import KpReviewForm from './KpReviewForm';
import { NAVY, getJson, send, todayPh, type CaseHearingsData } from './hearingUi';

interface CandidateCase {
  id: string; caseNumber: string; caseType: string; status: string; next: number | null; refusal: string | null;
  eligible: boolean; reasons: string[]; warnings: string[]; needsReview: boolean; categoryVerified: boolean;
}

/**
 * Create the next hearing on an eligible case. The case is chosen first (or
 * given), and its eligibility is shown before anything else: a VAWC case, a
 * case whose category is not verified, or one without an eligibility review
 * cannot have a hearing, and the reason is said. The hearing number is
 * always the next one - nothing is created ahead.
 */
export default function CreateHearingDialog({ caseId: fixedCase, onClose, onCreated, classificationHref }: {
  caseId?: string; onClose: () => void; onCreated: (caseId: string) => void;
  /** Where an official confirms the category, when it is not yet verified. */
  classificationHref?: (caseId: string) => string;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CandidateCase | null>(null);
  const caseId = fixedCase ?? picked?.id ?? null;
  const candidates = useSWR<CandidateCase[]>(fixedCase ? null : `/api/hearings/cases${q ? `?q=${encodeURIComponent(q)}` : ''}`, getJson, { keepPreviousData: true });
  const detail = useSWR<CaseHearingsData>(caseId ? `/api/cases/${caseId}/hearings` : null, getJson);
  const d = detail.data;

  // null = not touched yet: the field shows the case's default until the official changes it.
  const [dateIn, setDate] = useState<string | null>(null);
  const [timeIn, setTime] = useState<string | null>(null);
  const [venue, setVenue] = useState('Barangay Hall');
  const [officialIn, setOfficial] = useState<string | null>(null);
  const [complainant, setComplainant] = useState<string>('reporter');
  const [respondentIn, setRespondent] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<'draft' | 'schedule' | null>(null);

  // Defaults from the case: the proposed date from the last hearing, the first person reported.
  const proposed = useMemo(() => d?.hearings.filter(h => h.status === 'COMPLETED').at(-1)?.nextHearingAt ?? null, [d]);
  const firstRespondent = d?.parties.respondents[0]?.id ?? '';
  const lastOfficial = d?.hearings.filter(h => h.status !== 'CANCELLED').at(-1)?.assignedOfficialId ?? '';
  const date = dateIn ?? (proposed ? phDay(proposed) : '');
  const time = timeIn ?? (proposed && phTime(proposed) !== '00:00' ? phTime(proposed) : '09:00');
  const official = officialIn ?? lastOfficial;
  const respondent = respondentIn ?? firstRespondent;

  const next = d?.next ?? null;
  const ready = Boolean(d && d.canEdit && d.eligibility.eligible && next && !d.blocked);

  const save = async (asDraft: boolean) => {
    if (!caseId || !next) return;
    if (!date || !time) { toast.error('Choose the hearing date and time'); return; }
    setSaving(asDraft ? 'draft' : 'schedule');
    try {
      await send(`/api/cases/${caseId}/hearings`, 'POST', {
        hearingNumber: next, date, time, venue: venue.trim() || undefined, asDraft,
        assignedOfficialId: official || null,
        complainantPartyId: complainant === 'reporter' ? null : complainant,
        respondentPartyId: respondent || null,
        residentInstructions: instructions.trim() || undefined, notes: notes.trim() || undefined,
      });
      toast.success(asDraft ? `Hearing ${next} saved as a draft` : `Hearing ${next} scheduled`);
      onCreated(caseId);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setSaving(null); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={mobile}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Gavel sx={{ color: '#0369a1' }} /> Create hearing
        {next && d?.eligibility.eligible && <Chip size="small" label={`Hearing ${next} - ${HEARING_TITLES[next]}`} sx={{ ml: 1, fontWeight: 700, bgcolor: '#e0f2fe', color: '#0369a1' }} />}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.75 }}>
        {!fixedCase && (
          <Autocomplete
            options={candidates.data ?? []}
            loading={candidates.isLoading}
            value={picked}
            onChange={(_, v) => setPicked(v)}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ(v.trim()); }}
            filterOptions={x => x}
            getOptionLabel={o => `${o.caseNumber} - ${o.caseType}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText={candidates.error ? candidates.error.message : 'No open blotter case matches. Only cases you may manage are listed.'}
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: NAVY }}>{o.caseNumber}</Typography>
                  <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{o.caseType}</Typography>
                  <Chip size="small" label={o.eligible && !o.refusal ? `Ready for hearing ${o.next}` : 'Not eligible yet'}
                    sx={{ ml: 'auto', height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: o.eligible && !o.refusal ? '#dcfce7' : '#f1f5f9', color: o.eligible && !o.refusal ? '#15803d' : '#64748b' }} />
                </Box>
              </li>
            )}
            renderInput={params => <TextField {...params} size="small" label="Case" placeholder="Search by case number" />}
          />
        )}

        {caseId && detail.isLoading && <Skeleton height={120} />}
        {caseId && detail.error && <Alert severity="error" sx={{ borderRadius: 2 }}>{detail.error.message}</Alert>}

        {d && (
          <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 800, color: NAVY }}>{d.case.caseNumber}</Typography>
              <Typography sx={{ fontSize: '0.85rem', color: '#475569' }}>{d.case.caseType} · {d.case.status}</Typography>
            </Box>
            {d.eligibility.warnings.map(w => <Alert key={w} severity="warning" sx={{ borderRadius: 2, fontSize: '0.8rem' }}>{w}</Alert>)}
            {!d.eligibility.eligible && (
              <Alert severity={d.vawc ? 'error' : 'info'} sx={{ borderRadius: 2, fontSize: '0.82rem' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', mb: 0.25 }}>{d.vawc ? 'No ordinary barangay hearing for this case' : 'Not eligible for a hearing yet'}</Typography>
                {d.eligibility.reasons.map(r => <Box key={r}>{r}</Box>)}
                {!d.eligibility.categoryVerified && !d.vawc && classificationHref && (
                  <Button size="small" href={classificationHref(d.case.id)} sx={{ textTransform: 'none', mt: 0.5, px: 0 }}>Open the case to confirm its category</Button>
                )}
              </Alert>
            )}
            {!d.vawc && d.canEdit && d.eligibility.categoryVerified && d.eligibility.needsReview && (
              <KpReviewForm caseId={d.case.id} caseType={d.case.caseType} onSaved={() => { void detail.mutate(); void candidates.mutate(); }} />
            )}
            {d.eligibility.eligible && d.blocked && <Alert severity="info" sx={{ borderRadius: 2 }}>{d.blocked}</Alert>}
            {!d.canEdit && <Alert severity="info" sx={{ borderRadius: 2 }}>{d.accessMessage ?? 'You can view this case\'s hearings but not create one.'}</Alert>}

            {ready && next && (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <TextField size="small" type="date" label="Hearing date *" value={date} onChange={e => setDate(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayPh() } }}
                  helperText={proposed ? `Proposed at hearing ${next - 1}: ${phDay(proposed)}` : ' '} />
                <TextField size="small" type="time" label="Hearing time *" value={time} onChange={e => setTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} helperText="Philippine time" />
                <TextField size="small" label="Venue *" value={venue} onChange={e => setVenue(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TextField select size="small" label="Assigned official" value={official} onChange={e => setOfficial(e.target.value)}
                  helperText="Presides over or handles the hearing">
                  <MenuItem value=""><em>Me</em></MenuItem>
                  {d.officials.map(o => <MenuItem key={o.id} value={o.id}>{o.name}{o.role === 'admin' ? ' (Barangay Captain)' : ''}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Complainant / requesting party" value={complainant} onChange={e => setComplainant(e.target.value)}>
                  {d.parties.complainants.map(p => <MenuItem key={p.id ?? 'reporter'} value={p.id ?? 'reporter'}>{p.name} - {p.label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Respondent / other party" value={respondent} onChange={e => setRespondent(e.target.value)}
                  helperText={d.parties.respondents.length ? 'From the people recorded on the case' : 'No person reported is recorded - add one in Case records'}>
                  <MenuItem value=""><em>Not named yet</em></MenuItem>
                  {d.parties.respondents.map(p => <MenuItem key={p.id} value={p.id!}>{p.name} - {p.label}</MenuItem>)}
                </TextField>
                <TextField size="small" multiline minRows={2} label="Instructions for the complainant (optional)" value={instructions}
                  onChange={e => setInstructions(e.target.value)} slotProps={{ htmlInput: { maxLength: 600 } }} sx={{ gridColumn: { sm: '1 / -1' } }}
                  helperText="Shown to the complainant in My Hearings, with the standard instructions" />
                <TextField size="small" multiline minRows={2} label="Internal note (officials only, optional)" value={notes}
                  onChange={e => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
        {ready && (
          <>
            <Button variant="outlined" onClick={() => save(true)} disabled={saving !== null} sx={{ textTransform: 'none' }}>
              {saving === 'draft' ? <CircularProgress size={16} /> : 'Save as draft'}
            </Button>
            <Button variant="contained" onClick={() => save(false)} disabled={saving !== null} sx={{ textTransform: 'none', bgcolor: NAVY }}>
              {saving === 'schedule' ? <CircularProgress size={16} color="inherit" /> : `Schedule hearing ${next}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
