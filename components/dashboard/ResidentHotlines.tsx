'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Card, CardContent, Typography, Button, IconButton, Tooltip, Chip } from '@mui/material';
import { LocalPhone, Call, ContentCopy, Check } from '@mui/icons-material';
import { copyText } from '@/lib/clipboard';
import { EMERGENCY_HOTLINES, telHref, hotlineKind, type Hotline } from '@/lib/emergencyHotlines';

const NAVY = '#0c1e46';
const RED = '#b91c1c';
const KIND_COLOR: Record<string, string> = { Police: '#1d4ed8', Fire: '#c2410c', Rescue: '#b91c1c' };

/**
 * Emergency Hotlines on the resident's dashboard: every configured hotline
 * (lib/emergencyHotlines.ts - the same list the landing page shows), each
 * number with its own Call Now and Copy.
 *
 * Call Now is a plain tel: link to that row's own number: the phone opens its
 * dialer with the number ready, and the resident starts the call there.
 * SafeComm never places a call, never says one was made, and asks for no
 * permission. A number that is not dialable gets no link - only the number
 * and Copy. On a computer, the link opens the system's calling app when one
 * is set up; Copy is the fallback, and the card says so.
 */
export default function ResidentHotlines({ hotlines = EMERGENCY_HOTLINES }: {
  /** The configured list (lib/emergencyHotlines.ts); given only by the tests. */
  hotlines?: readonly Hotline[];
} = {}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A device with no touch screen may have no calling app: say so, and point to Copy.
  const [desktop, setDesktop] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: fine) and (hover: hover)');
    const sync = () => setDesktop(Boolean(mq?.matches));
    sync();
    mq?.addEventListener?.('change', sync);
    return () => { mq?.removeEventListener?.('change', sync); if (timer.current) clearTimeout(timer.current); };
  }, []);

  const copy = async (number: string) => {
    const ok = await copyText(number);
    setCopied(ok ? number : null);
    setFailed(ok ? null : number);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(null); setFailed(null); }, ok ? 1500 : 6000);
  };

  return (
    <Card component="section" aria-labelledby="resident-hotlines-title" data-testid="resident-hotlines" sx={{ borderTop: `3px solid ${RED}` }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LocalPhone sx={{ fontSize: 19, color: RED }} />
          </Box>
          <Typography id="resident-hotlines-title" component="h2" sx={{ fontWeight: 800, fontSize: '1rem', color: NAVY }}>Emergency Hotlines</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.84rem', color: '#64748b', mb: 1.5 }}>
          Tap Call Now to open your phone&apos;s dialer with the number ready - you start the call there.
          {desktop && ' On a computer, this opens your calling app if you have one; otherwise copy the number.'}
        </Typography>

        {/* Two columns only while the card is full width (tablet); one when it shares the row (md and up). */}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr' }, gap: 1 }}>
          {hotlines.map(h => {
            const kind = hotlineKind(h.name);
            return (
              <Box component="li" key={h.name} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25, display: 'grid', gap: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography component="h3" sx={{ fontWeight: 700, fontSize: '0.92rem', color: NAVY }}>{h.name}</Typography>
                  {kind && <Chip size="small" label={kind} sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: `${KIND_COLOR[kind]}14`, color: KIND_COLOR[kind] }} />}
                </Box>
                {h.numbers.map(number => {
                  const href = telHref(number);
                  return (
                    <Box key={number} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', columnGap: 1 }}>
                      <Typography sx={{ fontSize: '0.92rem', fontWeight: 700, color: '#334155', fontVariantNumeric: 'tabular-nums', userSelect: 'text', whiteSpace: 'nowrap' }}>
                        <Box component="span" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' }}>Contact number: </Box>
                        {number}
                      </Typography>
                      {href ? (
                        <Button component="a" href={href} size="small" variant="contained" startIcon={<Call sx={{ fontSize: 17 }} />}
                          aria-label={`Call Now: ${h.name}, ${number}`} data-number={number}
                          sx={{ textTransform: 'none', fontWeight: 700, bgcolor: RED, minHeight: 36, borderRadius: 2, '&:hover': { bgcolor: '#991b1b' } }}>
                          Call Now
                        </Button>
                      ) : (
                        <Typography sx={{ fontSize: '0.74rem', color: '#b45309', maxWidth: 140 }}>Cannot be dialled from here - copy it</Typography>
                      )}
                      <Tooltip title={copied === number ? 'Copied' : 'Copy number'}>
                        <IconButton size="small" aria-label={`Copy ${h.name} number ${number}`} onClick={() => void copy(number)}
                          sx={{ border: '1px solid #e2e8f0', borderRadius: 2, width: 36, height: 36 }}>
                          {copied === number ? <Check sx={{ fontSize: 17, color: '#15803d' }} /> : <ContentCopy sx={{ fontSize: 16, color: '#64748b' }} />}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
        {/* Read aloud on every copy; shown when a copy failed. */}
        <Typography role="status" aria-live="polite" sx={failed ? { mt: 1, fontSize: '0.8rem', color: '#b45309' }
          : { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>
          {failed ? `Could not copy automatically. The number is ${failed} - copy it by hand.` : copied ? `${copied} copied` : ''}
        </Typography>
      </CardContent>
    </Card>
  );
}
