'use client';

import HearingManagement from '@/components/hearings/HearingManagement';

/** Hearing Management for the blotter desk and the captain. */
export default function BlotterHearingsPage() {
  return <HearingManagement caseBase="/blotter-officer/case-management" initialTab={0} />;
}
