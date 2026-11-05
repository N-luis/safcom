'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Box, Button, IconButton, Popover, Typography, type ButtonProps } from '@mui/material';
import { Check, Close, ContentCopy } from '@mui/icons-material';
import toast from 'react-hot-toast';
import { copyText } from '@/lib/clipboard';

/**
 * A contact number that opens a card with the number and a Copy button,
 * instead of a tel: link that starts a call.
 *
 * The trigger keeps the look each screen already gave it - pass that
 * screen's Button props. The number is copied exactly as configured, never a
 * placeholder: with no number, the card says so and there is nothing to copy.
 */
export default function ContactCopyButton({ name, number, children, ...buttonProps }: {
  /** Whose number it is: "PNP Contact", "Barangay Hall". */
  name: string;
  /** As stored. Null or empty when none is configured. */
  number: string | null | undefined;
  /** What the button shows. */
  children: ReactNode;
} & Omit<ButtonProps, 'onClick' | 'href' | 'children'>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const numberRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const value = number?.trim() || null;

  // "Copied!" for a moment, then back to the action.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!value) return;
    if (await copyText(value)) {
      setCopied(true);
      toast.success('Phone number copied successfully.');
      return;
    }
    // No clipboard access at all: select the number so it can be copied by hand.
    const el = numberRef.current;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    toast.error('Could not copy automatically - the number is selected, so copy it with Ctrl+C or a long press.');
  };

  return (
    <>
      <Button
        {...buttonProps}
        aria-haspopup="dialog"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={e => { setCopied(false); setAnchor(e.currentTarget); }}
      >
        {children}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: {
          role: 'dialog', 'aria-labelledby': titleId,
          sx: { p: 2, borderRadius: 2.5, width: 300, maxWidth: 'calc(100vw - 32px)', mt: 0.75 },
        } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1.25 }}>
          <Typography id={titleId} sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0c1e46', lineHeight: 1.3 }}>
            Official Contact Information
          </Typography>
          <IconButton size="small" aria-label="Close" onClick={() => setAnchor(null)} sx={{ mt: -0.5, mr: -0.75 }}>
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.5, mb: 1.75 }}>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Name</Typography>
          <Typography sx={{ fontSize: '0.88rem', color: '#0c1e46', fontWeight: 700, overflowWrap: 'anywhere' }}>{name}</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>Phone Number</Typography>
          {value ? (
            <Typography ref={numberRef} sx={{
              fontSize: '0.95rem', color: '#0c1e46', fontWeight: 800, userSelect: 'all',
              fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
            }}>
              {value}
            </Typography>
          ) : (
            <Typography sx={{ fontSize: '0.85rem', color: '#b45309' }}>
              No phone number is on file for this contact yet.
            </Typography>
          )}
        </Box>

        <Button
          fullWidth variant="contained" disabled={!value} onClick={copy}
          startIcon={copied ? <Check /> : <ContentCopy />}
          aria-live="polite"
          sx={{
            minHeight: 44, borderRadius: 2, textTransform: 'none', fontWeight: 700,
            bgcolor: copied ? '#15803d' : '#0c1e46', '&:hover': { bgcolor: copied ? '#166534' : '#1a3a6e' },
          }}
        >
          {copied ? 'Copied!' : 'Copy Number'}
        </Button>
      </Popover>
    </>
  );
}
