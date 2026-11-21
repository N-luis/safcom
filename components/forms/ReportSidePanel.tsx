'use client';

import { Box, Card, CardContent, Typography } from '@mui/material';
import { TipsAndUpdatesOutlined, Timeline, LockOutlined } from '@mui/icons-material';

/**
 * Beside the File a Report form on wide screens (below it on narrow ones):
 * what happens after submitting, what helps a report, and how it is kept
 * private. (The emergency hotlines are on the resident's dashboard.) Each line describes what SafeComm actually does.
 */

const NAVY = '#0c1e46';

const STEPS = [
  { title: 'SafeComm Assist reads it', text: 'It may ask a few follow-up questions. You can skip any of them.' },
  { title: 'The right desk is recommended', text: 'The Blotter desk, or the confidential VAWC desk - you do not have to choose.' },
  { title: 'A barangay official reviews it', text: 'They may ask you for more information about your report.' },
  { title: 'You get updates', text: 'In Notifications and My Cases. Hearings appear under My Hearings & Notices.' },
];

const TIPS = [
  'What happened, in your own words',
  'When and where, if you know',
  'Who was involved - only if it is safe to say',
  'Whether anyone is in danger right now',
];

function Heading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#14b8a614', color: '#0f766e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</Box>
      <Typography sx={{ fontWeight: 800, fontSize: '0.98rem', color: NAVY }}>{children}</Typography>
    </Box>
  );
}

export default function ReportSidePanel() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, sm: 3 }, position: { lg: 'sticky' }, top: { lg: 24 } }}>
      <Card>
        <CardContent sx={{ p: 2.5 }}>
          <Heading icon={<Timeline sx={{ fontSize: 18 }} />}>What happens after you submit</Heading>
          <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {STEPS.map((s, i) => (
              <Box component="li" key={s.title} sx={{ display: 'flex', gap: 1.5 }}>
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: '#14b8a6', color: 'white', fontSize: '0.78rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: '1px' }}>{i + 1}</Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: NAVY, lineHeight: 1.35 }}>{s.title}</Typography>
                  <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>{s.text}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 2.5 }}>
          <Heading icon={<TipsAndUpdatesOutlined sx={{ fontSize: 18 }} />}>What helps your report</Heading>
          <Box component="ul" sx={{ m: 0, pl: 2.5, listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {TIPS.map(t => <Typography component="li" key={t} sx={{ display: 'list-item', fontSize: '0.86rem', color: '#334155' }}>{t}</Typography>)}
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b', mt: 1.25 }}>
            Leave out anything you do not know. You do not need evidence to file a report.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 2.5 }}>
          <Heading icon={<LockOutlined sx={{ fontSize: 18 }} />}>Your privacy</Heading>
          <Typography sx={{ fontSize: '0.86rem', color: '#334155' }}>
            Other residents cannot see your report. Reports that may involve violence against a woman or a child are kept
            confidential and go only to the barangay officers assigned to them.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
