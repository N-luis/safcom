import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { RESIDENT_ACTIVITY_TYPES, residentNotice } from '@/lib/notifications';
import { residentHearingWhere } from '@/lib/hearingsServer';
import { residentHearingMessage, RESIDENT_EVENT_KINDS } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import { residentAppointmentWhere } from '@/lib/vawcAppointmentsServer';
import { residentAppointmentMessage, RESIDENT_APPOINTMENT_EVENTS } from '@/lib/vawcAppointments';

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

    // Activities for those cases + active alerts (barangay-wide or targeted at this resident's barangay).
    // Hearing updates are read from the proceedings the resident is a party
    // to instead - so a respondent hears about theirs too, on a case they did not file.
    const [activities, alerts, hearingEvents, appointmentEvents, residencyEvents] = await Promise.all([
      caseIds.length > 0
        ? prisma.activity.findMany({
            where: { caseId: { in: caseIds }, type: { in: RESIDENT_ACTIVITY_TYPES.filter(t => t !== 'hearing') } },
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
      prisma.caseHearingEvent.findMany({
        where: { kind: { in: [...RESIDENT_EVENT_KINDS] }, hearing: residentHearingWhere(auth.resident.residentId) },
        orderBy: { createdAt: 'desc' },
        take: limit * 3,
        select: { id: true, kind: true, after: true, createdAt: true,
          hearing: { select: {
            case: { select: { id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, residentId: true } } } } },
      }),
      // Appointments the officer chose to tell this resident about (the former VAWC
      // Appointments, now read-only; each one migrated is a hearing - see below).
      prisma.vawcAppointmentEvent.findMany({
        where: { kind: { in: [...RESIDENT_APPOINTMENT_EVENTS] }, appointment: residentAppointmentWhere(auth.resident.residentId) },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, kind: true, after: true, createdAt: true, appointmentId: true },
      }),
      // The official's decisions on this resident's own residency (never anyone else's).
      prisma.residencyEvent.findMany({
        where: { residentId: auth.resident.residentId, kind: { in: ['approved', 'rejected', 'info_requested'] } },
        orderBy: { createdAt: 'desc' }, take: 5,
        select: { id: true, kind: true, note: true, createdAt: true },
      }),
    ]);
    // An appointment notice opens the hearing it became (Appointments were merged into hearings).
    const apptIds = [...new Set(appointmentEvents.map(e => e.appointmentId))];
    const migrated = apptIds.length
      ? await prisma.caseHearing.findMany({ where: { migratedFromAppointmentId: { in: apptIds }, ...residentHearingWhere(auth.resident.residentId) },
          select: { id: true, migratedFromAppointmentId: true } })
      : [];
    const hearingOf = new Map(migrated.map(h => [h.migratedFromAppointmentId, h.id]));

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
    // Each told to the party in their own words (lib/hearings.ts residentHearingMessage).
    const me = auth.resident.residentId;
    const hearingUpdates = hearingEvents.flatMap(e => {
      const message = residentHearingMessage(e, 'COMPLAINANT');
      if (!message) return [];
      const own = e.hearing.case.residentId === me;
      const c = e.hearing.case;
      return [{ id: e.id, color: '#0369a1', createdAt: e.createdAt, notice: { message, entryLabel: 'Hearing update' },
        case: own ? c : { id: null, caseNumber: c.caseNumber, caseType: undefined, status: null, riskLevel: null } }];
    });

    // Safe for anyone who sees the screen: "an appointment with the barangay" and its date - no case
    // number, category, officer or purpose, and no link to the case (lib/vawcAppointments.ts).
    const appointmentUpdates = appointmentEvents.flatMap(e => {
      const message = residentAppointmentMessage(e);
      return message ? [{
        id: e.id, source: 'case' as const, title: 'Appointment update', message, entryLabel: 'Appointment', color: '#0f766e', createdAt: e.createdAt,
        caseType: undefined, caseId: null, caseNumber: null, caseStatus: null, caseRiskLevel: null, level: null as string | null, requestId: null,
        href: hearingOf.has(e.appointmentId) ? `/resident/hearings?hearing=${encodeURIComponent(hearingOf.get(e.appointmentId)!)}` : '/resident/hearings',
      }] : [];
    });

    const residencyUpdates = residencyEvents.map(e => ({
      id: e.id, source: 'case' as const, title: 'Residency update',
      message: e.kind === 'approved' ? 'Your residency is verified. You can now file reports in the Resident Portal.'
        : e.kind === 'rejected' ? `Your residency was not approved.${e.note ? ` Reason: ${e.note}` : ''} You can correct your details and submit again.`
          : `The barangay needs more information about your residency.${e.note ? ` ${e.note}` : ''}`,
      entryLabel: e.kind === 'approved' ? 'Residency Verified' : e.kind === 'rejected' ? 'Residency Not Approved' : 'Additional Information Requested',
      color: e.kind === 'approved' ? '#15803d' : e.kind === 'rejected' ? '#b91c1c' : '#b45309', createdAt: e.createdAt,
      caseType: undefined, caseId: null, caseNumber: null, caseStatus: null, caseRiskLevel: null, level: null as string | null, requestId: null,
      href: '/resident/residency',
    }));

    const updates = [
      ...residencyUpdates,
      ...appointmentUpdates,
      ...[...caseUpdates, ...hearingUpdates].map(a => ({
        id: a.id,
        source: 'case' as const,
        title: a.case ? `Case #${a.case.caseNumber} Update` : 'Case Update',
        message: a.notice.message,
        entryLabel: a.notice.entryLabel,
        color: a.color,
        createdAt: a.createdAt,
        caseType: a.case?.caseType as string | undefined,
        caseId: a.case?.id ?? null,
        caseNumber: a.case?.caseNumber ?? null,
        caseStatus: a.case?.status ?? null,
        caseRiskLevel: a.case?.riskLevel ?? null,
        level: null as string | null,
        // A request for more information opens straight at that request (in the resident's own case).
        requestId: 'entityType' in a && a.entityType === 'ClarificationRequest' ? a.entityId ?? null : null,
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
  } catch (e) {
    logRouteError('GET /api/resident/updates', e);
    return rError('Server error', 500);
  }
}
