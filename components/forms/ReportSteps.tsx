'use client';

import { Box, Typography } from '@mui/material';
import { ChecklistRtl } from '@mui/icons-material';
import GuideHotlines from './GuideHotlines';
import type { Step, GuideLang } from '@/lib/reportGuide';

/** Next steps for this report (lib/reportGuide.ts beforeSubmitSteps / afterSubmitSteps) - only those that apply. */
export default function ReportSteps({ steps, lang, title, testid }: { steps: Step[]; lang: GuideLang; title: string; testid: string }) {
  if (!steps.length) return null;
  const urgent = steps.some(s => s.tone === 'urgent');
  return (
    <Box data-testid={testid} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, display: 'grid', gap: 0.75, textAlign: 'left' }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: '#0c1e46', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <ChecklistRtl sx={{ fontSize: 18, color: '#0f766e' }} /> {title}
      </Typography>
      {urgent && <GuideHotlines lang={lang} />}
      <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'grid', gap: 0.25 }}>
        {steps.filter(s => s.tone !== 'urgent').map(s => <Typography component="li" key={s.key} sx={{ fontSize: '0.82rem', color: '#334155' }}>{s.text[lang]}</Typography>)}
      </Box>
    </Box>
  );
}
