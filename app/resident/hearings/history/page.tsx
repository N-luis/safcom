import { redirect } from 'next/navigation';

/** Hearing History is part of My Hearings & Notices; an old link to it opens that page. */
export default function HearingHistoryPage() {
  redirect('/resident/hearings');
}
