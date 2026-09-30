'use client';

import { Box, Typography, Chip, Divider } from '@mui/material';
import { WarningAmber, LocalPhone, AutoAwesome } from '@mui/icons-material';
import { PNP_CONTACT_NUMBER, type GbvAnalysis } from '@/lib/gbvAnalysis';

/**
 * The initial risk assessment as shown to the person who filed the report.
 *
 * Everything here comes from the report itself. The component never states that
 * anyone has been contacted or notified — on a High classification it shows the
 * PNP number so the reporter can call, which is not the same as the system
 * having called, and says so.
 */

const LEVEL_COLOR: Record<string, string> = { High: '#ef4444', Medium: '#f97316', Low: '#22c55e' };
const LEVEL_BG: Record<string, string> = { High: '#fef2f2', Medium: '#fff7ed', Low: '#f0fdf4' };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 0.4 }}>
      <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', minWidth: 132, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

function Bullets({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography sx={{
        fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5,
      }}>
        {title}
      </Typography>
      {items.map((t, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mb: 0.3 }}>
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: color, flexShrink: 0, mt: '6px' }} />
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>{t}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function RiskAssessmentResult({ assessment, score, confidence, highRiskZone }: {
  assessment: GbvAnalysis;
  score?: number;
  confidence?: number;
  highRiskZone?: boolean;
}) {
  const color = LEVEL_COLOR[assessment.level] ?? '#94a3b8';
  const isHigh = assessment.level === 'High';

  return (
    <Box>
      <Box sx={{ bgcolor: LEVEL_BG[assessment.level] ?? '#f8fafc', border: `1px solid ${color}33`, borderRadius: 2.5, p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
          <AutoAwesome sx={{ fontSize: 15, color }} />
          <Typography sx={{
            fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase',
            fontWeight: 700, letterSpacing: '0.06em',
          }}>
            AI Risk Assessment
          </Typography>
          {highRiskZone && (
            <Chip label="High-Risk Zone" size="small"
              sx={{ bgcolor: '#ef444420', color: '#ef4444', fontWeight: 700, fontSize: '0.7rem', height: 20, ml: 'auto' }} />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
          <Chip
            label={`Risk Level: ${assessment.level.toUpperCase()}`}
            size="small"
            icon={isHigh ? <WarningAmber sx={{ fontSize: '15px !important', color: 'white !important' }} /> : undefined}
            sx={{ bgcolor: color, color: 'white', fontWeight: 800, fontSize: '0.8rem' }}
          />
          {typeof score === 'number' && typeof confidence === 'number' && (
            <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Score {score}/100 · {confidence}% confidence
            </Typography>
          )}
        </Box>

        <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.6, mb: 1.25 }}>
          {assessment.reason}
        </Typography>

        <Bullets title="Detected risk factors" items={assessment.detectedFactors.map(f => f.label)} color={color} />
        <Bullets title="Severity indicators" items={assessment.severityIndicators} color={color} />

        <Divider sx={{ my: 1.25 }} />

        <Row label="Frequency" value={assessment.frequency} />
        <Row label="Escalation" value={assessment.escalation} />
        <Row label="Immediate danger" value={assessment.immediateDanger} />
        <Row label="Recommended review" value={assessment.recommendedReview} />

        <Bullets title="Missing information" items={assessment.missingInformation} color="#cbd5e1" />
      </Box>

      {isHigh && (
        <Box sx={{
          mt: 1.5, borderRadius: 2.5, p: 2,
          bgcolor: '#fef2f2', border: '2px solid #ef4444',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
            <WarningAmber sx={{ fontSize: 18, color: '#ef4444' }} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#991b1b' }}>
              HIGH RISK CASE
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.86rem', color: '#7f1d1d', lineHeight: 1.6, mb: 1.25 }}>
            This report has been classified as HIGH RISK based on the information provided.
            For immediate assistance, or if you are in danger right now, contact the Philippine National Police.
          </Typography>

          <Box
            component="a"
            href={`tel:${PNP_CONTACT_NUMBER.replace(/-/g, '')}`}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              bgcolor: '#ef4444', color: '#fff', textDecoration: 'none',
              px: 2, py: 1, borderRadius: 2, fontWeight: 800, fontSize: '1rem',
              '&:hover': { bgcolor: '#dc2626' },
            }}
          >
            <LocalPhone sx={{ fontSize: 18 }} />
            PNP: {PNP_CONTACT_NUMBER}
          </Box>

          {/* Stated plainly: showing the number is not the same as the system
              having reported anything on the reporter's behalf. */}
          <Typography sx={{ fontSize: '0.78rem', color: '#7f1d1d', mt: 1.25, lineHeight: 1.55 }}>
            SafeComm has <strong>not</strong> contacted the PNP on your behalf, and this classification has not been
            sent to them. It is an initial assessment that a barangay officer will review.
          </Typography>
        </Box>
      )}

      <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', mt: 1.25, lineHeight: 1.55 }}>
        SafeComm&apos;s AI classification is an initial assessment. It does not replace human review or professional
        judgement, and it does not determine fault.
      </Typography>
    </Box>
  );
}
