import { createTheme } from '@mui/material/styles';

/**
 * Baseline typography for the whole app.
 *
 * Most screens set their own `fontSize` inline, and `sx` beats these overrides,
 * so what lives here is the floor for everything that *doesn't* — table cells,
 * text fields, menu items, helper text, tooltips. Before this existed those all
 * fell back to MUI's 14px default rendered in Arial, which is what made the
 * smaller labels hard to read.
 */
const theme = createTheme({
  typography: {
    // Geist is loaded in the root layout; keep a real fallback stack behind it.
    fontFamily: 'var(--font-geist-sans), "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    // MUI's default is 14 — this lifts every rem-derived variant with it.
    fontSize: 15,
    body1: { fontSize: '1rem', lineHeight: 1.6 },
    body2: { fontSize: '0.92rem', lineHeight: 1.6 },
    button: { fontSize: '0.92rem' },
    caption: { fontSize: '0.82rem' },
    subtitle1: { fontSize: '1rem' },
    subtitle2: { fontSize: '0.92rem' },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: '0.92rem' },
        head: { fontSize: '0.82rem' },
      },
    },
    MuiMenuItem: { styleOverrides: { root: { fontSize: '0.92rem' } } },
    MuiInputBase: { styleOverrides: { input: { fontSize: '0.95rem' } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.95rem' } } },
    MuiFormHelperText: { styleOverrides: { root: { fontSize: '0.82rem' } } },
    MuiFormControlLabel: { styleOverrides: { label: { fontSize: '0.92rem' } } },
    MuiChip: { styleOverrides: { label: { fontSize: '0.82rem' } } },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: '0.82rem' } } },
    MuiAlert: { styleOverrides: { root: { fontSize: '0.92rem' } } },
    MuiTab: { styleOverrides: { root: { fontSize: '0.92rem' } } },
    MuiListItemText: {
      styleOverrides: {
        primary: { fontSize: '0.95rem' },
        secondary: { fontSize: '0.85rem' },
      },
    },
  },
});

export default theme;
