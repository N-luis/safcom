'use client';

import CaseSearch from '@/components/cases/CaseSearch';

const QUICK_FILTERS = ["Domestic Violence","Child Abuse","Sexual Harassment","High Risk","Open Cases"];

export default function VawcSearchPage() {
  return <CaseSearch basePath="/vawc/cases" quickFilters={QUICK_FILTERS} />;
}
