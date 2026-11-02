import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { referralUpdateSchema, REFERRAL_STATUSES } from '@/lib/caseRecords';

/** Update a referral's status or notes - officer-only. The referral must belong to this case. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'referrals');
  if ('error' in g) return g.error;
  const parsed = referralUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);

  try {
    const existing = await prisma.caseReferral.findUnique({ where: { id: rid } });
    // Another case's referral, reached through this case's id: not found.
    if (!existing || existing.caseId !== id) return errorResponse('Referral not found', 404);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const updated = await prisma.$transaction(async tx => {
      const r = await tx.caseReferral.update({ where: { id: rid }, data: { status: parsed.data.status, notes: parsed.data.notes ?? existing.notes } });
      if (existing.status !== parsed.data.status) {
        await tx.activity.create({ data: {
          type: 'referral', message: `Referral marked ${REFERRAL_STATUSES[parsed.data.status].toLowerCase()} by ${me?.name ?? 'an official'}`,
          entityId: rid, entityType: 'CaseReferral', userId: g.actor.id, caseId: id, color: '#7c3aed',
        } });
      }
      return r;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: updated });
  } catch {
    return errorResponse('The referral could not be updated right now.', 503);
  }
}
