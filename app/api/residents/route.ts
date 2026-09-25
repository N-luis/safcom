import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse, paginationMeta } from '@/lib/auth';

const createSchema = z.object({
  residentNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  age: z.number().int().min(0),
  gender: z.string().min(1),
  barangay: z.string().min(1),
  address: z.string().min(1),
  contactNumber: z.string().optional(),
  email: z.string().email().optional(),
  status: z.string().optional(),
  riskLevel: z.string().optional(),
  notes: z.string().optional(),
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
  const sortBy = searchParams.get('sortBy') || 'registeredAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { residentNumber: { contains: search } },
      { barangay: { contains: search } },
    ];
  }
  if (status) where.status = status;
  if (riskLevel) where.riskLevel = riskLevel;

  try {
    const [residents, total] = await Promise.all([
      prisma.resident.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
        // Explicit select: `include` alone returns every scalar, which leaked
        // the bcrypt password hash to the browser.
        select: {
          id: true, residentNumber: true, firstName: true, lastName: true,
          age: true, gender: true, barangay: true, address: true,
          contactNumber: true, email: true, emailVerified: true,
          idDocument: true, status: true, riskLevel: true, notes: true,
          registeredAt: true, updatedAt: true,
          _count: { select: { cases: true } },
        },
      }),
      prisma.resident.count({ where }),
    ]);

    return successResponse({ residents, pagination: paginationMeta(total, page, limit) });
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

    const resident = await prisma.resident.create({ data: parsed.data });

    await prisma.activity.create({
      data: {
        type: 'resident',
        message: `New resident registered: ${resident.firstName} ${resident.lastName}`,
        entityId: resident.id,
        entityType: 'Resident',
        userId: auth.user.userId,
        color: '#8b5cf6',
      },
    });

    return successResponse(resident, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
