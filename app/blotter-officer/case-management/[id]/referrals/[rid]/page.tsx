'use client';

import { use } from 'react';
import ReferralFormEditor from '@/components/referrals/ReferralFormEditor';

/** One referral's Referral Form on a blotter case, with its live preview. Access is decided by the API, not by this page. */
export default function BlotterReferralPage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = use(params);
  return <ReferralFormEditor caseId={id} referralId={rid} basePath="/blotter-officer/case-management" />;
}
