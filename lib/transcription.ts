/**
 * Reading a photographed document, and deciding how far to trust what came
 * back.
 *
 * The transcriber is deliberately behind one function. SafeComm has no vision
 * model configured, and sending a resident's blotter photo to a third party is
 * a decision for the barangay rather than a default. Until a provider is
 * plugged into `transcribeImage`, it returns the configured fallback and the
 * case is marked for a human to read the photo - which is the same path the
 * pipeline takes when a provider fails or times out, so that path is exercised
 * rather than theoretical.
 *
 * The rule that matters most here: unclear text must not create risk factors.
 * A misread word is worse than no word, because it produces a confident
 * classification nobody can trace back to anything the resident wrote.
 */

export type FieldConfidence = 'high' | 'medium' | 'low';

export interface TranscriptionField {
  label: string;
  value: string;
  confidence: FieldConfidence;
}

export interface Transcription {
  /** What the document appears to say. Never invented: empty if unreadable. */
  text: string;
  /** Overall confidence in the reading. */
  confidence: FieldConfidence;
  /** Per-field, when the document has recognisable fields. */
  fields: TranscriptionField[];
  /** Words the reader could not make out, without the [?] markers. */
  unclearWords: string[];
  /** True when nothing could be read and a person needs to look at it. */
  failed: boolean;
  /** Shown to the resident when the read did not work. */
  message?: string;
}

/** Unclear words are marked inline so the resident can see and correct them. */
export const UNCLEAR_MARKER = /\[\?\]/g;

/** A word immediately followed by [?], e.g. "Hul[?]" or "Ruiz [?]". */
const UNCLEAR_WORD = /(\S+)\s*\[\?\]/g;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;

export function describeRejection(type: string, size: number): string | null {
  if (size > MAX_IMAGE_BYTES) {
    return `That photo is ${(size / 1024 / 1024).toFixed(1)} MB. Please use one under 10 MB, or take it again at a lower resolution.`;
  }
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase())) {
    return 'That file type cannot be read. Please upload a JPG, PNG, WEBP or HEIC photo.';
  }
  return null;
}

/** Pulls out the words a reader flagged, so they can be highlighted and guarded. */
export function extractUnclearWords(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(UNCLEAR_WORD)) {
    const word = m[1].replace(UNCLEAR_MARKER, '').trim();
    if (word) out.push(word);
  }
  return [...new Set(out)];
}

/** The transcription with its markers removed, for display or classification. */
export const withoutMarkers = (text: string): string =>
  (text ?? '').replace(UNCLEAR_MARKER, '').replace(/\s{2,}/g, ' ').trim();

export const FALLBACK_MESSAGE =
  'Image could not be read, a barangay officer will review it.';

export function unreadable(message = FALLBACK_MESSAGE): Transcription {
  return { text: '', confidence: 'low', fields: [], unclearWords: [], failed: true, message };
}

/**
 * The prompt a vision provider is given. Kept here rather than in the provider
 * so the instruction set is reviewable without reading integration code, and so
 * swapping providers cannot quietly change what was asked for.
 */
export const TAGALOG_OCR_PROMPT = `You are transcribing a photographed Philippine barangay document.
It may be handwritten, in Tagalog, Filipino, English, or a mixture.

Rules:
- Transcribe only what is visibly written. Never guess, complete or correct a word.
- Keep the original spelling, including misspellings and abbreviations.
- Where a word is not legible, write your best reading followed by [?]. If you
  cannot read it at all, write [?] on its own.
- Do not translate. Do not summarise. Do not add commentary.
- Return the transcription, a confidence of high, medium or low for the reading
  as a whole and for each labelled field you find, and the list of words you
  marked [?].`;

/**
 * Provider seam. Returns the configured fallback until a vision model is wired
 * in; the surrounding pipeline treats that identically to a provider failure.
 */
export async function transcribeImage(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter
  // defines the seam a provider implements; the stub has nothing to send it to.
  image: { base64: string; mimeType: string },
): Promise<Transcription> {
  return unreadable();
}

/** Runs a promise with a deadline, so a hung provider cannot hold the request. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    work.then(
      v => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(onTimeout()); },
    );
  });
}

export const TRANSCRIBE_TIMEOUT_MS = 30_000;

/**
 * One retry, then the fallback. A second attempt is worth it because the common
 * failures - a cold start, a rate limit - are transient; a third is not.
 */
export async function readDocument(
  image: { base64: string; mimeType: string },
  transcribe: typeof transcribeImage = transcribeImage,
  timeoutMs: number = TRANSCRIBE_TIMEOUT_MS,
): Promise<Transcription> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await withTimeout(transcribe(image), timeoutMs, () => unreadable());
    if (!result.failed) return result;
    if (attempt === 1) return result;
  }
  return unreadable();
}
