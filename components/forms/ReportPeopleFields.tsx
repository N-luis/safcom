'use client';

import { useState } from 'react';
import { Box, Typography, TextField, Button, RadioGroup, Radio, FormControlLabel, Alert } from '@mui/material';
import { Add, Remove } from '@mui/icons-material';
import { ANSWER_LABEL, YES_NO_UNKNOWN, type ReportPath } from '@/lib/caseRecords';
import type { ReportingRelationship } from '@/lib/interviewTypes';
import { PH_MOBILE_HINT, isPhMobileLocal, normalizePhMobile, phMobileLocal } from '@/lib/phoneNumber';
import PhMobileField from './PhMobileField';

/**
 * The person affected and the person reported, as far as the reporter knows.
 *
 * Every field is optional, and each section opens on its own button (Add
 * Person Affected, Add Person Reported) and can be removed again: a report is never
 * held back for a name the reporter does not know, and nobody should be
 * pushed to find out. The reporter, the person affected and the person
 * reported are separate - nothing here assumes one is another.
 */

export interface PeopleState {
  affected: { fullName: string; age: string; address: string; contactNumber: string; relationship: string; dependentsAffected: string; details: string };
  reported: { fullName: string; age: string; address: string; relationship: string; details: string };
}

export const EMPTY_PEOPLE: PeopleState = {
  affected: { fullName: '', age: '', address: '', contactNumber: '', relationship: '', dependentsAffected: '', details: '' },
  reported: { fullName: '', age: '', address: '', relationship: '', details: '' },
};

const clean = (o: Record<string, string>) => {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(o)) {
    const t = v.trim();
    if (!t) continue;
    out[k] = k === 'age' ? Number(t) : t;
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * What the server receives: only what was filled in, and only what the form
 * asks - details typed before switching to "for myself" are not sent. With no
 * desk chosen (null: the resident form, where SafeComm recommends the desk)
 * everything asked is sent; the Blotter form never asked for the affected
 * person's number or dependents.
 */
export function peoplePayload(p: PeopleState, path: ReportPath | null, relationship: ReportingRelationship | '') {
  const asksAll = path !== 'BLOTTER';
  const affected = relationship === 'SELF'
    ? { ...EMPTY_PEOPLE.affected, dependentsAffected: asksAll ? p.affected.dependentsAffected : '' }
    : { ...p.affected, contactNumber: asksAll ? normalizePhMobile(p.affected.contactNumber) ?? '' : '', ...(!asksAll && { dependentsAffected: '' }) };
  return { affectedParty: clean(affected), reportedParty: clean(p.reported) };
}

/**
 * Why the people details cannot be sent as they are, or null. Only a contact
 * number that was started but is not a full +63 mobile number stops a report;
 * it is never dropped silently, and an empty one is fine.
 */
export function peopleProblem(p: PeopleState, path: ReportPath | null, relationship: ReportingRelationship | ''): string | null {
  if (relationship === 'SELF' || path === 'BLOTTER') return null;
  const local = phMobileLocal(p.affected.contactNumber);
  if (local && !isPhMobileLocal(local)) return `The affected person's contact number is incomplete. ${PH_MOBILE_HINT}, or leave it empty.`;
  return null;
}

/** Whether a section holds anything the resident typed or chose. */
const hasAny = (o: Record<string, string>) => Object.values(o).some(v => v.trim() !== '');

export default function ReportPeopleFields({ path, relationship, value, onChange, disabled }: {
  /** The desk's own wording, or null for neutral wording that asks everything. */
  path: ReportPath | null;
  relationship: ReportingRelationship | '';
  value: PeopleState;
  onChange: (next: PeopleState) => void;
  disabled?: boolean;
}) {
  // Each section opens on its own button; one that already holds details (a restored form) starts open.
  const [openAffected, setOpenAffected] = useState(() => hasAny(value.affected));
  const [openReported, setOpenReported] = useState(() => hasAny(value.reported));
  // "Remove" on a section with details asks first, so nothing typed is lost by a stray tap.
  const [confirming, setConfirming] = useState<'affected' | 'reported' | null>(null);
  const vawc = path === 'VAWC';
  // The affected person's number and the dependents question: asked unless
  // this is the Blotter form, which never asked them.
  const asksAll = path !== 'BLOTTER';
  const self = relationship === 'SELF';
  const setA = (k: keyof PeopleState['affected']) => (e: { target: { value: string } }) =>
    onChange({ ...value, affected: { ...value.affected, [k]: e.target.value } });
  const setR = (k: keyof PeopleState['reported']) => (e: { target: { value: string } }) =>
    onChange({ ...value, reported: { ...value.reported, [k]: e.target.value } });
  const affectedName = vawc ? 'the victim-survivor' : 'the person affected';
  const ageProps = { htmlInput: { min: 0, max: 120, inputMode: 'numeric' as const } };

  // Removing a section clears what it held: a section that is not shown is not sent.
  const remove = (which: 'affected' | 'reported') => {
    onChange({ ...value, [which]: EMPTY_PEOPLE[which] });
    (which === 'affected' ? setOpenAffected : setOpenReported)(false);
    setConfirming(null);
  };
  const toggle = (which: 'affected' | 'reported') => {
    const open = which === 'affected' ? openAffected : openReported;
    if (!open) { (which === 'affected' ? setOpenAffected : setOpenReported)(true); setConfirming(null); return; }
    if (hasAny(value[which])) setConfirming(which); else remove(which);
  };
  const button = (which: 'affected' | 'reported', label: string) => {
    const open = which === 'affected' ? openAffected : openReported;
    return (
      <Button variant="outlined" onClick={() => toggle(which)} disabled={disabled} aria-expanded={open} aria-controls={`people-${which}`}
        startIcon={open ? <Remove /> : <Add />}
        sx={{ flex: { sm: '1 1 0' }, width: { xs: '100%', sm: 'auto' }, minHeight: 44, borderRadius: 2, textTransform: 'none', fontWeight: 700,
          ...(open ? { color: '#b91c1c', borderColor: '#fecaca', '&:hover': { borderColor: '#b91c1c', bgcolor: '#fef2f2' } }
            : { color: '#0f766e', borderColor: '#99f6e4', '&:hover': { borderColor: '#0f766e', bgcolor: '#f0fdfa' } }) }}>
        {open ? `Remove ${label}` : `Add ${label}`}
      </Button>
    );
  };
  const confirm = (which: 'affected' | 'reported', label: string) => confirming === which && (
    <Alert severity="warning" sx={{ borderRadius: 2 }} action={(
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Button color="inherit" size="small" onClick={() => setConfirming(null)}>Keep</Button>
        <Button color="error" size="small" onClick={() => remove(which)}>Remove</Button>
      </Box>
    )}>Remove the details you entered for the {label.toLowerCase()}?</Alert>
  );
  const section = (id: string, title: string, children: React.ReactNode) => (
    <Box id={id} role="group" aria-label={title} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: { xs: 1.5, sm: 2 }, bgcolor: '#fff' }}>
      <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: '#0c1e46', mb: 1.25 }}>{title}</Typography>
      {children}
    </Box>
  );
  const grid = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 120px' }, gap: 1.25 };
  const dependents = (id: string) => (
    <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
      <Typography id={id} sx={{ fontSize: '0.84rem', color: '#334155' }}>Are any children or dependents affected?</Typography>
      <RadioGroup row aria-labelledby={id} value={value.affected.dependentsAffected}
        onChange={e => onChange({ ...value, affected: { ...value.affected, dependentsAffected: e.target.value } })}>
        {YES_NO_UNKNOWN.map(a => <FormControlLabel key={a} value={a} disabled={disabled} control={<Radio size="small" />}
          label={a === 'unknown' ? 'Not sure' : ANSWER_LABEL[a]} />)}
      </RadioGroup>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0c1e46' }}>
          People Involved (optional)
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
          Share only what you already know. You do not need names, and you should not put yourself at risk to find anything out.
        </Typography>
      </Box>

      {/* Two independent buttons: opening one never opens or requires the other. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
        {button('affected', 'Person Affected')}
        {button('reported', 'Person Reported')}
      </Box>

      {openAffected && section('people-affected', 'Person affected', (
        <>
          {confirm('affected', 'Person Affected')}
          {self ? (
            // Reporting for yourself: you are the person affected. Only the children question is asked, and never on the Blotter form.
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>You said this happened to you, so you are the person affected.</Typography>
              {asksAll && dependents('dependents-self')}
            </Box>
          ) : (
            <Box sx={grid}>
              <TextField size="small" label="Full name, if known" value={value.affected.fullName} onChange={setA('fullName')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 120 } }} />
              <TextField size="small" label="Age, if known" type="number" value={value.affected.age} onChange={setA('age')} disabled={disabled} slotProps={ageProps} />
              <TextField size="small" label="Address, if needed" value={value.affected.address} onChange={setA('address')} disabled={disabled}
                slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
              {asksAll && (
                <Box sx={{ gridColumn: { sm: '1 / -1' } }}>
                  <PhMobileField label="Contact number - only if it is safe to provide" value={value.affected.contactNumber}
                    onChange={d => onChange({ ...value, affected: { ...value.affected, contactNumber: d } })} disabled={disabled} sx={{ width: '100%' }} />
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b', mt: 0.5 }}>Leave it empty if calling or texting them could put them at risk.</Typography>
                </Box>
              )}
              <TextField size="small" label="Relationship to you" placeholder="e.g. neighbour, sister, co-worker" value={value.affected.relationship}
                onChange={setA('relationship')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 120 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
              {asksAll && dependents('dependents-other')}
              <TextField size="small" label="Anything else that may help (optional)" multiline minRows={2} value={value.affected.details}
                onChange={setA('details')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 500 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
            </Box>
          )}
        </>
      ))}

      {openReported && section('people-reported', vawc ? 'Person reported (the person who did this)' : 'Person reported', (
        <>
          {confirm('reported', 'Person Reported')}
          <Box sx={grid}>
            <TextField size="small" label="Full name, if known" value={value.reported.fullName} onChange={setR('fullName')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 120 } }} />
            <TextField size="small" label="Age, if known" type="number" value={value.reported.age} onChange={setR('age')} disabled={disabled} slotProps={ageProps} />
            <TextField size="small" label="Address, if known" value={value.reported.address} onChange={setR('address')} disabled={disabled}
              slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
            <TextField size="small" label={`Who are they to ${self ? 'you' : affectedName}?`} placeholder={vawc ? 'e.g. husband, ex-partner, father' : path === null ? 'e.g. neighbour, relative, partner, stranger' : 'e.g. neighbour, stranger'}
              value={value.reported.relationship} onChange={setR('relationship')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 120 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
            <TextField size="small" label="Anything else that may help (optional)" multiline minRows={2} value={value.reported.details}
              onChange={setR('details')} disabled={disabled} slotProps={{ htmlInput: { maxLength: 500 } }} sx={{ gridColumn: { sm: '1 / -1' } }} />
          </Box>
        </>
      ))}
    </Box>
  );
}
