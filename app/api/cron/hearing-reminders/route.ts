import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { recordEvent, hearingActivity, notifyOfficials, hearingSnap } from '@/lib/hearingsServer';
import { LIVE_STATUSES, LIVE_NOTICE, formatHearingWhen, sessionTitle } from '@/lib/hearings';
import { HEARING_REMINDER_HOURS, HEARING_NOTICE_ALERT_HOURS } from '@/lib/safecommConfig';

export const dynamic = 'force-dynamic';

/**
 * Hearing reminders and "needs attention" alerts.
 *
 *   reminders  to both parties (in their SafeComm accounts, when they have
 *              one) and the officials, at each lead time in
 *              HEARING_REMINDER_HOURS (default 24; e.g. "72,24")
 *   attention  to the officials only: a party's notice is still not issued
 *              HEARING_NOTICE_ALERT_HOURS before the hearing (default 48),
 *              or the hearing's time has passed and nothing was recorded
 *
 * Each is sent once per hearing date: the hearing's history records what was
 * sent for which date, so a new date starts over and a re-run sends nothing.
 * Reminders are in-app only - SafeComm sends no text message or call, so a
 * reporter's safe-contact preference is never overridden - and they say only
 * the stage, date, time and venue.
 *
 * Protected by the same shared secret as the case reminders. Add to vercel.json:
 *   { "crons": [{ "path": "/api/cron/hearing-reminders", "schedule": "0 * * * *" }] }
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.nextUrl.searchParams.get('key');
  if (!secret) return errorResponse('Reminders are not configured', 503);
  if (provided !== secret) return errorResponse('Unauthorized', 401);

  const now = new Date();
  const leads = HEARING_REMINDER_HOURS;
  const horizon = Math.max(leads[0], HEARING_NOTICE_ALERT_HOURS);
  try {
    const hearings = await prisma.caseHearing.findMany({
      where: {
        status: { in: [...LIVE_STATUSES] },
        // Coming up within the longest lead time, or already past and still open.
        scheduledAt: { gte: new Date(now.getTime() - 14 * 86_400_000), lte: new Date(now.getTime() + horizon * 3_600_000) },
        case: { caseType: { notIn: [...VAWC_TYPES] } },
      },
      include: {
        case: { select: { id: true, caseNumber: true, assignedToId: true } },
        events: { where: { kind: { in: ['reminder', 'attention'] } }, select: { kind: true, after: true } },
        notices: { where: { recipientRole: { in: ['COMPLAINANT', 'RESPONDENT'] }, status: { in: [...LIVE_NOTICE] } }, select: { recipientRole: true } },
      },
      take: 500,
    });
    let reminders = 0, alerts = 0;
    for (const h of hearings) {
      const at = h.scheduledAt.toISOString();
      const forThisDate = (kind: string) => h.events.filter(e => e.kind === kind && (e.after as Record<string, unknown> | null)?.scheduledAt === at)
        .map(e => e.after as Record<string, unknown>);
      const hoursLeft = (h.scheduledAt.getTime() - now.getTime()) / 3_600_000;
      const snap = hearingSnap(h, h.scheduledAt, h.venue);
      const T = sessionTitle(h.stage, h.session);
      const missing = ['COMPLAINANT', 'RESPONDENT'].filter(r => !h.notices.some(n => n.recipientRole === r));
      const when = `${formatHearingWhen(h.scheduledAt)}${h.venue ? ` at ${h.venue}` : ''}`;

      // Reminder: the nearest lead time reached, unless it (or a nearer one) was sent for this date.
      if (hoursLeft > 0) {
        const lead = [...leads].reverse().find(l => hoursLeft <= l);
        const sent = forThisDate('reminder').map(a => Number(a.leadHours));
        if (lead !== undefined && !sent.some(s => s <= lead)) {
          await prisma.$transaction(async tx => {
            const e = await recordEvent(tx, { hearingId: h.id, caseId: h.caseId, kind: 'reminder', actorType: 'system', actorId: null, after: { ...snap, leadHours: lead } });
            await hearingActivity(tx, e.id, h.caseId, null, `Reminder sent: the ${T.toLowerCase()} is on ${formatHearingWhen(h.scheduledAt)}`);
            await notifyOfficials(tx, h, h.case, `Hearing approaching - ${h.case.caseNumber}`, `The ${T.toLowerCase()} is on ${when}.`);
            await tx.caseHearing.update({ where: { id: h.id }, data: { reminderSentAt: now } });
          });
          reminders++;
        }
      }

      // Attention: something the officials should do.
      const alerted = forThisDate('attention').map(a => a.reason);
      const reason = hoursLeft <= 0
        ? (hoursLeft < -1 ? 'overdue' : null)
        : (hoursLeft <= HEARING_NOTICE_ALERT_HOURS && missing.length ? 'no_notice' : null);
      if (reason && !alerted.includes(reason)) {
        await prisma.$transaction(async tx => {
          await recordEvent(tx, { hearingId: h.id, caseId: h.caseId, kind: 'attention', actorType: 'system', actorId: null, after: { ...snap, reason } });
          await notifyOfficials(tx, h, h.case, `Hearing needs attention - ${h.case.caseNumber}`,
            reason === 'overdue'
              ? `The ${T.toLowerCase()} was set for ${formatHearingWhen(h.scheduledAt)}. Record attendance and the outcome, or set a new date.`
              : `The ${T.toLowerCase()} is on ${when}, and the ${missing.map(r => r.toLowerCase()).join(' and ')}'s notice has not been issued yet.`, 'warning');
        });
        alerts++;
      }
    }
    return successResponse({ remindersSent: reminders, attentionAlerts: alerts, reminderHours: leads, noticeAlertHours: HEARING_NOTICE_ALERT_HOURS });
  } catch {
    return errorResponse('Server error', 500);
  }
}
