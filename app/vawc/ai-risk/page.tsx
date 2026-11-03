'use client';

import AnalyticsModule from '@/components/analytics/AnalyticsModule';

/**
 * Analytics for the VAWC desk, scoped to its own caseload.
 *
 * The API narrows the scope by role, so these figures never reach the blotter.
 */
export default function VawcAnalyticsPage() {
  return <AnalyticsModule scope="vawc" caseBase={{ BLOTTER: null, VAWC: '/vawc/cases' }} />;
}
