/**
 * Evidence photos on a case - what a gallery shows about each one. Client-safe.
 *
 * The bytes live in the CaseAttachment table (private: row-level security on,
 * nothing granted to the public API roles) and are only ever served by
 * /api/attachments/[id], which checks the caller every time. Nothing here is a
 * browser blob URL or a public link.
 */

export type EvidenceSource = 'report' | 'follow_up';

export interface EvidenceItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** When it was received (ISO). */
  createdAt: string;
  /** With the original report, or with a later follow-up. */
  source: EvidenceSource;
  /** Who uploaded it, as this viewer may be told ("The reporter", "You", an official's name). */
  uploadedBy: string;
}

/** The address of the stored image; `download` asks for it as a file. */
export const evidenceUrl = (id: string, download = false) => `/api/attachments/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;
