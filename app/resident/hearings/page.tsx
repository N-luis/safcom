'use client';

import { Suspense } from 'react';
import ResidentHearingsModule from '@/components/hearings/ResidentHearingsModule';

/** My Hearings & Notices: the hearings and notices, and the appointments, in one place (Suspense: it reads ?tab=). */
export default function MyHearingsPage() {
  return <Suspense><ResidentHearingsModule /></Suspense>;
}
