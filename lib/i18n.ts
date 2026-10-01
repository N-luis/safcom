'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * English and Tagalog for the reporting flow.
 *
 * Every user-facing string in the capture and result steps lives here rather
 * than in the components, so a translator can work from one file and a missing
 * key is a type error instead of an English sentence appearing in a Tagalog UI.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Tagalog' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'safecomm_lang';

export const STRINGS = {
  en: {
    languageLabel: 'Language',

    // Document capture
    attachTitle: 'Attach a document photo',
    attachHint: 'Optional. A blotter entry, docket, or any written document about this incident.',
    takePhoto: 'Take a photo',
    chooseFile: 'Choose from gallery',
    dropHere: 'or drop an image here',
    accepted: 'JPG, PNG, WEBP or HEIC, up to 10 MB',
    remove: 'Remove',
    retake: 'Retake',
    previewAlt: 'Photo of the document you attached',

    // Progress
    compressing: 'Preparing your photo…',
    uploading: 'Uploading…',
    reading: 'Reading your document…',
    checking: 'Checking risk…',
    done: 'Done',

    // Transcription review
    transcriptTitle: 'Is this what your document says?',
    transcriptQuestion: 'Tama ba ang pagkabasa? / Is this what your document says?',
    transcriptHelp: 'Correct anything that was read wrongly. Highlighted words were unclear.',
    transcriptPlaceholder: 'The text read from your photo will appear here.',
    unclearNote: 'Highlighted words could not be read clearly and were not used to assess your case.',
    confidenceHigh: 'Read clearly',
    confidenceMedium: 'Partly clear',
    confidenceLow: 'Hard to read',
    needsReview: 'A barangay officer will read the photo.',
    readFailed: 'Image could not be read, a barangay officer will review it.',

    // Analysis
    analyzingReport: 'Analyzing report\u2026',
    analyzing: 'Analyzing\u2026',
    analysisComplete: 'Analysis complete',
    analysisCompleteBody: 'Your assessment is ready.',
    analysisFailed: 'Analysis could not finish',
    analysisErrorBody: 'Something went wrong while assessing your report. Your answers are still here \u2014 try again.',
    analyzingNote: 'Please wait while SafeComm analyzes the report.',
    analysisSlow: 'This is taking longer than usual.',
    stagePreparing: 'Reviewing report information',
    stageReadingDocument: 'Reading attached document',
    stageFactors: 'Identifying relevant case factors',
    stageSeverity: 'Assessing severity and urgency',
    stageRecommendations: 'Generating personalized recommendations',
    minimize: 'Minimize',
    cancel: 'Cancel',
    retry: 'Try again',
    submitForReview: 'Submit for officer review',
    viewResult: 'View result',
    cancelConfirm: 'Stop the analysis? Your report stays filled in.',

    // Result card
    viewMyCases: 'View my cases',
    fileAnother: 'File another',
    callLabel: 'Tap to call',
  },

  tl: {
    languageLabel: 'Wika',

    attachTitle: 'Maglakip ng larawan ng dokumento',
    attachHint: 'Opsyonal. Blotter entry, docket, o anumang nakasulat tungkol sa insidenteng ito.',
    takePhoto: 'Kumuha ng larawan',
    chooseFile: 'Pumili sa gallery',
    dropHere: 'o i-drop ang larawan dito',
    accepted: 'JPG, PNG, WEBP o HEIC, hanggang 10 MB',
    remove: 'Alisin',
    retake: 'Kunan ulit',
    previewAlt: 'Larawan ng dokumentong inilakip mo',

    compressing: 'Inihahanda ang larawan…',
    uploading: 'Ina-upload…',
    reading: 'Binabasa ang dokumento…',
    checking: 'Sinusuri ang panganib…',
    done: 'Tapos na',

    transcriptTitle: 'Tama ba ang pagkabasa?',
    transcriptQuestion: 'Tama ba ang pagkabasa? / Is this what your document says?',
    transcriptHelp: 'Itama ang anumang maling nabasa. Ang naka-highlight ay hindi malinaw.',
    transcriptPlaceholder: 'Dito lalabas ang nabasa mula sa larawan mo.',
    unclearNote: 'Ang naka-highlight na salita ay hindi malinaw kaya hindi ito ginamit sa pagsusuri.',
    confidenceHigh: 'Malinaw ang pagkabasa',
    confidenceMedium: 'Bahagyang malinaw',
    confidenceLow: 'Mahirap basahin',
    needsReview: 'Babasahin ng opisyal ng barangay ang larawan.',
    readFailed: 'Hindi mabasa ang larawan, susuriin ito ng opisyal ng barangay.',

    analyzingReport: 'Sinusuri ang ulat\u2026',
    analyzing: 'Sinusuri\u2026',
    analysisComplete: 'Tapos na ang pagsusuri',
    analysisCompleteBody: 'Handa na ang iyong assessment.',
    analysisFailed: 'Hindi natapos ang pagsusuri',
    analysisErrorBody: 'May nangyaring mali habang sinusuri ang ulat. Nandiyan pa ang mga sagot mo \u2014 subukan ulit.',
    analyzingNote: 'Maghintay habang sinusuri ng SafeComm ang ulat.',
    analysisSlow: 'Mas matagal ito kaysa karaniwan.',
    stagePreparing: 'Sinusuri ang impormasyon ng ulat',
    stageReadingDocument: 'Binabasa ang nakalakip na dokumento',
    stageFactors: 'Tinutukoy ang mga salik ng kaso',
    stageSeverity: 'Tinataya ang bigat at pagkaapurahan',
    stageRecommendations: 'Gumagawa ng mga rekomendasyon',
    minimize: 'Paliitin',
    cancel: 'Kanselahin',
    retry: 'Subukan ulit',
    submitForReview: 'Ipasa sa opisyal',
    viewResult: 'Tingnan ang resulta',
    cancelConfirm: 'Ititigil ang pagsusuri? Mananatili ang nilagay mo sa form.',

    viewMyCases: 'Tingnan ang mga kaso ko',
    fileAnother: 'Mag-file ulit',
    callLabel: 'Pindutin para tumawag',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

/**
 * Reads the saved choice, defaulting to English.
 *
 * useSyncExternalStore rather than an effect: the server has no localStorage,
 * so the server snapshot is English and React reconciles after hydration
 * without a synchronous setState inside an effect.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the language should change it here too.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function getSnapshot(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'tl' ? 'tl' : 'en';
  } catch {
    return 'en';
  }
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, () => 'en' as Language);

  const setLanguage = useCallback((next: Language) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
    listeners.forEach(l => l());
  }, []);

  // Falls back to English rather than showing a raw key if a translation is
  // ever missing.
  const t = useCallback(
    (key: StringKey): string => STRINGS[lang][key] ?? STRINGS.en[key],
    [lang],
  );

  return { lang, setLanguage, t };
}
