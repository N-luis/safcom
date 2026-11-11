/**
 * A scan or photo of a signed paper Service Referral Form: what may be kept
 * and how it is read from the browser's upload. The content is checked by its
 * first bytes, not trusted from the type the browser claims.
 */

export const MAX_REFERRAL_SCANS = 6;
export const MAX_REFERRAL_SCAN_BYTES = 3 * 1024 * 1024;
export const REFERRAL_SCAN_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const MAGIC: Record<(typeof REFERRAL_SCAN_TYPES)[number], (b: Uint8Array) => boolean> = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'application/pdf': b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
};

export function parseReferralScan(dataUrl: string): { mimeType: string; bytes: Uint8Array<ArrayBuffer> } | { error: string } {
  const m = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl ?? '');
  if (!m) return { error: 'Not a valid file upload' };
  const mimeType = m[1] as (typeof REFERRAL_SCAN_TYPES)[number];
  if (!(REFERRAL_SCAN_TYPES as readonly string[]).includes(mimeType)) return { error: 'Only JPG, PNG, WEBP or PDF files are accepted' };
  const decoded = Buffer.from(m[2], 'base64');
  if (!decoded.length) return { error: 'The file is empty' };
  if (decoded.length > MAX_REFERRAL_SCAN_BYTES) return { error: `The file must be under ${MAX_REFERRAL_SCAN_BYTES / 1024 / 1024} MB` };
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  bytes.set(decoded);
  if (!MAGIC[mimeType](bytes)) return { error: 'The file does not match its type' };
  return { mimeType, bytes };
}
