import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { hearingRefusal, nextHearingNumber } from '@/lib/analytics';

/**
 * Katarungang Pambarangay hearings for one blotter case.
 *
 *   GET  - every hearing, postponed ones included, and which comes next.
 *   POST - schedule the next one. A VAWC case is refused: it is not subject
 *          to barangay mediation or conciliation. The first hearing needs the
 *          officer's confirmation that the dispute is one the barangay may
 *          conciliate - SafeComm does not decide that.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'hearings');
  if ('error' in g) return g.error;
  try {
    const hearings = await prisma.caseHearing.findMany({ where: { caseId: id }, orderBy: [{ hearingNumber: 'asc' }, { createdAt: 'asc' }] });
    const refusal = hearingRefusal(g.c.caseType, hearings, nextHearingNumber(hearings) ?? 4);
    return noStore({ success: true, data: {
      hearings, next: nextHearingNumber(hearings), canEdit: g.access.edit,
      // Why nothing can be scheduled now, if so - shown instead of the button.
      blocked: refusal,
    } });
  } catch {
    return errorResponse('The hearings could not be loaded right now.', 503);
  }
}

const postSchema = z.object({
  hearingNumber: z.number().int().min(1).max(3),
  scheduledAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  kpConfirmed: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'hearings');
  if ('error' in g) return g.error;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the hearing details', 400);
  try {
    const existing = await prisma.caseHearing.findMany({ where: { caseId: id }, select: { hearingNumber: true, status: true, outcome: true } });
    const refusal = hearingRefusal(g.c.caseType, existing, parsed.data.hearingNumber);
    if (refusal) return errorResponse(refusal, 422);
    if (!existing.length && !parsed.data.kpConfirmed) {
      return errorResponse('Confirm that this dispute is one the barangay may mediate or conciliate under the Katarungang Pambarangay.', 422);
    }
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const hearing = await prisma.$transaction(async tx => {
      const h = await tx.caseHearing.create({ data: {
        caseId: id, hearingNumber: parsed.data.hearingNumber, scheduledAt: new Date(parsed.data.scheduledAt),
        venue: parsed.data.venue || null, notes: parsed.data.notes || null, createdById: g.actor.id, updatedById: g.actor.id,
      } });
      await tx.activity.create({ data: {
        type: 'hearing', message: `Hearing ${h.hearingNumber} scheduled for ${h.scheduledAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} by ${me?.name ?? 'an official'}`,
        entityId: h.id, entityType: 'CaseHearing', userId: g.actor.id, caseId: id, color: '#0369a1',
      } });
      return h;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: hearing }, 201);
  } catch {
    return errorResponse('The hearing could not be scheduled right now.', 503);
  }
}
