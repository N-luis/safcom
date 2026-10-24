import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { canSeeVawc, withholdReporter } from '@/lib/caseAccess';
import { computeRisk } from '@/lib/riskEngine';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  // The VAWC desk, the captain and the system administrator - nobody else.
  // These endpoints sit outside the /vawc prefix the proxy gates by role, so
  // without this a blotter officer's own session read every survivor
  // narrative straight from the API. 404 rather than 403: whether a VAWC case
  // exists is itself part of what is being kept.
  if (!canSeeVawc(auth.user.role)) return errorResponse('Not found', 404);

  try {
    const now = new Date();
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const vawcFilter = { caseType: { in: [...VAWC_TYPES] } };

    const [total, highRisk, active, resolved, thisMonth, lastMonth, newToday, cases] = await Promise.all([
      prisma.case.count({ where: vawcFilter }),
      prisma.case.count({ where: { ...vawcFilter, riskLevel: { in: ['High', 'Critical'] } } }),
      prisma.case.count({ where: { ...vawcFilter, status: 'In Progress' } }),
      prisma.case.count({ where: { ...vawcFilter, status: { in: ['Resolved', 'Closed'] } } }),
      prisma.case.count({ where: { ...vawcFilter, filedAt: { gte: startThisMonth } } }),
      prisma.case.count({ where: { ...vawcFilter, filedAt: { gte: startLastMonth, lt: startThisMonth } } }),
      prisma.case.count({ where: { ...vawcFilter, filedAt: { gte: yesterday } } }),
      prisma.case.findMany({
        where: vawcFilter,
        take: 1000,
        orderBy: { filedAt: 'desc' },
        select: {
          id: true, caseNumber: true, residentName: true, caseType: true,
          status: true, riskLevel: true, barangay: true, description: true,
          filedAt: true, residentId: true, reporterIdentityWithheld: true,
        },
      }),
    ]);

    const growth = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

    // Context maps for the risk engine
    const barangayCounts: Record<string, number> = {};
    const residentCounts: Record<string, number> = {};
    cases.forEach(c => {
      if (new Date(c.filedAt) >= thirtyDaysAgo) {
        barangayCounts[c.barangay] = (barangayCounts[c.barangay] || 0) + 1;
      }
      if (c.residentId) {
        residentCounts[c.residentId] = (residentCounts[c.residentId] || 0) + 1;
      }
    });

    const scored = cases.map(c => withholdReporter({
      ...c,
      ...computeRisk({
        caseType: c.caseType,
        barangay: c.barangay,
        description: c.description,
        filedAt: c.filedAt,
        residentId: c.residentId,
        status: c.status,
        barangayCaseCount: barangayCounts[c.barangay] || 1,
        residentPriorCases: Math.max(0, (c.residentId ? (residentCounts[c.residentId] || 0) : 0) - 1),
      }),
    }));

    // Buckets are mutually exclusive so they sum to the analysed total.
    // 'Critical' only exists as a filed VAWC level; the engine returns High/Medium/Low.
    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    scored.forEach(c => {
      if (c.riskLevel === 'Critical') summary.critical++;
      else if (c.level === 'High') summary.high++;
      else if (c.level === 'Medium') summary.medium++;
      else summary.low++;
    });

    // Per-street aggregation
    const streetMap: Record<string, { total: number; high: number; scores: number[]; types: Record<string, number> }> = {};
    scored.forEach(c => {
      const key = c.barangay || 'Unspecified';
      if (!streetMap[key]) streetMap[key] = { total: 0, high: 0, scores: [], types: {} };
      streetMap[key].total += 1;
      if (c.level === 'High') streetMap[key].high += 1;
      streetMap[key].scores.push(c.score);
      streetMap[key].types[c.caseType] = (streetMap[key].types[c.caseType] || 0) + 1;
    });

    const byStreet = Object.entries(streetMap)
      .map(([barangay, d]) => ({
        barangay,
        total: d.total,
        highRisk: d.high,
        avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 8);

    const areaInterventions = byStreet.map(area => ({
      barangay: area.barangay,
      highRisk: area.highRisk,
      total: area.total,
      avgScore: area.avgScore,
      dominantCaseTypes: Object.entries(streetMap[area.barangay]?.types ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t),
    }));

    const byCategory = Object.entries(
      scored.reduce<Record<string, number>>((acc, c) => {
        acc[c.caseType] = (acc[c.caseType] || 0) + 1;
        return acc;
      }, {}),
    )
      .map(([caseType, count]) => ({ caseType, count }))
      .sort((a, b) => b.count - a.count);

    return successResponse({
      total, highRisk, active, resolved, growth, newToday,
      summary, byStreet, areaInterventions, byCategory,
      totalAnalyzed: scored.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch {
    return errorResponse('Server error', 500);
  }
}
