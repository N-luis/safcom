import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { HEARING_OUTCOMES, type HearingOutcome } from '@/lib/analytics';

/**
 * Record what happened to a scheduled hearing: held (with its outcome),
 * postponed (with the reason, and optionally the new date - a new row, so the
 * postponement stays on record), or cancelled. Only a scheduled hearing
 * changes; a held one is final.
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), outcome: z.enum(Object.keys(HEARING_OUTCOMES) as [HearingOutcome, ...HearingOutcome[]]), notes: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('postpone'), reason: z.string().trim().min(3, 'Say why it was postponed').max(300), newDate: z.string().datetime({ offset: true }).optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3, 'Say why it was cancelled').max(300) }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'hearings');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);
  try {
    const h = await prisma.caseHearing.findUnique({ where: { id: hid } });
    // Another case's hearing, reached through this case's id: not found.
    if (!h || h.caseId !== id) return errorResponse('Hearing not found', 404);
    if (h.status !== 'SCHEDULED') return errorResponse(`This hearing is already ${h.status.toLowerCase()}.`, 409);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const by = me?.name ?? 'an official';
    const d = parsed.data;
    await prisma.$transaction(async tx => {
      const done = await tx.caseHearing.updateMany({
        where: { id: hid, status: 'SCHEDULED' },
        data: d.action === 'complete'
          ? { status: 'COMPLETED', outcome: d.outcome, notes: d.notes ?? h.notes, updatedById: g.actor.id }
          : { status: d.action === 'postpone' ? 'POSTPONED' : 'CANCELLED', statusReason: d.reason, updatedById: g.actor.id },
      });
      if (!done.count) throw new Error('changed');
      if (d.action === 'postpone' && d.newDate) {
        await tx.caseHearing.create({ data: {
          caseId: id, hearingNumber: h.hearingNumber, scheduledAt: new Date(d.newDate), venue: h.venue,
          createdById: g.actor.id, updatedById: g.actor.id,
        } });
      }
      await tx.activity.create({ data: {
        type: 'hearing',
        message: d.action === 'complete' ? `Hearing ${h.hearingNumber} held - ${HEARING_OUTCOMES[d.outcome].toLowerCase()} (recorded by ${by})`
          : d.action === 'postpone' ? `Hearing ${h.hearingNumber} postponed by ${by}${d.newDate ? ' and rescheduled' : ''}`
            : `Hearing ${h.hearingNumber} cancelled by ${by}`,
        entityId: hid, entityType: 'CaseHearing', userId: g.actor.id, caseId: id, color: '#0369a1',
      } });
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This hearing was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The hearing could not be updated right now.', 503);
  }
}
