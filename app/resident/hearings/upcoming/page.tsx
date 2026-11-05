import { redirect } from 'next/navigation';

/** Upcoming Hearings and its calendar are part of My Hearings & Notices; an old link to it opens that page. */
export default function UpcomingHearingsPage() {
  redirect('/resident/hearings');
}
