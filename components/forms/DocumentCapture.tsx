'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Box, Typography, Button, LinearProgress, TextField, Chip, Tooltip,
} from '@mui/material';
import {
  PhotoCamera, PhotoLibrary, Close, Replay, CheckCircle, ErrorOutlined, Description,
} from '@mui/icons-material';
import { useLanguage } from '@/lib/i18n';
import { readDocumentImage } from '@/lib/ocr';
import {
  ACCEPTED_IMAGE_TYPES, describeRejection, UNCLEAR_MARKER, type Transcription,
} from '@/lib/transcription';

/**
 * Photographing a document on a phone, reading it, and letting the resident
 * correct the reading before it is used.
 *
 * Designed for the slow end of mobile data: the image is shrunk in the browser
 * before anything is uploaded, every step says what it is doing, and a failure
 * to read never blocks the report - it just means an officer reads the photo.
 *
 * The transcription is editable on purpose. A reading nobody can correct is a
 * reading that quietly becomes evidence.
 */

export type CaptureStage = 'idle' | 'compressing' | 'uploading' | 'reading' | 'done' | 'error';

export interface CapturedDocument {
  /** The photo stored with the case, as the officer will see it. */
  storedDataUrl: string;
  fileName: string;
  size: number;
  transcription: Transcription | null;
  /** What the resident confirmed, which is what gets classified. */
  confirmedText: string;
}

/** Longest edge for the stored photo; enough for an officer to read it. */
const STORED_EDGE = 1600;
/** The OCR copy is never stored, so it can be larger and harsher. */
const OCR_EDGE = 1800;

/**
 * Draws the image at a bounded size. The browser applies EXIF orientation
 * when decoding, so a photo taken sideways arrives upright.
 */
async function toCanvas(file: File, maxEdge: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas;
}

/**
 * Grey and stretch the contrast for reading only. Handwriting on a phone photo
 * is usually low-contrast under uneven light, and this is the single cheapest
 * thing that improves a transcription.
 */
function raiseContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const stretched = Math.max(0, Math.min(255, ((d[i] - min) / span) * 255));
    d[i] = d[i + 1] = d[i + 2] = stretched;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) => canvas.toDataURL('image/jpeg', quality);

export default function DocumentCapture({ value, onChange, disabled, accent = '#14b8a6' }: {
  value: CapturedDocument | null;
  onChange: (next: CapturedDocument | null) => void;
  disabled?: boolean;
  accent?: string;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<CaptureStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const stageLabel: Record<CaptureStage, string> = {
    idle: '', compressing: t('compressing'), uploading: t('uploading'),
    reading: t('reading'), done: t('done'), error: '',
  };

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError('');

    const rejection = describeRejection(file.type || 'application/octet-stream', file.size);
    if (rejection) { setError(rejection); setStage('error'); return; }

    try {
      setStage('compressing'); setProgress(10);
      // HEIC from an iPhone decodes through createImageBitmap on modern
      // browsers; the canvas output is JPEG either way, so nothing server-side
      // needs to understand HEIC.
      const storedDataUrl = toJpeg(await toCanvas(file, STORED_EDGE), 0.85);
      setProgress(35);

      const ocrDataUrl = toJpeg(raiseContrast(await toCanvas(file, OCR_EDGE)), 0.85);
      setProgress(55);

      // Read on the device: the photo never leaves the phone, there is no key
      // to configure, and it works offline once the language data is cached.
      setStage('reading');
      const transcription: Transcription | null = await readDocumentImage(
        ocrDataUrl,
        ({ ratio, stage: s }) => {
          // The first run downloads the language data, which is the slow part;
          // showing it as progress stops the screen looking stuck.
          setProgress(s === 'loading' ? 55 + Math.round(ratio * 20) : 75 + Math.round(ratio * 25));
        },
      );

      setProgress(100);
      setStage('done');
      onChange({
        storedDataUrl,
        fileName: file.name || 'document.jpg',
        size: Math.round((storedDataUrl.length * 3) / 4),
        transcription,
        confirmedText: transcription?.text ? transcription.text.replace(UNCLEAR_MARKER, '') : '',
      });
    } catch {
      // The report must still be fileable, so a read failure is not an error
      // screen - it is a photo an officer will look at.
      setError(t('readFailed'));
      setStage('done');
    }
  }, [onChange, t]);

  const clear = () => {
    onChange(null); setStage('idle'); setProgress(0); setError('');
    if (inputRef.current) inputRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  };

  const busy = stage === 'compressing' || stage === 'uploading' || stage === 'reading';
  const tr = value?.transcription;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
        <Description sx={{ fontSize: 16, color: '#64748b' }} />
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
          {t('attachTitle')}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.8rem', color: '#94a3b8', mb: 1.25 }}>{t('attachHint')}</Typography>

      <input ref={inputRef} type="file" hidden accept={ACCEPTED_IMAGE_TYPES.join(',')}
        onChange={e => handleFile(e.target.files?.[0])} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment"
        onChange={e => handleFile(e.target.files?.[0])} />

      {!value ? (
        <Box
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          sx={{
            border: `1.5px dashed ${dragging ? accent : '#cbd5e1'}`,
            bgcolor: dragging ? `${accent}0a` : 'transparent',
            borderRadius: 2.5, p: { xs: 1.75, sm: 2.25 }, transition: 'border-color .15s, background-color .15s',
          }}
        >
          {/* Fluid, so it stacks on a 320px phone and sits inline on desktop. */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              onClick={() => cameraRef.current?.click()}
              disabled={disabled || busy}
              startIcon={<PhotoCamera />}
              variant="contained"
              sx={{
                flex: '1 1 160px', minHeight: 44, textTransform: 'none', fontWeight: 700,
                bgcolor: accent, '&:hover': { bgcolor: accent, filter: 'brightness(0.92)' },
              }}
            >
              {t('takePhoto')}
            </Button>
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={disabled || busy}
              startIcon={<PhotoLibrary />}
              variant="outlined"
              sx={{
                flex: '1 1 160px', minHeight: 44, textTransform: 'none', fontWeight: 600,
                borderColor: '#cbd5e1', color: '#475569',
              }}
            >
              {t('chooseFile')}
            </Button>
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', mt: 1, display: { xs: 'none', sm: 'block' } }}>
            {t('dropHere')}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: '#cbd5e1', mt: 0.5 }}>{t('accepted')}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.storedDataUrl}
            alt={t('previewAlt')}
            style={{
              width: 104, height: 104, objectFit: 'cover', borderRadius: 10,
              border: '1px solid #e2e8f0', display: 'block', flexShrink: 0,
            }}
          />
          <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.82rem', color: '#475569', wordBreak: 'break-word' }}>
              {value.fileName}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Button
                onClick={() => cameraRef.current?.click()} disabled={disabled || busy}
                startIcon={<Replay />} size="small"
                sx={{ minHeight: 44, textTransform: 'none', color: accent }}
              >
                {t('retake')}
              </Button>
              <Button
                onClick={clear} disabled={disabled || busy}
                startIcon={<Close />} size="small"
                sx={{ minHeight: 44, textTransform: 'none', color: '#ef4444' }}
              >
                {t('remove')}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Live progress rather than a frozen screen. */}
      {busy && (
        <Box sx={{ mt: 1.25 }} role="status" aria-live="polite">
          <Typography sx={{ fontSize: '0.82rem', color: '#475569', mb: 0.5 }}>
            {stageLabel[stage]}
          </Typography>
          <LinearProgress
            variant="determinate" value={progress}
            sx={{
              height: 6, borderRadius: 3, bgcolor: '#eef2f6',
              '& .MuiLinearProgress-bar': { bgcolor: accent, borderRadius: 3 },
            }}
          />
        </Box>
      )}

      {error && (
        <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
          <ErrorOutlined sx={{ fontSize: 16, color: '#dc2626', mt: '2px' }} />
          <Typography sx={{ fontSize: '0.82rem', color: '#dc2626', lineHeight: 1.5 }}>{error}</Typography>
        </Box>
      )}

      {/* The reading, for the resident to confirm or correct. */}
      {/* Gated on having a document rather than on this component's own
          stage: a value restored by the parent has no stage, and the box
          would never appear. */}
      {value && !busy && (
        <Box sx={{ mt: 1.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>
              {t('transcriptQuestion')}
            </Typography>
            {tr && !tr.failed && (
              <Tooltip title={t('unclearNote')}>
                <Chip
                  size="small"
                  icon={tr.confidence === 'high'
                    ? <CheckCircle sx={{ fontSize: '14px !important' }} />
                    : <ErrorOutlined sx={{ fontSize: '14px !important' }} />}
                  label={tr.confidence === 'high' ? t('confidenceHigh')
                    : tr.confidence === 'medium' ? t('confidenceMedium') : t('confidenceLow')}
                  sx={{
                    height: 22, fontSize: '0.72rem', fontWeight: 700,
                    bgcolor: tr.confidence === 'high' ? '#dcfce7' : '#fef9c3',
                    color: tr.confidence === 'high' ? '#15803d' : '#854d0e',
                  }}
                />
              </Tooltip>
            )}
          </Box>

          {tr?.failed && (
            <Typography sx={{ fontSize: '0.82rem', color: '#854d0e', bgcolor: '#fef9c3', p: 1, borderRadius: 1.5, mb: 1 }}>
              {tr.message ?? t('readFailed')}
            </Typography>
          )}

          {/* Unclear words shown as chips: the textarea cannot carry colour, so
              the highlight lives beside it rather than being lost. */}
          {!!tr?.unclearWords.length && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
              {tr.unclearWords.map(w => (
                <Chip key={w} label={w} size="small"
                  sx={{ height: 22, fontSize: '0.72rem', bgcolor: '#fef08a', color: '#713f12', fontWeight: 700 }} />
              ))}
            </Box>
          )}

          <TextField
            fullWidth multiline minRows={3}
            value={value.confirmedText}
            onChange={e => onChange({ ...value, confirmedText: e.target.value })}
            placeholder={t('transcriptPlaceholder')}
            disabled={disabled}
            slotProps={{ htmlInput: { 'aria-label': t('transcriptTitle') } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, fontSize: '0.88rem' } }}
          />
          <Typography sx={{ fontSize: '0.76rem', color: '#94a3b8', mt: 0.5 }}>
            {t('transcriptHelp')}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
