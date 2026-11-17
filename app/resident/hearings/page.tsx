'use client';

import { Suspense } from 'react';
import ResidentHearingsModule from '@/components/hearings/ResidentHearingsModule';

/** My Hearings & Notices: every hearing the resident is a party to, blotter and VAWC, on one page (Suspense: it reads ?hearing= and an old ?tab=). */
export default function MyHearingsPage() {
  return <Suspense><ResidentHearingsModule /></Suspense>;
}
