'use client';

import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, RadioGroup, FormControlLabel, Radio, TextField, MenuItem, Box, Alert, Typography, CircularProgress, useMediaQuery,
} from '@mui/material';
import { FileDownload } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { MONTH_NAMES, parseExportPeriod, type ExportMode } from '@/lib/caseExport';

const NAVY = '#0c1e46';

/**
 * Export CSV - the cases whose incident date falls on a day, in a month, or in
 * a range. The server decides which cases this official may export and checks
 * every row; this dialog only says which period.
 */
export default function CaseExportDialog({ onClose }: { onClose: () => void }) {
  const phone = useMediaQuery('(max-width:600px)');
  // Today in the Philippines, read once.
  const [today] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  const thisYear = Number(today.slice(0, 4)), thisMonth = Number(today.slice(5, 7));
  const [mode, setMode] = useState<ExportMode>('date');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(thisMonth);
  const [year, setYear] = useState(thisYear);
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const query = { mode, date, month: String(month), year: String(year), start, end };
  const period = parseExportPeriod(query);
  const invalid = 'error' in period ? period.error : null;

  const exportNow = async () => {
    if ('error' in period) { setProblem(period.error); return; }
    setBusy(true); setProblem('');
    try {
      const params = new URLSearchParams(mode === 'date' ? { mode, date } : mode === 'month' ? { mode, month: String(month), year: String(year) } : { mode, start, end });
      const res = await fetch(`/api/cases/export?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; undated?: number | null };
        const undated = body.undated ? ` ${body.undated} case${body.undated === 1 ? ' has' : 's have'} no incident date recorded, so ${body.undated === 1 ? 'it is' : 'they are'} not in any period.` : '';
        setProblem(`${body.error ?? `The export could not be made (error ${res.status}).`}${res.status === 404 ? `.${undated}` : ''}`);
        return;
      }
      const count = Number(res.headers.get('X-Export-Count') ?? 0);
      const restricted = Number(res.headers.get('X-Export-Restricted') ?? 0);
      // The file goes straight to the official's device; nothing is kept in the browser or on a server.
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = period.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Exported ${count} case${count === 1 ? '' : 's'} - ${period.filename}${restricted ? ` (${restricted} with respondents marked restricted)` : ''}`);
      onClose();
    } catch {
      setProblem('The export could not be made - check the connection and try again.');
    } finally { setBusy(false); }
  };

  const years = Array.from({ length: thisYear - 2019 }, (_, i) => thisYear - i);
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" fullScreen={phone}>
      <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>
        Export cases to CSV
        <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>By the date the incident happened. Cases with no incident date recorded are not included.</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
        <RadioGroup value={mode} onChange={e => { setMode(e.target.value as ExportMode); setProblem(''); }} aria-label="Export period">
          <FormControlLabel value="date" control={<Radio size="small" />} label="Specific date" />
          <FormControlLabel value="month" control={<Radio size="small" />} label="Month" />
          <FormControlLabel value="range" control={<Radio size="small" />} label="Custom date range" />
        </RadioGroup>
        {mode === 'date' && (
          <TextField size="small" type="date" label="Incident date" value={date} onChange={e => { setDate(e.target.value); setProblem(''); }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }} />
        )}
        {mode === 'month' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            <TextField select size="small" label="Month" value={month} onChange={e => { setMonth(Number(e.target.value)); setProblem(''); }}>
              {MONTH_NAMES.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Year" value={year} onChange={e => { setYear(Number(e.target.value)); setProblem(''); }}>
              {years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </TextField>
          </Box>
        )}
        {mode === 'range' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
            <TextField size="small" type="date" label="Start date" value={start} onChange={e => { setStart(e.target.value); setProblem(''); }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }} />
            <TextField size="small" type="date" label="End date" value={end} onChange={e => { setEnd(e.target.value); setProblem(''); }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }} />
          </Box>
        )}
        {!('error' in period) && <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>File: {period.filename}</Typography>}
        {(problem || (invalid && mode === 'range' && start && end)) && (
          <Alert role="alert" severity={problem.startsWith('No cases found') ? 'info' : 'warning'} sx={{ borderRadius: 2, fontSize: '0.84rem' }}>{problem || invalid}</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={exportNow} disabled={busy || Boolean(invalid)} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <FileDownload />}
          sx={{ textTransform: 'none', bgcolor: NAVY }}>Export CSV</Button>
      </DialogActions>
    </Dialog>
  );
}
