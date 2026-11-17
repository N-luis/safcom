'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Card, CardContent, Typography, TextField, InputAdornment, Button, Skeleton, Alert, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, Divider, Chip, CircularProgress, useMediaQuery, useTheme,
} from '@mui/material';
import { Search, PeopleAlt, Close, Phone, Lock, PersonSearch } from '@mui/icons-material';
import { displayPhMobile } from '@/lib/phoneNumber';

/**
 * The Resident Directory on the Blotter and VAWC dashboards: registered
 * residents by name (search and pages run on the server, over every
 * resident), and one resident's full profile on request - fetched by their
 * id, logged on the server, with a Call button only when their safe-contact
 * wishes allow it. Nothing about their cases is shown or reachable here.
 */

interface ListData { rows: { id: string; name: string }[]; total: number; page: number; pageSize: number; pages: number }
interface Profile {
  resident: {
    id: string; fullName: string | null; age: number | null; sex: string | null; address: string | null; barangay: string | null;
    phone: string | null; email: string | null; accountStatus: string | null; registeredAt: string; updatedAt: string;
  };
  contact: { callAllowed: boolean; label: string; guidance: string };
  telHref: string | null;
}

const NAVY = '#0c1e46';
const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error ?? 'Could not load');
  return body.data as T;
};
const day = (d: string) => new Date(d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
const initials = (name: string) => name.split(/\s+/).map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase();

export default function ResidentDirectory({ accent = '#1d4ed8' }: { accent?: string }) {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);

  // Search once typing pauses, from the first page.
  useEffect(() => {
    const t = setTimeout(() => { setQ(input.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const key = `/api/officials/residents?${new URLSearchParams({ ...(q && { q }), page: String(page) })}`;
  const { data, error, isLoading, mutate } = useSWR<ListData>(key, (u: string) => getJson<ListData>(u), { keepPreviousData: true, revalidateOnFocus: false });
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ p: 2.5, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <PeopleAlt sx={{ fontSize: 19, color: accent }} />
          <Typography component="h2" sx={{ fontWeight: 700, fontSize: '0.98rem', color: NAVY }}>Resident Directory</Typography>
          {data && <Chip size="small" label={data.total} sx={{ ml: 'auto', height: 22, fontWeight: 700, fontSize: '0.74rem', bgcolor: '#f1f5f9', color: '#475569' }} />}
        </Box>
        <TextField size="small" fullWidth placeholder="Search residents by name" value={input} onChange={e => setInput(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> },
            htmlInput: { 'aria-label': 'Search residents by name', maxLength: 80 } }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: '0.9rem', height: 36 } }} />
      </CardContent>

      <Box sx={{ flex: 1, px: 1.5, minHeight: 200 }}>
        {isLoading && !data && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={44} sx={{ mx: 1 }} />)}
        {error && !data && (
          <Alert severity="error" sx={{ mx: 1, borderRadius: 2, fontSize: '0.84rem' }}
            action={<Button color="inherit" size="small" onClick={() => mutate()}>Retry</Button>}>{(error as Error).message}</Alert>
        )}
        {data && data.rows.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PersonSearch sx={{ fontSize: 32, color: '#cbd5e1' }} />
            <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8', mt: 0.5 }}>{q ? 'No resident matches that name.' : 'No registered residents yet.'}</Typography>
          </Box>
        )}
        {data && data.rows.map(r => (
          <Box key={r.id} data-resident={r.id}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 0.9, borderBottom: '1px solid #f1f5f9', opacity: isLoading ? 0.6 : 1 }}>
            <Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: `${accent}14`, color: accent, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.76rem', fontWeight: 700 }}>{initials(r.name)}</Box>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.9rem', fontWeight: 500, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</Typography>
            <Button size="small" variant="outlined" onClick={() => setOpen(r)}
              sx={{ flexShrink: 0, borderRadius: 1.5, fontSize: '0.8rem', py: 0.25, textTransform: 'none', borderColor: '#e2e8f0', color: '#334155',
                '&:hover': { borderColor: accent, color: accent } }}>
              View Full Details
            </Button>
          </Box>
        ))}
      </Box>

      <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.84rem', color: 'text.secondary' }}>{data ? (data.total ? `${from}–${to} of ${data.total}` : '0 residents') : ' '}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" disabled={!data || page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            sx={{ borderRadius: 1.5, fontSize: '0.84rem', py: 0.25, borderColor: '#e2e8f0', color: '#475569' }}>Previous</Button>
          <Button size="small" variant="outlined" disabled={!data || page >= data.pages} onClick={() => setPage(p => p + 1)}
            sx={{ borderRadius: 1.5, fontSize: '0.84rem', py: 0.25, borderColor: '#e2e8f0', color: '#475569' }}>Next</Button>
        </Box>
      </Box>

      {open && <ResidentProfileDialog id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function ResidentProfileDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  // POST: each view is recorded on the server. Fetched once per opening, never cached or prefetched.
  const { data, error, isLoading } = useSWR<Profile>(['resident-profile', id], () => getJson<Profile>(`/api/officials/residents/${encodeURIComponent(id)}`, { method: 'POST' }),
    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false, dedupingInterval: 0 });
  const r = data?.resident;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={mobile}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800, color: NAVY, pr: 6 }}>
        {r?.fullName ?? name}
        <IconButton onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 10, top: 10 }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 1.75 }}>
        {isLoading && <Box sx={{ display: 'grid', gap: 1 }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={28} />)}</Box>}
        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{(error as Error).message}</Alert>}
        {r && data && (
          <>
            <Section title="Personal">
              <Field k="Full name" v={r.fullName} />
              <Field k="Age" v={r.age !== null ? `${r.age} (as given at registration)` : null} />
              <Field k="Sex" v={r.sex} />
              <Field k="Address" v={r.address} />
              <Field k="Barangay" v={r.barangay} />
            </Section>
            <Divider />
            <Section title="Contact">
              <Field k="Contact number" v={r.phone ? displayPhMobile(r.phone) : null} strong />
              <Field k="E-mail" v={r.email} strong />
              <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: data.contact.callAllowed ? '#f8fafc' : '#fef2f2', border: `1px solid ${data.contact.callAllowed ? '#e2e8f0' : '#fecaca'}` }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: data.contact.callAllowed ? '#334155' : '#b91c1c', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {!data.contact.callAllowed && <Lock sx={{ fontSize: 15 }} />}{data.contact.label}
                </Typography>
                <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>{data.contact.guidance}</Typography>
              </Box>
            </Section>
            <Divider />
            <Section title="Account">
              <Field k="Account status" v={r.accountStatus} />
              <Field k="Registered" v={day(r.registeredAt)} />
              <Field k="Last updated" v={day(r.updatedAt)} />
            </Section>
            <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>This view is recorded in the access log. The resident&rsquo;s reports are opened from Case Management, under each case&rsquo;s own access.</Typography>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
        {data?.telHref && (
          // A link for the official's phone app: nothing is dialled or recorded as a call by SafeComm.
          <Button component="a" href={data.telHref} variant="contained" startIcon={<Phone />}
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#0f766e', '&:hover': { bgcolor: '#115e59' }, minHeight: 40 }}>
            Call Resident
          </Button>
        )}
        {data && !data.telHref && (
          <Button disabled startIcon={isLoading ? <CircularProgress size={14} /> : <Phone />} sx={{ textTransform: 'none' }}>
            {data.resident.phone ? 'Calling not advised' : 'No number on file'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box sx={{ display: 'grid', gap: 0.75 }}>
    <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</Typography>
    {children}
  </Box>
);
const Field = ({ k, v, strong = false }: { k: string; v: string | null; strong?: boolean }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '150px 1fr' }, gap: { xs: 0, sm: 1.5 } }}>
    <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{k}</Typography>
    <Typography sx={{ fontSize: '0.9rem', color: v ? NAVY : '#94a3b8', fontWeight: strong && v ? 700 : 400, wordBreak: 'break-word' }}>{v ?? 'Not on file'}</Typography>
  </Box>
);
