'use client';

import { use } from 'react';
import CaseWorkspace from '@/components/cases/CaseWorkspace';

export default function BlotterCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CaseWorkspace id={id} basePath="/blotter-officer/case-management" />;
}
