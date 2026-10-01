'use client';

import type { Transcription, FieldConfidence } from './transcription';
import { unreadable, UNREADABLE_UNCLEAR_RATIO} from './transcription';

/**
 * Reads a photographed document in the browser.
 *
 * Tesseract runs on the device, which is the reason it was chosen over a hosted
 * vision model: a resident's blotter photo never leaves their phone, there is
 * no API key to configure, and there is no per-read cost. The trade is accuracy
 * on handwriting - Tesseract is strong on printed and neatly written text and
 * weak on cursive. That is handled rather than hidden: low-confidence words are
 * marked [?], and lib/reportEvidence refuses to build a risk factor out of
 * them, so a bad read produces "needs human review" instead of a wrong level.
 *
 * English and Filipino are both loaded, because barangay documents mix them
 * freely within a sentence.
 */

/** Below this, a word is marked unclear rather than trusted. */
const WORD_CONFIDENCE_FLOOR = 65;

/** Mean word confidence bands for the reading as a whole. */
const HIGH_CONFIDENCE = 82;
const MEDIUM_CONFIDENCE = 62;

export interface OcrProgress {
  /** 0-1 across model download and recognition. */
  ratio: number;
  stage: 'loading' | 'recognizing';
}

interface TessWord { text: string; confidence: number }

/**
 * Tesseract moved words from `data.words` into the block tree in v6, and the
 * shape differs again by build. Both are read so an upgrade cannot silently
 * reduce this to a confidence-less blob of text.
 */
function collectWords(data: unknown): TessWord[] {
  const d = data as {
    words?: TessWord[];
    blocks?: { paragraphs?: { lines?: { words?: TessWord[] }[] }[] }[];
  };
  if (Array.isArray(d?.words) && d.words.length) return d.words;

  const out: TessWord[] = [];
  for (const block of d?.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) out.push(w);
      }
    }
  }
  return out;
}

function bandFor(mean: number): FieldConfidence {
  if (mean >= HIGH_CONFIDENCE) return 'high';
  if (mean >= MEDIUM_CONFIDENCE) return 'medium';
  return 'low';
}

/**
 * Rebuilds the text with [?] after any word the engine was unsure of, so the
 * resident sees exactly which words to check and the guard downstream knows
 * which ones not to trust.
 */
function markUnclear(words: TessWord[]): { text: string; unclear: string[] } {
  const unclear: string[] = [];
  const parts = words.map(w => {
    const clean = (w.text ?? '').trim();
    if (!clean) return '';
    if (w.confidence < WORD_CONFIDENCE_FLOOR) {
      unclear.push(clean);
      return `${clean}[?]`;
    }
    return clean;
  });
  return { text: parts.filter(Boolean).join(' '), unclear: [...new Set(unclear)] };
}

/**
 * Loaded on demand. The language data is a few megabytes, so pulling it in on
 * page load would cost every resident who never attaches a document.
 */
export async function readDocumentImage(
  dataUrl: string,
  onProgress?: (p: OcrProgress) => void,
): Promise<Transcription> {
  try {
    const { createWorker } = await import('tesseract.js');

    const worker = await createWorker(['eng', 'fil'], 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (!onProgress) return;
        const ratio = typeof m.progress === 'number' ? m.progress : 0;
        onProgress({
          ratio,
          stage: m.status === 'recognizing text' ? 'recognizing' : 'loading',
        });
      },
    });

    try {
      // `blocks` must be requested: without it Tesseract v6+ returns the text
      // with no per-word confidence, every read looks low-confidence, and the
      // evidence guard then withholds factors from a perfectly good scan.
      const { data } = await worker.recognize(dataUrl, {}, { blocks: true, text: true });
      const words = collectWords(data).filter(w => (w.text ?? '').trim().length > 0);

      // Nothing legible is a real answer, not an error: an officer reads it.
      if (!(data.text ?? '').trim()) {
        return unreadable('No text could be read from this photo, so a barangay officer will review it.');
      }

      // Per-word confidence drives the [?] markers. If a future version stops
      // providing it, fall back to the overall score rather than reading zero
      // and condemning every document as unreadable.
      const overall = (data as { confidence?: number }).confidence ?? 0;
      const mean = words.length
        ? words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length
        : overall;
      const { text, unclear } = markUnclear(words);

      // Most of the page unreadable is a real answer too. Half-reading a
      // blurry blotter entry and classifying the risk from whichever words
      // happened to come through is worse than admitting it needs an officer.
      if (words.length && unclear.length / words.length > UNREADABLE_UNCLEAR_RATIO) {
        return unreadable(
          'Most of the writing in this photo could not be made out, so a barangay officer will read it. '
          + 'You can retake it in better light, or send the report as it is.',
        );
      }

      return {
        // Without per-word data there are no markers, so fall back to the raw
        // text rather than an empty string.
        text: words.length ? text : (data.text ?? '').replace(/\s+/g, ' ').trim(),
        confidence: bandFor(mean),
        fields: [],
        unclearWords: unclear,
        failed: false,
      };
    } finally {
      // Always terminated, so a failed read does not leave a worker holding
      // memory on a phone.
      await worker.terminate();
    }
  } catch {
    return unreadable();
  }
}
