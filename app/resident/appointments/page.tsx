import { redirect } from 'next/navigation';

/** Appointments were merged into My Hearings & Notices: an old link or bookmark lands there. */
export default function MyAppointmentsRedirect() {
  redirect('/resident/hearings');
}
