'use client';

import { useState, type ReactNode } from 'react';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

/**
 * A long, supporting part of a card, folded behind one line: a small
 * uppercase label, an optional count, and a chevron. What an official must
 * see at once (a level, a warning, a decision button) is never put in one.
 */
export default function Fold({ title, count, children, defaultOpen = false, mb = 1.25 }: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  mb?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ mb }}>
      <ButtonBase onClick={() => setOpen(o => !o)} aria-expanded={open}
        sx={{ width: '100%', justifyContent: 'flex-start', gap: 0.75, py: 0.5, borderRadius: 1, textAlign: 'left',
          '&:hover .fold-title': { color: '#0c1e46' }, '&:focus-visible': { outline: '2px solid #93c5fd' } }}>
        <Typography className="fold-title" sx={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}{count !== undefined ? ` (${count})` : ''}
        </Typography>
        <ExpandMore sx={{ ml: 'auto', fontSize: 18, color: '#94a3b8', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pt: 0.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}
