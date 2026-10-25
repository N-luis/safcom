'use client';

import { useState } from 'react';
import { Box, Typography, Card, CardContent, Chip, Button, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import { PlayArrow, Edit, Visibility, Notes, Search, Shield, PictureAsPdf, Assignment, ArrowDropDown } from '@mui/icons-material';

type IntakeSummary = { id: string; status: string; version: number; updatedAt: string; completedAt: string | null } | null;

/**
 * "Intake Form" at the top right of the case page: where the intake stands,
 * and what can be done with it - start, continue, view, edit, export to PDF.
 * The menu is a convenience only; the intake page, its API and the PDF
 * endpoint each check the official's access again and refuse it.
 */
export default function IntakeFormButton({ caseId, basePath, intake }: { caseId: string; basePath: string; intake: IntakeSummary }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const href = `${basePath}/${caseId}/intake`;
  const pdf = `/api/cases/${caseId}/official-intake/pdf`;
  const completed = intake?.status === 'COMPLETED';
  const when = (d: string) => new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const state = !intake ? 'Not started' : completed ? 'Completed' : 'Draft';

  return (
    <>
      <Button variant="contained" onClick={e => setAnchor(e.currentTarget)} startIcon={<Assignment sx={{ fontSize: 17 }} />}
        endIcon={<ArrowDropDown />} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
        sx={{ borderRadius: 2, bgcolor: '#0f766e', fontWeight: 800, fontSize: '0.86rem', '&:hover': { bgcolor: '#115e59' } }}>
        Intake Form
        <Chip size="small" label={state} sx={{ ml: 1, height: 20, fontSize: '0.68rem', fontWeight: 800, cursor: 'pointer',
          bgcolor: !intake ? '#ffffff2e' : completed ? '#dcfce7' : '#fef3c7', color: !intake ? '#fff' : completed ? '#15803d' : '#a16207' }} />
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#64748b' }}>
            {!intake ? 'The intake interview has not been started for this case.'
              : completed ? `Completed ${intake.completedAt ? when(intake.completedAt) : ''} · version ${intake.version}`
                : `Draft saved ${when(intake.updatedAt)} · version ${intake.version}`}
          </Typography>
        </Box>
        <Divider />
        {!intake && (
          <MenuItem component="a" href={`${href}?start=1`}>
            <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon><ListItemText>Start Intake</ListItemText>
          </MenuItem>
        )}
        {intake && !completed && (
          <MenuItem component="a" href={href}>
            <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon><ListItemText>Continue Intake</ListItemText>
          </MenuItem>
        )}
        {intake && (
          <MenuItem component="a" href={`${href}?view=1`}>
            <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
            <ListItemText>{completed ? 'View Completed Intake' : 'View Intake Form'}</ListItemText>
          </MenuItem>
        )}
        {completed && (
          <MenuItem component="a" href={href}>
            <ListItemIcon><Edit fontSize="small" /></ListItemIcon><ListItemText>Edit Intake</ListItemText>
          </MenuItem>
        )}
        {intake && (
          <MenuItem component="a" href={pdf} download onClick={() => setAnchor(null)}>
            <ListItemIcon><PictureAsPdf fontSize="small" /></ListItemIcon>
            <ListItemText primary={completed ? 'Export PDF' : 'Export PDF (draft)'} secondary="The saved version, as the intake form" />
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

/**
 * The case's other record types, kept separate from the intake: a follow-up
 * report, an investigation update, an intervention. Each opens the timeline's
 * entry form with its type chosen.
 */
export function CaseRecordActions({ onQuickAction }: { onQuickAction: (type: 'note' | 'investigation' | 'intervention') => void }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.75 }}>
          Add to the case record
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<Notes />} onClick={() => onQuickAction('note')} sx={{ minHeight: 36 }}>
            Add Follow-up Report
          </Button>
          <Button size="small" variant="outlined" startIcon={<Search />} onClick={() => onQuickAction('investigation')} sx={{ minHeight: 36 }}>
            Record Investigation Update
          </Button>
          <Button size="small" variant="outlined" startIcon={<Shield />} onClick={() => onQuickAction('intervention')} sx={{ minHeight: 36 }}>
            Record Intervention
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
