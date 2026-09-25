'use client';

import { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/app/theme';

/**
 * Client boundary for the MUI theme — the root layout is a server component,
 * so ThemeProvider can't be used there directly.
 */
export default function AppThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
