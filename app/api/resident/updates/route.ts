import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { RESIDENT_ACTIVITY_TYPES, residentNotice } from '@/lib/notifications';

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
            where: { caseId: { in: caseIds }, type: { in: [...RESIDENT_ACTIVITY_TYPES] } },
            orderBy: { createdAt: 'desc' },
            // Some are internal notes and dropped below; read enough to fill the page.
            take: limit * 3,
            select: {
              id: true, type: true, message: true, color: true, createdAt: true,
              entityId: true, entityType: true,
              case: { select: { id: true, caseNumber: true, caseType: true, status: true, riskLevel: true } },
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

    // The official entries those activities are about, read whole. Bound to
    // this resident's cases as well as to the ids, so a row can only ever
    // resolve to an entry on a case the caller owns.
    const entryIds = activities.filter(a => a.entityType === 'CaseFollowUp' && a.entityId).map(a => a.entityId as string);
    const entries = entryIds.length > 0
      ? await prisma.caseFollowUp.findMany({
          where: { id: { in: entryIds }, caseId: { in: caseIds } },
          select: { id: true, type: true, content: true, statusFrom: true, statusTo: true, visibleToReporter: true, hiddenAt: true },
        })
      : [];
    const entryById = new Map(entries.map(e => [e.id, e]));

    const caseUpdates = activities.flatMap(a => {
      const linked = a.entityType === 'CaseFollowUp' ? entryById.get(a.entityId ?? '') ?? null : undefined;
      // Linked to an entry that is not there any more: nothing to tell.
      if (linked === null) return [];
      const notice = residentNotice(a, linked);
      return notice ? [{ ...a, notice }] : [];
    });

    const updates = [
      ...caseUpdates.map(a => ({
        id: a.id,
        source: 'case' as const,
        title: a.case ? `Case #${a.case.caseNumber} Update` : 'Case Update',
        message: a.notice.message,
        entryLabel: a.notice.entryLabel,
        color: a.color,
        createdAt: a.createdAt,
        caseType: a.case?.caseType,
        caseId: a.case?.id ?? null,
        caseNumber: a.case?.caseNumber ?? null,
        caseStatus: a.case?.status ?? null,
        caseRiskLevel: a.case?.riskLevel ?? null,
        level: null as string | null,
      })),
      ...alerts.map(a => ({
        id: a.id,
        source: 'alert' as const,
        title: a.title,
        message: a.message,
        entryLabel: null,
        color: a.level === 'critical' ? '#ef4444' : a.level === 'warning' ? '#f97316' : '#3b82f6',
        createdAt: a.createdAt,
        caseType: undefined,
        caseId: null,
        caseNumber: null,
        caseStatus: null,
        caseRiskLevel: null,
        // Urgency of the announcement, so the detail view can show it rather
        // than only a colour.
        level: a.level,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    return rSuccess(updates);
  } catch {
    return rError('Server error', 500);
  }
}
