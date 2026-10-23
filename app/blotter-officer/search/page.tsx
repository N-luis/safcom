'use client';

import CaseSearch from '@/components/cases/CaseSearch';

const QUICK_FILTERS = ["Theft & Robbery","Domestic Dispute","Assault","High Risk","Open Cases"];

export default function BlotterSearchPage() {
  return <CaseSearch basePath="/blotter-officer/case-management" quickFilters={QUICK_FILTERS} />;
}
