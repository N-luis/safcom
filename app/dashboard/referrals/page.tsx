'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import ReferralManagement from '@/components/referrals/ReferralManagement';

/** Referral management for the Barangay Captain (the routes refuse anyone who may not see referrals). */
export default function ReferralsPage() {
  return <DashboardLayout><ReferralManagement scope="captain" /></DashboardLayout>;
}
