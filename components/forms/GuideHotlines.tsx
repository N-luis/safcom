'use client';

import { Box, Button, Typography } from '@mui/material';
import { Call, LocalPhone } from '@mui/icons-material';
import { EMERGENCY_HOTLINES, QUICK_HOTLINES, telHref } from '@/lib/emergencyHotlines';

/**
 * The emergency numbers, short: the barangay and the three big ones, each a
 * tap-to-call link (the same configured list and links as the dashboard's
 * Emergency Hotlines). SafeComm never places a call.
 */
export default function GuideHotlines({ lang }: { lang: 'en' | 'tl' }) {
  const barangay = EMERGENCY_HOTLINES[0];
  const rows = [{ label: lang === 'tl' ? 'Barangay' : 'Barangay', name: barangay.name, number: barangay.numbers[0] }, ...QUICK_HOTLINES.map(q => ({ label: q.label, name: q.name, number: q.number }))];
  return (
    <Box data-testid="guide-hotlines" sx={{ border: '1px solid #fecaca', bgcolor: '#fef2f2', borderRadius: 2, p: 1.25, display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <LocalPhone sx={{ fontSize: 18, color: '#b91c1c' }} />
        <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: '#7f1d1d' }}>
          {lang === 'tl' ? 'Kung may nasa panganib ngayon, tumawag na' : 'If anyone is in danger now, call now'}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.76rem', color: '#7f1d1d' }}>
        {lang === 'tl' ? 'Hindi emergency response service ang SafeComm. Puwede kang mag-report pagkatapos.' : 'SafeComm is not an emergency response service. You can file the report afterwards.'}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.75 }}>
        {rows.map(r => {
          const href = telHref(r.number);
          return href ? (
            <Button key={r.name} component="a" href={href} variant="contained" size="small" startIcon={<Call sx={{ fontSize: 16 }} />}
              aria-label={`Call Now: ${r.name}, ${r.number}`}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', bgcolor: '#b91c1c', '&:hover': { bgcolor: '#991b1b' }, minHeight: 40, borderRadius: 2 }}>
              <Box component="span" sx={{ display: 'grid', textAlign: 'left', lineHeight: 1.2 }}>
                <Box component="span" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>{r.label} · {r.number}</Box>
                <Box component="span" sx={{ fontSize: '0.68rem', opacity: 0.85 }}>{r.name}</Box>
              </Box>
            </Button>
          ) : null;
        })}
      </Box>
    </Box>
  );
}
