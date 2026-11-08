'use client';

import { useState } from 'react';
import { Box, TextField, MenuItem, Checkbox, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import {
  optionText, readSingle, readMulti, readYesNo, readAge, writeChoice, allOptions, type InterviewField, type Picked,
} from '@/lib/interviewAnswers';
import { toTimeInput, fromTimeInput } from '@/lib/incidentTime';

/**
 * The answer to one interview question, in the shape its form item is
 * answered: a date, a time, an age, the form's own options, Yes/No with what
 * was specified - or free text when it fills no field. Emits one line of text
 * (see lib/interviewAnswers.ts).
 */
export default function InterviewAnswerField({ field, value, onChange, error, today }: {
  field: InterviewField | null; value: string; onChange: (v: string) => void; error: string | null; today: string;
}) {
  const label = 'Answer';
  const help = error ?? undefined;
  if (!field) {
    return <TextField size="small" fullWidth multiline minRows={2} label="The resident's answer, or your authorized note" value={value}
      onChange={e => onChange(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />;
  }
  const i = field.input;
  switch (i.kind) {
    case 'text':
      return <TextField size="small" fullWidth multiline={i.multiline} minRows={i.multiline ? 2 : undefined} label={label} value={value}
        onChange={e => onChange(e.target.value)} error={Boolean(error)} helperText={help ?? i.hint} slotProps={{ htmlInput: { maxLength: 2000 } }} />;
    case 'date':
      return <TextField size="small" type="date" label={label} value={value} onChange={e => onChange(e.target.value)} error={Boolean(error)}
        helperText={help ?? 'Only a date the resident gives. Not sure of it? Choose "None - added as information" and write what they said.'}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }} sx={{ maxWidth: { sm: 260 } }} />;
    case 'time':
      return <TextField size="small" type="time" label={label} value={toTimeInput(value)} onChange={e => onChange(fromTimeInput(e.target.value) ?? '')} error={Boolean(error)}
        helperText={help ?? 'Only a time the resident gives. Not sure of it? Choose "None - added as information" and write what they said.'}
        slotProps={{ inputLabel: { shrink: true } }} sx={{ maxWidth: { sm: 260 } }} />;
    case 'age':
      return <AgeAnswer value={value} onChange={onChange} error={error} />;
    case 'single': {
      const p = readSingle(i, value);
      return (
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <TextField select size="small" label={label} value={p ? p.option.value : ''} error={Boolean(error) && !p} helperText={!p ? help : undefined}
            onChange={e => { const o = i.options.find(x => x.value === e.target.value); onChange(o ? writeChoice({ option: o, specify: '' }) : ''); }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value=""><em>Not answered</em></MenuItem>
            {i.options.map(o => <MenuItem key={o.value} value={o.value}>{optionText(o)}</MenuItem>)}
          </TextField>
          {p?.option.specify && (
            <TextField size="small" label={p.option.specifyLabel ?? `Specify (${optionText(p.option)})`} value={p.specify} required={p.option.specify === 'required'}
              onChange={e => onChange(writeChoice({ option: p.option, specify: e.target.value }))} error={Boolean(error)} helperText={help}
              slotProps={{ htmlInput: { maxLength: 200 } }} />
          )}
        </Box>
      );
    }
    case 'multi': {
      const picked = readMulti(i, value);
      const all = allOptions(i);
      const write = (next: Picked[]) => onChange(all.flatMap(o => next.filter(p => p.option.value === o.value)).map(writeChoice).join('; '));
      const toggle = (o: typeof all[number], on: boolean) => write(on ? [...picked, { option: o, specify: '' }] : picked.filter(p => p.option.value !== o.value));
      return (
        <Box sx={{ border: '1px solid', borderColor: error ? '#d32f2f' : '#e2e8f0', borderRadius: 1.5, px: 1.25, py: 0.75 }}>
          <Typography sx={{ fontSize: '0.74rem', color: '#64748b', mb: 0.25 }}>{label} - choose all that apply</Typography>
          {i.groups.map(g => (
            <Box key={g.title} sx={{ mb: 0.5 }}>
              {g.title && <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', mt: 0.5 }}>{g.title}</Typography>}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 1 }}>
                {g.options.map(o => {
                  const p = picked.find(x => x.option.value === o.value);
                  return (
                    <Box key={o.value} sx={{ gridColumn: p && o.specify ? '1 / -1' : undefined }}>
                      <FormControlLabel sx={{ mr: 0 }} control={<Checkbox size="small" checked={Boolean(p)} onChange={e => toggle(o, e.target.checked)} />}
                        label={<Typography sx={{ fontSize: '0.82rem' }}>{optionText(o)}</Typography>} />
                      {p && o.specify && (
                        <TextField size="small" fullWidth label={`Specify (${optionText(o)})`} value={p.specify} required={o.specify === 'required'} sx={{ mb: 0.5 }}
                          onChange={e => write(picked.map(x => (x.option.value === o.value ? { ...x, specify: e.target.value } : x)))} slotProps={{ htmlInput: { maxLength: 200 } }} />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
          {error && <Typography sx={{ fontSize: '0.75rem', color: '#d32f2f' }}>{error}</Typography>}
        </Box>
      );
    }
    case 'yesno': {
      const y = readYesNo(value);
      return (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <RadioGroup row value={y.yes === null ? '' : y.yes ? 'yes' : 'no'} onChange={e => onChange(e.target.value === 'yes' ? `Yes - ${y.specify}` : 'No')}>
            <FormControlLabel value="yes" control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.85rem' }}>Yes</Typography>} />
            <FormControlLabel value="no" control={<Radio size="small" />} label={<Typography sx={{ fontSize: '0.85rem' }}>No</Typography>} />
          </RadioGroup>
          {y.yes && (
            <TextField size="small" label={i.yesLabel} value={y.specify} required onChange={e => onChange(`Yes - ${e.target.value}`)}
              error={Boolean(error)} helperText={help} slotProps={{ htmlInput: { maxLength: 200 } }} />
          )}
        </Box>
      );
    }
  }
}

function AgeAnswer({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  const start = readAge(value);
  const [about, setAbout] = useState(start.about);
  const write = (n: string, a: boolean) => onChange(n ? (a ? `about ${n}` : n) : '');
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField size="small" type="number" label="Answer - age" value={start.n} error={Boolean(error)} helperText={error ?? undefined}
        onChange={e => write(e.target.value.replace(/\D/g, '').slice(0, 3), about)} slotProps={{ htmlInput: { min: 0, max: 120, inputMode: 'numeric' } }} sx={{ width: 160 }} />
      <FormControlLabel control={<Checkbox size="small" checked={about} onChange={e => { setAbout(e.target.checked); write(start.n, e.target.checked); }} />}
        label={<Typography sx={{ fontSize: '0.82rem' }}>Approximate (&quot;about&quot;)</Typography>} />
    </Box>
  );
}
