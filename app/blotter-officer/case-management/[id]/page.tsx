'use client';

import { useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, IconButton,
  Divider, LinearProgress, Skeleton, TextField, Select, MenuItem,
  FormControl, InputLabel, Tooltip, Paper, Collapse, Alert,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBack, Add, Save, Edit, Delete, CheckCircle, Warning,
  LocationOn, Person, AccessTime, FolderOpen, Shield, Search,
  AutoAwesome, Psychology, Notes, Update, Close, OpenInNew,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { mutate } from 'swr';
import toast from 'react-hot-toast';
import { useCaseDetail } from '@/hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FollowUp {
  id: string;
  type: string;
  content: string;
  statusFrom?: string | null;
  statusTo?: string | null;
  outcome?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; role: string } | null;
}

interface CaseActivity {
  id: string;
  type: string;
  message: string;
  color: string;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

interface FactorScore {
  factor: string;
  weight: number;
  score: number;
  contribution: number;
  detail: string;
}

interface AIRisk {
  score: number;
  level: 'High' | 'Medium' | 'Low';
  factors: FactorScore[];
  riskFactors: string[];
  justification: string;
  recommendation: string;
  confidence: number;
  highRiskZone: boolean;
}

interface CaseDetail {
  id: string;
  caseNumber: string;
  residentName: string;
  caseType: string;
  status: string;
  riskLevel: string;
  barangay: string;
  description: string;
  notes?: string | null;
  filedAt: string;
  resolvedAt?: string | null;
  updatedAt: string;
  assignedTo?: { id: string; name: string; email: string; role: string } | null;
  resident?: { id: string; firstName: string; lastName: string } | null;
  activities: CaseActivity[];
  followUps: FollowUp[];
  aiRiskAssessment?: AIRisk;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  High: '#ef4444', Medium: '#f97316', Low: '#22c55e', Critical: '#8b5cf6',
};

const STATUS_STAGES = [
  { key: 'Open',                     label: 'Newly Reported',          color: '#64748b' },
  { key: 'Under Investigation',      label: 'Under Investigation',     color: '#3b82f6' },
  { key: 'Intervention in Progress', label: 'Intervention in Progress',color: '#8b5cf6' },
  { key: 'Pending Resolution',       label: 'Pending Resolution',      color: '#f59e0b' },
  { key: 'Resolved',                 label: 'Closed / Resolved',       color: '#22c55e' },
];

const ALL_STATUSES = [
  'Open', 'Under Investigation', 'In Progress',
  'Intervention in Progress', 'Pending Resolution',
  'Resolved', 'Closed',
];

const STATUS_STEP: Record<string, number> = {
  'Open': 0, 'In Progress': 1, 'Under Investigation': 1,
  'Intervention in Progress': 2, 'Pending Resolution': 3,
  'Resolved': 4, 'Closed': 4,
};

const STATUS_COLOR: Record<string, string> = {
  'Open': '#f97316', 'In Progress': '#3b82f6', 'Under Investigation': '#3b82f6',
  'Intervention in Progress': '#8b5cf6', 'Pending Resolution': '#f59e0b',
  'Resolved': '#22c55e', 'Closed': '#94a3b8',
};

const FOLLOWUP_META: Record<string, { label: string; color: string; Icon: typeof Notes }> = {
  note:           { label: 'Note',                  color: '#64748b', Icon: Notes },
  investigation:  { label: 'Investigation Update',  color: '#3b82f6', Icon: Search },
  intervention:   { label: 'Intervention Applied',  color: '#8b5cf6', Icon: Shield },
  evidence:       { label: 'Evidence Added',        color: '#f97316', Icon: FolderOpen },
  status_change:  { label: 'Status Changed',        color: '#22c55e', Icon: Update },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullDate(d: string) {
  return new Date(d).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── Progress Tracker ────────────────────────────────────────────────────────

function ProgressTracker({ status }: { status: string }) {
  const currentStep = STATUS_STEP[status] ?? 0;
  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent sx={{ px: 3, py: 2.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', mb: 2 }}>
          Case Progress
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
          {/* connector line */}
          <Box sx={{
            position: 'absolute', top: 11, left: '5%', right: '5%',
            height: 2, bgcolor: '#f1f5f9', zIndex: 0,
          }} />
          <Box sx={{
            position: 'absolute', top: 11, left: '5%',
            width: `${Math.min(95, currentStep * 23.75)}%`,
            height: 2, bgcolor: STATUS_STAGES[currentStep]?.color ?? '#64748b',
            transition: 'width 0.4s ease', zIndex: 1,
          }} />
          {STATUS_STAGES.map((stage, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const col = done || active ? stage.color : '#cbd5e1';
            return (
              <Box key={stage.key} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 2 }}>
                <Box sx={{
                  width: 24, height: 24, borderRadius: '50%',
                  bgcolor: done || active ? col : 'white',
                  border: `2px solid ${col}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.3s',
                  boxShadow: active ? `0 0 0 4px ${col}28` : 'none',
                }}>
                  {done && <CheckCircle sx={{ fontSize: 14, color: 'white' }} />}
                  {active && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'white' }} />}
                </Box>
                <Typography sx={{
                  fontSize: '0.72rem', fontWeight: active ? 700 : done ? 600 : 400,
                  color: active ? col : done ? '#64748b' : '#94a3b8',
                  mt: 0.75, textAlign: 'center', lineHeight: 1.3, maxWidth: 80,
                }}>
                  {stage.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}

// ─── Timeline Entry ──────────────────────────────────────────────────────────

interface TimelineEntryData {
  id: string;
  kind: 'filed' | 'follow_up' | 'activity';
  type: string;
  content: string;
  userName?: string;
  statusFrom?: string | null;
  statusTo?: string | null;
  outcome?: string | null;
  color: string;
  createdAt: string;
  followUpId?: string;
  canEdit?: boolean;
}

function TimelineEntry({
  entry, isLast, currentUserId, onEdit, onDelete,
}: {
  entry: TimelineEntryData;
  isLast: boolean;
  currentUserId?: string;
  onEdit?: (id: string, content: string, outcome: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const meta = FOLLOWUP_META[entry.type];
  const Icon = meta?.Icon ?? AutoAwesome;
  const color = entry.color;

  const isStatusChange = entry.kind === 'follow_up' && (entry.statusFrom || entry.statusTo);
  const isIntervention = entry.type === 'intervention';

  return (
    <Box sx={{ display: 'flex', gap: 2 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* Dot + line */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
        <Box sx={{
          width: 26, height: 26, borderRadius: '50%',
          bgcolor: entry.kind === 'filed' ? '#0c1e46' : `${color}18`,
          border: `2px solid ${entry.kind === 'filed' ? '#0c1e46' : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, zIndex: 1,
        }}>
          {entry.kind === 'filed'
            ? <FolderOpen sx={{ fontSize: 12, color: 'white' }} />
            : <Icon sx={{ fontSize: 12, color }} />
          }
        </Box>
        {!isLast && <Box sx={{ width: 2, flex: 1, bgcolor: '#f1f5f9', mt: 0.5, mb: 0.5 }} />}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, pb: isLast ? 0 : 3, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.5, gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {entry.kind === 'filed' && (
              <Chip label="Case Filed" size="small" sx={{ bgcolor: '#0c1e4618', color: '#0c1e46', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
            )}
            {entry.kind === 'follow_up' && meta && (
              <Chip label={meta.label} size="small" sx={{ bgcolor: `${color}18`, color, fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
            )}
            {entry.kind === 'activity' && (
              <Chip label="System" size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
            )}
            {entry.userName && (
              <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>by {entry.userName}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {fullDate(entry.createdAt)}
            </Typography>
            {entry.kind === 'follow_up' && entry.canEdit && hover && (
              <Box sx={{ display: 'flex', gap: 0.25 }}>
                <Tooltip title="Edit">
                  <IconButton size="small" sx={{ p: 0.2 }} onClick={() => onEdit?.(entry.followUpId!, entry.content, entry.outcome ?? '')}>
                    <Edit sx={{ fontSize: 12, color: '#94a3b8' }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton size="small" sx={{ p: 0.2 }} onClick={() => onDelete?.(entry.followUpId!)}>
                    <Delete sx={{ fontSize: 12, color: '#94a3b8' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
          </Box>
        </Box>

        {/* Status change badge */}
        {isStatusChange && entry.statusFrom && entry.statusTo && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
            <Chip label={entry.statusFrom} size="small" sx={{ bgcolor: `${STATUS_COLOR[entry.statusFrom] ?? '#94a3b8'}18`, color: STATUS_COLOR[entry.statusFrom] ?? '#94a3b8', fontSize: '0.72rem', height: 22 }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>→</Typography>
            <Chip label={entry.statusTo} size="small" sx={{ bgcolor: `${STATUS_COLOR[entry.statusTo] ?? '#94a3b8'}18`, color: STATUS_COLOR[entry.statusTo] ?? '#94a3b8', fontWeight: 700, fontSize: '0.72rem', height: 22 }} />
          </Box>
        )}

        {/* Content */}
        <Paper variant="outlined" sx={{
          p: 1.25, borderRadius: 1.5, bgcolor: entry.kind === 'filed' ? '#f8fafc' : `${color}05`,
          borderColor: entry.kind === 'activity' ? '#f1f5f9' : `${color}22`,
        }}>
          <Typography sx={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>
            {entry.content}
          </Typography>
        </Paper>

        {/* Intervention outcome */}
        {isIntervention && entry.outcome && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 0.75, px: 1, py: 0.6, borderRadius: 1.5, bgcolor: `${color}0a`, border: `1px solid ${color}22` }}>
            <CheckCircle sx={{ fontSize: 12, color, mt: '2px', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.86rem', color: '#374151' }}>
              <strong>Outcome:</strong> {entry.outcome}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Add Follow-Up Form ───────────────────────────────────────────────────────

function AddFollowUpForm({ caseId, currentStatus, onSaved }: {
  caseId: string;
  currentStatus: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('note');
  const [content, setContent] = useState('');
  const [updateStatus, setUpdateStatus] = useState(false);
  const [statusTo, setStatusTo] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setType('note'); setContent(''); setUpdateStatus(false); setStatusTo(''); setOutcome(''); };

  const submit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = { type, content: content.trim() };
      if (updateStatus && statusTo && statusTo !== currentStatus) payload.statusTo = statusTo;
      if (outcome.trim()) payload.outcome = outcome.trim();

      const res = await fetch(`/api/cases/${caseId}/follow-ups`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error || 'Failed to save'); }

      toast.success('Follow-up saved');
      reset();
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ mb: 2.5 }}>
      {!open ? (
        <Button
          fullWidth variant="outlined"
          startIcon={<Add />}
          onClick={() => setOpen(true)}
          sx={{
            borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b', py: 1.1,
            borderStyle: 'dashed',
            '&:hover': { borderColor: '#0c1e46', color: '#0c1e46', bgcolor: '#f8fafc' },
          }}
        >
          Add Follow-Up Report
        </Button>
      ) : (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <Card variant="outlined" sx={{ borderColor: '#e2e8f0', borderRadius: 2 }}>
            <CardContent sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.75 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>
                  New Follow-Up Entry
                </Typography>
                <IconButton size="small" onClick={() => { setOpen(false); reset(); }}>
                  <Close sx={{ fontSize: 16, color: '#94a3b8' }} />
                </IconButton>
              </Box>

              <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                <InputLabel>Entry Type</InputLabel>
                <Select value={type} label="Entry Type" onChange={e => setType(e.target.value)} sx={{ borderRadius: 2 }}>
                  {Object.entries(FOLLOWUP_META).map(([k, v]) => (
                    <MenuItem key={k} value={k}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: v.color, flexShrink: 0 }} />
                        {v.label}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth multiline rows={3} size="small"
                label="Content *"
                placeholder={
                  type === 'note' ? 'General note or observation…' :
                  type === 'investigation' ? 'Investigation findings, witness interviews, evidence collected…' :
                  type === 'intervention' ? 'Describe the intervention applied (counseling, patrol, mediation, etc.)…' :
                  type === 'evidence' ? 'Describe the evidence collected or received…' :
                  'Status update details…'
                }
                value={content}
                onChange={e => setContent(e.target.value)}
                sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
              />

              {type === 'intervention' && (
                <TextField
                  fullWidth size="small" label="Intervention Outcome (optional)"
                  placeholder="Result or impact of this intervention…"
                  value={outcome}
                  onChange={e => setOutcome(e.target.value)}
                  sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                />
              )}

              <Box sx={{
                p: 1.25, borderRadius: 2, bgcolor: '#f8fafc', border: '1px solid #f1f5f9', mb: 1.5,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: updateStatus ? 1.25 : 0 }}>
                  <Box
                    component="input" type="checkbox"
                    checked={updateStatus}
                    onChange={e => setUpdateStatus((e.target as HTMLInputElement).checked)}
                    style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#0c1e46' }}
                  />
                  <Typography sx={{ fontSize: '0.9rem', color: '#374151', cursor: 'pointer' }} onClick={() => setUpdateStatus(p => !p)}>
                    Also update case status
                  </Typography>
                  <Chip label={currentStatus} size="small" sx={{ bgcolor: `${STATUS_COLOR[currentStatus] ?? '#94a3b8'}18`, color: STATUS_COLOR[currentStatus] ?? '#94a3b8', fontWeight: 600, fontSize: '0.72rem', height: 22, ml: 'auto' }} />
                </Box>
                {updateStatus && (
                  <FormControl fullWidth size="small">
                    <InputLabel>New Status</InputLabel>
                    <Select value={statusTo} label="New Status" onChange={e => setStatusTo(e.target.value)} sx={{ borderRadius: 2 }}>
                      {ALL_STATUSES.filter(s => s !== currentStatus).map(s => (
                        <MenuItem key={s} value={s}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[s] ?? '#94a3b8', flexShrink: 0 }} />
                            {s}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" onClick={() => { setOpen(false); reset(); }} sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b', flex: 1 }}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  disabled={saving || !content.trim()}
                  onClick={submit}
                  startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save />}
                  sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' }, flex: 2 }}
                >
                  {saving ? 'Saving…' : 'Save Entry'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </Box>
  );
}

// ─── Edit Follow-Up Modal ─────────────────────────────────────────────────────

function EditFollowUpModal({ caseId, fid, initialContent, initialOutcome, onDone }: {
  caseId: string; fid: string;
  initialContent: string; initialOutcome: string;
  onDone: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [outcome, setOutcome] = useState(initialOutcome);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/follow-ups/${fid}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), outcome: outcome.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed to update');
      toast.success('Follow-up updated');
      onDone();
    } catch {
      toast.error('Failed to update follow-up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <Card variant="outlined" sx={{ borderColor: '#3b82f6', borderRadius: 2, mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#0c1e46', mb: 1.5 }}>
            Edit Follow-Up
          </Typography>
          <TextField fullWidth multiline rows={3} size="small" label="Content" value={content}
            onChange={e => setContent(e.target.value)}
            sx={{ mb: 1.25, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
          <TextField fullWidth size="small" label="Outcome (optional)" value={outcome}
            onChange={e => setOutcome(e.target.value)}
            sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" onClick={onDone} sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b', flex: 1 }}>Cancel</Button>
            <Button variant="contained" disabled={saving || !content.trim()} onClick={save}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save />}
              sx={{ borderRadius: 2, bgcolor: '#0c1e46', '&:hover': { bgcolor: '#1a3a6e' }, flex: 2 }}>
              {saving ? 'Saving…' : 'Update'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── AI Assessment Mini-Card ──────────────────────────────────────────────────

function AIAssessmentCard({ ai, riskLevel }: { ai?: AIRisk; riskLevel: string }) {
  const [expanded, setExpanded] = useState(false);
  const col = RISK_COLOR[ai?.level ?? riskLevel] ?? '#94a3b8';
  const score = ai?.score ?? 0;
  const inner = 44;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
          <Psychology sx={{ fontSize: 18, color: '#7c3aed' }} />
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46' }}>AI Risk Assessment</Typography>
          <Chip label="Ensemble Engine v2.0" size="small" sx={{ bgcolor: '#ede9fe', color: '#7c3aed', fontSize: '0.72rem', fontWeight: 700, height: 17, ml: 'auto' }} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: ai ? 1.25 : 0 }}>
          {/* Score ring */}
          <Box sx={{
            width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
            background: `conic-gradient(${col} ${score * 3.6}deg, #f1f5f9 0deg)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Box sx={{ width: inner, height: inner, borderRadius: '50%', bgcolor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: col, lineHeight: 1 }}>{score}</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8' }}>/100</Typography>
            </Box>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Chip label={ai?.level ?? riskLevel} size="small" sx={{ bgcolor: `${col}18`, color: col, fontWeight: 700, mb: 0.5 }} />
            {ai?.confidence && (
              <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>{ai.confidence}% model confidence</Typography>
            )}
            {ai?.highRiskZone && (
              <Chip label="⚠ High-Risk Zone" size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', height: 22, mt: 0.5 }} />
            )}
          </Box>
        </Box>

        {ai?.justification && (
          <Typography sx={{ fontSize: '0.86rem', color: '#475569', lineHeight: 1.55, mb: 1 }}>
            {ai.justification}
          </Typography>
        )}

        {ai?.riskFactors && ai.riskFactors.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: expanded ? 1.25 : 0 }}>
            {ai.riskFactors.map((rf, i) => (
              <Chip key={i} label={rf} size="small" sx={{ bgcolor: `${col}0f`, color: col, fontSize: '0.72rem', height: 22 }} />
            ))}
          </Box>
        )}

        {ai?.factors && ai.factors.length > 0 && (
          <>
            <Button
              size="small" onClick={() => setExpanded(p => !p)}
              sx={{ fontSize: '0.82rem', color: '#64748b', px: 0, '&:hover': { bgcolor: 'transparent', color: '#0c1e46' } }}
            >
              {expanded ? 'Hide' : 'Show'} factor breakdown
            </Button>
            <Collapse in={expanded}>
              <Box sx={{ mt: 1 }}>
                {ai.factors.map(f => (
                  <Box key={f.factor} sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                      <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>{f.factor}</Typography>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: col }}>{f.contribution}pts</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={f.score}
                      sx={{ height: 4, borderRadius: 4, bgcolor: '#f1f5f9', '& .MuiLinearProgress-bar': { bgcolor: col, borderRadius: 4 } }}
                    />
                    <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 0.25 }}>{f.detail}</Typography>
                  </Box>
                ))}
              </Box>
            </Collapse>
          </>
        )}

        {ai?.recommendation && (
          <Box sx={{ mt: 1.25, p: 1, borderRadius: 1.5, bgcolor: `${col}08`, border: `1px solid ${col}22` }}>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
              <AutoAwesome sx={{ fontSize: 13, color: col, mt: '1px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.86rem', color: '#374151' }}>{ai.recommendation}</Typography>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'interventions'>('all');
  const [editTarget, setEditTarget] = useState<{ fid: string; content: string; outcome: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);

  const { data: caseData, isLoading, mutate: revalidate } = useCaseDetail(id) as {
    data: CaseDetail | undefined; isLoading: boolean; mutate: () => void;
  };

  // Fetch current user id from auth context via stored cookie (simple approach)
  // We'll load it from the API on mount
  const [authUser, setAuthUser] = useState<{ userId: string; role: string } | null>(null);
  useMemo(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.data && setAuthUser({ userId: d.data.userId ?? d.data.id, role: d.data.role }))
      .catch(() => null);
  }, []);

  const onSaved = () => {
    revalidate();
    mutate((key: unknown) => typeof key === 'string' && key.includes('/api/cases'));
  };

  const handleDelete = async (fid: string) => {
    if (!confirm('Delete this follow-up entry?')) return;
    try {
      const res = await fetch(`/api/cases/${id}/follow-ups/${fid}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Entry deleted');
      onSaved();
    } catch {
      toast.error('Failed to delete entry');
    }
  };

  // Build merged chronological timeline
  const timeline: TimelineEntryData[] = useMemo(() => {
    if (!caseData) return [];
    const entries: TimelineEntryData[] = [];

    // Original filing
    entries.push({
      id: 'filed',
      kind: 'filed',
      type: 'filed',
      content: caseData.description,
      userName: caseData.residentName,
      color: '#0c1e46',
      createdAt: caseData.filedAt,
    });

    // Follow-up entries
    for (const fu of caseData.followUps ?? []) {
      entries.push({
        id: fu.id,
        kind: 'follow_up',
        type: fu.type,
        content: fu.content,
        userName: fu.user?.name,
        statusFrom: fu.statusFrom,
        statusTo: fu.statusTo,
        outcome: fu.outcome,
        color: FOLLOWUP_META[fu.type]?.color ?? '#64748b',
        createdAt: fu.createdAt,
        followUpId: fu.id,
        canEdit: fu.user?.id === authUser?.userId || authUser?.role === 'admin' || authUser?.role === 'system_admin',
      });
    }

    // System activities (exclude follow_up type to avoid duplicates)
    for (const act of caseData.activities ?? []) {
      if (act.type === 'follow_up') continue;
      entries.push({
        id: act.id,
        kind: 'activity',
        type: 'activity',
        content: act.message,
        userName: act.user?.name,
        color: act.color,
        createdAt: act.createdAt,
      });
    }

    return entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [caseData, authUser]);

  const interventions = timeline.filter(e => e.type === 'intervention');
  const displayTimeline = timelineFilter === 'interventions' ? interventions : timeline;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="rectangular" height={64} sx={{ borderRadius: 2, mb: 2 }} />
        <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2, mb: 2 }} />
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (!caseData) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <FolderOpen sx={{ fontSize: 48, color: '#e2e8f0', mb: 2 }} />
        <Typography sx={{ fontWeight: 600, color: '#374151' }}>Case not found</Typography>
        <Button onClick={() => router.back()} sx={{ mt: 2 }}>Go Back</Button>
      </Box>
    );
  }

  const riskCol = RISK_COLOR[caseData.riskLevel] ?? '#94a3b8';
  const statusCol = STATUS_COLOR[caseData.status] ?? '#94a3b8';

  return (
    <Box>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Tooltip title="Back to Case Management">
            <IconButton onClick={() => router.push('/blotter-officer/case-management')} sx={{ mt: 0.25 }}>
              <ArrowBack />
            </IconButton>
          </Tooltip>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#0c1e46', letterSpacing: '-0.02em' }}>
                #{caseData.caseNumber}
              </Typography>
              <Chip
                label={caseData.status}
                size="small"
                sx={{ bgcolor: `${statusCol}18`, color: statusCol, fontWeight: 700, fontSize: '0.86rem' }}
              />
              <Chip
                label={`${caseData.riskLevel} Risk`}
                size="small"
                sx={{ bgcolor: `${riskCol}18`, color: riskCol, fontWeight: 700, fontSize: '0.86rem' }}
              />
              {caseData.aiRiskAssessment?.highRiskZone && (
                <Chip label="⚠ High-Risk Zone" size="small" sx={{ bgcolor: '#fef2f2', color: '#ef4444', fontWeight: 700, fontSize: '0.78rem' }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.25 }}>
              {caseData.caseType} · {caseData.residentName} · {caseData.barangay}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="View in full list">
            <Button
              variant="outlined" size="small"
              startIcon={<OpenInNew sx={{ fontSize: 15 }} />}
              onClick={() => router.push(`/blotter-officer/case-management?caseNumber=${caseData.caseNumber}`)}
              sx={{ borderRadius: 2, borderColor: '#e2e8f0', color: '#64748b', fontSize: '0.86rem' }}
            >
              Case List
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Progress Tracker ── */}
      <ProgressTracker status={caseData.status} />

      {/* ── Two-column layout ── */}
      <Grid container spacing={2.5}>

        {/* Left: Case Info + AI + Description */}
        <Grid size={{ xs: 12, md: 5 }}>

          {/* Case Info */}
          <Card sx={{ mb: 2 }}>
            <CardContent sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46', mb: 1.5 }}>
                Case Information
              </Typography>
              {[
                { label: 'Reporter / Subject', value: caseData.residentName, Icon: Person },
                { label: 'Case Type', value: caseData.caseType, Icon: FolderOpen },
                { label: 'Location / Street', value: caseData.barangay, Icon: LocationOn },
                { label: 'Date Filed', value: fullDate(caseData.filedAt), Icon: AccessTime },
                {
                  label: 'Assigned Officer',
                  value: caseData.assignedTo?.name ?? 'Unassigned',
                  Icon: Person,
                },
              ].map(({ label, value, Icon }) => (
                <Box key={label} sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon sx={{ fontSize: 14, color: '#64748b' }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>{label}</Typography>
                    <Typography sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{value}</Typography>
                  </Box>
                </Box>
              ))}

              {caseData.resolvedAt && (
                <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <CheckCircle sx={{ fontSize: 14, color: '#22c55e' }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>Resolved On</Typography>
                    <Typography sx={{ fontSize: '0.9rem', fontWeight: 500, color: '#22c55e' }}>{fullDate(caseData.resolvedAt)}</Typography>
                  </Box>
                </Box>
              )}

              <Divider sx={{ my: 1.25 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                  Last updated {timeAgo(caseData.updatedAt)}
                </Typography>
                <Chip
                  label={`${(caseData.followUps ?? []).length} follow-up${(caseData.followUps ?? []).length !== 1 ? 's' : ''}`}
                  size="small"
                  sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }}
                />
              </Box>
            </CardContent>
          </Card>

          {/* AI Assessment */}
          <AIAssessmentCard ai={caseData.aiRiskAssessment} riskLevel={caseData.riskLevel} />

          {/* Original Description */}
          <Card>
            <CardContent sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0c1e46', mb: 1 }}>
                Original Report
              </Typography>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#f8fafc' }}>
                <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.65, color: '#475569' }}>
                  {caseData.description}
                </Typography>
              </Paper>
              {caseData.notes && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: '#0c1e46', mb: 0.75 }}>
                    Additional Notes
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#fefce8', borderColor: '#fef08a' }}>
                    <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.65, color: '#78350f', whiteSpace: 'pre-wrap' }}>
                      {caseData.notes}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Timeline */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: 'fit-content' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.98rem', color: '#0c1e46' }}>
                    Case Timeline
                  </Typography>
                  <Chip label={`${timeline.length} event${timeline.length !== 1 ? 's' : ''}`} size="small" sx={{ bgcolor: '#f1f5f9', color: '#64748b', fontSize: '0.72rem', height: 22 }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Chip
                    label="All Events"
                    size="small"
                    onClick={() => setTimelineFilter('all')}
                    sx={{
                      bgcolor: timelineFilter === 'all' ? '#0c1e46' : '#f1f5f9',
                      color: timelineFilter === 'all' ? 'white' : '#64748b',
                      fontWeight: 600, fontSize: '0.78rem', height: 24, cursor: 'pointer',
                    }}
                  />
                  <Chip
                    label={`Interventions (${interventions.length})`}
                    size="small"
                    onClick={() => setTimelineFilter('interventions')}
                    sx={{
                      bgcolor: timelineFilter === 'interventions' ? '#8b5cf6' : '#f1f5f9',
                      color: timelineFilter === 'interventions' ? 'white' : '#64748b',
                      fontWeight: 600, fontSize: '0.78rem', height: 24, cursor: 'pointer',
                    }}
                  />
                </Box>
              </Box>

              {/* Add Follow-Up Form */}
              <AddFollowUpForm caseId={id} currentStatus={caseData.status} onSaved={onSaved} />

              {/* Edit inline form */}
              {editTarget && (
                <EditFollowUpModal
                  caseId={id}
                  fid={editTarget.fid}
                  initialContent={editTarget.content}
                  initialOutcome={editTarget.outcome}
                  onDone={() => { setEditTarget(null); onSaved(); }}
                />
              )}

              <Divider sx={{ mb: 2.5 }} />

              {/* Timeline entries */}
              {displayTimeline.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Shield sx={{ fontSize: 32, color: '#e2e8f0', mb: 1 }} />
                  <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
                    {timelineFilter === 'interventions' ? 'No interventions recorded yet' : 'No timeline events'}
                  </Typography>
                </Box>
              ) : (
                <AnimatePresence>
                  {displayTimeline.map((entry, i) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    >
                      <TimelineEntry
                        entry={entry}
                        isLast={i === displayTimeline.length - 1}
                        currentUserId={currentUserId}
                        onEdit={(fid, content, outcome) => setEditTarget({ fid, content, outcome })}
                        onDelete={handleDelete}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
