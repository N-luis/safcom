import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { computeRisk } from '@/lib/riskEngine';
import { vawcFilter, withholdReporter } from '@/lib/caseAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    /**
     * Only the cases this role may see.
     *
     * Everything below is built from this list - the top-risk table, the map,
     * the per-area counts - so an unfiltered read put VAWC cases, by number,
     * type and the person's name, on the blotter's own risk page.
     *
     * scope=vawc narrows it to that desk's caseload instead, and is refused
     * to anyone those cases are hidden from.
     */
    const visible = vawcFilter(auth.user.role);
    const wantsVawc = req.nextUrl.searchParams.get('scope') === 'vawc';
    if (wantsVawc && Object.keys(visible).length > 0) return errorResponse('Not found', 404);
    const where = wantsVawc ? { caseType: { in: [...VAWC_TYPES] } } : visible;

    // Fetch all relevant cases (capped at 1000 for performance)
    const allCases = await prisma.case.findMany({
      where,
      take: 1000,
      orderBy: { filedAt: 'desc' },
      select: {
        id: true,
        caseNumber: true,
        residentName: true,
        caseType: true,
        status: true,
        riskLevel: true,
        barangay: true,
        description: true,
        filedAt: true,
        residentId: true, reporterIdentityWithheld: true,
      },
    });

    if (allCases.length === 0) {
      return successResponse({
        summary: { critical: 0, high: 0, medium: 0, low: 0 },
        byCategory: [],
        byBarangay: [],
        monthly: buildEmptyMonthly(),
        radarData: [],
        topRiskCases: [],
        areaInterventions: [],
        modelStats: [],
        mapCases: [],
        totalAnalyzed: 0,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Build context maps
    const barangayCounts: Record<string, number> = {};
    const residentCounts: Record<string, number> = {};

    allCases.forEach(c => {
      if (new Date(c.filedAt) >= thirtyDaysAgo) {
        barangayCounts[c.barangay] = (barangayCounts[c.barangay] || 0) + 1;
      }
      if (c.residentId) {
        residentCounts[c.residentId] = (residentCounts[c.residentId] || 0) + 1;
      }
    });

    // Score every case
    const scored = allCases.map(c => {
      const result = computeRisk({
        caseType: c.caseType,
        barangay: c.barangay,
        description: c.description,
        filedAt: c.filedAt,
        residentId: c.residentId,
        status: c.status,
        barangayCaseCount: barangayCounts[c.barangay] || 1,
        residentPriorCases: Math.max(0, (c.residentId ? (residentCounts[c.residentId] || 0) : 0) - 1),
      });
      return withholdReporter({ ...c, ...result });
    });

    // Summary counts
    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    scored.forEach(c => {
      if (c.level === 'High') summary.high++;
      else if (c.level === 'Medium') summary.medium++;
      else summary.low++;
    });

    // By category
    const categoryMap: Record<string, { scores: number[]; high: number }> = {};
    scored.forEach(c => {
      if (!categoryMap[c.caseType]) categoryMap[c.caseType] = { scores: [], high: 0 };
      categoryMap[c.caseType].scores.push(c.score);
      if (c.level === 'High') categoryMap[c.caseType].high++;
    });
    const byCategory = Object.entries(categoryMap)
      .map(([type, d]) => ({
        type,
        count: d.scores.length,
        avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
        high: d.high,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    // By barangay (top 8)
    const barangayMap: Record<string, { scores: number[]; high: number; total: number }> = {};
    scored.forEach(c => {
      if (!barangayMap[c.barangay]) barangayMap[c.barangay] = { scores: [], high: 0, total: 0 };
      barangayMap[c.barangay].scores.push(c.score);
      barangayMap[c.barangay].total++;
      if (c.level === 'High') barangayMap[c.barangay].high++;
    });
    const byBarangay = Object.entries(barangayMap)
      .map(([barangay, d]) => ({
        barangay,
        total: d.total,
        highRisk: d.high,
        avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 8);

    // Monthly distribution (last 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyMap: Record<string, { High: number; Medium: number; Low: number }> = {};
    scored.forEach(c => {
      const d = new Date(c.filedAt);
      if (d < sixMonthsAgo) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!monthlyMap[key]) monthlyMap[key] = { High: 0, Medium: 0, Low: 0 };
      if (c.level === 'High') monthlyMap[key].High++;
      else if (c.level === 'Medium') monthlyMap[key].Medium++;
      else monthlyMap[key].Low++;
    });

    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthly.push({
        month: monthNames[d.getMonth()],
        ...(monthlyMap[key] || { High: 0, Medium: 0, Low: 0 }),
      });
    }

    // Radar data by category (top 6)
    const radarData = byCategory.slice(0, 6).map(c => ({
      subject: c.type.split(' ')[0],
      score: c.avgScore,
      count: c.count,
      fullMark: 100,
    }));

    // Top risk cases (High, sorted by score)
    const topRiskCases = scored
      .filter(c => c.level === 'High')
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(c => ({
        id: c.id,
        caseNumber: c.caseNumber,
        residentName: c.residentName,
        caseType: c.caseType,
        barangay: c.barangay,
        status: c.status,
        score: c.score,
        level: c.level,
        confidence: c.confidence,
        recommendation: c.recommendation,
        riskFactors: c.riskFactors,
        justification: c.justification,
        highRiskZone: c.highRiskZone,
        factors: c.factors,
        filedAt: c.filedAt,
      }));

    // Per-barangay case type breakdown for intervention recommendation engine
    const barangayCaseTypesMap: Record<string, Record<string, number>> = {};
    scored.forEach(c => {
      if (!barangayCaseTypesMap[c.barangay]) barangayCaseTypesMap[c.barangay] = {};
      barangayCaseTypesMap[c.barangay][c.caseType] = (barangayCaseTypesMap[c.barangay][c.caseType] || 0) + 1;
    });
    const areaInterventions = byBarangay.map(area => {
      const typeCounts = barangayCaseTypesMap[area.barangay] || {};
      const dominantCaseTypes = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);
      return { barangay: area.barangay, highRisk: area.highRisk, total: area.total, avgScore: area.avgScore, dominantCaseTypes };
    });

    // Aggregate per-factor (sub-model) statistics across all scored cases
    const modelAgg: Record<string, { scores: number[]; triggered: number }> = {};
    scored.forEach(c => {
      (c.factors ?? []).forEach((f: { factor: string; score: number }) => {
        if (!modelAgg[f.factor]) modelAgg[f.factor] = { scores: [], triggered: 0 };
        modelAgg[f.factor].scores.push(f.score);
        if (f.score >= 50) modelAgg[f.factor].triggered++;
      });
    });
    const modelStats = Object.entries(modelAgg).map(([factor, d]) => ({
      factor,
      avgScore: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
      casesTriggered: d.triggered,
    }));

    const mapCases = scored.map(c => ({
      id: c.id,
      caseNumber: c.caseNumber,
      caseType: c.caseType,
      barangay: c.barangay,
      status: c.status,
      score: c.score,
      level: c.level as 'High' | 'Medium' | 'Low',
      filedAt: new Date(c.filedAt).toISOString(),
    }));

    return successResponse({
      summary,
      byCategory,
      byBarangay,
      monthly,
      radarData,
      topRiskCases,
      areaInterventions,
      modelStats,
      mapCases,
      totalAnalyzed: scored.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AI Stats]', err);
    return errorResponse('Analysis failed', 500);
  }
}

function buildEmptyMonthly() {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return { month: monthNames[d.getMonth()], High: 0, Medium: 0, Low: 0 };
  });
}
