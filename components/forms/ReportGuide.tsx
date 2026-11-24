'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, IconButton, TextField, Typography } from '@mui/material';
import { SupportAgent, Send, Close, ArrowDownward, InfoOutlined, PlaylistAddCheck } from '@mui/icons-material';
import GuideHotlines from './GuideHotlines';
import { GUIDE_INTRO, SUGGESTED_QUESTIONS, URGENT_WORDS, type GuideLang } from '@/lib/reportGuide';

/**
 * SafeComm's AI Reporting Assistant, on File a Report. The resident asks in
 * their own words; the answer comes from /api/resident/report-guide - SafeComm's
 * workflow, the desk its own rules recommend (never final), and the
 * emergency numbers first when someone may be in danger (shown at once, before
 * any AI). It never files anything: the resident uses the form below.
 * Nothing of the conversation is saved.
 */
const NAVY = '#0c1e46';
const TEAL = '#0f766e';

interface Rec { destination: string; label: string; reasons: string[]; questions: string[] }
interface Answer { reply: string; source: 'AI' | 'GUIDE'; urgent: boolean; recommendation: Rec | null; checklist: string[]; clarifyingQuestions: string[]; needsOfficialConfirmation: boolean; aiStatus?: string | null }

/** Why the written guide answered instead of the AI, in the resident's language - so "not available" is never said when it was only busy. */
function guideNote(status: string | null | undefined, lang: GuideLang): string {
  const tl = lang === 'tl';
  switch (status) {
    case 'busy':
    case 'rate_limited':
      return tl ? 'Gabay ng SafeComm - abala ang AI sandali. Magtanong ulit pagkalipas ng ilang segundo para sa sagot ng AI.'
        : "SafeComm's guide - the AI was busy for a moment. Ask again in a few seconds for an AI answer.";
    case 'off':
      return tl ? 'Gabay ng SafeComm - naka-off ang AI sa site na ito.' : "SafeComm's guide - the AI is turned off on this site.";
    case 'daily_limit':
    case 'resident_limit':
      return tl ? 'Gabay ng SafeComm - naubos na ang AI para sa araw na ito; babalik ito bukas.'
        : "SafeComm's guide - today's AI allowance is used up; it comes back tomorrow.";
    default:
      return tl ? 'Gabay ng SafeComm - hindi nagamit ang sagot ng AI ngayon.' : "SafeComm's guide - the AI could not answer this time.";
  }
}
type Msg = { role: 'resident'; text: string; urgentNow: boolean } | { role: 'assistant'; text: string; answer?: Answer };

export default function ReportGuide({ lang, open, onOpenChange, descriptionEmpty, onUseDescription, onContinue }: {
  lang: GuideLang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  descriptionEmpty: boolean;
  /** Put the resident's own messages in the description (only when it is empty). */
  onUseDescription: (text: string) => void;
  /** Close the assistant and go to the form's description. */
  onContinue: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setError(''); setInput('');
    // Danger in the resident's own words: the numbers show now, not after the AI.
    const next: Msg[] = [...messages, { role: 'resident', text: t, urgentNow: URGENT_WORDS.test(t) }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch('/api/resident/report-guide', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', lang, messages: next.slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 2000) })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) { setError(json.error ?? 'The assistant could not answer right now.'); return; }
      const a = json.data as Answer;
      setMessages(m => [...m, { role: 'assistant', text: a.reply, answer: a }]);
    } catch {
      setError(lang === 'tl' ? 'Walang koneksyon. Subukan ulit.' : 'Network error. Try again.');
    } finally { setBusy(false); }
  };

  const residentWords = messages.filter(m => m.role === 'resident').map(m => m.text).filter(t => t.split(/\s+/).length >= 8 && !/\?\s*$/.test(t));

  if (!open) {
    return (
      <Box data-testid="report-guide-closed" sx={{ border: '1px solid #ccfbf1', bgcolor: '#f0fdfa', borderRadius: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <SupportAgent sx={{ color: TEAL }} />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: NAVY }}>{lang === 'tl' ? 'Hindi sigurado kung paano mag-report?' : 'Not sure how to report?'}</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: '#475569' }}>
            {lang === 'tl' ? 'Magtanong sa AI Reporting Assistant ng SafeComm - sa Filipino o English.' : "Ask SafeComm's AI Reporting Assistant - in English or Filipino."}
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => onOpenChange(true)} startIcon={<SupportAgent />} data-testid="open-report-guide"
          sx={{ bgcolor: TEAL, textTransform: 'none', fontWeight: 700, minHeight: 40, '&:hover': { bgcolor: '#115e59' } }}>
          {lang === 'tl' ? 'Magtanong' : 'Ask the assistant'}
        </Button>
      </Box>
    );
  }

  return (
    <Box component="section" aria-labelledby="report-guide-title" data-testid="report-guide" sx={{ border: '1px solid #99f6e4', borderRadius: 2.5, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.1, bgcolor: '#f0fdfa', borderBottom: '1px solid #ccfbf1' }}>
        <SupportAgent sx={{ color: TEAL }} />
        <Typography id="report-guide-title" component="h2" sx={{ fontWeight: 800, fontSize: '0.95rem', color: NAVY, flex: 1 }}>AI Reporting Assistant</Typography>
        <IconButton size="small" aria-label={lang === 'tl' ? 'Isara ang assistant' : 'Close the assistant'} onClick={() => onOpenChange(false)}><Close fontSize="small" /></IconButton>
      </Box>

      <Box sx={{ p: 1.5, display: 'grid', gap: 1.25, maxHeight: { xs: 520, md: 560 }, overflowY: 'auto' }} role="log" aria-live="polite">
        <Bubble who="assistant">{GUIDE_INTRO[lang]}</Bubble>
        {messages.length === 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }} data-testid="guide-suggestions">
            {SUGGESTED_QUESTIONS[lang].map(q => (
              <Chip key={q} label={q} onClick={() => void send(q)} variant="outlined" clickable
                sx={{ borderColor: '#99f6e4', color: TEAL, fontWeight: 600, height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
            ))}
          </Box>
        )}
        {messages.map((m, i) => m.role === 'resident' ? (
          <Box key={i} sx={{ display: 'grid', gap: 1 }}>
            <Bubble who="resident">{m.text}</Bubble>
            {m.urgentNow && <GuideHotlines lang={lang} />}
          </Box>
        ) : (
          <Box key={i} sx={{ display: 'grid', gap: 1 }} data-testid="guide-answer">
            <Bubble who="assistant">{m.text}</Bubble>
            {m.answer && <AnswerCards a={m.answer} lang={lang} showHotlines={m.answer.urgent && !(messages[i - 1]?.role === 'resident' && (messages[i - 1] as { urgentNow: boolean }).urgentNow)} />}
          </Box>
        ))}
        {busy && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#64748b', fontSize: '0.82rem' }} role="status">
            <CircularProgress size={16} sx={{ color: TEAL }} /> {lang === 'tl' ? 'Nag-iisip…' : 'Thinking…'}
          </Box>
        )}
        {error && <Alert severity="warning" sx={{ borderRadius: 2 }} action={<Button size="small" color="inherit" onClick={() => { const last = [...messages].reverse().find(x => x.role === 'resident'); if (last) { setMessages(ms => ms.slice(0, ms.lastIndexOf(last))); void send(last.text); } }}>{lang === 'tl' ? 'Ulitin' : 'Retry'}</Button>}>
          {error} {lang === 'tl' ? 'Puwede mo pa ring punan ang form sa ibaba.' : 'You can still fill in the form below.'}
        </Alert>}
        <div ref={end} />
      </Box>

      <Box component="form" onSubmit={e => { e.preventDefault(); void send(input); }} sx={{ display: 'flex', gap: 1, p: 1.25, borderTop: '1px solid #e2e8f0', alignItems: 'flex-end' }}>
        <TextField value={input} onChange={e => setInput(e.target.value)} size="small" fullWidth multiline maxRows={4}
          placeholder={lang === 'tl' ? 'Isulat ang tanong o ikuwento ang nangyari…' : 'Ask a question or describe what happened…'}
          slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': lang === 'tl' ? 'Mensahe sa assistant' : 'Message to the assistant' } }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
        <Button type="submit" variant="contained" disabled={busy || !input.trim()} aria-label={lang === 'tl' ? 'Ipadala' : 'Send'}
          sx={{ minWidth: 48, minHeight: 40, bgcolor: TEAL, '&:hover': { bgcolor: '#115e59' } }}><Send fontSize="small" /></Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', px: 1.25, pb: 1.25 }}>
        {descriptionEmpty && residentWords.length > 0 && (
          <Button size="small" variant="outlined" onClick={() => { onUseDescription(residentWords.join('\n\n')); onContinue(); }} data-testid="guide-use-words"
            sx={{ textTransform: 'none', fontWeight: 700, borderColor: '#99f6e4', color: TEAL }}>
            {lang === 'tl' ? 'Gamitin ang isinulat ko bilang paglalarawan' : 'Use what I wrote as my description'}
          </Button>
        )}
        <Button size="small" variant="contained" endIcon={<ArrowDownward />} onClick={onContinue} data-testid="guide-continue"
          sx={{ textTransform: 'none', fontWeight: 700, bgcolor: NAVY }}>
          {lang === 'tl' ? 'Magpatuloy sa report' : 'Continue to Report'}
        </Button>
        <Button size="small" onClick={() => onOpenChange(false)} sx={{ textTransform: 'none', color: '#475569' }}>
          {lang === 'tl' ? 'Bumalik sa form' : 'Return to the report form'}
        </Button>
      </Box>
    </Box>
  );
}

function Bubble({ who, children }: { who: 'assistant' | 'resident'; children: React.ReactNode }) {
  const mine = who === 'resident';
  return (
    <Box sx={{ justifySelf: mine ? 'end' : 'start', maxWidth: '92%', bgcolor: mine ? '#0f766e' : '#f1f5f9', color: mine ? 'white' : '#1e293b',
      borderRadius: 2, px: 1.5, py: 1, fontSize: '0.88rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {children}
    </Box>
  );
}

function AnswerCards({ a, lang, showHotlines }: { a: Answer; lang: GuideLang; showHotlines: boolean }) {
  const [more, setMore] = useState(true);
  return (
    <Box sx={{ display: 'grid', gap: 0.75, pl: { sm: 1 } }}>
      {showHotlines && <GuideHotlines lang={lang} />}
      {a.recommendation && (
        <Box data-testid="guide-recommendation" sx={{ border: '1px solid #ddd6fe', bgcolor: '#faf5ff', borderRadius: 2, p: 1.25 }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {lang === 'tl' ? 'Posibleng desk' : 'Possible reporting desk'}
          </Typography>
          <Typography sx={{ fontWeight: 800, color: NAVY, fontSize: '0.92rem' }}>{a.recommendation.label}</Typography>
          <Collapse in={more}>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.25, fontSize: '0.8rem', color: '#334155' }}>{a.recommendation.reasons.map((r, i) => <li key={i}>{r}</li>)}</Box>
          </Collapse>
          <Typography sx={{ fontSize: '0.74rem', color: '#6b21a8', mt: 0.5 }}>
            {lang === 'tl' ? 'Mungkahi lang ito, hindi pinal na desisyon - ang opisyal ng barangay ang magpapasya. Hindi mo kailangang pumili ng kategorya.'
              : 'A suggestion, not a final decision - a barangay official decides. You do not have to choose a category.'}
          </Typography>
          {a.recommendation.reasons.length > 1 && <Button size="small" onClick={() => setMore(v => !v)} sx={{ p: 0, minWidth: 0, textTransform: 'none', fontSize: '0.74rem' }}>{more ? (lang === 'tl' ? 'Itago' : 'Hide why') : (lang === 'tl' ? 'Bakit?' : 'Why?')}</Button>}
        </Box>
      )}
      {a.clarifyingQuestions.length > 0 && (
        <Box data-testid="guide-questions" sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: NAVY }}>{lang === 'tl' ? 'Makakatulong kung alam mo (puwedeng laktawan):' : 'It would help to know (you can skip any):'}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: '0.8rem', color: '#334155' }}>{a.clarifyingQuestions.map((q, i) => <li key={i}>{q}</li>)}</Box>
        </Box>
      )}
      {a.checklist.length > 0 && (
        <Box data-testid="guide-checklist" sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 1.25 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 0.5 }}><PlaylistAddCheck sx={{ fontSize: 18 }} />{lang === 'tl' ? 'Para sa iyong report' : 'For your report'}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: '0.8rem', color: '#334155' }}>{a.checklist.map((q, i) => <li key={i}>{q}</li>)}</Box>
        </Box>
      )}
      <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <InfoOutlined sx={{ fontSize: 13 }} />
        {a.source === 'AI' ? (lang === 'tl' ? 'Sagot ng AI mula sa proseso ng SafeComm.' : "AI answer, from SafeComm's process.") : guideNote(a.aiStatus, lang)}
        {a.needsOfficialConfirmation && (lang === 'tl' ? ' Kailangang kumpirmahin ng opisyal ng barangay.' : ' An authorized barangay official needs to confirm this.')}
      </Typography>
    </Box>
  );
}
