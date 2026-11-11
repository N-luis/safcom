'use client';

import { use } from 'react';
import ServiceReferralEditor from '@/components/referrals/ServiceReferralEditor';

/** One Service Referral Form of a VAWC case. Access is decided by its API, not by this page. */
export default function VawcServiceReferralPage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = use(params);
  return <ServiceReferralEditor caseId={id} referralId={rid} basePath="/vawc/cases" />;
}
