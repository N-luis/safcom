/**
 * Photo attachments on a report.
 *
 * The browser sends each image as a data URL and the bytes are stored in
 * Postgres. That is deliberate: the app runs serverless, so a file written into
 * public/uploads does not survive the request, and no object storage is
 * configured. The page shrinks images before sending, and the limits below keep
 * the rows small enough that this stays reasonable.
 */

export const MAX_ATTACHMENTS = 3;

/** Per image, after the browser has shrunk it. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Longest edge the browser resizes down to before uploading. */
export const MAX_IMAGE_EDGE = 1600;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface ParsedAttachment {
  mimeType: string;
  /** Prisma's Bytes column wants a Uint8Array over a plain ArrayBuffer;
   *  Buffer is backed by ArrayBufferLike, which does not satisfy it. */
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Turns "data:image/jpeg;base64,…" into bytes, rejecting anything that is not
 * an allowed image or is larger than the per-file limit. Returns a reason
 * rather than throwing so the caller can report which file failed.
 */
export function parseImageDataUrl(dataUrl: string): ParsedAttachment | { error: string } {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) return { error: 'Not a valid image upload' };

  const [, mimeType, base64] = match;
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return { error: 'Only JPG, PNG and WEBP images are accepted' };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const decoded = Buffer.from(base64, 'base64');
    bytes = new Uint8Array(new ArrayBuffer(decoded.length));
    bytes.set(decoded);
  } catch {
    return { error: 'The image could not be read' };
  }
  if (bytes.length === 0) return { error: 'The image is empty' };
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { error: `Each photo must be under ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB` };
  }
  return { mimeType, bytes };
}

/** Human-readable size for the upload list. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
