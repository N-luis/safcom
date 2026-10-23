'use client';

import RiskAnalytics from '@/components/cases/RiskAnalytics';

/**
 * The VAWC desk's risk board, scoped to its own caseload.
 *
 * The API refuses `scope=vawc` to anyone those cases are hidden from, so
 * these figures never reach the blotter.
 */
export default function VawcRiskPage() {
  return <RiskAnalytics scope="vawc" basePath="/vawc/cases" />;
}
