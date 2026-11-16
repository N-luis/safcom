import { redirect } from 'next/navigation';

/** The module is now VAWC Hearings: old links and bookmarks land there (only ?section= is carried over). */
export default async function VawcAppointmentsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const section = (await searchParams).section;
  redirect(typeof section === 'string' && /^[a-z]{1,20}$/.test(section) ? `/vawc/hearings?section=${section}` : '/vawc/hearings');
}
