import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';

const VAWC = [...VAWC_TYPES];
const ACTIVE_STATUSES = ['Open', 'In Progress'];

type CaseRow = {
  id: string;
  caseNumber: string;
  residentName: string;
  caseType: string;
  status: string;
  riskLevel: string;
  barangay: string;
  filedAt: Date;
  resolvedAt: Date | null;
  assignedTo: { id: string; name: string } | null;
};

const isVawc = (caseType: string) => VAWC.includes(caseType as (typeof VAWC_TYPES)[number]);

function summarise(rows: CaseRow[]) {
  return {
    total: rows.length,
    open: rows.filter(c => c.status === 'Open').length,
    inProgress: rows.filter(c => c.status === 'In Progress').length,
    resolved: rows.filter(c => c.status === 'Resolved' || c.status === 'Closed').length,
    critical: rows.filter(c => c.riskLevel === 'Critical').length,
    highRisk: rows.filter(c => c.riskLevel === 'High' || c.riskLevel === 'Critical').length,
    unassigned: rows.filter(c => !c.assignedTo && ACTIVE_STATUSES.includes(c.status)).length,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (auth.user.role !== 'admin' && auth.user.role !== 'system_admin') {
    return errorResponse('Forbidden — barangay captain access only', 403);
  }

  try {
    const [cases, residentTotal, residentPending, staff, alerts, activities] = await Promise.all([
      prisma.case.findMany({
        orderBy: { filedAt: 'desc' },
        select: {
          id: true, caseNumber: true, residentName: true, caseType: true,
          status: true, riskLevel: true, barangay: true,
          filedAt: true, resolvedAt: true,
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      prisma.resident.count(),
      prisma.resident.count({ where: { status: 'Pending' } }),
      prisma.user.findMany({
        where: { active: true },
        select: {
          id: true, name: true, email: true, role: true, barangay: true, createdAt: true,
          _count: { select: { assignedCases: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.alert.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
    ]);

    const blotterRows = cases.filter(c => !isVawc(c.caseType));
    const vawcRows = cases.filter(c => isVawc(c.caseType));

    const blotter = summarise(blotterRows);
    const vawc = summarise(vawcRows);

    const totalCases = cases.length;
    const resolvedCases = blotter.resolved + vawc.resolved;
    const activeCases = cases.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
    const criticalOpen = cases.filter(
      c => c.riskLevel === 'Critical' && ACTIVE_STATUSES.includes(c.status),
    ).length;
    const highOpen = cases.filter(
      c => c.riskLevel === 'High' && ACTIVE_STATUSES.includes(c.status),
    ).length;

    const resolutionRate = totalCases > 0 ? Math.round((resolvedCases / totalCases) * 100) : 0;

    // Safety index = resolution rate penalised by the unresolved severe caseload.
    // Critical counts 3x a High case because it demands captain-level escalation.
    const severityPenalty = Math.min(40, criticalOpen * 3 + highOpen);
    const safetyIndex = Math.max(0, Math.min(100, resolutionRate - severityPenalty));

    // 6-month trend, split per module so the captain sees both queues side by side.
    const now = new Date();
    const trends = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const inMonth = (date: Date) => {
        const dt = new Date(date);
        return dt.getMonth() === m && dt.getFullYear() === y;
      };
      return {
        month: d.toLocaleString('default', { month: 'short' }),
        blotter: blotterRows.filter(c => inMonth(c.filedAt)).length,
        vawc: vawcRows.filter(c => inMonth(c.filedAt)).length,
        resolved: cases.filter(c => c.resolvedAt && inMonth(c.resolvedAt)).length,
      };
    });

    const shape = (c: CaseRow) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      residentName: c.residentName,
      caseType: c.caseType,
      module: isVawc(c.caseType) ? 'VAWC' : 'Blotter',
      status: c.status,
      riskLevel: c.riskLevel,
      barangay: c.barangay,
      filedAt: c.filedAt,
      officer: c.assignedTo?.name ?? null,
    });

    const RISK_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

    const escalations = cases
      .filter(c => ACTIVE_STATUSES.includes(c.status) && (c.riskLevel === 'Critical' || c.riskLevel === 'High'))
      .sort((a, b) => {
        const diff = (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9);
        return diff !== 0 ? diff : new Date(b.filedAt).getTime() - new Date(a.filedAt).getTime();
      })
      .slice(0, 8)
      .map(shape);

    const byRoleMap: Record<string, number> = {};
    staff.forEach(s => { byRoleMap[s.role] = (byRoleMap[s.role] || 0) + 1; });

    return successResponse({
      generatedAt: new Date().toISOString(),
      residents: { total: residentTotal, pending: residentPending, active: residentTotal - residentPending },
      staff: {
        total: staff.length,
        byRole: Object.entries(byRoleMap).map(([role, count]) => ({ role, count })),
        members: staff.map(s => ({
          id: s.id, name: s.name, email: s.email, role: s.role,
          barangay: s.barangay, joinedAt: s.createdAt, caseload: s._count.assignedCases,
        })),
      },
      modules: { blotter, vawc },
      totals: {
        cases: totalCases,
        active: activeCases,
        resolved: resolvedCases,
        criticalOpen,
        alerts: alerts.length,
        resolutionRate,
        safetyIndex,
      },
      trends,
      recentCases: cases.slice(0, 10).map(shape),
      escalations,
      alerts,
      activities,
    });
  } catch {
    return errorResponse('Server error', 500);
  }
}
