import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import {
  OFFICER_ACTIONS, OFFICER_ACTION_LABELS, PROGRESS_STATES, sanitizeNote,
  MAX_NOTE_LENGTH, type ProgressState,
} from '@/lib/followUps';

const createSchema = z.object({
  type: z.enum(['note', 'investigation', 'intervention', 'evidence', 'status_change']).default('note'),
  content: z.string().min(1, 'Content is required').max(MAX_NOTE_LENGTH),
  statusTo: z.string().optional(),
  outcome: z.string().optional(),
  /// A logged action rather than a free note.
  action: z.enum(OFFICER_ACTIONS).optional(),
  /// Officer notes are internal unless the officer chooses to share them.
  visibleToReporter: z.boolean().optional(),
  /// An officer may correct the progress a resident reported.
  progressState: z.enum(PROGRESS_STATES).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    // Officers see the whole timeline - internal notes and hidden entries
    // included - because the audit trail is the point of keeping them.
    const followUps = await prisma.caseFollowUp.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, role: true } },
        resident: { select: { id: true, firstName: true, lastName: true } },
        attachments: { select: { id: true } },
      },
    });
    return successResponse(followUps.map(f => ({
      ...f,
      internal: !f.visibleToReporter,
      authorName: f.authorRole === 'resident'
        ? `${f.resident?.firstName ?? 'Resident'} ${f.resident?.lastName ?? ''}`.trim()
        : f.user?.name ?? 'System',
      attachmentIds: f.attachments.map(a => a.id),
    })));
  } catch {
    return errorResponse('Server error', 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Validation error', 400);

    const existing = await prisma.case.findUnique({ where: { id } });
    if (!existing) return errorResponse('Case not found', 404);

    const { type, content, statusTo, outcome, action, visibleToReporter, progressState } = parsed.data;
    const statusFrom = existing.status;
    const statusChanged = !!statusTo && statusTo !== statusFrom;

    const note = sanitizeNote(content);
    const entryText = action ? `${OFFICER_ACTION_LABELS[action]}${note ? ` — ${note}` : ''}` : note;

    const followUp = await prisma.caseFollowUp.create({
      data: {
        caseId: id,
        userId: auth.user.userId,
        authorRole: 'officer',
        updateType: statusChanged ? 'status_change' : 'officer_action',
        type,
        content: entryText,
        statusFrom: statusChanged ? statusFrom : null,
        statusTo: statusChanged ? statusTo : null,
        outcome: outcome || action || null,
        // Internal by default: an officer's working note is not correspondence.
        visibleToReporter: visibleToReporter ?? false,
      },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    // An officer's reading of the progress overrides the resident's.
    await prisma.case.update({
      where: { id },
      data: {
        lastOfficerActionAt: new Date(),
        ...(progressState && { progressState: progressState as ProgressState }),
      },
    });

    // Update case status if changed
    if (statusChanged) {
      const updateData: Record<string, unknown> = { status: statusTo };
      if (statusTo === 'Resolved' || statusTo === 'Closed') {
        updateData.resolvedAt = new Date();
      }
      await prisma.case.update({ where: { id }, data: updateData });
    }

    // Create a unified activity log entry
    const user = await prisma.user.findUnique({ where: { id: auth.user.userId }, select: { name: true } });
    const typeLabels: Record<string, string> = {
      note: 'Note added', investigation: 'Investigation update', intervention: 'Intervention applied',
      evidence: 'Evidence recorded', status_change: 'Status update',
    };
    const typeColors: Record<string, string> = {
      note: '#64748b', investigation: '#3b82f6', intervention: '#8b5cf6',
      evidence: '#f97316', status_change: '#22c55e',
    };
    const activityMsg = statusChanged
      ? `${typeLabels[type] ?? 'Update'} by ${user?.name ?? 'Officer'} — Status: ${statusFrom} → ${statusTo}`
      : `${typeLabels[type] ?? 'Update'} by ${user?.name ?? 'Officer'}: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`;

    await prisma.activity.create({
      data: {
        type: 'follow_up',
        message: activityMsg,
        entityId: id,
        entityType: 'Case',
        caseId: id,
        userId: auth.user.userId,
        color: typeColors[type] ?? '#64748b',
      },
    });

    return successResponse(followUp, 201);
  } catch {
    return errorResponse('Server error', 500);
  }
}
