import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse, paginationMeta } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { computeRisk } from '@/lib/riskEngine';

/** Reads a filter param that may hold one value or a comma-separated group. */
function csv(raw: string | null): string[] {
  return (raw ?? '').split(',').map(v => v.trim()).filter(Boolean);
}

const createSchema = z.object({
  residentName: z.string().min(2),
  caseType: z.string().min(1),
  barangay: z.string().min(1),
  description: z.string().min(10),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const limit = Math.min(Number(sp.get('limit') ?? 20), 100);
  const search = sp.get('search') ?? '';
  // Status and risk accept a comma-separated list so a caller can ask for a
  // group the dashboard actually counts as one number - e.g. the Resolved card
  // counts 'Resolved' plus 'Closed', and High-Risk counts 'High' plus 'Critical'.
  const status = csv(sp.get('status'));
  const risk = csv(sp.get('risk'));
  const type = sp.get('type') ?? '';
  const urgent = sp.get('urgent') === 'true';
  const fromParam = sp.get('from');
  const from = fromParam ? new Date(fromParam) : null;
  const validFrom = from && !isNaN(from.getTime()) ? from : null;

  try {
    const where = {
      caseType: type ? { equals: type } : { in: [...VAWC_TYPES] },
      ...(urgent
        ? { riskLevel: { in: ['High', 'Critical'] }, status: { notIn: ['Resolved', 'Closed'] } }
        : {
            ...(status.length && { status: { in: status } }),
            ...(risk.length && { riskLevel: { in: risk } }),
          }),
      ...(validFrom && { filedAt: { gte: validFrom } }),
      ...(search && {
        OR: [
          { residentName: { contains: search, mode: 'insensitive' as const } },
          { caseNumber: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { filedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, caseNumber: true, residentName: true, caseType: true,
          status: true, riskLevel: true, barangay: true, description: true,
          notes: true, filedAt: true, resolvedAt: true, updatedAt: true,
          assignedTo: { select: { name: true } },
        },
      }),
      prisma.case.count({ where }),
    ]);

    return successResponse({ cases, ...paginationMeta(total, page, limit) });
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  const { residentName, caseType, barangay, description, notes } = parsed.data;

  if (![...VAWC_TYPES].includes(caseType as typeof VAWC_TYPES[number])) {
    return errorResponse('Invalid VAWC case type', 400);
  }

  try {
    const count = await prisma.case.count();
    const year = new Date().getFullYear();
    const caseNumber = `VC-${year}-${String(count + 1).padStart(4, '0')}`;
    const filedAt = new Date();

    // AI risk assessment — the officer no longer sets the risk level manually;
    // SafComm AI flags it the moment the case is filed, based on case-type severity,
    // the incident description, repeat-incident history for this person, and
    // barangay hotspot density.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [barangayCaseCount, residentPriorCases] = await Promise.all([
      prisma.case.count({ where: { barangay, filedAt: { gte: thirtyDaysAgo } } }),
      prisma.case.count({ where: { residentName: { equals: residentName, mode: 'insensitive' } } }),
    ]);
    const aiRisk = computeRisk({
      caseType, barangay, description, filedAt, residentId: null, status: 'Open',
      barangayCaseCount, residentPriorCases,
    });

    const newCase = await prisma.case.create({
      data: {
        caseNumber, residentName, caseType, barangay, description,
        riskLevel: aiRisk.level, status: 'Open',
        ...(notes && { notes }),
        ...(auth.user.userId && { assignedToId: auth.user.userId }),
      },
    });

    await prisma.activity.create({
      data: {
        type: 'vawc_case_filed',
        message: `New VAWC case filed: ${caseNumber} — ${residentName} (${caseType}) — AI flagged risk: ${aiRisk.level} (${aiRisk.score}/100)`,
        entityId: newCase.id,
        entityType: 'Case',
        userId: auth.user.userId,
        color: '#7c3aed',
      },
    });

    return successResponse({ ...newCase, aiRiskAssessment: aiRisk }, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
