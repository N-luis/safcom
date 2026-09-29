import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { computeRisk } from '@/lib/riskEngine';

const createSchema = z.object({
  caseType: z.string().min(1, 'Case type is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  barangay: z.string().optional(),
  minorsInvolved: z.boolean().optional(),
  physicalHarm: z.boolean().optional(),
  recurring: z.boolean().optional(),
  additionalNotes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 10)));
  // Accepts a comma-separated group so a caller can ask for exactly what the
  // dashboard counts as one number - "Resolved Cases" there is Resolved plus
  // Closed, which a single exact status could not express.
  const status = (searchParams.get('status') || '')
    .split(',').map(v => v.trim()).filter(Boolean);
  const search = searchParams.get('search') || '';

  const where: Record<string, unknown> = { residentId: auth.resident.residentId };
  if (status.length) where.status = { in: status };
  if (search) {
    where.OR = [
      { caseNumber: { contains: search } },
      { caseType: { contains: search } },
      { description: { contains: search } },
    ];
  }

  try {
    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { filedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, caseNumber: true, caseType: true, status: true,
          riskLevel: true, barangay: true, description: true,
          filedAt: true, updatedAt: true, notes: true,
        },
      }),
      prisma.case.count({ where }),
    ]);
    return rSuccess({ cases, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch {
    return rError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const resident = await prisma.resident.findUnique({
      where: { id: auth.resident.residentId },
      select: { firstName: true, lastName: true, barangay: true },
    });
    if (!resident) return rError('Resident not found', 404);

    const count = await prisma.case.count();
    const year = new Date().getFullYear();
    const caseNumber = `SC-${year}-${String(count + 1).padStart(4, '0')}`;
    const barangay = parsed.data.barangay || resident.barangay;
    const filedAt = new Date();

    const { minorsInvolved, physicalHarm, recurring, additionalNotes } = parsed.data;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [barangayCaseCount, residentCaseCount, highRiskAreaCaseCount] = await Promise.all([
      prisma.case.count({ where: { barangay, filedAt: { gte: thirtyDaysAgo } } }),
      prisma.case.count({ where: { residentId: auth.resident.residentId } }),
      prisma.case.count({
        where: {
          barangay,
          caseType: parsed.data.caseType,
          riskLevel: { in: ['High', 'Critical'] },
          filedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const aiRisk = computeRisk({
      caseType: parsed.data.caseType,
      barangay,
      description: parsed.data.description,
      filedAt,
      residentId: auth.resident.residentId,
      status: 'Open',
      barangayCaseCount,
      residentPriorCases: Math.max(0, residentCaseCount),
      minorsInvolved,
      physicalHarm,
      recurring,
      highRiskAreaCaseCount,
    });

    // Encode risk context and notes into the notes field
    const contextLines: string[] = [];
    if (physicalHarm)    contextLines.push('Physical harm: Yes');
    if (minorsInvolved)  contextLines.push('Minors involved: Yes');
    if (recurring)       contextLines.push('Recurring incident: Yes');
    if (additionalNotes) contextLines.push(`Notes: ${additionalNotes}`);
    const notesValue = contextLines.length ? contextLines.join('\n') : undefined;

    const newCase = await prisma.case.create({
      data: {
        caseNumber,
        residentName: `${resident.firstName} ${resident.lastName}`,
        caseType: parsed.data.caseType,
        description: parsed.data.description,
        barangay,
        status: 'Open',
        riskLevel: aiRisk.level,
        filedAt,
        residentId: auth.resident.residentId,
        ...(notesValue && { notes: notesValue }),
      },
    });

    const activityMsg = `Resident filed case ${caseNumber}: ${parsed.data.caseType} — AI risk: ${aiRisk.level}${aiRisk.highRiskZone ? ' ⚠ HIGH-RISK ZONE' : ''}`;

    await prisma.activity.create({
      data: {
        type: 'case_filed',
        message: activityMsg,
        entityId: newCase.id,
        entityType: 'Case',
        caseId: newCase.id,
        color: aiRisk.level === 'High' ? '#ef4444' : aiRisk.level === 'Medium' ? '#f97316' : '#14b8a6',
      },
    });

    return rSuccess({ ...newCase, aiRiskAssessment: aiRisk }, 201);
  } catch {
    return rError('Server error', 500);
  }
}
