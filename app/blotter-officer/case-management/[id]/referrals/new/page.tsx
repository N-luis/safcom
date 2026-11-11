'use client';

import { use } from 'react';
import ReferralFormEditor from '@/components/referrals/ReferralFormEditor';

/** A new Referral Form for a blotter case, with its live preview. Access is decided by the API, not by this page. */
export default function BlotterNewReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReferralFormEditor caseId={id} referralId={null} basePath="/blotter-officer/case-management" />;
}
