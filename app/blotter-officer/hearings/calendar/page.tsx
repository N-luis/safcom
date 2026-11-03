'use client';

import HearingCalendar from '@/components/hearings/HearingCalendar';

/** The Hearing Calendar for the blotter desk and the captain. */
export default function BlotterHearingCalendarPage() {
  return <HearingCalendar caseBase="/blotter-officer/case-management" />;
}
