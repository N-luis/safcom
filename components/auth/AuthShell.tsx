'use client';

import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { Shield } from '@mui/icons-material';
import { motion } from 'framer-motion';

/** The dark text field the resident sign-in pages share. */
export const authField = {
  '& .MuiOutlinedInput-root': { color: 'white', '& fieldset': { borderColor: 'rgba(255,255,255,0.18)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.35)' }, '&.Mui-focused fieldset': { borderColor: '#14b8a6' } },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.55)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#2dd4bf' },
  '& .MuiFormHelperText-root': { color: 'rgba(255,255,255,0.5)' },
  '& .MuiFormHelperText-root.Mui-error': { color: '#fca5a5' },
  '& .MuiInputAdornment-root, & .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.45)' },
  '& .MuiSelect-select': { color: 'white' },
} as const;

export const authPrimaryButton = {
  py: 1.4, fontWeight: 700, fontSize: '0.98rem', textTransform: 'none',
  background: 'linear-gradient(135deg, #14b8a6, #0891b2)',
  boxShadow: '0 8px 24px rgba(20,184,166,0.35)',
  '&:hover': { background: 'linear-gradient(135deg, #0d9488, #0e7490)' },
} as const;

/**
 * The resident sign-in pages' frame (sign in, register, confirm the email,
 * reset or set up a password): the navy background and the SafeComm card.
 */
export default function AuthShell({ title, subtitle, children, wide = false, light = false }: {
  title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean;
  /** A white card (the long registration form, whose address fields and map are made for light backgrounds). */
  light?: boolean;
}) {
  return (
    <Box sx={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #071739 0%, #0c2461 60%, #1a3a6b 100%)',
      display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'center',
      px: 2, py: { xs: 3, sm: 5 }, boxSizing: 'border-box', position: 'relative', overflowX: 'hidden',
    }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ width: '100%', maxWidth: wide ? 760 : 440, position: 'relative', zIndex: 1 }}>
        <Box component="main" sx={{
          bgcolor: light ? '#ffffff' : 'rgba(255,255,255,0.04)', backdropFilter: light ? 'none' : 'blur(24px)', border: light ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 4, p: { xs: 2.5, sm: 4.5 }, boxShadow: '0 30px 60px rgba(0,0,0,0.5)', boxSizing: 'border-box',
        }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box sx={{
              width: 56, height: 56, borderRadius: 3, mx: 'auto', mb: 1.5,
              background: 'linear-gradient(135deg, #14b8a6, #0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 10px 28px rgba(20,184,166,0.4)',
            }}>
              <Shield sx={{ color: 'white', fontSize: 28 }} />
            </Box>
            <Typography sx={{ fontWeight: 800, color: light ? '#0c1e46' : 'white', fontSize: '1.35rem' }}>SafeComm</Typography>
            <Typography sx={{ color: light ? '#64748b' : 'rgba(255,255,255,0.45)', fontSize: '0.82rem', letterSpacing: 2, textTransform: 'uppercase' }}>Resident Portal</Typography>
          </Box>
          <Typography component="h1" sx={{ color: light ? '#0c1e46' : 'white', fontWeight: 700, fontSize: '1.15rem', mb: 0.5 }}>{title}</Typography>
          {subtitle && <Typography sx={{ color: light ? '#475569' : 'rgba(255,255,255,0.55)', fontSize: '0.9rem', mb: 2.5, lineHeight: 1.55 }}>{subtitle}</Typography>}
          {children}
        </Box>
      </motion.div>
    </Box>
  );
}
