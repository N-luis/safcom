'use client';

import { Box, Typography, Chip, Divider, LinearProgress } from '@mui/material';
import {
  WarningAmber, LocalPhone, AutoAwesome, Person, Shield, Campaign,
  Insights, HelpOutlined, TaskAlt,
} from '@mui/icons-material';
import type { CaseAssessment, CasePriority, CaseRecommendation } from '@/lib/caseAssessment';

/**
 * What the resident sees once their report has been assessed.
 *
 * It reports the assessment and nothing more: it does not say anyone has been
 * contacted, does not name anyone a victim or an offender, and gives no legal
 * or medical opinion. The emergency numbers appear only when the configured
 * threshold is reached, so they still mean something when they do.
 */

const PRIORITY_COLOR: Record<CasePriority, string> = {
  'Routine': '#22c55e',
  'Priority Attention': '#f59e0b',
  'Urgent Attention': '#f97316',
  'Immediate Response': '#ef4444',
};

const PRIORITY_BG: Record<CasePriority, string> = {
  'Routine': '#f0fdf4',
  'Priority Attention': '#fffbeb',
  'Urgent Attention': '#fff7ed',
  'Immediate Response': '#fef2f2',
};

/** How far along each scale a value sits, for the little strength bars. */
function level(scale: readonly string[], value: string): number {
  const i = scale.indexOf(value);
  return i < 0 ? 0 : (i / (scale.length - 1)) * 100;
}

const SCALES = {
  immediateThreat: ['None Identified', 'Possible', 'Present', 'Critical'],
  incidentSeverity: ['Minor', 'Moderate', 'Serious', 'Critical'],
  recurrence: ['No Indication', 'Possible Recurrence', 'Repeated Incident', 'Ongoing Pattern'],
  vulnerability: ['Standard', 'Increased', 'Significant', 'Critical'],
  escalationPotential: ['Low Concern', 'Monitor', 'Elevated', 'Urgent'],
  urgency: ['Routine', 'Attention Needed', 'Priority', 'Immediate Response'],
} as const;

const FACTOR_LABEL: Record<keyof typeof SCALES, string> = {
  immediateThreat: 'Immediate Threat',
  incidentSeverity: 'Incident Severity',
  recurrence: 'Recurrence',
  vulnerability: 'Vulnerability',
  escalationPotential: 'Escalation Potential',
  urgency: 'Urgency',
};

const AUDIENCE: Record<CaseRecommendation['audience'], { label: string; icon: React.ElementType; color: string }> = {
  emergency: { label: 'If you need help now', icon: Campaign, color: '#ef4444' },
  resident: { label: 'What you can do', icon: Person, color: '#0ea5e9' },
  officer: { label: 'For the barangay officer', icon: Shield, color: '#64748b' },
};

function SectionTitle({ icon: Icon, children, color = '#94a3b8' }: {
  icon?: React.ElementType; children: React.ReactNode; color?: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
      {Icon && <Icon sx={{ fontSize: 15, color }} />}
      <Typography sx={{
        fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.06em',
        textTransform: 'uppercase', color,
      }}>
        {children}
      </Typography>
    </Box>
  );
}

function Card({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box sx={{ border: '1px solid #e8edf2', borderRadius: 2.5, p: 2, bgcolor: '#fff', ...sx }}>
      {children}
    </Box>
  );
}

export default function CaseAssessmentPanel({ assessment, caseNumber }: {
  assessment: CaseAssessment;
  caseNumber?: string;
}) {
  const color = PRIORITY_COLOR[assessment.priority];
  const urgent = assessment.priority === 'Immediate Response' || assessment.priority === 'Urgent Attention';

  let n = 0;
  const order: CaseRecommendation['audience'][] = ['emergency', 'resident', 'officer'];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, textAlign: 'left' }}>

      {/* 2–3. AI Case Assessment + Overall Case Priority */}
      <Card sx={{ bgcolor: PRIORITY_BG[assessment.priority], borderColor: `${color}44` }}>
        <SectionTitle icon={AutoAwesome} color={color}>AI Case Assessment</SectionTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
          <Typography sx={{ fontSize: '0.84rem', color: '#64748b' }}>Overall case priority</Typography>
          <Chip
            label={assessment.priority}
            size="small"
            icon={urgent ? <WarningAmber sx={{ fontSize: '15px !important', color: 'white !important' }} /> : undefined}
            sx={{ bgcolor: color, color: '#fff', fontWeight: 800, fontSize: '0.82rem' }}
          />
        </Box>
        <Typography sx={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.6 }}>
          {assessment.summary}
        </Typography>
      </Card>

      {/* 4. Assessment Factors */}
      <Card>
        <SectionTitle icon={Insights}>Assessment factors</SectionTitle>
        {(Object.keys(SCALES) as (keyof typeof SCALES)[]).map(key => {
          const value = assessment.factors[key];
          const pct = level(SCALES[key], value);
          const bar = pct >= 66 ? '#ef4444' : pct >= 34 ? '#f59e0b' : '#22c55e';
          return (
            <Box key={key} sx={{ mb: 1.1, '&:last-of-type': { mb: 0 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.3 }}>
                <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{FACTOR_LABEL[key]}</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46', fontWeight: 700 }}>{value}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={pct}
                aria-label={`${FACTOR_LABEL[key]}: ${value}`}
                sx={{
                  height: 5, borderRadius: 3, bgcolor: '#eef2f6',
                  '& .MuiLinearProgress-bar': { bgcolor: bar, borderRadius: 3 },
                }}
              />
            </Box>
          );
        })}
      </Card>

      {/* 5. Why This Assessment? */}
      <Card>
        <SectionTitle icon={HelpOutlined}>Why this assessment?</SectionTitle>
        <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.6 }}>
          {assessment.reason}
        </Typography>
        {assessment.missingInformation.length > 0 && (
          <>
            <Divider sx={{ my: 1.25 }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mb: 0.5 }}>
              Details that would change this reading if you can add them:
            </Typography>
            {assessment.missingInformation.map(m => (
              <Typography key={m} sx={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>• {m}</Typography>
            ))}
          </>
        )}
      </Card>

      {/* 6. Personalized Recommendations */}
      <Card>
        <SectionTitle icon={TaskAlt}>Recommended next actions</SectionTitle>
        {order.map(aud => {
          const group = assessment.recommendations.filter(r => r.audience === aud);
          if (!group.length) return null;
          const meta = AUDIENCE[aud];
          const Icon = meta.icon;
          return (
            <Box key={aud} sx={{ mb: 1.25, '&:last-of-type': { mb: 0 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.5 }}>
                <Icon sx={{ fontSize: 14, color: meta.color }} />
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: meta.color }}>{meta.label}</Typography>
              </Box>
              {group.map(r => {
                n += 1;
                return (
                  <Box key={r.text} sx={{ display: 'flex', gap: 0.9, mb: 0.45 }}>
                    <Typography sx={{ fontSize: '0.82rem', color: meta.color, fontWeight: 800, minWidth: 16 }}>{n}.</Typography>
                    <Typography sx={{ fontSize: '0.84rem', color: '#475569', lineHeight: 1.55 }}>{r.text}</Typography>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Card>

      {/* 7. Important Safety Notice — only above the configured threshold */}
      {assessment.showEmergencyNotice && (
        <Card sx={{ bgcolor: '#fef2f2', border: '2px solid #ef4444' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
            <WarningAmber sx={{ fontSize: 18, color: '#ef4444' }} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#991b1b' }}>
              Immediate attention recommended
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.86rem', color: '#7f1d1d', lineHeight: 1.6, mb: 1.25 }}>
            This report contains indicators that may require immediate attention. If you are currently in danger,
            seek assistance from the emergency authorities below.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {assessment.emergencyContacts.map(c => (
              <Box
                key={c.number}
                component="a"
                href={`tel:${c.number.replace(/[^0-9+]/g, '')}`}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.75,
                  bgcolor: '#ef4444', color: '#fff', textDecoration: 'none',
                  px: 1.75, py: 0.9, borderRadius: 2, fontWeight: 800, fontSize: '0.9rem',
                  // A thumb target, and full width on a phone so it cannot be missed.
                  minHeight: 44, width: { xs: '100%', sm: 'auto' }, justifyContent: 'center',
                  '&:hover': { bgcolor: '#dc2626' },
                  '&:focus-visible': { outline: '3px solid #fecaca', outlineOffset: 2 },
                }}
              >
                <LocalPhone sx={{ fontSize: 17 }} />
                {c.label}: {c.number}
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: '#7f1d1d', mt: 1.25, lineHeight: 1.55 }}>
            SafeComm has <strong>not</strong> contacted them for you, and this assessment has not been sent to them.
          </Typography>
        </Card>
      )}

      {/* 8–9. Case status, then what happens next */}
      <Card sx={{ bgcolor: '#f8fafc' }}>
        <SectionTitle icon={Shield}>Case status</SectionTitle>
        <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.6, mb: 1.25 }}>
          {caseNumber ? <>Your case <strong>#{caseNumber}</strong> is recorded and awaiting officer review.</> : 'Your case is recorded and awaiting officer review.'}
          {' '}You can follow it under My Cases.
        </Typography>

        <SectionTitle icon={HelpOutlined}>What happens next?</SectionTitle>
        {[
          'Your report has been recorded.',
          'The system performs an AI-assisted assessment.',
          'An authorized officer reviews the report.',
          'The case may be assigned for appropriate follow-up.',
          'You can monitor the status through your SafeComm account.',
          'You may provide additional information if requested.',
        ].map((step, i) => (
          <Box key={step} sx={{ display: 'flex', gap: 0.9, mb: 0.4 }}>
            <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 800, minWidth: 16 }}>{i + 1}.</Typography>
            <Typography sx={{ fontSize: '0.84rem', color: '#64748b', lineHeight: 1.55 }}>{step}</Typography>
          </Box>
        ))}
      </Card>

      {/* 10. Limits of the assessment */}
      <Box>
        {assessment.safetyReminders.map(r => (
          <Typography key={r} sx={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6, mb: 0.4 }}>
            {r}
          </Typography>
        ))}
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6 }}>
          Authorized personnel remain responsible for reviewing and handling this case. If you need help with your
          report, contact your barangay office.
        </Typography>
      </Box>
    </Box>
  );
}
