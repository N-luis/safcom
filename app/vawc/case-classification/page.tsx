'use client';

import { Box } from '@mui/material';
import CaseClassification from '@/components/cases/CaseClassification';
import { VAWC_CATEGORIES } from '@/lib/classificationSchema';

/**
 * The VAWC desk's classification view.
 *
 * Scoped to this desk's caseload: the API refuses `scope=vawc` to anyone the
 * VAWC cases are hidden from, so these counts never reach the blotter.
 */
export default function VawcCaseClassificationPage() {
  return (
    <Box>
      <CaseClassification
        scope="vawc"
        categories={VAWC_CATEGORIES}
        accent="#7c3aed"
        basePath="/vawc/cases"
        title="Case Classification"
        subtitle="How VAWC cases break down, from this desk&rsquo;s own filings"
      />
    </Box>
  );
}
