import { analyseReport, type GbvAnalysis, type DetectedFactor } from './gbvAnalysis';
import { extractUnclearWords, withoutMarkers, type Transcription } from './transcription';

/**
 * Combining what the resident typed with what a photographed document appears
 * to say, without letting a misread word invent a risk factor.
 *
 * The guard is the point of this module. A factor that rests only on text the
 * reader was unsure of is dropped and reported as unclear instead, because a
 * confident classification nobody can trace to a legible word is worse than no
 * classification at all. The typed description is always trusted: the resident
 * wrote it themselves.
 */

export interface EvidenceResult {
  analysis: GbvAnalysis;
  /** Factors that were found but withdrawn because the words were unclear. */
  withheldFactors: { label: string; unclearText: string[] }[];
  /** True when a person needs to read the photo before the case is trusted. */
  needsHumanReview: boolean;
  /** Plain reasons for the flag, shown to the resident and the officer. */
  reviewReasons: string[];
  /** What was actually classified, after markers were removed. */
  classifiedText: string;
}

/** Normalised for substring comparison against the report text. */
const norm = (s: string) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * A factor is unsafe when the sentence it was found in came from the document
 * AND that sentence carries a word the reader could not make out.
 */
function restsOnUnclearText(
  factor: DetectedFactor,
  transcriptSentences: string[],
  unclear: string[],
): string[] {
  if (!unclear.length) return [];
  const hits: string[] = [];
  for (const evidence of factor.evidence) {
    const e = norm(evidence);
    const fromDocument = transcriptSentences.some(t => norm(t) && e.includes(norm(t).slice(0, 40)));
    if (!fromDocument && !transcriptSentences.some(t => norm(t).includes(e.slice(0, 40)))) continue;
    for (const w of unclear) {
      if (w && e.includes(norm(w))) hits.push(w);
    }
  }
  return [...new Set(hits)];
}

export function buildEvidence(
  typedDescription: string,
  transcription?: Transcription | null,
): EvidenceResult {
  const typed = (typedDescription ?? '').trim();

  if (!transcription || transcription.failed || !transcription.text.trim()) {
    const analysis = analyseReport(typed);
    const reviewReasons = transcription?.failed
      ? [transcription.message ?? 'The attached photo could not be read.']
      : [];
    return {
      analysis,
      withheldFactors: [],
      needsHumanReview: Boolean(transcription?.failed),
      reviewReasons,
      classifiedText: typed,
    };
  }

  const unclear = transcription.unclearWords.length
    ? transcription.unclearWords
    : extractUnclearWords(transcription.text);
  const documentText = withoutMarkers(transcription.text);
  const transcriptSentences = documentText.split(/(?<=[.!?\n])\s+/).filter(Boolean);

  // Classified together, so a document can corroborate what was typed.
  const combined = [typed, documentText].filter(Boolean).join('\n\n');
  const full = analyseReport(combined);

  const lowConfidence = transcription.confidence === 'low';
  const withheldFactors: EvidenceResult['withheldFactors'] = [];

  // What the typed text alone supports is never withheld - the resident wrote it.
  const typedOnly = analyseReport(typed);
  const typedIds = new Set(typedOnly.detectedFactors.map(f => f.id));

  const keptFactors = full.detectedFactors.filter(factor => {
    if (typedIds.has(factor.id)) return true;
    if (lowConfidence) {
      withheldFactors.push({ label: factor.label, unclearText: ['the whole reading was low confidence'] });
      return false;
    }
    const unclearBehind = restsOnUnclearText(factor, transcriptSentences, unclear);
    if (unclearBehind.length) {
      withheldFactors.push({ label: factor.label, unclearText: unclearBehind });
      return false;
    }
    return true;
  });

  // Re-read with the unsafe text removed, so the level follows the kept
  // evidence rather than being patched after the fact.
  const safeText = lowConfidence
    ? typed
    : [typed, stripUnclearSentences(documentText, unclear)].filter(Boolean).join('\n\n');
  const analysis = analyseReport(safeText);

  const reviewReasons: string[] = [];
  if (lowConfidence) {
    reviewReasons.push('The photo was hard to read, so nothing from it was used to assess this case.');
  }
  if (withheldFactors.length) {
    const words = [...new Set(withheldFactors.flatMap(w => w.unclearText))].slice(0, 6);
    reviewReasons.push(
      `Some words in the photo were unclear, so they were not counted: ${words.join(', ')}.`,
    );
  }
  if (!lowConfidence && transcription.confidence === 'medium') {
    reviewReasons.push('The photo was only partly clear. Please check the transcription above.');
  }

  return {
    analysis,
    withheldFactors,
    needsHumanReview: reviewReasons.length > 0 || keptFactors.length !== full.detectedFactors.length,
    reviewReasons,
    classifiedText: safeText,
  };
}

/** Drops whole sentences that carry an unclear word, rather than single words. */
function stripUnclearSentences(documentText: string, unclear: string[]): string {
  if (!unclear.length) return documentText;
  return documentText
    .split(/(?<=[.!?\n])\s+/)
    .filter(sentence => !unclear.some(w => norm(sentence).includes(norm(w))))
    .join(' ')
    .trim();
}
