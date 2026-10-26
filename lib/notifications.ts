export const RESIDENT_NOTIFICATIONS_LAST_SEEN_KEY = 'resident_notifications_last_seen';

/**
 * The case-log rows a resident may be told about, on their own case.
 *
 * The activity log is the desk's working record - intake drafts, danger flags,
 * who was assigned, internal notes - and the resident feed used to show all of
 * it. It is an allow-list now: anything not named here stays with the desk.
 */
export const RESIDENT_ACTIVITY_TYPES = [
  'case_filed', 'case', 'vawc_status_changed', 'category_changed', 'category_confirmed',
  'assignment', 'follow_up',
] as const;

/** An official's follow-up entry, as the notice about it needs it. */
export interface LinkedFollowUp {
  type: string;
  content: string;
  statusFrom: string | null;
  statusTo: string | null;
  visibleToReporter: boolean;
  hiddenAt: Date | null;
}

/** What each kind of official entry is called, to a resident. */
export const FOLLOW_UP_NOTICE_LABELS: Record<string, string> = {
  note: 'Note from the barangay',
  investigation: 'Investigation update',
  intervention: 'Intervention update',
  evidence: 'Evidence update',
  status_change: 'Status update',
};

export interface ResidentNotice {
  message: string;
  /** The kind of official entry, when the notice is one. */
  entryLabel: string | null;
}

/**
 * What a resident is told about one activity on their case - or null, for
 * nothing at all.
 *
 * An official's entry is told in full, from the entry itself, and only when
 * the official shared it with the reporter and it has not been hidden: the
 * activity line is a cut-down log message that names the officer, and was
 * written for internal notes too. An unshared entry that changed the status
 * tells the resident the new status and nothing of the note.
 */
export function residentNotice(
  activity: { type: string; message: string },
  followUp: LinkedFollowUp | null | undefined,
): ResidentNotice | null {
  const { type, message } = activity;
  if (!(RESIDENT_ACTIVITY_TYPES as readonly string[]).includes(type)) return null;

  if (type === 'follow_up') {
    if (followUp) {
      if (followUp.hiddenAt) return null;
      const status = followUp.statusFrom && followUp.statusTo ? `Status: ${followUp.statusFrom} → ${followUp.statusTo}` : null;
      if (followUp.visibleToReporter) {
        return {
          message: status ? `${followUp.content}\n\n${status}` : followUp.content,
          entryLabel: FOLLOW_UP_NOTICE_LABELS[followUp.type] ?? 'Update from the barangay',
        };
      }
      return status ? { message: `Status updated - ${status.slice('Status: '.length)}`, entryLabel: 'Status update' } : null;
    }
    // Written before entries were linked: the row cannot say whether its note
    // was shared, so only a status change in it is told.
    const m = /— Status: (.+) → (.+)$/.exec(message);
    return m ? { message: `Status updated - ${m[1]} → ${m[2]}`, entryLabel: 'Status update' } : null;
  }

  if (type === 'case_filed' || (type === 'case' && message.startsWith('New case'))) {
    // The desk's line carries triage, rule codes and zone flags.
    return { message: 'Your report was filed and is waiting for review by the barangay.', entryLabel: null };
  }

  if (type === 'assignment') {
    // Officers are never named to a resident, as on their case timeline.
    return /assigned to|took case/.test(message)
      ? { message: 'A barangay officer has been assigned to your case.', entryLabel: null }
      : null;
  }

  return { message, entryLabel: null };
}
