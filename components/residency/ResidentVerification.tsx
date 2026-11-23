'use client';

import { useState } from 'react';
import dynamicImport from 'next/dynamic';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Tabs, Tab, Chip, Button, Alert, Skeleton, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress, IconButton, Divider, InputAdornment,
} from '@mui/material';
import { HowToReg, Close, Search, Warning, Map as MapIcon } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { RESIDENCY_STATUSES, LOCATION_FLAGS, type ResidencyStatus, type LocationFlag, type BoundaryGeometry } from '@/lib/jurisdiction';

const NAVY = '#0c1e46';
const ResidenceMapView = dynamicImport(() => import('./ResidenceMapView'), { ssr: false, loading: () => <Skeleton variant="rounded" height={280} /> });

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error ?? 'Could not load'), { status: r.status });
  return b.data as T;
}
async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Could not save');
  return j;
}
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '-');
const STATUS_COLOR: Record<string, string> = { VERIFIED: '#15803d', PENDING_VERIFICATION: '#0369a1', NEEDS_INFO: '#b45309', REJECTED: '#b91c1c', INCOMPLETE: '#64748b' };
const chip = (c: string) => ({ height: 22, fontSize: '0.72rem', fontWeight: 700, bgcolor: `${c}14`, color: c, border: `1px solid ${c}33` });

interface Row { id: string; residentNumber: string; name: string; submittedAt: string | null; registeredAt: string; status: string; statusLabel: string; note: string | null;
  email: string | null; contactNumber: string | null; altContactNumber: string | null;
  address: string; addressStatus: string | null; located: boolean; flags: LocationFlag[]; emailVerified: boolean }
interface ListData { counts: Record<ResidencyStatus, number>; total: number; status: string; rows: Row[] }

/**
 * Resident Verification, for the Barangay Captain: the registered residents
 * by residency status, each application with its address, its home location
 * against the official boundary and what the server's check flagged; approve,
 * reject (with a reason) or ask for more information. Also the referral
 * records (reports that could not be standard cases) and the jurisdiction's
 * boundary. Every decision is recorded and logged; nothing here is decided
 * by the AI or by the check alone.
 */
export default function ResidentVerification() {
  const [tab, setTab] = useState<ResidencyStatus | 'REFERRALS' | 'JURISDICTION'>('PENDING_VERIFICATION');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const status = tab === 'REFERRALS' || tab === 'JURISDICTION' ? 'PENDING_VERIFICATION' : tab;
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/residency/applications?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`, getJson, { keepPreviousData: true });
  const forbidden = (error as { status?: number } | undefined)?.status === 403;
  const tiles: [string, number | undefined, string][] = [
    ['Registered residents', data?.total, NAVY], ['Verified', data?.counts.VERIFIED, STATUS_COLOR.VERIFIED],
    ['Pending verification', data?.counts.PENDING_VERIFICATION, STATUS_COLOR.PENDING_VERIFICATION], ['Rejected', data?.counts.REJECTED, STATUS_COLOR.REJECTED],
    ['Requires more information', data?.counts.NEEDS_INFO, STATUS_COLOR.NEEDS_INFO], ['Registration incomplete', data?.counts.INCOMPLETE, STATUS_COLOR.INCOMPLETE],
  ];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#ccfbf1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HowToReg sx={{ color: '#0f766e' }} /></Box>
        <Box>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.3rem', color: NAVY }}>Resident Verification</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Only verified residents of the barangay can file standard reports. Home locations here are for this review only.</Typography>
        </Box>
      </Box>
      {forbidden ? <Alert severity="info" sx={{ borderRadius: 2 }}>{error?.message}</Alert> : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.25 }}>
            {tiles.map(([label, v, c]) => (
              <Card key={label} sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  {isLoading && !data ? <Skeleton width={40} height={34} /> : <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: v ? c : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{v ?? 0}</Typography>}
                  <Typography sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{label}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
          <Card sx={{ borderRadius: 2, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid #e2e8f0', px: 1 }}>
              {(['PENDING_VERIFICATION', 'NEEDS_INFO', 'VERIFIED', 'REJECTED', 'INCOMPLETE'] as ResidencyStatus[]).map(s => (
                <Tab key={s} value={s} sx={{ textTransform: 'none', fontWeight: 600 }} label={`${RESIDENCY_STATUSES[s]}${data ? ` (${data.counts[s]})` : ''}`} />
              ))}
              <Tab value="REFERRALS" label="Referral records" sx={{ textTransform: 'none', fontWeight: 600 }} />
              <Tab value="JURISDICTION" label="Jurisdiction & boundary" sx={{ textTransform: 'none', fontWeight: 600 }} />
            </Tabs>
            <CardContent>
              {tab === 'REFERRALS' ? <Referrals /> : tab === 'JURISDICTION' ? <Jurisdiction /> : (
                <>
                  <TextField size="small" placeholder="Name, resident number or street" value={q} onChange={e => setQ(e.target.value)} sx={{ mb: 1.5, minWidth: { sm: 320 } }}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18 }} /></InputAdornment> } }} />
                  {isLoading && !data && <Skeleton variant="rounded" height={200} />}
                  {data && !data.rows.length && <Typography sx={{ color: '#64748b', py: 4, textAlign: 'center' }}>No one here.</Typography>}
                  {data && data.rows.length > 0 && (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                      <Table size="small" sx={{ minWidth: 1020 }}>
                        <TableHead><TableRow sx={{ '& th': { fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' } }}>
                          <TableCell>Resident</TableCell><TableCell>Contact</TableCell><TableCell>Residential address</TableCell><TableCell>Check</TableCell><TableCell>Registered / submitted</TableCell><TableCell align="right" />
                        </TableRow></TableHead>
                        <TableBody>
                          {data.rows.map(r => (
                            <TableRow key={r.id} hover sx={{ '& td': { fontSize: '0.82rem', verticalAlign: 'top' } }}>
                              <TableCell><b>{r.name}</b><Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{r.residentNumber}</Typography>
                                <Chip size="small" label={r.statusLabel} sx={{ mt: 0.5, height: 20, fontSize: '0.68rem' }} /></TableCell>
                              <TableCell sx={{ wordBreak: 'break-word', maxWidth: 220 }}>{r.email ?? <span style={{ color: '#94a3b8' }}>No email</span>}
                                <Typography sx={{ fontSize: '0.72rem', color: r.emailVerified ? '#15803d' : '#b45309' }}>{r.emailVerified ? 'Email confirmed' : 'Email not confirmed yet'}</Typography>
                                {r.contactNumber && <Typography sx={{ fontSize: '0.78rem' }}>{r.contactNumber}{r.altContactNumber ? ` / ${r.altContactNumber}` : ''}</Typography>}</TableCell>
                              <TableCell>{r.address || <span style={{ color: '#b45309' }}>Not given</span>}
                                <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>{r.located ? 'Home located on the map' : 'No map location (manual verification)'}</Typography></TableCell>
                              <TableCell>
                                {r.addressStatus && <Chip size="small" label={r.addressStatus.replace('_', ' ').toLowerCase()} sx={chip(r.addressStatus === 'INSIDE' ? '#15803d' : r.addressStatus === 'OUTSIDE' ? '#b91c1c' : '#b45309')} />}
                                {r.flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED').map(f => <Typography key={f} sx={{ fontSize: '0.72rem', color: '#b45309' }}>{LOCATION_FLAGS[f]}</Typography>)}
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{when(r.registeredAt)}<Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>Submitted {when(r.submittedAt)}</Typography></TableCell>
                              <TableCell align="right"><Button size="small" variant={r.status === 'PENDING_VERIFICATION' ? 'contained' : 'outlined'} onClick={() => setOpen(r.id)}
                                sx={{ textTransform: 'none', ...(r.status === 'PENDING_VERIFICATION' && { bgcolor: NAVY }) }}>{r.status === 'PENDING_VERIFICATION' ? 'Review' : 'View'}</Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {open && <Review id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void mutate(); }} />}
    </Box>
  );
}

interface Detail {
  resident: { name: string; residentNumber: string; birthDate: string | null; age: number; sex: string; contactNumber: string | null; email: string | null; emailVerified: boolean; registeredAt: string; cases: number };
  residency: { status: string; statusLabel: string; submittedAt: string | null; verifiedAt: string | null; verifiedBy: string | null; note: string | null; canDecide: boolean };
  address: { line: string; province: string | null; municipality: string | null; barangay: string | null; street: string | null; houseNumber: string | null; purok: string | null };
  location: { latitude: number; longitude: number; source: string | null } | null;
  checkNow: { status: string; selection: string; boundary: string; flags: LocationFlag[]; street: { known: boolean; suggestions: string[] } | null; explanation: string };
  jurisdiction: { barangay: string; municipality: string; province: string; boundary: BoundaryGeometry | null; boundarySource: string | null };
  history: { id: string; kind: string; by: string; note: string | null; createdAt: string; toStatus: string | null }[];
}

/** A labelled field in the review. */
function F({ k, v }: { k: string; v: React.ReactNode }) {
  return <Box><Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{k}</Typography><Typography component="div" sx={{ fontSize: '0.86rem', color: NAVY }}>{v || '-'}</Typography></Box>;
}

function Review({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { data, error } = useSWR<Detail>(`/api/residency/applications/${id}`, getJson);
  const [mode, setMode] = useState<null | 'reject' | 'request_info'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try { await send(`/api/residency/applications/${id}`, 'POST', body); toast.success(ok); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 800, color: NAVY, pr: 6 }}>
        {data ? data.resident.name : 'Applicant'} {data && <Chip size="small" label={data.residency.statusLabel} sx={{ ...chip(STATUS_COLOR[data.residency.status] ?? '#64748b'), ml: 1 }} />}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        {error && <Alert severity="error">{error.message}</Alert>}
        {!data && !error && <Skeleton variant="rounded" height={300} />}
        {data && (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
              <F k="Resident no." v={data.resident.residentNumber} />
              <F k="Date of birth / age" v={`${data.resident.birthDate ? new Date(data.resident.birthDate).toLocaleDateString('en-PH', { timeZone: 'UTC', dateStyle: 'medium' }) : 'Not given'} · ${data.resident.age}`} />
              <F k="Sex" v={data.resident.sex} />
              <F k="Contact" v={data.resident.contactNumber} />
              <F k="Email" v={`${data.resident.email ?? '-'}${data.resident.emailVerified ? ' (verified)' : ''}`} />
              <F k="Registered" v={when(data.resident.registeredAt)} />
              <F k="Submitted" v={when(data.residency.submittedAt)} />
              <F k="Cases filed" v={String(data.resident.cases)} />
            </Box>
            <Divider />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <Box sx={{ display: 'grid', gap: 1 }}>
                <F k="Residential address" v={data.address.line} />
                <F k="Province / municipality / barangay" v={[data.address.province, data.address.municipality, data.address.barangay].filter(Boolean).join(' / ')} />
                <F k="Street · house no. · purok" v={[data.address.street, data.address.houseNumber, data.address.purok].filter(Boolean).join(' · ')} />
                <Alert severity={data.checkNow.status === 'OUTSIDE' ? 'error' : data.checkNow.status === 'INSIDE' ? 'success' : 'warning'} sx={{ borderRadius: 2, fontSize: '0.8rem' }}>
                  <b>Check against {data.jurisdiction.barangay}, {data.jurisdiction.municipality}:</b> address {data.checkNow.selection === 'MATCH' ? 'names the barangay' : 'names another place'};
                  {' '}map pin: {data.checkNow.boundary === 'INSIDE' ? 'inside the official boundary' : data.checkNow.boundary === 'OUTSIDE' ? 'outside the official boundary' : data.checkNow.boundary === 'NO_PIN' ? 'none given' : 'not checked (no official boundary configured)'}.
                  {data.checkNow.flags.filter(f => f !== 'BOUNDARY_NOT_CONFIGURED').map(f => <Box key={f}>{LOCATION_FLAGS[f]}</Box>)}
                  {data.checkNow.street && !data.checkNow.street.known && data.checkNow.street.suggestions.length > 0 && <Box>Closest streets on the list: {data.checkNow.street.suggestions.join(', ')}.</Box>}
                </Alert>
                <Typography sx={{ fontSize: '0.74rem', color: '#64748b' }}>A pin, a sign-in or a statement does not prove residence. Check it the way the barangay verifies residents before approving.</Typography>
              </Box>
              <Box>
                {data.location ? <ResidenceMapView location={data.location} boundary={data.jurisdiction.boundary} /> : (
                  <Alert severity="info" icon={<MapIcon />} sx={{ borderRadius: 2 }}>No map location was given - verify the address another way.</Alert>
                )}
                {data.location && <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.5 }}>{data.location.latitude.toFixed(6)}, {data.location.longitude.toFixed(6)} · {data.location.source?.toLowerCase()}</Typography>}
              </Box>
            </Box>
            {data.residency.note && <Alert severity="info" sx={{ borderRadius: 2 }}>Last note to the resident: {data.residency.note}</Alert>}
            <Box>
              <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.9rem', mb: 0.5 }}>History</Typography>
              {data.history.map(h => (
                <Typography key={h.id} sx={{ fontSize: '0.8rem', color: '#475569' }}>{when(h.createdAt)} - {h.kind.replace('_', ' ')} ({h.by}){h.note ? `: ${h.note}` : ''}</Typography>
              ))}
            </Box>
            {mode && (
              <TextField multiline minRows={2} autoFocus label={mode === 'reject' ? 'Reason (the resident sees it) *' : 'What is needed (the resident sees it) *'}
                value={text} onChange={e => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
        {data?.residency.canDecide && !mode && (
          <>
            <Button color="warning" variant="outlined" onClick={() => { setMode('request_info'); setText(''); }} sx={{ textTransform: 'none' }}>Request more information</Button>
            <Button color="error" variant="outlined" onClick={() => { setMode('reject'); setText(''); }} sx={{ textTransform: 'none' }}>Reject</Button>
            <Button variant="contained" disabled={busy} onClick={() => act({ action: 'approve' }, 'Resident verified')} sx={{ textTransform: 'none', bgcolor: '#15803d' }}>
              {busy ? <CircularProgress size={16} color="inherit" /> : 'Approve - verified resident'}
            </Button>
          </>
        )}
        {mode && (
          <>
            <Button onClick={() => setMode(null)} sx={{ textTransform: 'none' }}>Back</Button>
            <Button variant="contained" color={mode === 'reject' ? 'error' : 'warning'} disabled={busy || text.trim().length < 5}
              onClick={() => act(mode === 'reject' ? { action: 'reject', reason: text.trim() } : { action: 'request_info', note: text.trim() }, mode === 'reject' ? 'Application rejected' : 'More information requested')}
              sx={{ textTransform: 'none' }}>{busy ? <CircularProgress size={16} color="inherit" /> : mode === 'reject' ? 'Reject application' : 'Send request'}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

interface RefRow { id: string; kind: string; kindLabel: string; urgent: boolean; status: string; statusLabel: string; province: string | null; municipality: string | null;
  barangay: string | null; street: string | null; locationDetails: string | null; summary: string | null; reportingRelationship: string | null; createdAt: string;
  reviewNote: string | null; resident: { name: string; residentNumber: string; contactNumber: string | null; residencyStatus: string } | null }

function Referrals() {
  const [status, setStatus] = useState('NEW');
  const { data, error, mutate } = useSWR<{ counts: Record<string, number>; rows: RefRow[] }>(`/api/residency/referrals?status=${status}`, getJson);
  const [note, setNote] = useState<Record<string, string>>({});
  const mark = async (id: string, s: 'REVIEWED' | 'CLOSED') => {
    try { await send('/api/residency/referrals', 'PATCH', { id, status: s, note: (note[id] ?? '').trim() }); toast.success('Updated'); void mutate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update'); }
  };
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>Reports that could not be standard SafeComm cases - outside the jurisdiction, from a not-yet-verified account, or urgent. They are not cases. Where the barangay should act, have staff take the report in through the Walk-in Report.</Typography>
      <Tabs value={status} onChange={(_, v) => setStatus(v)} sx={{ minHeight: 36 }}>
        {['NEW', 'REVIEWED', 'CLOSED', 'ALL'].map(s => <Tab key={s} value={s} label={`${s === 'ALL' ? 'All' : s[0] + s.slice(1).toLowerCase()}${data && s !== 'ALL' ? ` (${data.counts[s] ?? 0})` : ''}`} sx={{ textTransform: 'none', minHeight: 36 }} />)}
      </Tabs>
      {error && <Alert severity="info">{error.message}</Alert>}
      {data && !data.rows.length && <Typography sx={{ color: '#64748b', py: 3, textAlign: 'center' }}>No referral records here.</Typography>}
      {data?.rows.map(r => (
        <Box key={r.id} sx={{ border: `1px solid ${r.urgent ? '#fecaca' : '#e2e8f0'}`, bgcolor: r.urgent ? '#fef2f2' : '#fff', borderRadius: 2, p: 1.5, display: 'grid', gap: 0.75 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {r.urgent && <Chip size="small" icon={<Warning sx={{ fontSize: 14 }} />} label="Urgent" sx={chip('#b91c1c')} />}
            <Chip size="small" label={r.kindLabel} sx={chip('#4338ca')} />
            <Chip size="small" label={r.statusLabel} sx={chip('#64748b')} />
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b', ml: 'auto' }}>{when(r.createdAt)}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.84rem', color: NAVY }}><b>Where:</b> {[r.street, r.locationDetails, r.barangay, r.municipality, r.province].filter(Boolean).join(', ') || 'Not given'}</Typography>
          {r.summary && <Typography sx={{ fontSize: '0.84rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{r.summary}</Typography>}
          {r.resident && <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>From {r.resident.name} ({r.resident.residentNumber}){r.resident.contactNumber ? ` · ${r.resident.contactNumber}` : ''} · residency: {RESIDENCY_STATUSES[r.resident.residencyStatus as ResidencyStatus] ?? r.resident.residencyStatus}{r.reportingRelationship && r.reportingRelationship !== 'SELF' ? ` · reporting for someone else` : ''}</Typography>}
          {r.reviewNote && <Typography sx={{ fontSize: '0.8rem', color: '#15803d' }}>Done: {r.reviewNote}</Typography>}
          {r.status !== 'CLOSED' && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" placeholder="What was done (required)" value={note[r.id] ?? ''} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} sx={{ flex: 1, minWidth: 220 }} />
              {r.status === 'NEW' && <Button size="small" variant="outlined" disabled={(note[r.id] ?? '').trim().length < 3} onClick={() => mark(r.id, 'REVIEWED')} sx={{ textTransform: 'none' }}>Mark reviewed</Button>}
              <Button size="small" variant="outlined" disabled={(note[r.id] ?? '').trim().length < 3} onClick={() => mark(r.id, 'CLOSED')} sx={{ textTransform: 'none' }}>Close</Button>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

interface JurData { barangay: string; municipality: string; province: string; barangayAliases: string[]; boundary: BoundaryGeometry | null; boundarySource: string | null;
  boundaryConfigured: boolean; updatedAt: string | null; updatedBy: string | null; canEdit: boolean }

function Jurisdiction() {
  const { data, mutate } = useSWR<JurData>('/api/jurisdiction', getJson);
  const [geo, setGeo] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (clear = false) => {
    let boundary: unknown = null;
    if (!clear) { try { boundary = JSON.parse(geo); } catch { toast.error('That is not valid JSON. Paste a GeoJSON Polygon, MultiPolygon or Feature.'); return; } }
    setBusy(true);
    try {
      const j = await send('/api/jurisdiction', 'PUT', clear ? { boundary: null } : { boundary, boundarySource: source.trim() });
      (j.warnings ?? []).forEach((w: string) => toast(w, { icon: '⚠️' }));
      toast.success(clear ? 'Boundary cleared' : 'Boundary saved'); setGeo(''); void mutate();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  if (!data) return <Skeleton variant="rounded" height={200} />;
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography sx={{ fontSize: '0.9rem', color: NAVY }}><b>Jurisdiction:</b> Barangay {data.barangay}, {data.municipality}, {data.province}{data.barangayAliases.length ? ` (also written ${data.barangayAliases.join(', ')})` : ''}</Typography>
      {data.boundaryConfigured ? (
        <>
          <Alert severity="success" sx={{ borderRadius: 2 }}>Official boundary configured{data.boundarySource ? ` - source: ${data.boundarySource}` : ''}{data.updatedBy ? `, by ${data.updatedBy}` : ''}{data.updatedAt ? ` (${when(data.updatedAt)})` : ''}. Map pins are checked against it.</Alert>
          <ResidenceMapView location={null} boundary={data.boundary} height={320} />
        </>
      ) : (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          No official boundary is configured. SafeComm does not guess one (the public map data for Biñang 1st and 2nd appears to have the two names swapped), so map pins are not
          checked automatically - every application is reviewed by a person. Paste the official boundary from the municipal or provincial office below.
        </Alert>
      )}
      {data.canEdit && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <TextField multiline minRows={4} label="Official boundary (GeoJSON Polygon / MultiPolygon, [longitude, latitude])" value={geo} onChange={e => setGeo(e.target.value)}
            placeholder='{"type":"Polygon","coordinates":[[[120.93,14.79],[120.94,14.79],[120.94,14.80],[120.93,14.79]]]}' />
          <TextField size="small" label="Source (office, survey or document) *" value={source} onChange={e => setSource(e.target.value)} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={busy || !geo.trim() || source.trim().length < 3} onClick={() => save(false)} sx={{ textTransform: 'none', bgcolor: NAVY }}>Save boundary</Button>
            {data.boundaryConfigured && <Button color="error" disabled={busy} onClick={() => save(true)} sx={{ textTransform: 'none' }}>Clear boundary</Button>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
