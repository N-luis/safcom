import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { parseImageDataUrl } from '@/lib/attachments';
import { assessCase, priorityToRiskLevel } from '@/lib/caseAssessment';
import {
  PROGRESS_VALUES, progressToState, sanitizeNote, shouldReassess, isHigherLevel,
  MAX_FOLLOW_UPS_PER_DAY, MAX_NOTE_LENGTH, PENDING_CONFIRMATION_STATUS,
  visibleToResident,
} from '@/lib/followUps';

export const dynamic = 'force-dynamic';

/**
 * A resident following up on their own case.
 *
 * Three things are enforced here rather than trusted to the UI: the case must
 * belong to the caller, it must still be open, and there is a daily cap so the
 * timeline cannot be flooded. Everything a resident writes is visible to them
 * by definition; officer notes are not, and the GET filters accordingly.
 */

const createSchema = z.object({
  progress: z.enum(PROGRESS_VALUES),
  note: z.string().max(MAX_NOTE_LENGTH, `Keep the note under ${MAX_NOTE_LENGTH} characters`).optional(),
  photo: z.object({ name: z.string().max(200), dataUrl: z.string().min(1) }).optional(),
});

const CLOSED = ['Resolved', 'Closed'];

/** The caller's own case, or null. Ownership is the first gate on every path. */
async function ownCase(caseId: string, residentId: string) {
  return prisma.case.findFirst({
    where: { id: caseId, residentId },
    select: {
      id: true, caseNumber: true, status: true, riskLevel: true, caseType: true,
      barangay: true, description: true, progressState: true, residentId: true,
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { id } = await ctx.params;

  const own = await ownCase(id, auth.resident.residentId);
  if (!own) return rError('Case not found', 404);

  const entries = await prisma.caseFollowUp.findMany({
    where: { caseId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true } },
      attachments: { select: { id: true } },
    },
  });

  return rSuccess({
    progressState: own.progressState,
    status: own.status,
    timeline: visibleToResident(entries).map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      updateType: e.updateType,
      authorRole: e.authorRole,
      // The resident sees themselves as "You" and never an officer's name.
      // An automated re-assessment is attributed to the system, not to a
      // person who did not write it.
      authorName: e.authorRole === 'resident' ? 'You'
        : e.authorRole === 'system' ? 'SafeComm (automated)'
        : 'Barangay Officer',
      progress: e.progress,
      content: e.content,
      attachmentIds: e.attachments.map(a => a.id),
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return rError('Invalid request', 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Validation error', 400);

  const own = await ownCase(id, auth.resident.residentId);
  if (!own) return rError('Case not found', 404);
  if (CLOSED.includes(own.status)) {
    return rError('This case is closed. Please file a new report if the problem has returned.', 400);
  }

  // One day's worth, counted per case, so a busy reporter is not blocked on
  // their other cases.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todayCount = await prisma.caseFollowUp.count({
    where: { caseId: id, authorRole: 'resident', createdAt: { gte: since } },
  });
  if (todayCount >= MAX_FOLLOW_UPS_PER_DAY) {
    return rError(
      `You have already added ${MAX_FOLLOW_UPS_PER_DAY} updates to this case today. Please try again tomorrow, or call the barangay if it is urgent.`,
      429,
    );
  }

  const note = sanitizeNote(parsed.data.note ?? '');
  const progress = parsed.data.progress;

  try {
    const entry = await prisma.caseFollowUp.create({
      data: {
        caseId: id,
        residentId: auth.resident.residentId,
        authorRole: 'resident',
        updateType: 'follow_up',
        progress,
        type: 'follow_up',
        content: note || `Reported as: ${progress.replace(/_/g, ' ')}`,
        // A resident always sees their own update.
        visibleToReporter: true,
      },
    });

    if (parsed.data.photo) {
      const image = parseImageDataUrl(parsed.data.photo.dataUrl);
      if (!('error' in image)) {
        await prisma.caseAttachment.create({
          data: {
            caseId: id,
            followUpId: entry.id,
            filename: parsed.data.photo.name,
            mimeType: image.mimeType,
            size: image.bytes.length,
            data: image.bytes,
          },
        });
      }
    }

    // Marking it resolved is a request, not a closure: an officer confirms.
    const nextStatus = progress === 'resolved' ? PENDING_CONFIRMATION_STATUS : own.status;

    await prisma.case.update({
      where: { id },
      data: {
        progressState: progressToState(progress),
        lastResidentUpdateAt: new Date(),
        // A fresh update restarts the silence clock.
        reminderSentAt: null,
        ...(nextStatus !== own.status && { status: nextStatus }),
      },
    });

    // ── Risk re-assessment ────────────────────────────────────────────────
    let riskChange: { from: string; to: string } | null = null;
    if (shouldReassess(progress, note)) {
      const history = await prisma.caseFollowUp.findMany({
        where: { caseId: id, updateType: 'follow_up' },
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      });
      const priorSameType = await prisma.case.count({
        where: { residentId: auth.resident.residentId, caseType: own.caseType },
      });
      // Assessed on the whole case history, not the latest line alone.
      const combined = [own.description, ...history.map(h => h.content)].join('\n\n');
      const reassessed = assessCase(combined, { priorSameType });
      const nextLevel = priorityToRiskLevel(reassessed.priority);

      // Only ever upward. Lowering a level is an officer's decision.
      if (isHigherLevel(nextLevel, own.riskLevel)) {
        riskChange = { from: own.riskLevel, to: nextLevel };
        await prisma.case.update({ where: { id }, data: { riskLevel: nextLevel } });
        await prisma.caseFollowUp.create({
          data: {
            caseId: id,
            authorRole: 'system',
            updateType: 'risk_change',
            type: 'risk_change',
            content: `Risk level raised from ${own.riskLevel} to ${nextLevel} after a new follow-up. This is an initial assessment and does not determine fault.`,
            visibleToReporter: true,
          },
        });
      }
    }

    // ── Tell the officers ─────────────────────────────────────────────────
    const worsening = progress === 'worsening';
    await prisma.notification.create({
      data: {
        title: worsening
          ? `Case ${own.caseNumber} is getting worse`
          : `New follow-up on case ${own.caseNumber}`,
        message: `${note || 'No note added.'}${riskChange ? ` Risk raised to ${riskChange.to}.` : ''}`,
        type: worsening || riskChange ? 'warning' : 'info',
        userId: null,
      },
    });

    await prisma.activity.create({
      data: {
        type: 'case_follow_up',
        message: `Resident follow-up on ${own.caseNumber}: ${progress.replace(/_/g, ' ')}${riskChange ? ` — risk raised ${riskChange.from} to ${riskChange.to}` : ''}`,
        entityId: id,
        entityType: 'Case',
        color: worsening ? '#ef4444' : '#14b8a6',
      },
    });

    return rSuccess({
      id: entry.id,
      progressState: progressToState(progress),
      status: nextStatus,
      riskChange,
      pendingConfirmation: nextStatus === PENDING_CONFIRMATION_STATUS,
    }, 201);
  } catch {
    return rError('Could not save your update. Please try again.', 500);
  }
}
