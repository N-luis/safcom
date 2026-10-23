import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { canSeeVawc } from '@/lib/caseAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)));
  const unreadOnly = searchParams.get('unread') === 'true';

  try {
    /**
     * Mine or everyone's, and never about a case I may not read.
     *
     * A notice carries its case's number and type, and its own title usually
     * names the case too - so an ungated list told a blotter officer that a
     * Domestic Violence case had been filed, and which number it was. The
     * narrative was already withheld; this withholds the rest.
     */
    const mine = { OR: [{ userId: auth.user.userId }, { userId: null }] };
    const caseVisible = canSeeVawc(auth.user.role)
      ? {}
      : { OR: [{ caseId: null }, { case: { caseType: { notIn: [...VAWC_TYPES] } } }] };

    const where: Record<string, unknown> = { AND: [mine, caseVisible] };
    if (unreadOnly) where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        // The case it is about, so the notice can open it. Only the fields the
        // list needs - not the description, which a blotter officer may not be
        // entitled to read on a VAWC case.
        include: {
          case: {
            select: { id: true, caseNumber: true, caseType: true, status: true, riskLevel: true },
          },
        },
      }),
      // Counted the same way, or the badge promises unread notices that the
      // list will not show.
      prisma.notification.count({ where: { AND: [mine, caseVisible], read: false } }),
    ]);

    return successResponse({ notifications, unreadCount });
  } catch {
    return errorResponse('Server error', 500);
  }
}

const createSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.enum(['info', 'warning', 'success', 'error']).optional(),
  broadcast: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? parsed.error.message, 400);

    const notification = await prisma.notification.create({
      data: {
        title: parsed.data.title,
        message: parsed.data.message,
        type: parsed.data.type ?? 'info',
        userId: parsed.data.broadcast ? null : auth.user.userId,
      },
    });
    return successResponse(notification, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  try {
    await prisma.notification.updateMany({
      where: { OR: [{ userId: auth.user.userId }, { userId: null }], read: false },
      data: { read: true },
    });
    return successResponse({ updated: true });
  } catch {
    return errorResponse('Server error', 500);
  }
}
