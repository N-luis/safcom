'use client';

import WalkInReport from '@/components/cases/WalkInReport';
import { VAWC_TYPES } from '@/lib/vawcTypes';

/**
 * Taking a VAWC report at the desk.
 *
 * The same intake the blotter uses, with this desk's case types. It files
 * through /api/cases, which refuses a VAWC case type to anyone outside this
 * desk, so a report taken here stays here.
 */
export default function VawcWalkInPage() {
  return (
    <WalkInReport
      incidentTypes={[...VAWC_TYPES]}
      prefix="VC"
      basePath="/vawc/cases"
      subjectLabel="Subject"
      notice="Keep this record to what the person in front of you has said. It is confidential to this desk."
    />
  );
}
