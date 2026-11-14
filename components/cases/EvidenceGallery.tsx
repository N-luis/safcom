'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton, Chip, Skeleton, Alert, useMediaQuery,
} from '@mui/material';
import { PhotoLibrary, ChevronLeft, ChevronRight, Close, OpenInNew, Download, BrokenImage } from '@mui/icons-material';
import { evidenceUrl, type EvidenceItem } from '@/lib/evidence';
import { formatBytes } from '@/lib/attachments';

const NAVY = '#0c1e46';
const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'The evidence could not be loaded');
  return (body.data?.items ?? []) as EvidenceItem[];
};

/**
 * Evidence Attachments - the photos stored with a case, each loaded from the
 * stored file through /api/attachments/[id] (which checks the viewer every
 * time). Thumbnails, filename, upload date; a click opens it full size, with
 * Open original and Download.
 *
 * `staff` lists the case for officials (/api/cases/[id]/evidence); `resident`
 * lists the resident's own report (/api/resident/cases/[id]/evidence).
 */
export default function EvidenceGallery({ caseId, audience, compact = false, title = 'Evidence Attachments', bare = false }: {
  caseId: string; audience: 'staff' | 'resident'; compact?: boolean; title?: string;
  /** Without its own card - for a drawer or a dialog that already has one. */
  bare?: boolean;
}) {
  const url = audience === 'staff' ? `/api/cases/${caseId}/evidence` : `/api/resident/cases/${caseId}/evidence`;
  const { data: items, error, isLoading, mutate } = useSWR<EvidenceItem[]>(url, fetcher, { revalidateOnFocus: false });
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const body = (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <PhotoLibrary sx={{ fontSize: 19, color: '#0369a1' }} />
        <Typography component="h2" sx={{ fontWeight: 800, color: NAVY, fontSize: compact ? '0.9rem' : '1rem' }}>
          {title}{items ? ` (${items.length})` : ''}
        </Typography>
      </Box>
      {error ? (
        <Alert severity="warning" sx={{ borderRadius: 2, fontSize: '0.82rem' }}
          action={<Button size="small" onClick={() => mutate()} sx={{ textTransform: 'none' }}>Try again</Button>}>
          {error.message}
        </Alert>
      ) : isLoading || !items ? (
        <Box sx={{ display: 'flex', gap: 1 }}>{[0, 1, 2].map(i => <Skeleton key={i} variant="rounded" width={compact ? 88 : 120} height={compact ? 88 : 120} />)}</Box>
      ) : items.length === 0 ? (
        <Typography sx={{ fontSize: '0.84rem', color: '#94a3b8' }}>
          {audience === 'resident' ? 'You did not attach photos to this report.' : 'No photos were attached to this report.'}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 96 : 132}px, 1fr))`, gap: 1.25 }}>
          {items.map((a, i) => (
            <Box key={a.id} sx={{ minWidth: 0 }}>
              <Box component="button" type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${items.length}: ${a.filename}`}
                sx={{ p: 0, border: '1px solid #e2e8f0', borderRadius: 2, overflow: 'hidden', cursor: 'zoom-in', width: '100%', aspectRatio: '1 / 1', display: 'block',
                  bgcolor: '#f1f5f9', '&:hover': { borderColor: '#0369a1' }, '&:focus-visible': { outline: '2px solid #0369a1', outlineOffset: 2 } }}>
                {broken[a.id] ? (
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 0.5, px: 1 }}>
                    <BrokenImage />
                    <Typography sx={{ fontSize: '0.72rem' }}>Could not load</Typography>
                  </Box>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={evidenceUrl(a.id)} alt={`Photo ${i + 1}: ${a.filename}`} loading="lazy"
                    onError={() => setBroken(b => ({ ...b, [a.id]: true }))}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
              </Box>
              <Typography title={a.filename} sx={{ fontSize: '0.76rem', fontWeight: 600, color: '#334155', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.filename}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: '#64748b' }}>{when(a.createdAt)}</Typography>
              {a.source === 'follow_up' && <Chip size="small" label="With a follow-up" sx={{ height: 18, fontSize: '0.66rem', mt: 0.25 }} />}
            </Box>
          ))}
        </Box>
      )}
      {items && open !== null && items[open] && (
        <Preview items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} staff={audience === 'staff'} />
      )}
    </Box>
  );
  if (bare) return body;
  return <Card id="evidence-attachments" sx={{ borderRadius: 3 }}><CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>{body}</CardContent></Card>;
}

function Preview({ items, index, onIndex, onClose, staff }: {
  items: EvidenceItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; staff: boolean;
}) {
  const phone = useMediaQuery('(max-width:600px)');
  const a = items[index];
  const [failed, setFailed] = useState(false);
  const go = (d: number) => { setFailed(false); onIndex((index + d + items.length) % items.length); };
  // Left and right arrows step through the photos.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (items.length < 2) return;
      if (e.key === 'ArrowRight') { setFailed(false); onIndex((index + 1) % items.length); }
      if (e.key === 'ArrowLeft') { setFailed(false); onIndex((index - 1 + items.length) % items.length); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, items.length, onIndex]);
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth fullScreen={phone} aria-label={`Photo ${index + 1} of ${items.length}`}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '1rem', overflowWrap: 'anywhere' }}>{a.filename}</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#64748b' }}>
            Photo {index + 1} of {items.length} · Uploaded {when(a.createdAt)} · {formatBytes(a.size)}{staff ? ` · ${a.uploadedBy}` : ''}
            {a.source === 'follow_up' ? ' · with a follow-up' : ''}
          </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ position: 'relative', bgcolor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: { xs: 300, sm: 420 }, p: 1 }}>
        {failed ? (
          <Box sx={{ color: '#cbd5e1', textAlign: 'center' }}><BrokenImage sx={{ fontSize: 40 }} /><Typography>This photo could not be loaded. Try Open original.</Typography></Box>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={evidenceUrl(a.id)} alt={`Photo ${index + 1}: ${a.filename}`} onError={() => setFailed(true)}
            style={{ maxWidth: '100%', maxHeight: phone ? 'calc(100vh - 220px)' : '72vh', objectFit: 'contain', display: 'block' }} />
        )}
        {items.length > 1 && (
          <>
            <IconButton aria-label="Previous photo" onClick={() => go(-1)} sx={{ position: 'absolute', left: 8, bgcolor: 'rgba(255,255,255,0.85)', '&:hover': { bgcolor: '#fff' } }}><ChevronLeft /></IconButton>
            <IconButton aria-label="Next photo" onClick={() => go(1)} sx={{ position: 'absolute', right: 8, bgcolor: 'rgba(255,255,255,0.85)', '&:hover': { bgcolor: '#fff' } }}><ChevronRight /></IconButton>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.25, gap: 1, flexWrap: 'wrap' }}>
        <Button component="a" href={evidenceUrl(a.id)} target="_blank" rel="noopener noreferrer" startIcon={<OpenInNew />} sx={{ textTransform: 'none' }}>Open original</Button>
        <Button component="a" href={evidenceUrl(a.id, true)} download={a.filename} variant="contained" startIcon={<Download />} sx={{ textTransform: 'none', bgcolor: NAVY }}>Download</Button>
      </DialogActions>
    </Dialog>
  );
}
