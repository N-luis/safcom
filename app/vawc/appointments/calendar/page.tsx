import { redirect } from 'next/navigation';

/** The module is now VAWC Hearings: the old calendar link lands on its calendar. */
export default function VawcAppointmentCalendarRedirect() {
  redirect('/vawc/hearings/calendar');
}
