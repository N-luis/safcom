'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import AnalyticsModule from '@/components/analytics/AnalyticsModule';

/**
 * Analytics & Case Intelligence for the system administrator: both desks'
 * figures. VAWC cases are counted but never listed here - the server keeps
 * their rows from this role - so only blotter cases open from this board.
 */
export default function AnalyticsPage() {
  return (
    <DashboardLayout>
      <AnalyticsModule scope="all" caseBase={{ BLOTTER: '/blotter-officer/case-management', VAWC: null }} />
    </DashboardLayout>
  );
}
