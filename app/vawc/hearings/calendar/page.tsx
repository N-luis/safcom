'use client';

import HearingCalendar from '@/components/hearings/HearingCalendar';

/** The VAWC Hearings calendar: the shared Hearing Calendar, showing VAWC hearings only (the Blotter desk's never shows them). */
export default function VawcHearingsCalendarPage() {
  return <HearingCalendar track="VAWC" caseBase="/vawc/cases" recordsHref="/vawc/hearings" />;
}
