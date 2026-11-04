'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import HearingManagement, { STAGE_SLUGS, PROCEEDINGS_SLUG } from '@/components/hearings/HearingManagement';
import { KP_STAGE_KEYS } from '@/lib/hearings';

/** Hearing Management opened on every proceeding, or on one Katarungang Pambarangay stage: mediation, pangkat or conciliation. */
export default function HearingStagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage: slug } = use(params);
  const view = slug === PROCEEDINGS_SLUG ? 'ALL' : KP_STAGE_KEYS.find(s => STAGE_SLUGS[s] === slug);
  if (!view) notFound();
  return <HearingManagement key={view} caseBase="/blotter-officer/case-management" view={view} />;
}
