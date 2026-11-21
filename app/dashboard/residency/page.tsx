'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';
import ResidentVerification from '@/components/residency/ResidentVerification';

/** Resident Verification for the Barangay Captain (the routes refuse everyone else). */
export default function ResidencyVerificationPage() {
  return <DashboardLayout><ResidentVerification /></DashboardLayout>;
}
