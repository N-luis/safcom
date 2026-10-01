import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse, paginationMeta } from '@/lib/auth';
import { OVERDUE_AFTER_DAYS } from '@/lib/followUps';
import { computeRisk } from '@/lib/riskEngine';
import { enforceHardRules } from '@/lib/caseClassification';
import { detectLanguageSafe } from '@/lib/detectLanguage';

const createSchema = z.object({
  caseNumber: z.string().min(1),
  residentName: z.string().min(1),
  caseType: z.string().min(1),
  status: z.string().optional(),
  barangay: z.string().min(1),
  description: z.string().min(1),
  notes: z.string().optional(),
  assignedToId: z.string().optional(),
  residentId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)));
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const riskLevel = searchParams.get('riskLevel') || '';
  const sortBy = searchParams.get('sortBy') || 'filedAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { caseNumber: { contains: search } },
      { residentName: { contains: search } },
      { barangay: { contains: search } },
      { caseType: { contains: search } },
    ];
  }
  if (status) where.status = status;

  // Progress filters for triage. "Overdue" is about the barangay's own response
  // time, not the resident's, so it keys off the last officer action.
  const progressFilter = searchParams.get('progress') || '';
  const overdueCutoff = new Date(Date.now() - OVERDUE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const newFollowUpCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (progressFilter === 'worsening') {
    where.progressState = 'worsening';
  } else if (progressFilter === 'overdue') {
    where.status = { notIn: ['Resolved', 'Closed'] };
    where.OR = [
      { lastOfficerActionAt: { lt: overdueCutoff } },
      { lastOfficerActionAt: null, filedAt: { lt: overdueCutoff } },
    ];
  } else if (progressFilter === 'new_follow_up') {
    where.lastResidentUpdateAt = { gte: newFollowUpCutoff };
  }
  if (riskLevel) where.riskLevel = riskLevel;

  const RISK_PRIORITY: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  try {
    let cases: Awaited<ReturnType<typeof prisma.case.findMany>>;
    let total: number;

    if (sortBy === 'riskLevel') {
      // Prisma can't ORDER BY a CASE expression, so fetch all matching rows, sort
      // by risk priority in memory, then slice for the requested page.
      const all = await prisma.case.findMany({
        where,
        orderBy: { filedAt: 'desc' },
        include: { assignedTo: { select: { id: true, name: true } } },
      });
      all.sort((a, b) => {
        const ap = RISK_PRIORITY[a.riskLevel] ?? 99;
        const bp = RISK_PRIORITY[b.riskLevel] ?? 99;
        if (ap !== bp) return sortDir === 'desc' ? ap - bp : bp - ap;
        return new Date(b.filedAt).getTime() - new Date(a.filedAt).getTime();
      });
      total = all.length;
      cases = all.slice((page - 1) * limit, page * limit);
    } else {
      [cases, total] = await Promise.all([
        prisma.case.findMany({
          where,
          orderBy: { [sortBy]: sortDir },
          skip: (page - 1) * limit,
          take: limit,
          include: { assignedTo: { select: { id: true, name: true } } },
        }),
        prisma.case.count({ where }),
      ]);
    }

    return successResponse({ cases, pagination: paginationMeta(total, page, limit) });
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const { caseType, barangay, description, residentName, residentId, status } = parsed.data;
    const filedAt = new Date();

    // AI risk assessment — the blotter officer no longer assigns the risk level manually;
    // SafComm AI flags it automatically based on incident severity, the incident
    // description, repeat-incident history for this person, and barangay hotspot density.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [barangayCaseCount, residentPriorCases] = await Promise.all([
      prisma.case.count({ where: { barangay, filedAt: { gte: thirtyDaysAgo } } }),
      residentId
        ? prisma.case.count({ where: { residentId } })
        : prisma.case.count({ where: { residentName: { equals: residentName, mode: 'insensitive' } } }),
    ]);
    const aiRisk = computeRisk({
      caseType, barangay, description, filedAt, residentId: residentId ?? null, status: status || 'Open',
      barangayCaseCount, residentPriorCases,
    });

    // The same floor the resident path uses. A walk-in report describing a
    // child being hurt has to land where the identical report typed at home
    // lands; the rules may raise the engine's level, never lower it.
    const { level: riskLevel } = enforceHardRules(aiRisk.level, { report: description });

    // Recorded here too: a walk-in is typed by an officer but dictated by the
    // resident, and the reply they are handed should be in their own words.
    const language = detectLanguageSafe(description).language;

    const newCase = await prisma.case.create({
      data: { ...parsed.data, status: status || 'Open', riskLevel, language },
    });

    await prisma.activity.create({
      data: {
        type: 'case',
        message: `New case ${newCase.caseNumber} filed for ${newCase.residentName} — AI flagged risk: ${riskLevel} (${aiRisk.score}/100)`,
        entityId: newCase.id,
        entityType: 'Case',
        userId: auth.user.userId,
        caseId: newCase.id,
        color: '#3b82f6',
      },
    });

    return successResponse({ ...newCase, aiRiskAssessment: aiRisk }, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
