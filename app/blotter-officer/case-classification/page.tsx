'use client';

import { Box } from '@mui/material';
import CaseClassification from '@/components/cases/CaseClassification';
import { BLOTTER_CATEGORIES } from '@/lib/classificationSchema';

export default function BlotterCaseClassificationPage() {
  return (
    <Box>
      <CaseClassification
        scope="all"
        categories={BLOTTER_CATEGORIES}
        accent="#0c1e46"
        basePath="/blotter-officer/case-management"
      />
    </Box>
  );
}
