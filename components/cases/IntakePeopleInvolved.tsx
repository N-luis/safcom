'use client';

import { Box, Typography, Chip, Grid } from '@mui/material';
import { ANSWER_LABEL } from '@/lib/caseRecords';

/**
 * Section 1 of both intake forms (Blotter and VAWC): the person affected and
 * the person reported, each as the resident gave them on the report and, when
 * an official has added or verified details, as the official recorded them -
 * side by side, never merged, so the resident's original stays as it was.
 * The reporter is shown above (section B); the three are never assumed to be
 * one another.
 */

export interface PersonRecord {
  source: 'reporter' | 'official';
  fullName: string | null; age: number | null; address: string | null; contactNumber: string | null;
  relationship: string | null; dependentsAffected: string | null; details: string | null; updatedAt: string;
}
export interface PeopleContext { reporterIsAffected: boolean; anonymous: boolean; affectedNote: string | null; affected: PersonRecord[]; reported: PersonRecord[] }

const NP = 'Not provided';
export const SOURCE_LABEL = { reporter: "From the resident's report", official: 'Added or verified by an official' } as const;
const SOURCE_COLOR = { reporter: '#0f766e', official: '#4f46e5' } as const;

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.4, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', minWidth: 150 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.85rem', color: value ? '#0c1e46' : '#94a3b8', fontWeight: value ? 600 : 400, flex: 1, minWidth: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {value ?? NP}
      </Typography>
    </Box>
  );
}

function Record({ r, role, reporterIsAffected }: { r: PersonRecord; role: 'AFFECTED' | 'REPORTED'; reporterIsAffected: boolean }) {
  const selfAffected = role === 'AFFECTED' && reporterIsAffected && r.source === 'reporter';
  return (
    <Box data-person-source={r.source} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, bgcolor: '#fff' }}>
      <Chip size="small" label={SOURCE_LABEL[r.source]}
        sx={{ height: 22, fontSize: '0.72rem', fontWeight: 700, mb: 0.75, bgcolor: `${SOURCE_COLOR[r.source]}14`, color: SOURCE_COLOR[r.source], border: `1px solid ${SOURCE_COLOR[r.source]}33` }} />
      <Field label="Full name" value={selfAffected ? 'The reporter (reported about themselves)' : r.fullName} />
      {!selfAffected && <Field label="Age" value={r.age !== null ? String(r.age) : null} />}
      {!selfAffected && <Field label="Address" value={r.address} />}
      {role === 'AFFECTED' && !selfAffected && <Field label="Contact number" value={r.contactNumber} />}
      {!selfAffected && <Field label={role === 'AFFECTED' ? 'Relationship to the reporter' : 'Relationship to the person affected'} value={r.relationship} />}
      {role === 'AFFECTED' && <Field label="Children or dependents affected" value={r.dependentsAffected ? (r.dependentsAffected === 'unknown' ? 'Not sure' : ANSWER_LABEL[r.dependentsAffected as keyof typeof ANSWER_LABEL] ?? r.dependentsAffected) : null} />}
      {!selfAffected && <Field label="Anything else" value={r.details} />}
    </Box>
  );
}

export default function IntakePeopleInvolved({ people }: { people: PeopleContext }) {
  const affectedNote = people.affectedNote;
  const blocks: { role: 'AFFECTED' | 'REPORTED'; title: string; records: PersonRecord[]; none: string }[] = [
    { role: 'AFFECTED', title: 'Person affected', records: people.affected,
      none: people.anonymous ? 'Not provided (anonymous report).' : people.reporterIsAffected ? 'The reporter - they reported this about themselves.' : 'Not provided on the report.' },
    { role: 'REPORTED', title: 'Person reported', records: people.reported, none: 'Not provided on the report.' },
  ];
  return (
    <Grid container spacing={2} data-testid="intake-people">
      {blocks.map(b => (
        <Grid key={b.role} size={{ xs: 12, md: 6 }} data-person-role={b.role}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: '#0c1e46', mb: 0.75 }}>{b.title}</Typography>
          {b.role === 'AFFECTED' && affectedNote && !people.reporterIsAffected && (
            <Typography sx={{ fontSize: '0.8rem', color: '#475569', mb: 0.75 }}>The reporter&rsquo;s note: {affectedNote}</Typography>
          )}
          {b.records.length === 0
            ? <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>{b.none}</Typography>
            : <Box sx={{ display: 'grid', gap: 1 }}>{b.records.map(r => <Record key={r.source} r={r} role={b.role} reporterIsAffected={people.reporterIsAffected} />)}</Box>}
        </Grid>
      ))}
    </Grid>
  );
}

/**
 * What the report says for a VAWC intake item about the victim-survivor or the
 * person reported - shown beside the item for the official to confirm and
 * enter. An official's record first, else the resident's. Null when nothing.
 */
export function reportHint(key: string, people: PeopleContext): { text: string; source: PersonRecord['source'] } | null {
  const pick = (list: PersonRecord[]) => list.find(r => r.source === 'official') ?? list.find(r => r.source === 'reporter') ?? null;
  const affected = people.reporterIsAffected ? null : pick(people.affected);
  const reported = pick(people.reported);
  const from = (r: PersonRecord | null, v: string | number | null | undefined) => (r && v !== null && v !== undefined && v !== '' ? { text: String(v), source: r.source } : null);
  switch (key) {
    case 'victimName': return from(affected, affected?.fullName);
    case 'currentAddress': return from(affected, affected?.address);
    case 'victimContact': return from(affected, affected?.contactNumber);
    case 'perpName': return from(reported, reported?.fullName);
    case 'perpAddress': return from(reported, reported?.address);
    case 'perpRelationship': return from(reported, reported?.relationship);
    default: return null;
  }
}
