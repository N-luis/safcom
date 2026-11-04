'use client';

import { Box, Typography, Alert } from '@mui/material';
import type { Responses } from '@/lib/officialIntakeForm';
import { kpForm7Content, kpForm7Missing, dayOf, KP_FORM7_NOTICE } from '@/lib/kpForm7';
import { BARANGAY_CONTEXT } from '@/lib/safecommConfig';

/**
 * KP Form No. 7 (Complainant's Form) as it will print, from the same answers
 * the Blotter Intake Form is editing - live, and read-only. Shown only for a
 * case an official has found eligible; otherwise it says why not.
 */

const SERIF = '"Times New Roman", Times, "Liberation Serif", serif';
const Line = ({ w = 160 }: { w?: number }) => <Box component="span" sx={{ display: 'inline-block', width: w, borderBottom: '1px solid #111', mx: 0.5, verticalAlign: 'bottom' }} />;

export default function KpForm7Preview({ responses, caseNumber, municipality, province, eligible, reasons, draft }: {
  responses: Responses; caseNumber: string; municipality?: string | null; province?: string | null;
  eligible: boolean; reasons: string[]; draft: boolean;
}) {
  if (!eligible) {
    return (
      <Alert severity="info" sx={{ m: 2, borderRadius: 2 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', mb: 0.5 }}>KP Form No. 7 is not available for this case yet</Typography>
        <Typography sx={{ fontSize: '0.82rem' }}>
          A blotter record becomes a Katarungang Pambarangay complaint only once an official finds the case eligible - confirm the category and
          record the eligibility review in the Hearings panel on the case page.
        </Typography>
        {reasons.map(r => <Typography key={r} sx={{ fontSize: '0.8rem', mt: 0.5 }}>- {r}</Typography>)}
      </Alert>
    );
  }
  const k = kpForm7Content(responses, { caseNumber, barangay: BARANGAY_CONTEXT.name, municipality, province });
  const missing = kpForm7Missing(k);
  const made = k.madeOn ? dayOf(k.madeOn) : null;
  const para = { fontFamily: SERIF, fontSize: 14, lineHeight: 1.6, color: '#111' };
  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      {missing.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>Still needed before it can be produced: {missing.join('; ')}.</Alert>
      )}
      <Box component="section" aria-label="KP Form No. 7 preview" data-page="kp7"
        sx={{ position: 'relative', bgcolor: '#fff', color: '#111', maxWidth: 780, mx: 'auto', p: { xs: 2, sm: '40px 52px' }, boxShadow: '0 1px 4px rgba(15,23,42,0.18)', overflow: 'hidden' }}>
        {draft && <Typography aria-hidden sx={{ position: 'absolute', top: '40%', left: '18%', fontWeight: 900, fontSize: { xs: 70, sm: 120 }, color: 'rgba(0,0,0,0.05)', transform: 'rotate(-35deg)', pointerEvents: 'none' }}>DRAFT</Typography>}
        <Typography sx={{ fontFamily: SERIF, fontSize: 11, fontStyle: 'italic', color: '#555', mb: 1 }}>KP Form No. 7 - Complainant&apos;s Form</Typography>
        <Box sx={{ textAlign: 'center', ...para, fontSize: 13.5 }}>
          <div>Republic of the Philippines</div>
          <div>Province of {k.province || <Line w={120} />}</div>
          <div>CITY/MUNICIPALITY OF {k.municipality.toUpperCase() || <Line w={130} />}</div>
          <div>Barangay {k.barangay || <Line w={120} />}</div>
          <Box sx={{ fontWeight: 700, mt: 1 }}>OFFICE OF THE LUPONG TAGAPAMAYAPA</Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 3, ...para }}>
          <Box>
            {(k.complainants.length ? k.complainants : ['']).map((n, i) => <div key={i}>{n || <Line />}</div>)}
            <Box sx={{ fontStyle: 'italic' }}>Complainant/s</Box>
            <Box sx={{ my: 1.25, pl: 4 }}>- against -</Box>
            {(k.respondents.length ? k.respondents : ['']).map((n, i) => <div key={i}>{n || <Line />}</div>)}
            <Box sx={{ fontStyle: 'italic' }}>Respondent/s</Box>
          </Box>
          <Box>
            <div>Barangay Case No. {k.caseNo || <Line w={110} />}</div>
            <div>For: {k.nature || <Line w={160} />}</div>
          </Box>
        </Box>
        <Box sx={{ textAlign: 'center', fontFamily: SERIF, fontWeight: 700, fontSize: 16, letterSpacing: '0.3em', mt: 3, mb: 1.5 }}>COMPLAINT</Box>
        <Box sx={{ ...para, textIndent: '2.5em' }}>I/WE hereby complain against above named respondent/s for violating my/our rights and interests in the following manner:</Box>
        <Box sx={{ ...para, pl: 2.5, my: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 60 }}>{k.complaint || <Box component="span" sx={{ color: '#9ca3af', fontStyle: 'italic' }}>The complaint statement (Section E) appears here.</Box>}</Box>
        <Box sx={{ ...para, textIndent: '2.5em', mt: 2 }}>THEREFORE, I/WE pray that the following relief/s be granted to me/us in accordance with law and/or equity:</Box>
        <Box sx={{ ...para, pl: 2.5, my: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 40 }}>{k.relief || <Box component="span" sx={{ color: '#9ca3af', fontStyle: 'italic' }}>The relief requested (Section E) appears here.</Box>}</Box>
        <Box sx={{ ...para, textIndent: '2.5em', mt: 3 }}>Made this {made?.day ?? <Line w={60} />} day of {made?.monthYear ?? <><Line w={110} />, 20<Line w={30} /></>}.</Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 4 }}>
          <Box sx={{ textAlign: 'center', borderTop: '1px solid #111', minWidth: 220, pt: 0.5, fontFamily: SERIF, fontStyle: 'italic' }}>Complainant/s</Box>
        </Box>
        <Box sx={{ ...para, textIndent: '2.5em', mt: 3 }}>Received and filed this <Line w={60} /> day of <Line w={110} />, 20<Line w={30} />.</Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 4 }}>
          <Box sx={{ textAlign: 'center', borderTop: '1px solid #111', minWidth: 260, pt: 0.5, fontFamily: SERIF, fontStyle: 'italic' }}>Punong Barangay/Lupon Chairman</Box>
        </Box>
        <Typography sx={{ fontSize: 10, color: '#6b7280', mt: 4 }}>{KP_FORM7_NOTICE}</Typography>
      </Box>
    </Box>
  );
}
