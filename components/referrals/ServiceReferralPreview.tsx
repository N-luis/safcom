'use client';

import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { Visibility } from '@mui/icons-material';
import { keyframes } from '@emotion/react';
import {
  SERVICE_REFERRAL_INSTRUCTIONS, SERVICE_REFERRAL_DIGITAL_NOTICE, SERVICES, servicesFor, mmddyyyy, ACK_STATUS, CLIENT_SIGNATORY, referredByName,
  type ServiceReferralForm, type SectionC, type Destination, type FormKey,
} from '@/lib/serviceReferralForm';

/**
 * The Service Referral Form as a document, beside the editor - drawn from the
 * one form state the editor holds (there is no second copy), so it changes
 * with every keystroke and tick. Same pages, bars, labels and boxes as the
 * PDF (lib/serviceReferralPdf.ts). Read-only; clicking a part takes the
 * officer to that field. Nothing is stored or logged here.
 */
export interface ServiceReferralPreviewProps {
  form: ServiceReferralForm;
  reference: string;
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  /** Section C as recorded; blank (for the receiving organization) when null or awaiting. */
  sectionC?: SectionC | null;
  unsaved?: boolean;
  /** The field just changed: its place in the document is briefly marked and kept in view. */
  changed?: { key: FormKey; n: number } | null;
  onJump?: (key: FormKey) => void;
  variant?: 'panel' | 'print';
}

const INK = '#111827', GRID = '#1f2937', SHADE = '#dcdcdc', BAR = '#c9c9c9', PANEL = '#ececec', VALUE = '#0d1f61', FAINT = '#9ca3af';
const FONT = 'Arial, Helvetica, "Liberation Sans", sans-serif';
const flashA = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;
const flashB = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;

export default function ServiceReferralPreview(props: ServiceReferralPreviewProps) {
  const { variant = 'panel', changed } = props;
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the part being typed into in view - inside the preview only.
  useEffect(() => {
    const box = scroller.current;
    if (variant !== 'panel' || !changed || !box) return;
    const el = box.querySelector<HTMLElement>(`[data-key="${changed.key}"]`);
    if (!el) return;
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < b.top + 30 || r.bottom > b.bottom - 20) box.scrollTop += r.top - b.top - b.height / 3;
  }, [changed, variant]);

  const pages = (
    <>
      <Page number={1} {...props}><PageOne {...props} /></Page>
      <Page number={2} {...props}><PageTwo {...props} /></Page>
    </>
  );
  if (variant === 'print') return <Box sx={{ fontFamily: FONT }}>{pages}</Box>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}
      role="region" aria-label="Live document preview (read-only)">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Visibility sx={{ fontSize: 18, color: '#7c3aed' }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>Live preview</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: '#64748b', display: { xs: 'none', sm: 'block' } }}>read-only - updates as you type</Typography>
        {props.unsaved && <Typography sx={{ ml: 'auto', fontSize: '0.72rem', color: '#a16207', fontWeight: 700 }}>includes unsaved changes</Typography>}
      </Box>
      <Box ref={scroller} data-testid="referral-preview-scroll"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: { xs: 1, sm: 2 }, fontFamily: FONT, '& > section + section': { mt: 2 } }}>
        {pages}
      </Box>
    </Box>
  );
}

// ── Page frame ──────────────────────────────────────────────────────────────

function Page({ number, children, ...props }: { number: number; children: React.ReactNode } & ServiceReferralPreviewProps) {
  const { form, reference, status, unsaved } = props;
  return (
    <Box component="section" data-page={number} aria-label={`Page ${number} of 2`}
      sx={{ position: 'relative', bgcolor: '#fff', color: INK, width: '100%', maxWidth: 780, mx: 'auto', minHeight: { md: 1000 }, boxSizing: 'border-box',
        p: { xs: '14px', sm: '26px 32px' }, boxShadow: '0 1px 4px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontSize: 11, lineHeight: 1.35, '@media print': { boxShadow: 'none', maxWidth: 'none', minHeight: 0, p: 0, breakAfter: 'page' } }}>
      {status !== 'ISSUED' && (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: 900, fontSize: { xs: 64, sm: status === 'DRAFT' ? 140 : 96 }, color: 'rgba(0,0,0,0.05)', transform: 'rotate(-35deg)', userSelect: 'none' }}>
            {status === 'DRAFT' ? 'DRAFT' : 'CANCELLED'}
          </Typography>
        </Box>
      )}
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Box sx={{ bgcolor: '#f3e86b', px: 1.5, py: 0.4, fontWeight: 900, fontSize: { xs: 13, sm: 17 }, letterSpacing: '0.02em' }}>CONFIDENTIAL</Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, pb: 0.75, borderBottom: `2.5px solid ${INK}`, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <Typography component="h3" sx={{ fontFamily: FONT, fontWeight: 800, fontSize: { xs: 14, sm: 16 }, lineHeight: 1.2 }}>SERVICE REFERRAL<br />FORM</Typography>
          <Box sx={{ ml: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', border: `1px solid ${GRID}`, fontSize: 9.5, minWidth: { xs: '100%', sm: 250 } }}>
            {(['clientCode', 'incidentNo'] as const).map((k, i) => (
              <Box key={k} data-key={k} {...jump(props, k)} sx={{ px: 0.75, py: 0.5, borderLeft: i ? `1px solid ${GRID}` : 0, cursor: props.onJump ? 'pointer' : 'default', ...flash(props, k) }}>
                <Box sx={{ fontWeight: 700 }}>{i ? '2. Incident No.:' : '1. Client Code:'}</Box>
                <Box sx={{ color: VALUE, minHeight: 15, overflowWrap: 'anywhere' }}>{form[k].trim() || <Line />}</Box>
              </Box>
            ))}
          </Box>
        </Box>
        {status !== 'ISSUED' && (
          <Typography sx={{ fontFamily: FONT, fontSize: 9.5, fontWeight: 700, color: '#b91c1c', mt: 0.5 }}>
            {status === 'DRAFT' ? 'DRAFT - NOT ISSUED. Do not give this copy to the receiving organization.' : 'CANCELLED - this referral was withdrawn and is not valid.'}
          </Typography>
        )}
        <Box sx={{ flex: 1, mt: 1.25 }}>{children}</Box>
        <Box component="footer" sx={{ mt: 2, pt: 0.75, borderTop: '1px solid #d1d5db', display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 8, color: '#6b7280', flex: 1 }}>
            {SERVICE_REFERRAL_DIGITAL_NOTICE}<br />Referral No. {reference}{unsaved ? ' - includes changes not yet saved' : ''}. Confidential: for the receiving organization only.
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Page {number} of 2</Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

const jump = (p: ServiceReferralPreviewProps, key: FormKey) => (p.onJump && p.variant !== 'print' ? {
  role: 'button', tabIndex: 0, 'aria-label': `Go to ${key} in the form`,
  onClick: () => p.onJump!(key),
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onJump!(key); } },
} : {});
const flash = (p: ServiceReferralPreviewProps, key: FormKey) => (p.changed?.key === key
  ? { animation: `${p.changed.n % 2 ? flashA : flashB} 1.4s ease-out`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } } : {});

const Line = () => <Box component="span" sx={{ display: 'inline-block', width: '100%', minWidth: 40, borderBottom: '1px solid #9ca3af', height: 12 }} />;
const Blank = () => <Box component="span" sx={{ color: FAINT, fontStyle: 'italic', fontSize: 9.5 }}>-</Box>;

function SectionBar({ title }: { title: string }) {
  return <Box sx={{ bgcolor: BAR, border: `1px solid ${GRID}`, textAlign: 'center', fontWeight: 800, fontSize: 11, py: 0.35 }}>{title}</Box>;
}

/** A shaded label cell beside its value, as the form's table. */
function Cell({ label, sub, k, p, children, span }: { label: string; sub?: string; k?: FormKey; p: ServiceReferralPreviewProps; children: React.ReactNode; span?: boolean }) {
  return (
    <>
      <Box sx={{ bgcolor: SHADE, borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, px: 0.6, py: 0.45, fontWeight: 700, fontSize: 10.5 }}>
        {label}{sub && <Box sx={{ fontWeight: 400, fontStyle: 'italic', fontSize: 9 }}>{sub}</Box>}
      </Box>
      <Box data-key={k} {...(k ? jump(p, k) : {})}
        sx={{ borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, px: 0.6, py: 0.45, color: VALUE, minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
          gridColumn: span ? 'span 3' : undefined, cursor: k && p.onJump ? 'pointer' : 'default', ...(k && p.onJump && { '&:hover': { bgcolor: '#f5f3ff' } }), ...(k ? flash(p, k) : {}) }}>
        {children}
      </Box>
    </>
  );
}

/** Sub-labelled parts in one cell: Last / First / Middle / Extension, No. / Street / Barangay / City. */
function Parts({ parts, p }: { parts: [FormKey, string][]; p: ServiceReferralPreviewProps }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: `repeat(${parts.length}, minmax(0,1fr))` }, gap: 0.5 }}>
      {parts.map(([k, label]) => (
        <Box key={k} data-key={k} {...jump(p, k)} sx={{ minWidth: 0, cursor: p.onJump ? 'pointer' : 'default', ...flash(p, k) }}>
          <Box sx={{ fontSize: 8, color: '#6b7280' }}>{label}</Box>
          <Box sx={{ color: VALUE, minHeight: 15, overflowWrap: 'anywhere' }}>{String(p.form[k]).trim() || <Blank />}</Box>
        </Box>
      ))}
    </Box>
  );
}

function Check({ on, label, children }: { on: boolean; label: string; children?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6, fontWeight: on ? 700 : 400, py: 0.15 }} aria-label={`${label}${on ? ' (selected)' : ''}`} data-selected={on ? 'true' : undefined}>
      <Box component="span" aria-hidden sx={{ width: 11, height: 11, flexShrink: 0, mt: '2px', border: `1px solid ${INK}`, bgcolor: '#fff', fontSize: 10, lineHeight: '10px', textAlign: 'center', fontWeight: 900 }}>{on ? '✓' : ''}</Box>
      <span>{label}{children}</span>
    </Box>
  );
}

function PageOne(p: ServiceReferralPreviewProps) {
  const f = p.form;
  return (
    <>
      <Box sx={{ border: '1px solid #6b7280', bgcolor: '#f3f3f3', p: 1, mb: 1.5 }}>
        <Box sx={{ fontWeight: 800, fontSize: 11 }}>INSTRUCTIONS</Box>
        <Box component="ol" sx={{ m: 0, pl: 3, fontSize: 10 }}>
          {SERVICE_REFERRAL_INSTRUCTIONS.map(s => <li key={s}>{s}</li>)}
        </Box>
      </Box>

      <SectionBar title="A.  REFERRING ORGANIZATION INFORMATION" />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '30% 70%', sm: '17% 31% 13% 39%' }, borderLeft: `1px solid ${GRID}` }}>
        <Cell label="1. Referring Organization" k="referringOrganization" p={p}>{f.referringOrganization.trim() || <Blank />}</Cell>
        <Cell label="2. Action Taken" k="actionTaken" p={p}>{f.actionTaken.trim() || <Blank />}</Cell>
        <Cell label="3. Referred by" p={p}>
          <Parts p={p} parts={[['referredByLast', 'Last Name'], ['referredByFirst', 'First Name'], ['referredByMiddle', 'Middle Name'], ['referredByExt', 'Extension']]} />
        </Cell>
        <Cell label="4. Position / Job Title" k="position" p={p}>{f.position.trim() || <Blank />}</Cell>
        <Cell label="5. Contact No." k="contactNo" p={p}>{f.contactNo.trim() || <Blank />}</Cell>
        <Cell label="6. Email Address" k="email" p={p}>{f.email.trim() || <Blank />}</Cell>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '30% 70%', sm: '17% 83%' }, borderLeft: `1px solid ${GRID}` }}>
        <Cell label="7. Address" p={p}>
          <Parts p={p} parts={[['addressNo', 'No.'], ['addressStreet', 'Street Name'], ['addressBarangay', 'Barangay'], ['addressCity', 'City/Mun']]} />
        </Cell>
      </Box>

      <SectionBar title="B.  SERVICE REFERRAL INFORMATION" />
      <Box sx={{ border: `1px solid ${GRID}`, borderTop: 0, bgcolor: SHADE, px: 0.6, py: 0.35, fontWeight: 800, fontSize: 10 }}>8. REFERRAL SERVICE</Box>
      <Block dest="BARANGAY" heading="Referred to Barangay" p={p} />
      <Block dest="SWDO" heading="Referred to Social Welfare and Development Office" p={p} />
    </>
  );
}

function Block({ dest, heading, p }: { dest: Destination; heading: string; p: ServiceReferralPreviewProps }) {
  const f = p.form;
  const chosen = f.destination === dest;
  const v = (k: FormKey) => (chosen ? String(f[k]).trim() : '');
  const rows: [FormKey, string][] = [
    ['receivingAgency', dest === 'BARANGAY' ? 'Barangay / Office' : 'Agency/Organization'], ['receivingAddress', 'Address'],
    ['receivingContactPerson', 'Name of Contact Person'], ['receivingContactNo', 'Contact No.'], ['receivingEmail', 'Email Address'],
  ];
  return (
    <Box data-key={chosen ? 'destination' : undefined} data-destination={dest} data-chosen={chosen ? 'true' : undefined}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '49% 51%' }, border: `1px solid ${GRID}`, borderTop: 0, ...(chosen ? flash(p, 'destination') : {}) }}>
      <Box data-key={chosen ? 'services' : undefined} {...jump(p, 'services')}
        sx={{ bgcolor: PANEL, p: 0.75, borderRight: { sm: `1px solid ${GRID}` }, borderBottom: { xs: `1px solid ${GRID}`, sm: 0 }, cursor: p.onJump ? 'pointer' : 'default', ...(chosen ? flash(p, 'services') : {}) }}>
        <Box sx={{ fontWeight: 800, fontStyle: 'italic', mb: 0.4 }}>{heading}</Box>
        {servicesFor(dest).map(k => {
          const on = chosen && f.services.includes(k);
          return (
            <Check key={k} on={on} label={SERVICES[k].label}>
              {'other' in SERVICES[k] && <>: <Box component="span" data-key={on ? 'serviceOther' : undefined} sx={{ color: VALUE, fontWeight: 400, borderBottom: '1px solid #9ca3af', px: 0.5, display: 'inline-block', minWidth: 90, ...(on ? flash(p, 'serviceOther') : {}) }}>{on ? f.serviceOther.trim() : ''}&nbsp;</Box></>}
            </Check>
          );
        })}
      </Box>
      <Box sx={{ p: 0.75 }}>
        {rows.map(([k, label]) => (
          <Box key={k} data-key={chosen ? k : undefined} {...(chosen ? jump(p, k) : {})}
            sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', py: 0.35, cursor: chosen && p.onJump ? 'pointer' : 'default', ...(chosen ? flash(p, k) : {}) }}>
            <Box sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontSize: 10 }}>{label}:</Box>
            <Box sx={{ flex: 1, borderBottom: '1px solid #6b7280', color: VALUE, minHeight: 15, overflowWrap: 'anywhere', minWidth: 0 }}>{v(k)}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function PageTwo(p: ServiceReferralPreviewProps) {
  const c = p.sectionC;
  const recorded = Boolean(c?.status && c.status !== 'AWAITING');
  const val = (s: string | null | undefined) => (recorded && s ? s : '');
  const name = referredByName(p.form);
  return (
    <>
      <Box sx={{ fontWeight: 800, fontStyle: 'italic', fontSize: 11.5, mb: 1 }}>C. To be accomplished by the Receiving Organization</Box>
      {!recorded && (
        <Box data-testid="section-c-state" sx={{ fontSize: 9.5, color: '#6b7280', fontStyle: 'italic', mb: 0.75 }}>
          {p.status === 'ISSUED' ? `${ACK_STATUS.AWAITING} - the receiving organization completes this section.` : 'Left blank for the receiving organization to complete.'}
        </Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '34% 66%', sm: '22% 32% 18% 28%' }, borderLeft: `1px solid ${GRID}`, borderTop: `1px solid ${GRID}` }}>
        <Cell label="9. Received by" sub="(signature over printed name)" p={p}>
          {val(c?.receivedByName) ? <>{c!.receivedByName}<Box component="span" sx={{ display: 'block', fontSize: 8.5, color: '#6b7280', fontStyle: 'italic' }}>printed name as recorded in SafeComm</Box></> : ''}
        </Cell>
        <Cell label="10. Position / Job Title" p={p}>{val(c?.position)}</Cell>
        <Cell label="11. Client Code" p={p}>{val(c?.clientCode)}</Cell>
        <Cell label="12. Date of Received" p={p}><Box component="span" sx={{ display: 'block', fontSize: 7.5, color: '#6b7280' }}>(mm/dd/yyyy)</Box>{mmddyyyy(val(c?.dateReceived))}</Cell>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '34% 66%', sm: '22% 78%' }, borderLeft: `1px solid ${GRID}` }}>
        <Cell label="13. Remarks" p={p}>{val(c?.remarks)}</Cell>
      </Box>
      {recorded && c?.status && (
        <Box sx={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic', mt: 0.5 }}>
          Section C as recorded in SafeComm: {ACK_STATUS[c.status]}. The signature is on the receiving organization&rsquo;s copy, not reproduced here.
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: { xs: 3, sm: 5 }, mt: 5 }}>
        <Box data-key="clientSignatory" {...jump(p, 'clientSignatory')} sx={{ cursor: p.onJump ? 'pointer' : 'default', ...flash(p, 'clientSignatory') }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
            <Box sx={{ fontWeight: 700 }}>Signature/thumbprint of client:</Box>
            <Box sx={{ flex: 1, borderBottom: `1px solid ${INK}`, minHeight: 16 }} aria-label="Client signature line - signed by hand" />
          </Box>
          <Box sx={{ fontStyle: 'italic', fontSize: 10 }}>(or parent/guardian if client is a child below 18 or as defined by RA7610)</Box>
          {p.form.clientSignatory && <Box sx={{ fontSize: 9, color: '#6b7280' }}>To be signed by: {CLIENT_SIGNATORY[p.form.clientSignatory]}</Box>}
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, mt: 1.5, maxWidth: 200 }}><Box sx={{ fontWeight: 700 }}>Date:</Box><Box sx={{ flex: 1, borderBottom: `1px solid ${INK}`, minHeight: 14 }} /></Box>
        </Box>
        <Box>
          <Box sx={{ textAlign: 'center', color: VALUE, minHeight: 16 }}>{name}</Box>
          <Box sx={{ borderTop: `1px solid ${INK}`, pt: 0.25, fontWeight: 700, fontStyle: 'italic', fontSize: 10.5 }} aria-label="Service provider signature line - signed by hand">
            Printed name and signature of the service provider of the referring organization
          </Box>
          <Box sx={{ fontSize: 9, color: '#6b7280' }}>(sign by hand on the printed copy)</Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, mt: 1.5, maxWidth: 200 }}><Box sx={{ fontWeight: 700 }}>Date:</Box><Box sx={{ flex: 1, borderBottom: `1px solid ${INK}`, minHeight: 14 }} /></Box>
        </Box>
      </Box>
    </>
  );
}
