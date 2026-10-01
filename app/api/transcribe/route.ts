import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { parseImageDataUrl } from '@/lib/attachments';
import {
  readDocument, describeRejection, unreadable, extractUnclearWords,
  MAX_IMAGE_BYTES,
} from '@/lib/transcription';

export const dynamic = 'force-dynamic';

/**
 * Reads a photographed document for the resident filing a report.
 *
 * Nothing is stored here. The image arrives already shrunk and contrast-raised
 * by the browser, is read, and is discarded; the photo the officer sees is the
 * attachment saved with the case, not this enhanced copy.
 *
 * A failure is never an error screen. A provider that is missing, slow or
 * broken returns the same shape with `failed: true` and a sentence the resident
 * can act on, because a report that cannot be filed is worse than a report
 * filed without its photo transcribed.
 */

const schema = z.object({
  dataUrl: z.string().min(1),
  /** Only used to reject early with a clearer message than a decode failure. */
  mimeType: z.string().optional(),
  size: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return rError('Invalid request', 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return rError('No image was received', 400);

  const { dataUrl, mimeType, size } = parsed.data;

  // Rejections are a real answer, not a fallback: the resident can fix these.
  if (mimeType || typeof size === 'number') {
    const rejection = describeRejection(mimeType ?? 'image/jpeg', size ?? 0);
    if (rejection) return rError(rejection, 400);
  }

  const image = parseImageDataUrl(dataUrl);
  if ('error' in image) return rError(image.error, 400);
  if (image.bytes.length > MAX_IMAGE_BYTES) {
    return rError('That photo is too large to read. Please take it again at a lower resolution.', 400);
  }

  try {
    const transcription = await readDocument({
      base64: Buffer.from(image.bytes).toString('base64'),
      mimeType: image.mimeType,
    });

    // Derive the markers even if a provider forgot to list them, so the guard
    // downstream and the highlighting upstream always agree.
    const unclearWords = transcription.unclearWords.length
      ? transcription.unclearWords
      : extractUnclearWords(transcription.text);

    return rSuccess({ ...transcription, unclearWords });
  } catch {
    // Deliberately a 200: the resident can still file, and the case is marked
    // for an officer to read the photo.
    return rSuccess(unreadable());
  }
}
