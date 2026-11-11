'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Box, Card, CardContent, Typography, Button, Chip, CircularProgress, Divider } from '@mui/material';
import { NoteAdd, OpenInNew, PictureAsPdf, Send } from '@mui/icons-material';
import toast from 'react-hot-toast';
import {
  DESTINATIONS, ACK_STATUS, REFERRAL_STATUS, serviceLabel,
  type Destination, type ServiceKey, type AckStatus, type ReferralStatus, type ServiceReferralForm,
} from '@/lib/serviceReferralForm';

/**
 * The case's Service Referral Forms and the button that starts one.
 *
 * Create sends one request key per button (kept for as long as the button is
 * on screen), so a double click - or a click repeated after a slow network -
 * gets the same draft back instead of a second one.
 */

interface Row {
  id: string; reference: string; status: ReferralStatus; destination: Destination | null; services: ServiceKey[]; form: ServiceReferralForm;
  receivingOrganization: string | null; createdAt: string; createdBy: string | null; issuedAt: string | null; issuedBy: string | null;
  documentSha256: string | null; cancelled: { at: string; reason: string | null } | null;
  ack: { status: AckStatus | null; dateReceived: string | null; recordedAt: string | null; recordedBy: string | null };
}
interface Data { referrals: Row[]; access: { edit: boolean; message: string | null } }

const day = (d: string) => new Date(d).toLocaleDateString('en-PH', { dateStyle: 'medium' });
const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

export function useCreateServiceReferral(caseId: string, basePath: string) {
  const router = useRouter();
  const requestKey = useRef<string>('');
  const [creating, setCreating] = useState(false);
  const create = async () => {
    if (creating) return;
    if (!requestKey.current) requestKey.current = key();
    setCreating(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/service-referrals`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: requestKey.current }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? 'The referral could not be started'); return; }
      if (json.data.created) toast.success(`Service referral ${json.data.reference} started as a draft`);
      router.push(`${basePath}/${caseId}/referrals/${json.data.id}`);
      // A later click (after coming back) starts a new referral.
      requestKey.current = '';
    } finally {
      setCreating(false);
    }
  };
  return { create, creating };
}

/** The header action on a VAWC case. */
export function CreateServiceReferralButton({ caseId, basePath }: { caseId: string; basePath: string }) {
  const { create, creating } = useCreateServiceReferral(caseId, basePath);
  return (
    <Button variant="outlined" onClick={() => void create()} disabled={creating}
      startIcon={creating ? <CircularProgress size={15} /> : <NoteAdd sx={{ fontSize: 17 }} />}
      sx={{ borderRadius: 2, fontWeight: 800, fontSize: '0.86rem', borderColor: '#c4b5fd', color: '#6d28d9' }}>
      Create Service Referral
    </Button>
  );
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Could not load'), { status: res.status });
  return json.data as Data;
};

export default function ServiceReferralHistory({ caseId, basePath }: { caseId: string; basePath: string }) {
  const { data, error, isLoading } = useSWR<Data>(`/api/cases/${caseId}/service-referrals`, fetcher);
  const { create, creating } = useCreateServiceReferral(caseId, basePath);
  // Not this official's to see (or not a VAWC case): nothing is shown.
  if ((error as { status?: number } | undefined)?.status && [403, 404, 422].includes((error as { status: number }).status)) return null;
  const open = (id: string) => `${basePath}/${caseId}/referrals/${id}`;

  return (
    <Card sx={{ mb: 2 }} id="service-referrals">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>Referral History - Service Referral Forms</Typography>
          {data?.access.edit && (
            <Button size="small" startIcon={creating ? <CircularProgress size={13} /> : <NoteAdd sx={{ fontSize: 15 }} />} disabled={creating}
              onClick={() => void create()} sx={{ ml: 'auto', textTransform: 'none' }}>New referral</Button>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.76rem', color: '#64748b', mb: 1 }}>
          One form per receiving organization. Issued means given to them; received means they acknowledged it - neither means the service was provided.
        </Typography>
        {isLoading && <CircularProgress size={18} />}
        {error && !isLoading && <Typography sx={{ fontSize: '0.82rem', color: '#b91c1c' }}>The referrals could not be loaded.</Typography>}
        {data && data.referrals.length === 0 && <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>No service referrals yet.</Typography>}
        {data?.referrals.map((r, i) => (
          <Box key={r.id}>
            {i > 0 && <Divider sx={{ my: 1 }} />}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#0c1e46' }}>{r.reference}</Typography>
              <Chip size="small" label={REFERRAL_STATUS[r.status]} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 800,
                bgcolor: r.status === 'DRAFT' ? '#fef3c7' : r.status === 'ISSUED' ? '#ede9fe' : '#f1f5f9', color: r.status === 'DRAFT' ? '#a16207' : r.status === 'ISSUED' ? '#6d28d9' : '#475569' }} />
              {r.status === 'ISSUED' && r.ack.status && (
                <Chip size="small" label={ACK_STATUS[r.ack.status]} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700,
                  bgcolor: r.ack.status === 'ACKNOWLEDGED' ? '#dcfce7' : r.ack.status === 'RETURNED' ? '#ffedd5' : '#f1f5f9',
                  color: r.ack.status === 'ACKNOWLEDGED' ? '#15803d' : r.ack.status === 'RETURNED' ? '#c2410c' : '#475569' }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.8rem', color: '#334155', mt: 0.25 }}>
              {r.destination ? DESTINATIONS[r.destination].short : 'Destination not chosen yet'}
              {r.receivingOrganization ? ` · ${r.receivingOrganization}` : ''}
            </Typography>
            {r.services.length > 0 && <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>Services requested: {r.services.map(k => serviceLabel(k, r.form)).join('; ')}</Typography>}
            <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>
              Created {day(r.createdAt)}{r.createdBy ? ` by ${r.createdBy}` : ''}
              {r.issuedAt ? ` · issued ${day(r.issuedAt)}${r.issuedBy ? ` by ${r.issuedBy}` : ''}` : ''}
              {r.ack.recordedAt ? ` · acknowledgement recorded ${day(r.ack.recordedAt)}` : ''}
              {r.cancelled ? ` · cancelled ${day(r.cancelled.at)}` : ''}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
              <Button size="small" href={open(r.id)} startIcon={r.status === 'DRAFT' && data.access.edit ? <Send sx={{ fontSize: 15 }} /> : <OpenInNew sx={{ fontSize: 15 }} />} sx={{ textTransform: 'none', minHeight: 30 }}>
                {r.status === 'DRAFT' && data.access.edit ? 'Continue draft' : 'Open'}
              </Button>
              <Button size="small" component="a" href={`/api/cases/${caseId}/service-referrals/${r.id}/pdf`} download startIcon={<PictureAsPdf sx={{ fontSize: 15 }} />} sx={{ textTransform: 'none', minHeight: 30 }}>
                {r.status === 'ISSUED' ? 'Issued PDF' : r.status === 'DRAFT' ? 'Draft PDF' : 'PDF'}
              </Button>
            </Box>
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
