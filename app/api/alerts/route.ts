import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';

const createSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(120, 'Title is too long'),
  message: z.string().min(5, 'Message must be at least 5 characters').max(600, 'Message is too long'),
  level: z.enum(['info', 'warning', 'critical']).optional(),
  barangay: z.string().optional(),
  expiresAt: z.string().optional(),
});

/**
 * Which module an announcement was published from. Residents see every
 * announcement the same way; this is for the officers' own board so each
 * module can tell its posts from the other's.
 */
export function moduleForRole(role: string): string {
  if (role === 'officer' || role === 'blotter_officer') return 'blotter';
  if (role === 'vawc_officer' || role === 'vawc' || role === 'vawc_lead') return 'vawc';
  if (role === 'admin') return 'captain';
  return 'admin';
}

/** Anyone who staffs a module may publish a barangay announcement. */
const CAN_PUBLISH = [
  'officer', 'blotter_officer',
  'vawc_officer', 'vawc', 'vawc_lead',
  'admin', 'system_admin',
];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  // The officers' board wants taken-down and expired posts too; the default
  // (live only) is what any resident-facing surface should read.
  const includeInactive = searchParams.get('all') === 'true';
  const moduleFilter = searchParams.get('module') || '';

  try {
    const now = new Date();
    const alerts = await prisma.alert.findMany({
      where: {
        ...(includeInactive ? {} : { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
        ...(moduleFilter ? { module: moduleFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // `expired` is derived, not stored — a post can lapse without anyone
    // touching the row.
    return successResponse(
      alerts.map(a => ({ ...a, expired: Boolean(a.expiresAt && a.expiresAt <= now) })),
    );
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  if (!CAN_PUBLISH.includes(auth.user.role)) return errorResponse('Forbidden', 403);

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid data', 400);

    const { expiresAt, barangay, ...rest } = parsed.data;

    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return errorResponse('Invalid expiry date', 400);
    }
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && expiry <= new Date()) {
      return errorResponse('The expiry date must be in the future', 400);
    }

    const poster = await prisma.user.findUnique({
      where: { id: auth.user.userId },
      select: { name: true },
    });

    const alert = await prisma.alert.create({
      data: {
        ...rest,
        level: rest.level ?? 'warning',
        // Empty string means "every barangay" — store null so the resident
        // feed's `barangay: null` match picks it up.
        barangay: barangay?.trim() ? barangay.trim() : null,
        expiresAt: expiry,
        module: moduleForRole(auth.user.role),
        createdBy: poster?.name ?? auth.user.email,
      },
    });

    await prisma.activity.create({
      data: {
        type: 'announcement_published',
        message: `Announcement published: ${alert.title}`,
        entityId: alert.id,
        entityType: 'Alert',
        userId: auth.user.userId,
        color: alert.level === 'critical' ? '#ef4444' : alert.level === 'warning' ? '#f97316' : '#3b82f6',
      },
    });

    return successResponse(alert, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
