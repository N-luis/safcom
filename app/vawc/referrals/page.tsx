'use client';

import ReferralManagement from '@/components/referrals/ReferralManagement';

/** Confidential referrals (possible VAWC concerns) for the VAWC desk - the server shows it only those. */
export default function VawcReferralsPage() {
  return <ReferralManagement scope="vawc" />;
}
