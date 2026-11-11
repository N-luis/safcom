import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { cancelSchema, cancelAllowed, type AckStatus, type ReferralStatus } from '@/lib/serviceReferralForm';
import { gateServiceReferral, loadReferral, namesFor, referralDto, noStore } from '@/lib/serviceReferralServer';

/**
 * POST { reason } - cancel a referral: a draft not to be used, or an issued
 * referral withdrawn before the receiving organization acknowledged it. Kept,
 * never deleted - its history and any issued document stay on record.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referral_cancel');
  if ('error' in g) return g.error;
  const parsed = cancelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Give a reason', 400);
  try {
    const r = await loadReferral(id, rid);
    if (!r) return errorResponse('Referral not found', 404);
    if (!cancelAllowed(r.status as ReferralStatus, r.ackStatus as AckStatus | null)) {
      return errorResponse(r.status === 'CANCELLED' ? 'This referral is already cancelled.' : 'A referral the receiving organization has acknowledged cannot be cancelled.', 409);
    }
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const now = new Date();
    await prisma.$transaction(async tx => {
      const res = await tx.serviceReferral.updateMany({
        where: { id: rid, caseId: id, status: r.status, ackStatus: r.ackStatus },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledById: g.actor.id, cancelReason: parsed.data.reason, version: { increment: 1 }, updatedById: g.actor.id },
      });
      if (res.count !== 1) throw Object.assign(new Error('stale'), { stale: true });
      await tx.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: 'CANCELLED', version: r.version + 1, changedKeys: [], note: parsed.data.reason, actorId: g.actor.id } });
      await tx.activity.create({ data: {
        type: 'service_referral', message: `Service referral ${r.reference} cancelled by ${me?.name ?? 'an official'}`,
        entityId: rid, entityType: 'ServiceReferral', userId: g.actor.id, caseId: id, color: '#64748b',
      } });
    });
    const fresh = await loadReferral(id, rid);
    const name = await namesFor([fresh!]);
    await g.log('permitted', `${g.access.code}:cancel`);
    return noStore({ success: true, data: { referral: referralDto(fresh!, name) } });
  } catch (e) {
    if ((e as { stale?: boolean }).stale) return noStore({ success: false, error: 'This referral changed since you opened it. Reload to see it.', code: 'stale' }, 409);
    return errorResponse('The referral could not be cancelled right now.', 503);
  }
}
