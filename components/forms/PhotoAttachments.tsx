'use client';

import { useRef, useState } from 'react';
import { Box, Typography, Button, IconButton, CircularProgress } from '@mui/material';
import { AddPhotoAlternate, Close } from '@mui/icons-material';
import {
  MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_IMAGE_EDGE,
  ALLOWED_IMAGE_TYPES, formatBytes,
} from '@/lib/attachments';

export interface PickedPhoto {
  /** Stable key for the list, not sent to the server. */
  key: string;
  name: string;
  /** Already shrunk; also used directly as the preview src. */
  dataUrl: string;
  size: number;
}

/**
 * Shrinks a photo in the browser before it is ever uploaded.
 *
 * A phone camera file is routinely 4-8 MB, which would be refused by the size
 * limit and is far more detail than a barangay report needs. Redrawing it at
 * MAX_IMAGE_EDGE and re-encoding as JPEG brings a typical photo under 400 KB,
 * so the upload succeeds and the stored row stays small.
 */
function shrink(file: File): Promise<{ dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Could not process the image')); return; }
        // White behind it: a transparent PNG would otherwise go black as JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        // base64 carries 3 bytes per 4 characters, minus the padding.
        const base64 = dataUrl.split(',')[1] ?? '';
        const size = Math.floor(base64.length * 0.75) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
        resolve({ dataUrl, size });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function PhotoAttachments({ photos, onChange, disabled, accent = '#14b8a6' }: {
  photos: PickedPhoto[];
  onChange: (next: PickedPhoto[]) => void;
  disabled?: boolean;
  accent?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const full = photos.length >= MAX_ATTACHMENTS;

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setBusy(true);
    const next = [...photos];
    try {
      for (const file of Array.from(files)) {
        if (next.length >= MAX_ATTACHMENTS) {
          setError(`You can attach up to ${MAX_ATTACHMENTS} photos`);
          break;
        }
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
          setError(`${file.name} is not a JPG, PNG or WEBP image`);
          continue;
        }
        try {
          const { dataUrl, size } = await shrink(file);
          if (size > MAX_ATTACHMENT_BYTES) {
            setError(`${file.name} is still too large after resizing`);
            continue;
          }
          next.push({ key: `${file.name}-${Date.now()}-${next.length}`, name: file.name, dataUrl, size });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That image could not be read');
        }
      }
      onChange(next);
    } finally {
      setBusy(false);
      // Clearing lets the same file be picked again after it is removed.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Box>
      <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>
        Photos <Box component="span" sx={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</Box>
      </Typography>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={e => pick(e.target.files)}
      />

      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {photos.map((p, i) => (
          <Box key={p.key} sx={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.dataUrl}
              alt={`Attached photo ${i + 1}: ${p.name}`}
              style={{
                width: 96, height: 96, objectFit: 'cover',
                borderRadius: 10, border: '1px solid #e2e8f0', display: 'block',
              }}
            />
            <IconButton
              size="small"
              aria-label={`Remove ${p.name}`}
              disabled={disabled}
              onClick={() => onChange(photos.filter(x => x.key !== p.key))}
              sx={{
                position: 'absolute', top: -8, right: -8, bgcolor: '#fff',
                border: '1px solid #e2e8f0', width: 22, height: 22,
                '&:hover': { bgcolor: '#fef2f2', borderColor: '#fecaca' },
              }}
            >
              <Close sx={{ fontSize: 13, color: '#ef4444' }} />
            </IconButton>
            <Typography sx={{ fontSize: '0.7rem', color: '#94a3b8', mt: 0.4, width: 96, textAlign: 'center' }}>
              {formatBytes(p.size)}
            </Typography>
          </Box>
        ))}

        {!full && (
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            startIcon={busy ? <CircularProgress size={15} /> : <AddPhotoAlternate sx={{ fontSize: 18 }} />}
            sx={{
              width: 96, height: 96, borderRadius: 2.5, flexDirection: 'column', gap: 0.5,
              border: '1.5px dashed #cbd5e1', color: accent, textTransform: 'none',
              fontSize: '0.76rem', fontWeight: 600, lineHeight: 1.2,
              '& .MuiButton-startIcon': { m: 0 },
              '&:hover': { borderColor: accent, bgcolor: `${accent}0a` },
            }}
          >
            {busy ? 'Adding…' : 'Add photo'}
          </Button>
        )}
      </Box>

      <Typography sx={{ fontSize: '0.78rem', color: error ? '#dc2626' : '#94a3b8', mt: 0.75 }}>
        {error || `Up to ${MAX_ATTACHMENTS} photos — JPG, PNG or WEBP. Large photos are resized automatically.`}
      </Typography>
    </Box>
  );
}
