'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import HearingManagement, { STAGE_SLUGS } from '@/components/hearings/HearingManagement';
import { KP_STAGE_KEYS } from '@/lib/hearings';

/** Hearing Management opened on one Katarungang Pambarangay stage: mediation, pangkat or conciliation. */
export default function HearingStagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage: slug } = use(params);
  const stage = KP_STAGE_KEYS.find(s => STAGE_SLUGS[s] === slug);
  if (!stage) notFound();
  return <HearingManagement key={stage} caseBase="/blotter-officer/case-management" stage={stage} />;
}
