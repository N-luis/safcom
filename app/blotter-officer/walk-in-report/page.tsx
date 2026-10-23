'use client';

import WalkInReport from '@/components/cases/WalkInReport';

const INCIDENT_TYPES = ['Theft & Robbery', 'Public Nuisance', 'Domestic Dispute', 'Assault', 'Cybercrime', 'Vandalism', 'Drug-Related', 'Trespassing', 'Other'];

export default function BlotterWalkInPage() {
  return (
    <WalkInReport
      incidentTypes={INCIDENT_TYPES}
      prefix="BLT"
      basePath="/blotter-officer/case-management"
    />
  );
}
