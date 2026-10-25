'use client';

import { use, Suspense } from 'react';
import OfficialIntakeForm from '@/components/cases/OfficialIntakeForm';

/** The intake form for a VAWC case. Access is decided by its API, not by this page. */
export default function VawcIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><OfficialIntakeForm caseId={id} basePath="/vawc/cases" /></Suspense>;
}
