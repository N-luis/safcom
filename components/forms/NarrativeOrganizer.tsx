'use client';

import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import { AutoFixHigh, Check, Edit, Undo } from '@mui/icons-material';
import type { GuideLang } from '@/lib/reportGuide';

/**
 * "Help me organize my description": the resident's words, organized by the
 * AI from what they wrote only (checked on the server: no new name, place,
 * number or accusation). Shown beside the original; the resident uses it,
 * edits it, or keeps their own. Nothing replaces the description by itself,
 * and when the organized version is used the original goes with the report.
 */
export interface Organized { organized: string; confirmed: string[]; uncertain: string[]; missing: string[] }

export default function NarrativeOrganizer({ lang, description, using, onOffered, onUse, onKeep, onUndo }: {
  lang: GuideLang;
  description: string;
  /** The organized version in use, if any (with the resident's own words). */
  using: { original: string; mode: 'ACCEPTED' | 'EDITED' } | null;
  onOffered: (offered: boolean) => void;
  onUse: (text: string, mode: 'ACCEPTED' | 'EDITED', original: string) => void;
  onKeep: () => void;
  onUndo: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ original: string; o: Organized } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const tl = lang === 'tl';
  const enough = description.trim().split(/\s+/).filter(Boolean).length >= 8;

  const run = async () => {
    setBusy(true); setError(''); setResult(null); setEditing(null);
    const original = description;
    try {
      const res = await fetch('/api/resident/report-guide', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'organize', text: original }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) { setError(json.error ?? (tl ? 'Hindi ito maayos ngayon.' : 'It could not be organized right now.')); return; }
      if (!json.data.ok) {
        setError(json.data.reason === 'too_short' ? (tl ? 'Magsulat muna ng kaunti pa.' : 'Write a little more first.')
          : json.data.reason === 'rejected' ? (tl ? 'Hindi ginamit ang mungkahi ng AI dahil may idinagdag ito na hindi mo isinulat. Ang paglalarawan mo ang mananatili.' : 'The AI suggestion was not used because it added something you did not write. Your description stays as it is.')
            : (tl ? 'Hindi available ang AI ngayon. Ang paglalarawan mo ay mananatili at puwede mo pa ring i-submit.' : 'The AI is not available right now. Your description stays as it is, and you can still submit it.'));
        return;
      }
      setResult({ original, o: json.data.result as Organized });
      onOffered(true);
    } catch { setError(tl ? 'Walang koneksyon. Subukan ulit.' : 'Network error. Try again.'); } finally { setBusy(false); }
  };

  if (using) {
    return (
      <Alert severity="success" icon={<AutoFixHigh />} sx={{ mt: 1, borderRadius: 2, fontSize: '0.82rem' }} data-testid="organizer-in-use"
        action={<Button size="small" color="inherit" startIcon={<Undo />} onClick={onUndo} sx={{ textTransform: 'none' }}>{tl ? 'Ibalik ang sa akin' : 'Back to my words'}</Button>}>
        {tl ? 'Ginagamit mo ang inayos na bersyon. Kasama sa report ang sarili mong salita.' : 'You are using the organized version. Your own words go with the report too.'}
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 1, display: 'grid', gap: 1 }}>
      <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <AutoFixHigh />} disabled={!enough || busy} onClick={run} data-testid="organize-button"
        sx={{ justifySelf: 'start', textTransform: 'none', fontWeight: 700, borderColor: '#c4b5fd', color: '#6d28d9' }}>
        {busy ? (tl ? 'Inaayos…' : 'Organizing…') : (tl ? 'Tulungan akong ayusin ang paglalarawan (AI)' : 'Help me organize my description (AI)')}
      </Button>
      {!enough && <Typography sx={{ fontSize: '0.74rem', color: '#94a3b8' }}>{tl ? 'Magagamit kapag may ilang pangungusap na.' : 'Available once you have written a few sentences.'}</Typography>}
      {error && <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{error}</Alert>}
      {result && (
        <Box data-testid="organizer-compare" sx={{ border: '1px solid #ddd6fe', borderRadius: 2, p: 1.25, display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.25 }}>
            <Box>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#475569' }}>A. {tl ? 'Ang orihinal mong paglalarawan' : 'Your original description'}</Typography>
              <Box data-testid="organizer-original" sx={{ bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 1.5, p: 1, fontSize: '0.84rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.original}</Box>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#6d28d9' }}>B. {tl ? 'Inayos ng AI' : 'AI-organized description'}</Typography>
              {editing === null
                ? <Box data-testid="organizer-suggestion" sx={{ bgcolor: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 1.5, p: 1, fontSize: '0.84rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.o.organized}</Box>
                : <TextField value={editing} onChange={e => setEditing(e.target.value)} multiline minRows={5} fullWidth size="small" slotProps={{ htmlInput: { 'aria-label': tl ? 'I-edit ang inayos na bersyon' : 'Edit the organized version', maxLength: 6000 } }} />}
            </Box>
          </Box>
          {result.o.uncertain.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#92400e' }}><b>{tl ? 'Hindi sigurado:' : 'Not certain:'}</b> {result.o.uncertain.join('; ')}</Typography>}
          {result.o.missing.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}><b>{tl ? 'Puwede mong idagdag (opsyonal):' : 'You might add (optional):'}</b> {result.o.missing.join('; ')}</Typography>}
          <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tl ? 'Mula lamang sa isinulat mo. Suriin bago gamitin.' : 'Made only from what you wrote. Check it before using it.'}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {editing === null ? (
              <>
                <Button size="small" variant="contained" startIcon={<Check />} onClick={() => { onUse(result.o.organized, 'ACCEPTED', result.original); setResult(null); }} data-testid="organizer-accept"
                  sx={{ textTransform: 'none', bgcolor: '#6d28d9', '&:hover': { bgcolor: '#5b21b6' } }}>{tl ? 'Gamitin ito' : 'Use this version'}</Button>
                <Button size="small" variant="outlined" startIcon={<Edit />} onClick={() => setEditing(result.o.organized)} data-testid="organizer-edit" sx={{ textTransform: 'none' }}>{tl ? 'I-edit' : 'Edit'}</Button>
              </>
            ) : (
              <Button size="small" variant="contained" startIcon={<Check />} disabled={!editing.trim()} data-testid="organizer-use-edited"
                onClick={() => { onUse(editing.trim(), editing.trim() === result.o.organized ? 'ACCEPTED' : 'EDITED', result.original); setResult(null); setEditing(null); }}
                sx={{ textTransform: 'none', bgcolor: '#6d28d9', '&:hover': { bgcolor: '#5b21b6' } }}>{tl ? 'Gamitin ang na-edit' : 'Use my edited version'}</Button>
            )}
            <Button size="small" onClick={() => { setResult(null); setEditing(null); onKeep(); }} data-testid="organizer-keep" sx={{ textTransform: 'none', color: '#475569' }}>
              {tl ? 'Panatilihin ang sa akin' : 'Keep my original'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
