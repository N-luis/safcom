'use client';

import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Skeleton, Button, Divider, Tooltip, Collapse, Alert, Dialog,
  DialogTitle, DialogContent, DialogActions, IconButton, Stack,
  Accordion, AccordionSummary, AccordionDetails, Select, MenuItem,
  FormControl,
} from '@mui/material';
import {
  Psychology, Warning, CheckCircle, TrendingUp, Shield, Info,
  AutoAwesome, Refresh, ExpandMore, ExpandLess, LocationOn,
  Person, AccessTime, Category, Science, DataObject,
  LocalPolice, Construction, Visibility, Campaign, Healing, Groups,
  AccountBalance, Assessment, Hub,
} from '@mui/icons-material';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  Legend, Cell,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useAIStats } from '@/hooks/useApi';

const RiskHeatMap = dynamic(() => import('@/components/cases/RiskHeatMap'), { ssr: false });

// ─── Types ──────────────────────────────────────────────────────────────────

interface FactorScore {
  factor: string;
  weight: number;
  score: number;
  contribution: number;
  detail: string;
}

interface RiskCase {
  id: string;
  caseNumber: string;
  residentName: string;
  caseType: string;
  barangay: string;
  status: string;
  score: number;
  level: 'High' | 'Medium' | 'Low';
  confidence: number;
  recommendation: string;
  riskFactors: string[];
  justification: string;
  highRiskZone: boolean;
  factors: FactorScore[];
  filedAt: string;
}

interface AreaIntervention {
  barangay: string;
  highRisk: number;
  total: number;
  avgScore: number;
  dominantCaseTypes: string[];
}

interface ModelStat {
  factor: string;
  avgScore: number;
  casesTriggered: number;
}

interface AIStatsData {
  summary: { critical: number; high: number; medium: number; low: number };
  byCategory: { type: string; count: number; avgScore: number; high: number }[];
  byBarangay: { barangay: string; total: number; highRisk: number; avgScore: number }[];
  monthly: { month: string; High: number; Medium: number; Low: number }[];
  radarData: { subject: string; score: number; count: number; fullMark: number }[];
  topRiskCases: RiskCase[];
  areaInterventions: AreaIntervention[];
  modelStats: ModelStat[];
  totalAnalyzed: number;
  lastUpdated: string;
  modelEngine: string;
}

interface InterventionAction {
  category: string;
  iconKey: string;
  color: string;
  priority: 'High' | 'Medium' | 'Low';
  timeframe: string;
  actions: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  Critical: '#8b5cf6', High: '#ef4444', Medium: '#f97316', Low: '#22c55e',
};

const PRIORITY_COLOR: Record<string, string> = { High: '#ef4444', Medium: '#f97316', Low: '#22c55e' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, any> = {
  LocalPolice, Construction, Visibility, Campaign, Healing, Groups,
  AccountBalance, Category, Person, LocationOn, AccessTime, Science, CheckCircle, Info,
};

const MODEL_META: Record<string, { name: string; desc: string; weight: number; color: string; iconKey: string }> = {
  'Case Type Severity': {
    name: 'Severity Classifier',
    desc: 'Classifies incident type against 40+ offense severity maps',
    weight: 25, color: '#ef4444', iconKey: 'Category',
  },
  'Incident Description': {
    name: 'NLP Description Scanner',
    desc: 'Analyzes case narrative for risk language, weapon mentions, and threat indicators',
    weight: 20, color: '#8b5cf6', iconKey: 'Science',
  },
  'Prior Case History': {
    name: 'Recidivism Detector',
    desc: 'Tracks prior blotter records and repeat-incident patterns per resident',
    weight: 20, color: '#f97316', iconKey: 'Person',
  },
  'Area Incident Frequency': {
    name: 'GeoRisk Engine',
    desc: 'Geographic incident density and area hotspot cluster analysis',
    weight: 15, color: '#3b82f6', iconKey: 'LocationOn',
  },
  'Response Urgency': {
    name: 'Urgency Analyzer',
    desc: 'Case age, resolution status, and intervention timeliness scoring',
    weight: 12, color: '#06b6d4', iconKey: 'AccessTime',
  },
  'Incident Time': {
    name: 'Temporal Pattern Engine',
    desc: 'Time-of-incident risk windows and night/late-evening pattern signals',
    weight: 8, color: '#22c55e', iconKey: 'AccessTime',
  },
};

const MODEL_ORDER = [
  'Case Type Severity', 'Incident Description', 'Prior Case History',
  'Area Incident Frequency', 'Response Urgency', 'Incident Time',
];

function scoreColor(score: number) {
  return score >= 55 ? '#ef4444' : score >= 35 ? '#f97316' : '#22c55e';
}

// ─── Recommendation Engine ───────────────────────────────────────────────────

function generateInterventions(area: AreaIntervention): InterventionAction[] {
  const types = (area.dominantCaseTypes ?? []).join(' ').toLowerCase();
  const hasViolence = /assault|violence|physical|vaw|battery|harm|abuse|domestic/i.test(types);
  const hasDrugs = /drug|substance|narcotic|illegal/i.test(types);
  const hasTheft = /theft|robbery|steal|snatch/i.test(types);
  const hasDispute = /dispute|quarrel|neighbor|noise|complaint|harassment/i.test(types);
  const isHighRisk = area.avgScore >= 55 || area.highRisk >= 2;
  const isCritical = area.highRisk >= 4 || area.avgScore >= 70;
  const out: InterventionAction[] = [];

  // 1. Immediate Response
  const immediateActions: string[] = [];
  if (isHighRisk) immediateActions.push('Alert barangay captain and all tanod units for immediate area monitoring');
  if (isCritical) immediateActions.push('Request PNP Station for emergency police reinforcement in the area');
  if (hasViolence) immediateActions.push('Ensure immediate victim protection and medical assistance access');
  if (hasDrugs) immediateActions.push('Activate anti-drug watch protocol and notify drug clearing committee');
  if (!immediateActions.length) immediateActions.push('Maintain standard monitoring protocol and log all new incidents');
  out.push({
    category: 'Immediate Response',
    iconKey: 'LocalPolice',
    color: '#ef4444',
    priority: isCritical || isHighRisk ? 'High' : 'Medium',
    timeframe: 'Within 24 hours',
    actions: immediateActions.slice(0, 3),
  });

  // 2. Infrastructure Improvements
  const infraActions: string[] = [];
  if (isHighRisk) infraActions.push('Request CCTV installation at identified hotspot intersections');
  infraActions.push('Improve street lighting at high-incident locations, especially night-time zones');
  if (hasTheft || hasDrugs) infraActions.push('Install community watch program boards and emergency contact signage');
  infraActions.push('Set up dedicated barangay help desk for incident reporting and victim referrals');
  out.push({
    category: 'Infrastructure Improvements',
    iconKey: 'Construction',
    color: '#f97316',
    priority: isHighRisk ? 'Medium' : 'Low',
    timeframe: '1–4 weeks',
    actions: infraActions.slice(0, 3),
  });

  // 3. Increased Patrol Frequency
  const patrolActions: string[] = [];
  patrolActions.push(`Schedule additional tanod patrol rounds in ${area.barangay} high-incident zones`);
  if (hasDrugs) patrolActions.push('Coordinate with PDEA regional office for joint anti-drug patrol operations');
  if (hasTheft) patrolActions.push('Establish visible tanod checkpoint during peak hours (6PM–12AM)');
  patrolActions.push('Deploy foot patrols to key communal areas (parks, markets, terminals)');
  out.push({
    category: 'Increased Patrol Frequency',
    iconKey: 'Visibility',
    color: '#3b82f6',
    priority: isHighRisk ? 'High' : 'Medium',
    timeframe: 'Immediate – Ongoing',
    actions: patrolActions.slice(0, 3),
  });

  // 4. Community Awareness Programs
  const awarenessActions: string[] = [];
  if (hasViolence) awarenessActions.push('Conduct VAWC awareness seminar and distribute materials to all households');
  if (hasDrugs) awarenessActions.push('Organize anti-drug symposium targeting youth and parents (DepEd coordination)');
  if (hasDispute) awarenessActions.push('Run neighborhood harmony campaign and conflict de-escalation workshops');
  awarenessActions.push('Distribute emergency hotlines, safety tips, and barangay protocol flyers');
  awarenessActions.push('Hold barangay assembly to inform residents of current risk levels and safety protocols');
  out.push({
    category: 'Community Awareness Programs',
    iconKey: 'Campaign',
    color: '#8b5cf6',
    priority: 'Medium',
    timeframe: '1–2 weeks',
    actions: awarenessActions.slice(0, 3),
  });

  // 5. Counseling & Psychosocial Support (only when violence or elevated risk)
  if (hasViolence || area.highRisk >= 2) {
    const counselingActions: string[] = [];
    if (hasViolence) counselingActions.push('Refer all VAWC case victims to DSWD psychosocial support services immediately');
    counselingActions.push('Connect affected residents with BHERT for trauma support and crisis counseling');
    counselingActions.push('Engage municipal social worker for family counseling and crisis intervention');
    if (hasViolence) counselingActions.push('Establish safe room at barangay hall for victims requiring temporary shelter');
    out.push({
      category: 'Counseling & Psychosocial Support',
      iconKey: 'Healing',
      color: '#ec4899',
      priority: hasViolence ? 'High' : 'Medium',
      timeframe: 'Within 48 hours',
      actions: counselingActions.slice(0, 3),
    });
  }

  // 6. Mediation Services (only when disputes or multiple cases)
  if (hasDispute || area.total >= 3) {
    const mediationActions: string[] = [];
    mediationActions.push('Schedule katarungang pambarangay (KP) mediation for all pending disputes');
    mediationActions.push('Engage lupong tagapamayapa panel for formal conflict resolution and conciliation');
    if (hasDispute) mediationActions.push('Conduct structured dialogue between conflicting parties with trained mediator');
    mediationActions.push('Document mediation outcomes and enforce 30-day compliance follow-up');
    out.push({
      category: 'Mediation Services',
      iconKey: 'Groups',
      color: '#06b6d4',
      priority: 'Medium',
      timeframe: '1–2 weeks',
      actions: mediationActions.slice(0, 3),
    });
  }

  // 7. Inter-Agency Referrals
  const agencyActions: string[] = [];
  if (hasDrugs) agencyActions.push('File formal referral to PDEA/PNP Drug Enforcement Unit for drug-related cases');
  if (hasViolence) agencyActions.push('Coordinate with WCPU (Women and Children Protection Unit) for victim assistance');
  agencyActions.push('Submit comprehensive area risk report to Municipal Social Welfare and Development Office');
  if (isCritical) agencyActions.push('Request PNP for formal High-Risk Zone designation and coordinated response plan');
  agencyActions.push('Engage LGU health center for community health monitoring and wellness intervention');
  out.push({
    category: 'Inter-Agency Referrals',
    iconKey: 'AccountBalance',
    color: '#14b8a6',
    priority: isCritical ? 'High' : 'Medium',
    timeframe: '1 week',
    actions: agencyActions.slice(0, 3),
  });

  return out;
}

function generateCaseRecommendations(c: RiskCase): { label: string; color: string; iconKey: string }[] {
  const type = c.caseType.toLowerCase();
  const recs: { label: string; color: string; iconKey: string }[] = [];

  if (c.level === 'High') {
    recs.push({ label: 'Immediate case officer assignment required', color: '#ef4444', iconKey: 'LocalPolice' });
  }
  if (c.highRiskZone) {
    recs.push({ label: 'High-Risk Zone — coordinate area-wide response measures', color: '#8b5cf6', iconKey: 'LocationOn' });
  }
  if (/assault|violence|vaw|harm|battery|abuse|domestic/i.test(type)) {
    recs.push({ label: 'WCPU referral recommended for victim protection', color: '#ec4899', iconKey: 'Healing' });
    recs.push({ label: 'Victim psychosocial support — DSWD referral', color: '#ec4899', iconKey: 'Healing' });
  }
  if (/drug|narcotic/i.test(type)) {
    recs.push({ label: 'Forward to PDEA for drug case classification', color: '#f97316', iconKey: 'AccountBalance' });
  }
  if (/theft|robbery/i.test(type)) {
    recs.push({ label: 'Increase tanod patrol in affected area', color: '#3b82f6', iconKey: 'Visibility' });
  }
  if (/dispute|quarrel|neighbor/i.test(type)) {
    recs.push({ label: 'Schedule KP mediation session within 7 days', color: '#06b6d4', iconKey: 'Groups' });
  }

  const repeatFactor = c.factors?.find(f => f.factor === 'Prior Case History');
  if (repeatFactor && repeatFactor.score >= 50) {
    recs.push({ label: 'Recidivism risk — enroll in pre-emptive intervention program', color: '#f97316', iconKey: 'Person' });
  }

  const locationFactor = c.factors?.find(f => f.factor === 'Area Incident Frequency');
  if (locationFactor && locationFactor.score >= 60) {
    recs.push({ label: 'High-incident zone — initiate area patrol schedule', color: '#3b82f6', iconKey: 'Visibility' });
  }

  if (recs.length === 0) {
    recs.push({ label: 'Standard monitoring and scheduled follow-up procedure', color: '#22c55e', iconKey: 'CheckCircle' });
  }
  return recs.slice(0, 4);
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RiskScoreRing({ score, level, size = 64 }: { score: number; level: string; size?: number }) {
  const color = RISK_COLOR[level] ?? '#94a3b8';
  const inner = Math.round(size * 0.74);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{
        width: size, height: size, borderRadius: '50%',
        background: `conic-gradient(${color} ${score * 3.6}deg, #f1f5f9 0deg)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Box sx={{
          width: inner, height: inner, borderRadius: '50%', bgcolor: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{ fontSize: size >= 60 ? '1rem' : '0.8rem', fontWeight: 800, color, lineHeight: 1 }}>
            {score}
          </Typography>
        </Box>
      </Box>
      <Chip label={level} size="small" sx={{ bgcolor: `${color}18`, color, fontWeight: 700, fontSize: '0.72rem', height: 22, px: 0.5 }} />
    </Box>
  );
}

function FactorRow({ f, i }: { f: FactorScore; i: number }) {
  const meta = MODEL_META[f.factor];
  const IconComp = meta ? ICON_MAP[meta.iconKey] : Info;
  const col = meta?.color ?? scoreColor(f.score);
  return (
    <motion.div key={f.factor} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <IconComp sx={{ fontSize: 13, color: col }} />
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#374151' }}>
              {meta?.name ?? f.factor}
            </Typography>
            <Chip label={`w:${f.weight}%`} size="small" sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#f1f5f9', color: '#94a3b8', ml: 0.25 }} />
          </Box>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: col }}>{f.contribution}pts</Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={f.score}
          sx={{ height: 5, borderRadius: 5, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: col, borderRadius: 5 } }}
        />
        <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 0.3, lineHeight: 1.4 }}>{f.detail}</Typography>
      </Box>
    </motion.div>
  );
}

function ExpandableRow({ c }: { c: RiskCase }) {
  const [open, setOpen] = useState(false);
  const color = RISK_COLOR[c.level] ?? '#94a3b8';
  const caseRecs = generateCaseRecommendations(c);

  return (
    <>
      <TableRow
        onClick={() => setOpen(p => !p)}
        sx={{
          cursor: 'pointer',
          '& td': { py: 1.2, borderBottom: open ? 'none' : '1px solid #f8fafc' },
          '&:hover': { bgcolor: `${color}07` },
          bgcolor: open ? `${color}05` : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <TableCell>
          <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>#{c.caseNumber}</Typography>
        </TableCell>
        <TableCell>
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{c.residentName}</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{c.barangay}</Typography>
        </TableCell>
        <TableCell>
          <Chip
            label={c.caseType.split(' ').slice(0, 2).join(' ')}
            size="small"
            sx={{ fontSize: '0.78rem', height: 24, bgcolor: '#f1f5f9', color: '#475569' }}
          />
        </TableCell>
        <TableCell>
          <RiskScoreRing score={c.score} level={c.level} size={52} />
        </TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%',
              bgcolor: c.status === 'Open' ? '#f97316' : c.status === 'In Progress' ? '#3b82f6' : '#22c55e',
              flexShrink: 0,
            }} />
            <Typography sx={{ fontSize: '0.86rem' }}>{c.status}</Typography>
          </Box>
        </TableCell>
        <TableCell>
          <Chip label={`${c.confidence}% conf.`} size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
        </TableCell>
        <TableCell padding="none" sx={{ pr: 1 }}>
          <IconButton size="small" sx={{ p: 0.3 }}>
            {open ? <ExpandLess sx={{ fontSize: 15, color: '#94a3b8' }} /> : <ExpandMore sx={{ fontSize: 15, color: '#94a3b8' }} />}
          </IconButton>
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, borderBottom: open ? '1px solid #f1f5f9' : 'none', px: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2, px: 2.5, bgcolor: '#fafbfd', borderLeft: `3px solid ${color}` }}>

              {/* Justification banner */}
              <Box sx={{
                display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2,
                p: 1.25, borderRadius: 2, bgcolor: `${color}0d`, border: `1px solid ${color}22`,
              }}>
                <AutoAwesome sx={{ fontSize: 14, color, mt: '1px', flexShrink: 0 }} />
                <Box>
                  <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color, mb: 0.25 }}>
                    AI Justification
                  </Typography>
                  <Typography sx={{ fontSize: '0.86rem', color: '#374151', lineHeight: 1.5 }}>
                    {c.justification}
                  </Typography>
                  {c.riskFactors?.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                      {c.riskFactors.map((rf, i) => (
                        <Chip key={i} label={rf} size="small" sx={{ bgcolor: `${color}14`, color, fontSize: '0.72rem', height: 22 }} />
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Ensemble scorecard */}
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', mb: 1.25 }}>
                Ensemble Risk Scorecard — {c.score}/100
              </Typography>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                {(c.factors ?? []).map((f, i) => (
                  <Grid key={f.factor} size={{ xs: 12, sm: 6 }}>
                    <FactorRow f={f} i={i} />
                  </Grid>
                ))}
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              {/* AI Recommended Actions */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                <AutoAwesome sx={{ fontSize: 14, color }} />
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46' }}>
                  Recommended Actions
                </Typography>
                <Chip label="Decision Support" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                {caseRecs.map((rec, i) => {
                  const IconComp = ICON_MAP[rec.iconKey] ?? Info;
                  return (
                    <Box key={i} sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      px: 1.25, py: 0.65, borderRadius: 1.5,
                      bgcolor: `${rec.color}0f`, border: `1px solid ${rec.color}22`,
                    }}>
                      <IconComp sx={{ fontSize: 13, color: rec.color, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.86rem', color: '#374151', fontWeight: 500 }}>
                        {rec.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function InterventionsPanel({ areaInterventions }: { areaInterventions: AreaIntervention[] }) {
  const [selectedArea, setSelectedArea] = useState(0);
  const [expanded, setExpanded] = useState<string | false>('Immediate Response');

  if (!areaInterventions || areaInterventions.length === 0) {
    return (
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5, textAlign: 'center', py: 4 }}>
          <CheckCircle sx={{ fontSize: 36, color: '#22c55e', mb: 1 }} />
          <Typography sx={{ fontWeight: 600, color: '#374151' }}>No Data for Recommendations</Typography>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.5 }}>
            Run analysis to generate area-specific intervention recommendations.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const area = areaInterventions[selectedArea] ?? areaInterventions[0];
  const interventions = generateInterventions(area);
  const highPriority = interventions.filter(i => i.priority === 'High').length;

  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.75, flexWrap: 'wrap', gap: 1.5 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.4 }}>
              <Assessment sx={{ color: '#0c1e46', fontSize: 20 }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
                Priority Intervention Plan
              </Typography>
              <Chip
                label="AI-Generated"
                size="small"
                icon={<AutoAwesome sx={{ fontSize: '11px !important', color: '#7c3aed !important' }} />}
                sx={{ bgcolor: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: '0.72rem', height: 24 }}
              />
              {highPriority > 0 && (
                <Chip label={`${highPriority} High Priority`} size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>
              Actionable recommendations derived from historical case patterns, area risk scoring, and incident type analysis
            </Typography>
          </Box>
          {areaInterventions.length > 1 && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={selectedArea}
                onChange={(e) => setSelectedArea(Number(e.target.value))}
                sx={{ fontSize: '0.9rem', borderRadius: 2 }}
              >
                {areaInterventions.map((a, i) => (
                  <MenuItem key={a.barangay} value={i} sx={{ fontSize: '0.9rem' }}>
                    {a.barangay} ({a.highRisk} high-risk)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {/* Area summary context row */}
        <Box sx={{
          display: 'flex', gap: 1, mb: 2, p: 1.5, borderRadius: 2, flexWrap: 'wrap',
          bgcolor: `${scoreColor(area.avgScore)}08`, border: `1px solid ${scoreColor(area.avgScore)}22`,
          alignItems: 'center',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <LocationOn sx={{ fontSize: 14, color: scoreColor(area.avgScore) }} />
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#0c1e46' }}>{area.barangay}</Typography>
          </Box>
          <Chip label={`Avg Score: ${area.avgScore}/100`} size="small" sx={{ bgcolor: `${scoreColor(area.avgScore)}18`, color: scoreColor(area.avgScore), fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          <Chip label={`${area.highRisk} High-Risk`} size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          <Chip label={`${area.total} Total Cases`} size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
          {area.dominantCaseTypes.length > 0 && (
            <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
              Dominant: {area.dominantCaseTypes.join(' · ')}
            </Typography>
          )}
        </Box>

        {/* Accordion intervention categories */}
        {interventions.map((inv) => {
          const IconComp = ICON_MAP[inv.iconKey] ?? Info;
          const isOpen = expanded === inv.category;
          return (
            <Accordion
              key={inv.category}
              expanded={isOpen}
              onChange={(_, e) => setExpanded(e ? inv.category : false)}
              disableGutters
              elevation={0}
              sx={{
                mb: 0.6, border: '1px solid #f1f5f9', borderRadius: '8px !important',
                overflow: 'hidden', '&:before': { display: 'none' },
                '&.Mui-expanded': { borderColor: `${inv.color}44` },
                transition: 'border-color 0.15s',
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMore sx={{ fontSize: 18, color: inv.color }} />}
                sx={{
                  minHeight: 46, px: 1.75,
                  bgcolor: isOpen ? `${inv.color}07` : 'transparent',
                  '& .MuiAccordionSummary-content': { my: 0.75, alignItems: 'center', gap: 1 },
                }}
              >
                <Box sx={{ p: 0.45, bgcolor: `${inv.color}18`, borderRadius: 1, display: 'flex', flexShrink: 0 }}>
                  <IconComp sx={{ fontSize: 14, color: inv.color }} />
                </Box>
                <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46', flexGrow: 1 }}>
                  {inv.category}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mr: 0.5 }}>
                  <Chip
                    label={inv.priority}
                    size="small"
                    sx={{ bgcolor: `${PRIORITY_COLOR[inv.priority]}18`, color: PRIORITY_COLOR[inv.priority], fontWeight: 700, fontSize: '0.72rem', height: 22 }}
                  />
                  <Chip label={inv.timeframe} size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
                  <Chip label={`${inv.actions.length} action${inv.actions.length !== 1 ? 's' : ''}`} size="small" sx={{ bgcolor: `${inv.color}14`, color: inv.color, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 1.75, pb: 1.5, pt: 0.25 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {inv.actions.map((action, i) => (
                    <Box key={i} sx={{
                      display: 'flex', alignItems: 'flex-start', gap: 1,
                      px: 1.25, py: 0.75, borderRadius: 1.5,
                      bgcolor: `${inv.color}07`, border: `1px solid ${inv.color}18`,
                    }}>
                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: inv.color, mt: '7px', flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.86rem', color: '#374151', lineHeight: 1.55 }}>
                        {action}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ModelInfoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 800, color: '#0c1e46', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Hub sx={{ color: '#7c3aed', fontSize: 26 }} />
          Ensemble Engine v2.0
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Chip label="Active" color="success" size="small" sx={{ fontWeight: 700 }} />
            <Chip label="6-Model Consensus" size="small" sx={{ bgcolor: '#ede9fe', color: '#7c3aed', fontWeight: 700 }} />
            <Chip label="No API key required" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.78rem' }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0c1e46', mb: 0.5 }}>
            SafComm Rule-Based Ensemble v2.0
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#64748b', mb: 1.5, lineHeight: 1.6 }}>
            6 specialized sub-models independently analyze each case. Risk level is assigned by rule-based consensus — not a simple score threshold. Each decision is fully traceable.
          </Typography>
          <Box sx={{ bgcolor: '#f8fafc', borderRadius: 2, p: 1.75 }}>
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: '#374151', mb: 1 }}>Sub-Model Breakdown</Typography>
            {MODEL_ORDER.map(key => {
              const meta = MODEL_META[key];
              if (!meta) return null;
              const IconComp = ICON_MAP[meta.iconKey] ?? Info;
              return (
                <Box key={key} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'flex-start' }}>
                  <Chip label={`${meta.weight}%`} size="small" sx={{ height: 22, fontSize: '0.72rem', bgcolor: `${meta.color}18`, color: meta.color, fontWeight: 700, flexShrink: 0, mt: '1px' }} />
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                    <IconComp sx={{ fontSize: 14, color: meta.color, mt: '1px' }} />
                    <Box>
                      <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#374151' }}>{meta.name}</Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>{meta.desc}</Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })}
            <Divider sx={{ my: 1.25 }} />
            <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
              Rule-based classification: High (explicit triggers) → Medium (indicator pattern) → Low (no signals)
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />
        <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 1.5 }}>
          AI Upgrade Options
        </Typography>

        {[
          {
            name: 'Google Gemini 2.0 Flash', tag: 'Recommended', color: '#3b82f6', icon: '✦',
            pros: ['Free tier: 1,500 req/day — no billing needed', 'NLP case narrative analysis for hidden risk signals', 'JSON schema output for structured scoring', 'Cross-case pattern detection in one API call'],
            how: 'Case description + context → Gemini returns structured risk object',
          },
          {
            name: 'TensorFlow.js (Custom Model)', tag: 'Advanced', color: '#f97316', icon: '⬡',
            pros: ['Trains on your own historical case outcomes', 'Runs in Node.js — zero external dependency', 'Accuracy improves as more cases are resolved', 'Best at 1,000+ labeled training cases'],
            how: 'Export Prisma cases → train tf.sequential → serve as ONNX in API route',
          },
          {
            name: 'OpenAI GPT-4o Mini', tag: 'Alternative', color: '#8b5cf6', icon: '◈',
            pros: ['Most capable NLP narrative analysis', 'Structured outputs + function calling', 'Context-aware cross-case pattern detection', '$0.15/1M input tokens — cost-efficient'],
            how: 'Batch case bundle to gpt-4o-mini → parse structured JSON risk assessment',
          },
        ].map(m => (
          <Box key={m.name} sx={{ mb: 1.5, p: 1.5, border: '1px solid #f1f5f9', borderRadius: 2, '&:hover': { bgcolor: '#fafbfc' }, transition: 'all 0.15s' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Typography sx={{ fontSize: '1rem', lineHeight: 1, color: m.color }}>{m.icon}</Typography>
              <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>{m.name}</Typography>
              <Chip label={m.tag} size="small" sx={{ bgcolor: `${m.color}14`, color: m.color, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
            </Box>
            {m.pros.map(p => (
              <Box key={p} sx={{ display: 'flex', gap: 0.75, mb: 0.2, alignItems: 'flex-start' }}>
                <TrendingUp sx={{ fontSize: 12, color: m.color, mt: '2px', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.86rem', color: '#64748b' }}>{p}</Typography>
              </Box>
            ))}
            <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8', mt: 0.75, fontStyle: 'italic' }}>
              {m.how}
            </Typography>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} variant="contained" sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' } }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AIRiskPredictionPage() {
  const [modelInfoOpen, setModelInfoOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  const { data: stats, isLoading, mutate } = useAIStats() as {
    data: AIStatsData | undefined;
    isLoading: boolean;
    mutate: () => Promise<unknown>;
  };

  const runAnalysis = async () => {
    setAnalysing(true);
    await mutate();
    setAnalysing(false);
  };

  const summary = stats?.summary ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const totalAnalyzed = stats?.totalAnalyzed ?? 0;

  const summaryCards = [
    { label: 'High Risk', count: summary.high, color: '#ef4444', desc: 'Require immediate action' },
    { label: 'Medium Risk', count: summary.medium, color: '#f97316', desc: 'Monitor and schedule review' },
    { label: 'Low Risk', count: summary.low, color: '#22c55e', desc: 'Standard processing' },
    { label: 'Total Analyzed', count: totalAnalyzed, color: '#0c1e46', desc: 'Cases scored by AI engine' },
  ];

  return (
    <Box>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
              AI Risk Prediction
            </Typography>
            <Chip
              label="Ensemble Engine v2.0"
              size="small"
              icon={<Hub sx={{ fontSize: '13px !important', color: '#7c3aed !important' }} />}
              sx={{ bgcolor: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: '0.78rem', height: 24 }}
            />
            <Chip
              label="Decision Support"
              size="small"
              icon={<Shield sx={{ fontSize: '12px !important', color: '#0c1e46 !important' }} />}
              sx={{ bgcolor: '#f1f5f9', color: '#0c1e46', fontWeight: 600, fontSize: '0.78rem', height: 24 }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
            {stats
              ? `${totalAnalyzed} case${totalAnalyzed !== 1 ? 's' : ''} analyzed · Last run: ${new Date(stats.lastUpdated).toLocaleTimeString()} · ${stats.modelEngine}`
              : '6-model ensemble scoring with actionable intervention recommendations from live case data'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined" size="small"
            startIcon={<DataObject sx={{ fontSize: 16 }} />}
            onClick={() => setModelInfoOpen(true)}
            sx={{ borderRadius: 2, fontSize: '0.9rem', color: '#64748b', borderColor: '#e2e8f0', '&:hover': { borderColor: '#cbd5e1', bgcolor: '#f8fafc' } }}
          >
            Model Info
          </Button>
          <Button
            variant="contained"
            startIcon={analysing
              ? <Refresh sx={{ animation: 'spin 0.9s linear infinite', '@keyframes spin': { '100%': { transform: 'rotate(360deg)' } } }} />
              : <AutoAwesome sx={{ fontSize: 18 }} />}
            onClick={runAnalysis}
            disabled={analysing}
            sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' }, fontWeight: 600 }}
          >
            {analysing ? 'Analysing…' : 'Run Analysis'}
          </Button>
        </Stack>
      </Box>

      {/* ── Summary Cards ── */}
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        {summaryCards.map((r, i) => (
          <Grid key={r.label} size={{ xs: 6, sm: 3 }}>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <Card sx={{
                textAlign: 'center',
                transition: 'all 0.2s',
                '&:hover': { boxShadow: `0 8px 24px ${r.color}22`, transform: 'translateY(-2px)' },
              }}>
                <CardContent sx={{ p: 2, pb: '16px !important' }}>
                  {isLoading
                    ? <Skeleton variant="text" width={44} height={48} sx={{ mx: 'auto' }} />
                    : <Typography sx={{ fontSize: '2.1rem', fontWeight: 800, color: r.color, lineHeight: 1 }}>{r.count}</Typography>
                  }
                  <Typography sx={{ fontSize: '0.86rem', color: '#374151', fontWeight: 700, mt: 0.4 }}>{r.label}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mt: 0.2 }}>{r.desc}</Typography>
                </CardContent>
              </Card>
            </motion.div>
          </Grid>
        ))}
      </Grid>

      {/* ── Charts Row: Radar + Monthly ── */}
      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.4 }}>
                Risk Pattern by Category
              </Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.5 }}>
                Average AI risk score per incident type
              </Typography>
              <Box sx={{ height: 240 }}>
                {isLoading
                  ? <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
                  : stats?.radarData && stats.radarData.length > 0
                  ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={stats.radarData}>
                        <PolarGrid stroke="#f1f5f9" />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Radar name="Avg Risk Score" dataKey="score" stroke="#0c1e46" fill="#0c1e46" fillOpacity={0.16} strokeWidth={2} dot={{ fill: '#0c1e46', r: 3 }} />
                        <ChartTooltip
                          formatter={(v: unknown) => [`${String(v)}/100`, 'Avg Risk Score']}
                          contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  )
                  : (
                    <Box sx={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                      <Psychology sx={{ fontSize: 36, color: '#e2e8f0' }} />
                      <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No case data yet</Typography>
                    </Box>
                  )
                }
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46', mb: 0.4 }}>
                Monthly Risk Distribution
              </Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.5 }}>
                AI-computed risk levels stacked by month (last 6 months)
              </Typography>
              <Box sx={{ height: 240 }}>
                {isLoading
                  ? <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 2 }} />
                  : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats?.monthly ?? []} barSize={18} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                        <ChartTooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: '0.86rem' }} />
                        <Bar dataKey="High" stackId="a" fill="#ef4444" />
                        <Bar dataKey="Medium" stackId="a" fill="#f97316" />
                        <Bar dataKey="Low" stackId="a" fill="#22c55e" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── Street Hotspots ── */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
            <LocationOn sx={{ color: '#ef4444', fontSize: 18 }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>Street Risk Hotspots</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.75 }}>
            Top 8 streets by average AI risk score (color = risk level)
          </Typography>
          <Box sx={{ height: stats?.byBarangay?.length ? Math.max(160, (stats.byBarangay.length * 32) + 40) : 160 }}>
            {isLoading
              ? <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
              : stats?.byBarangay && stats.byBarangay.length > 0
              ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.byBarangay} layout="vertical" barSize={18} margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis dataKey="barangay" type="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={95} />
                    <ChartTooltip
                      formatter={(v: unknown, name: unknown) => [
                        `${String(v)}${name === 'avgScore' ? '/100' : ' cases'}`,
                        name === 'avgScore' ? 'Avg Risk Score' : 'High-Risk Cases',
                      ]}
                      contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.9rem' }}
                    />
                    <Bar dataKey="avgScore" name="avgScore" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#64748b' }}>
                      {(stats?.byBarangay ?? []).map((d, i) => (
                        <Cell key={i} fill={scoreColor(d.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
              : (
                <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                  <LocationOn sx={{ fontSize: 36, color: '#e2e8f0' }} />
                  <Typography sx={{ fontSize: '0.9rem', color: '#94a3b8' }}>No street data yet</Typography>
                </Box>
              )
            }
          </Box>
        </CardContent>
      </Card>

      {/* ── Street Risk Heatmap ── */}
      <Card sx={{ mb: 2.5 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
            <Box sx={{
              width: 26, height: 26, borderRadius: 1.5,
              background: 'linear-gradient(135deg, #22c55e 0%, #f97316 50%, #ef4444 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <LocationOn sx={{ fontSize: 14, color: 'white' }} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
              Street Risk Heatmap
            </Typography>
            <Chip
              label="Live Map"
              size="small"
              sx={{ bgcolor: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.72rem', height: 24 }}
            />
            <Chip
              label="Bocaue, Bulacan"
              size="small"
              icon={<LocationOn sx={{ fontSize: '11px !important', color: '#64748b !important' }} />}
              sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 24 }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1.75 }}>
            Street-level risk network plotted over the Biñang 2nd area map — heat intensity shows incident concentration per intersection and landmark
          </Typography>
          <RiskHeatMap />
        </CardContent>
      </Card>

      {/* ── Priority Interventions ── */}
      {isLoading
        ? <Card sx={{ mb: 2.5 }}><CardContent sx={{ p: 2.5 }}><Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} /></CardContent></Card>
        : <InterventionsPanel areaInterventions={stats?.areaInterventions ?? []} />
      }

      {/* ── Bottom Row: Cases Table ── */}
      <Grid container spacing={2.5}>

        {/* High-Risk Cases */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent sx={{ p: 2.5, pb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Warning sx={{ color: '#ef4444', fontSize: 18 }} />
                  <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
                    High-Risk Cases
                  </Typography>
                  {stats?.topRiskCases && stats.topRiskCases.length > 0 && (
                    <Chip label={`${stats.topRiskCases.length} flagged`} size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.78rem', height: 24 }} />
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75 }}>
                  <Chip label="Live" size="small" sx={{ bgcolor: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.72rem', height: 24 }} />
                  <Chip label="Click row to expand scorecard" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 24 }} />
                </Box>
              </Box>
            </CardContent>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', py: 1.2, borderBottom: '1px solid #f1f5f9' } }}>
                    {['Case #', 'Subject', 'Type', 'AI Score', 'Status', 'Confidence', ''].map(h => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  <AnimatePresence>
                    {isLoading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            {Array.from({ length: 7 }).map((__, j) => (
                              <TableCell key={j}><Skeleton variant="text" width={55} /></TableCell>
                            ))}
                          </TableRow>
                        ))
                      : (stats?.topRiskCases ?? []).length === 0
                      ? (
                          <TableRow>
                            <TableCell colSpan={7} sx={{ textAlign: 'center', py: 5 }}>
                              <CheckCircle sx={{ fontSize: 36, color: '#22c55e', display: 'block', mx: 'auto', mb: 1 }} />
                              <Typography sx={{ fontSize: '0.94rem', fontWeight: 600, color: '#374151' }}>
                                All Clear — No High-Risk Cases
                              </Typography>
                              <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', mt: 0.25 }}>
                                The AI engine found no high-risk cases in the database.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )
                      : (stats?.topRiskCases ?? []).map(c => <ExpandableRow key={c.id} c={c} />)
                    }
                  </AnimatePresence>
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>
      </Grid>

      {/* Model Info Dialog */}
      <ModelInfoDialog open={modelInfoOpen} onClose={() => setModelInfoOpen(false)} />
    </Box>
  );
}
