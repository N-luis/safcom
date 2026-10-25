'use client';

import { Box, Typography, Chip, Button, Alert } from '@mui/material';
import { Phone, CheckCircle, Schedule, Edit } from '@mui/icons-material';
import type { IntakeResult } from '@/lib/intake';
import { EMERGENCY_CONTACTS } from '@/lib/safecommConfig';

/**
 * What a resident sees once their report is filed.
 *
 * Only what is theirs to know: a short summary, where the assessment stands,
 * what to do to stay safe, whether more detail would help, whether a person
 * will look at it promptly, and what happens next. Officer guidance, source
 * passages and review reasons stay on the officer side. No promise is made
 * about the outcome, and nothing says the authorities have been contacted -
 * SafeComm does not contact them.
 */

type Lang = 'tl' | 'en';

const T: Record<Lang, Record<string, string>> = {
  tl: {
    title: 'Buod ng iyong report',
    status: 'Katayuan',
    PRELIMINARY: 'Paunang pagtatasa — susuriin pa ng opisyal',
    FOR_REVIEW: 'Para sa pagsusuri ng opisyal',
    NEEDS_MORE_INFORMATION: 'Kailangan pa ng kaunting impormasyon',
    URGENT_REVIEW: 'Minarkahan para sa agarang pagsusuri ng isang opisyal',
    NEEDS_FOLLOW_UP: 'Natanggap — kulang pa ang ilang detalye, kaya hindi pa ito ganap na natatasa. Maaaring mag-follow up ang isang opisyal.',
    ASSESSMENT_UNAVAILABLE: 'Natanggap — isang opisyal ang magtatasa nito',
    level: 'Paunang antas',
    undetermined: 'Hindi pa matukoy',
    emergency: 'Kung may panganib ngayon, tumawag agad:',
    prompt: 'Titingnan agad ito ng isang opisyal.',
    standard: 'Titingnan ito ng isang opisyal ayon sa pagkakasunod-sunod.',
    more: 'Makatutulong kung maidadagdag mo:',
    moreHow: 'Maaari kang magdagdag ng update sa My Cases anumang oras — kung ligtas para sa iyo.',
    next: 'Susunod: makikita mo ang progreso at mga sagot ng barangay sa My Cases.',
    framework: 'Ito ay paunang triage lamang, hindi legal na pagpapasya. Hindi pa nakikipag-ugnayan ang SafeComm sa pulis para sa iyo.',
    steps: 'Mga dapat gawin',
  },
  en: {
    title: 'Summary of your report',
    status: 'Status',
    PRELIMINARY: 'Preliminary assessment — an officer will review it',
    FOR_REVIEW: 'For officer review',
    NEEDS_MORE_INFORMATION: 'A little more information is needed',
    URGENT_REVIEW: 'Marked for urgent review by an officer',
    NEEDS_FOLLOW_UP: 'Received — some details are still missing, so it has not been fully assessed yet. An officer may follow up with you.',
    ASSESSMENT_UNAVAILABLE: 'Received — an officer will assess it',
    level: 'Preliminary level',
    undetermined: 'Not yet determined',
    emergency: 'If there is danger now, call straight away:',
    prompt: 'An officer will look at this promptly.',
    standard: 'An officer will look at this in turn.',
    more: 'It would help to add:',
    moreHow: 'You can add an update from My Cases at any time — when it is safe for you.',
    next: 'Next: you can follow progress and the barangay’s replies in My Cases.',
    framework: 'This is preliminary triage only, not a legal decision. SafeComm has not contacted the police for you.',
    steps: 'What to do now',
  },
};

export default function SubmissionSummary({ intake, triageStatus, onOpenCases }: {
  intake: IntakeResult;
  /** Where the server's triage put it (lib/intake.ts triageStatusFor). */
  triageStatus?: string | null;
  onOpenCases: () => void;
}) {
  const lang: Lang = intake.language === 'english' ? 'en' : 'tl';
  const t = T[lang];
  const prompt = triageStatus === 'URGENT_REVIEW' || intake.immediateSafetyConcern || (intake.matrixLevel ?? 0) >= 4;
  // The server's triage status where it has one; the intake's own otherwise.
  const statusText = (triageStatus && t[triageStatus]) || t[intake.assessmentStatus];

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 2, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: '#0c1e46' }}>{t.title}</Typography>

      {intake.immediateSafetyConcern && (
        <Alert severity="error" icon={<Phone />} sx={{ borderRadius: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', mb: 0.75 }}>{t.emergency}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {EMERGENCY_CONTACTS.map(c => (
              <Button key={c.label} size="small" variant="outlined" color="error"
                href={`tel:${c.number.replace(/[^\d+]/g, '')}`} sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700 }}>
                {c.label}: {c.number}
              </Button>
            ))}
          </Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{t.status}:</Typography>
        <Chip size="small" label={statusText} sx={{ height: 'auto', py: 0.25, fontWeight: 700, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{t.level}:</Typography>
        <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#0c1e46' }}>
          {intake.matrixLevel ? `Level ${intake.matrixLevel} — ${intake.matrixLabel}` : t.undetermined}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        {prompt ? <Schedule sx={{ fontSize: 17, color: '#b45309' }} /> : <CheckCircle sx={{ fontSize: 17, color: '#0f766e' }} />}
        <Typography sx={{ fontSize: '0.84rem', color: '#334155' }}>{prompt ? t.prompt : t.standard}</Typography>
      </Box>

      {intake.recommendedNextSteps.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', mb: 0.25 }}>{t.steps}</Typography>
          {intake.recommendedNextSteps.slice(0, 4).map(s => (
            <Typography key={s} sx={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.55 }}>• {s}</Typography>
          ))}
        </Box>
      )}

      {intake.missingInformation.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>{t.more}</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#475569' }}>{intake.missingInformation.join('; ')}</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: '#64748b', mt: 0.25 }}>{t.moreHow}</Typography>
        </Box>
      )}

      <Button size="small" startIcon={<Edit sx={{ fontSize: 15 }} />} onClick={onOpenCases}
        sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, color: '#0f766e' }}>
        {t.next}
      </Button>
      <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>{t.framework}</Typography>
    </Box>
  );
}
