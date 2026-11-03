'use client';

import AnalyticsModule from '@/components/analytics/AnalyticsModule';

/** Analytics for the blotter desk - its own caseload. */
export default function BlotterAnalyticsPage() {
  return <AnalyticsModule scope="blotter" caseBase={{ BLOTTER: '/blotter-officer/case-management', VAWC: null }} />;
}
