'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import HearingManagement from '@/components/hearings/HearingManagement';

/** Hearing Management opened on Hearing 1, 2 or 3. */
export default function HearingNumberPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const n = Number(number);
  if (n !== 1 && n !== 2 && n !== 3) notFound();
  return <HearingManagement key={n} caseBase="/blotter-officer/case-management" initialTab={n} />;
}
