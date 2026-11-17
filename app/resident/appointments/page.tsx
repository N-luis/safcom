import { redirect } from 'next/navigation';

/** Appointments are a tab of My Hearings & Notices; an old link or bookmark lands there. */
export default function MyAppointmentsRedirect() {
  redirect('/resident/hearings?tab=appointments');
}
