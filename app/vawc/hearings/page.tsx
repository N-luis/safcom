'use client';

import { Suspense } from 'react';
import VawcAppointments from '@/components/vawcAppointments/VawcAppointments';

/** VAWC Hearings for the VAWC desk and the captain (Suspense: it reads ?section=). */
export default function VawcHearingsPage() {
  return <Suspense><VawcAppointments /></Suspense>;
}
