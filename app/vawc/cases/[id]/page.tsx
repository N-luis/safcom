'use client';

import { use } from 'react';
import CaseWorkspace from '@/components/cases/CaseWorkspace';

/**
 * The VAWC desk's case workspace.
 *
 * The same workspace the blotter has, mounted on this desk's list. It reads
 * /api/cases/[id], which refuses a VAWC case to anyone outside this desk, so
 * a case opened here is one the officer is entitled to.
 */
export default function VawcCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CaseWorkspace id={id} basePath="/vawc/cases" />;
}
