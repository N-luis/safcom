import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';

export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(searchParams.get('limit') || 10)));

  try {
    // Get the resident's case IDs and barangay first
    const [residentCases, resident] = await Promise.all([
      prisma.case.findMany({
        where: { residentId: auth.resident.residentId },
        select: { id: true },
      }),
      prisma.resident.findUnique({
        where: { id: auth.resident.residentId },
        select: { barangay: true },
      }),
    ]);
    const caseIds = residentCases.map(c => c.id);
    const now = new Date();

    // Activities for those cases + active alerts (barangay-wide or targeted at this resident's barangay)
    const [activities, alerts] = await Promise.all([
      caseIds.length > 0
        ? prisma.activity.findMany({
            where: { caseId: { in: caseIds } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
              id: true, type: true, message: true, color: true, createdAt: true,
              case: { select: { caseNumber: true, caseType: true } },
            },
          })
        : Promise.resolve([]),
      prisma.alert.findMany({
        where: {
          active: true,
          // An officers-only announcement must never reach a resident, so the
          // audience is filtered here rather than relying on the barangay match.
          // Rows predating the audience column default to 'residents'.
          audience: { in: ['residents', 'everyone'] },
          OR: [{ barangay: null }, { barangay: '' }, ...(resident?.barangay ? [{ barangay: { equals: resident.barangay, mode: 'insensitive' as const } }] : [])],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        orderBy: { createdAt: 'desc' },
        // Announcements are published from the Blotter/VAWC Reports boards and
        // can stack up during a storm, so keep more than a couple.
        take: 10,
        select: { id: true, title: true, message: true, level: true, createdAt: true },
      }),
    ]);

    const updates = [
      ...activities.map(a => ({
        id: a.id,
        source: 'case' as const,
        title: a.case ? `Case #${a.case.caseNumber} Update` : 'Case Update',
        message: a.message,
        color: a.color,
        createdAt: a.createdAt,
        caseType: a.case?.caseType,
      })),
      ...alerts.map(a => ({
        id: a.id,
        source: 'alert' as const,
        title: a.title,
        message: a.message,
        color: a.level === 'critical' ? '#ef4444' : a.level === 'warning' ? '#f97316' : '#3b82f6',
        createdAt: a.createdAt,
        caseType: undefined,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    return rSuccess(updates);
  } catch {
    return rError('Server error', 500);
  }
}
