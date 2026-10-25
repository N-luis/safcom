'use client';

import { use, Suspense } from 'react';
import OfficialIntakeForm from '@/components/cases/OfficialIntakeForm';

/** The intake form for a blotter case. Access is decided by its API, not by this page. */
export default function BlotterIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><OfficialIntakeForm caseId={id} basePath="/blotter-officer/case-management" /></Suspense>;
}
