'use client';

import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { Visibility } from '@mui/icons-material';
import { keyframes } from '@emotion/react';
import type { ReferralFormKey } from '@/lib/referralForm';

/**
 * The Referral Form as the paper form, beside the editor: the same title,
 * labels, order and lines as the PDF (lib/referralFormPdf.ts), each line
 * carrying what is typed on the left - drawn from the editor's one copy of the
 * values, so it changes with every keystroke. Read-only; clicking a line takes
 * the official to that field. Nothing is stored or logged here.
 */

export type PreviewKey = ReferralFormKey | 'caseNumber' | 'to' | 'referredAt' | 'reason';
export interface ReferralFormPreviewProps {
  caseNumber: string;
  /** YYYY-MM-DD */
  referredAt: string;
  /** "To:" - the office referred to. */
  to: string;
  reason: string;
  form: Record<ReferralFormKey, string>;
  changed?: { key: PreviewKey; n: number } | null;
  onJump?: (key: PreviewKey) => void;
}

const INK = '#000', VALUE = '#0d1f59';
const FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const flashA = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;
const flashB = keyframes`from { background-color: #fde68a; } to { background-color: transparent; }`;

/** As the PDF prints it: "November 10, 2026". */
const longDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d)
  ? new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' })
  : '');

export default function ReferralFormPreview(props: ReferralFormPreviewProps) {
  const { changed } = props;
  const box = useRef<HTMLDivElement>(null);

  // Keep the line being typed into in view - inside the preview only.
  useEffect(() => {
    const b = box.current;
    if (!changed || !b) return;
    const el = b.querySelector<HTMLElement>(`[data-key="${changed.key}"]`);
    if (!el) return;
    const br = b.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < br.top + 30 || r.bottom > br.bottom - 20) b.scrollTop += r.top - br.top - br.height / 3;
  }, [changed]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}
      role="region" aria-label="Live preview of the referral form (read-only)">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Visibility sx={{ fontSize: 18, color: '#0f766e' }} />
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0c1e46' }}>Live preview</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: '#64748b' }}>updates as you type</Typography>
      </Box>
      <Box ref={box} data-testid="referral-form-preview" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 1, sm: 2 } }}>
        <Sheet {...props} />
      </Box>
    </Box>
  );
}

/** The page itself. */
export function Sheet(p: ReferralFormPreviewProps) {
  const f = p.form;
  const L = (key: PreviewKey, label: string, value: string, grow = 1) => <Line key={key} k={key} label={label} value={value} grow={grow} p={p} />;
  return (
    <Box component="section" aria-label="Referral form"
      sx={{ bgcolor: '#fff', color: INK, fontFamily: FONT, fontSize: { xs: 12.5, sm: 14 }, maxWidth: 760, mx: 'auto', minHeight: { md: 980 },
        p: { xs: '18px 14px', sm: '40px 48px' }, boxShadow: '0 1px 4px rgba(15,23,42,0.18)', boxSizing: 'border-box' }}>
      <Box sx={{ textAlign: 'center', mb: { xs: 3, sm: 4.5 } }}>
        <Box component="span" sx={{ bgcolor: '#99cc00', px: 0.5, fontSize: { xs: 13, sm: 15 } }}>REFERRAL FORM</Box>
      </Box>
      <Row>
        {L('caseNumber', 'Case No.', p.caseNumber, 0.6)}
        <Box sx={{ width: { xs: 12, sm: 60 } }} />
        {L('referredAt', 'Date of Referral', longDate(p.referredAt), 1)}
      </Row>
      <Row>{L('to', 'To:', p.to)}</Row>
      <Row>{L('toAddress', 'Address', f.toAddress)}</Row>
      <Row>{L('toContactPerson', 'Contact Person', f.toContactPerson)}</Row>
      <Row>{L('clientName', 'Name of Client', f.clientName)}</Row>
      <Row>
        {L('clientAge', 'Age', f.clientAge, 0.25)}
        {L('clientSex', 'Sex', f.clientSex, 0.3)}
        {L('clientAddress', 'Address', f.clientAddress, 1.6)}
      </Row>
      <Row>
        {L('guardianName', 'Name of Family/Guardian', f.guardianName, 1.6)}
        {L('guardianContact', 'Contact No.', f.guardianContact, 0.8)}
      </Row>
      <Box sx={{ height: { xs: 14, sm: 22 } }} />
      <Row>{L('guardianAddress', 'Address', f.guardianAddress)}</Row>
      <Row>{L('reason', 'Reason/s for Referral', p.reason)}</Row>
      <Row>{L('servicesRequested', 'Specific Service/s Requested', f.servicesRequested)}</Row>
      <Box sx={{ py: 0.6 }}>Please refer to attached report/ intake form/case summary for more information.</Box>
      <Box sx={{ py: 0.6 }}>Feedback requested and send to Referring Party/Agency:</Box>
      <Row>{L('feedbackTo', '', f.feedbackTo)}</Row>
      <Box sx={{ height: { xs: 10, sm: 14 } }} />
      <Row>{L('feedbackAddress', 'Address', f.feedbackAddress)}</Row>
      <Row>
        {L('feedbackCellPhone', 'Cell Phone No.', f.feedbackCellPhone)}
        {L('feedbackLandline', 'Landline No.', f.feedbackLandline)}
      </Row>
      <Row>
        {L('feedbackEmail', 'Email address:', f.feedbackEmail)}
        {L('feedbackFax', 'Fax No.', f.feedbackFax)}
      </Row>
      <Row>{L('feedbackContact', 'Contact Person', f.feedbackContact)}</Row>
      <Box sx={{ py: 0.6 }}>Referred by:</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: { xs: 2, sm: 5 }, mt: { xs: 3, sm: 4 }, maxWidth: 560 }}>
        {([['referredByName', 'Signature over Printed Name', f.referredByName], ['referredByDesignation', 'Designation', f.referredByDesignation]] as const).map(([k, cap, v]) => (
          <Box key={k} data-key={k} {...jump(p, k)} sx={{ textAlign: 'center', cursor: p.onJump ? 'pointer' : 'default', ...flash(p, k) }}>
            <Box sx={{ color: VALUE, minHeight: 20, borderBottom: `1px solid ${INK}`, overflowWrap: 'anywhere' }}>{v}</Box>
            <Box sx={{ mt: 0.75 }}>{cap}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 1, sm: 1.5 }, py: 0.6, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>{children}</Box>
);

const jump = (p: ReferralFormPreviewProps, key: PreviewKey) => (p.onJump ? {
  role: 'button', tabIndex: 0, 'aria-label': `Go to this field in the form`,
  onClick: () => p.onJump!(key),
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onJump!(key); } },
} : {});
const flash = (p: ReferralFormPreviewProps, key: PreviewKey) => (p.changed?.key === key
  ? { animation: `${p.changed.n % 2 ? flashA : flashB} 1.4s ease-out`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } } : {});

/** "Label ______" with what was typed on the line. */
function Line({ k, label, value, grow, p }: { k: PreviewKey; label: string; value: string; grow: number; p: ReferralFormPreviewProps }) {
  return (
    <Box data-key={k} {...jump(p, k)}
      sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, flex: `${grow} 1 0`, minWidth: { xs: label ? '45%' : '100%', sm: 0 }, cursor: p.onJump ? 'pointer' : 'default', ...flash(p, k) }}>
      {label && <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{label}</Box>}
      <Box component="span" sx={{ flex: 1, minWidth: 24, borderBottom: `1px solid ${INK}`, color: VALUE, minHeight: '1.35em', px: 0.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {value.trim()}
      </Box>
    </Box>
  );
}
