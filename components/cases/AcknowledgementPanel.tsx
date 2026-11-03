'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, TextField, MenuItem, CircularProgress } from '@mui/material';
import { MarkEmailRead, Download } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { ISSUE_METHODS, type IssueMethod } from '@/lib/analytics';

/**
 * The case's acknowledgement letter: generate it, download it, record that it
 * was given to the reporter. It confirms receipt only.
 */

interface Letter {
  letterNumber: string; status: 'GENERATED' | 'ISSUED'; recipient: string; generatedAt: string; generatedBy: string | null;
  issuedAt: string | null; issuedBy: string | null; issueMethod: IssueMethod | null;
}
interface Data { letter: Letter | null; canEdit: boolean }

const NAVY = '#0c1e46';
const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Could not load the letter');
  return body.data as Data;
};
const when = (d: string) => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AcknowledgementPanel({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Data>(`/api/cases/${caseId}/acknowledgement`, fetcher);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<IssueMethod | ''>('');

  const call = async (method: 'POST' | 'PATCH', body?: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/acknowledgement`, {
        method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      toast.success(method === 'POST' ? 'Acknowledgement letter generated' : 'Marked as issued');
      await mutate();
      onChanged?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };

  const l = data?.letter ?? null;
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <MarkEmailRead sx={{ fontSize: 17, color: '#0f766e' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: NAVY }}>Acknowledgement letter</Typography>
          {l && <Chip size="small" label={l.status === 'ISSUED' ? 'Issued' : 'Pending'}
            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: l.status === 'ISSUED' ? '#f0fdf4' : '#fffbeb', color: l.status === 'ISSUED' ? '#15803d' : '#a16207' }} />}
        </Box>
        {isLoading && <Skeleton height={50} />}
        {error && <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>{error.message}</Alert>}
        {data && !l && (
          <>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mb: 1 }}>
              Confirms to the reporter that the barangay received the report, with its reference number. It is not a finding.
            </Typography>
            {data.canEdit && (
              <Button size="small" variant="outlined" onClick={() => void call('POST')} disabled={busy} sx={{ textTransform: 'none' }}>
                {busy ? <CircularProgress size={14} /> : 'Generate letter'}
              </Button>
            )}
          </>
        )}
        {l && (
          <>
            <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}><b>{l.letterNumber}</b> · to {l.recipient}</Typography>
            <Typography sx={{ fontSize: '0.76rem', color: '#64748b' }}>Generated {when(l.generatedAt)}{l.generatedBy ? ` by ${l.generatedBy}` : ''}</Typography>
            {l.status === 'ISSUED' && l.issuedAt && (
              <Typography sx={{ fontSize: '0.76rem', color: '#15803d' }}>
                Issued {when(l.issuedAt)}{l.issuedBy ? ` by ${l.issuedBy}` : ''}{l.issueMethod ? ` - ${ISSUE_METHODS[l.issueMethod].toLowerCase()}` : ''}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mt: 1 }}>
              <Button size="small" variant="outlined" startIcon={<Download sx={{ fontSize: 15 }} />} href={`/api/cases/${caseId}/acknowledgement/pdf`}
                sx={{ textTransform: 'none' }}>Download PDF</Button>
              {data?.canEdit && l.status === 'GENERATED' && (
                <>
                  <TextField select size="small" label="How it was given" value={method} onChange={e => setMethod(e.target.value as IssueMethod)} sx={{ minWidth: 220 }}>
                    {(Object.keys(ISSUE_METHODS) as IssueMethod[]).map(k => <MenuItem key={k} value={k}>{ISSUE_METHODS[k]}</MenuItem>)}
                  </TextField>
                  <Button size="small" variant="contained" disabled={!method || busy} onClick={() => void call('PATCH', { issueMethod: method })}
                    sx={{ textTransform: 'none', bgcolor: '#0f766e', '&:hover': { bgcolor: '#115e59' } }}>Mark as issued</Button>
                </>
              )}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
