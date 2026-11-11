import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { ackSchema, ackTransitionAllowed, ACK_BASIS, ACK_STATUS, type AckStatus } from '@/lib/serviceReferralForm';
import { gateServiceReferral, loadReferral, namesFor, referralDto, noStore } from '@/lib/serviceReferralServer';

const phDay = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * POST - record Section C ("To be accomplished by the Receiving
 * Organization") from an actual receipt or confirmation: the returned signed
 * copy, a written confirmation, or a verbal one - the officer says which.
 *
 *   { status: 'ACKNOWLEDGED', basis, receivedByName, position?, clientCode?, dateReceived, remarks? }
 *   { status: 'RETURNED', basis, remarks, ... }  - returned for follow-up
 *
 * Only on an issued referral, only by the officer the case is assigned to,
 * and only from the state on their screen (a recorded receipt is final).
 * Who recorded it and when are kept. Recording receipt says nothing about
 * whether the service has been provided.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referral_ack');
  if ('error' in g) return g.error;
  const parsed = ackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the acknowledgement', 400);
  const a = parsed.data;

  try {
    const r = await loadReferral(id, rid);
    if (!r) return errorResponse('Referral not found', 404);
    if (r.status !== 'ISSUED' || !r.issuedAt) return errorResponse('Only an issued referral can be acknowledged by the receiving organization.', 409);
    const from = r.ackStatus as AckStatus | null;
    if (!ackTransitionAllowed(from, a.status)) {
      return noStore({ success: false, error: `This referral is already recorded as ${ACK_STATUS[from ?? 'AWAITING'].toLowerCase()}.`, code: 'ack_final' }, 409);
    }
    if (a.dateReceived) {
      const today = phDay(new Date());
      if (a.dateReceived > today) return errorResponse('The date received cannot be in the future.', 400);
      if (a.dateReceived < phDay(r.issuedAt)) return errorResponse('The date received cannot be before the referral was issued.', 400);
    }
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const now = new Date();
    await prisma.$transaction(async tx => {
      const res = await tx.serviceReferral.updateMany({
        where: { id: rid, caseId: id, status: 'ISSUED', ackStatus: from },
        data: {
          ackStatus: a.status, ackBasis: a.basis, ackReceivedByName: a.receivedByName ?? null, ackPosition: a.position ?? null,
          ackClientCode: a.clientCode ?? null, ackDateReceived: a.dateReceived ?? null, ackRemarks: a.remarks ?? null,
          ackRecordedById: g.actor.id, ackRecordedAt: now, version: { increment: 1 }, updatedById: g.actor.id,
        },
      });
      if (res.count !== 1) throw Object.assign(new Error('stale'), { stale: true });
      await tx.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: a.status, version: r.version + 1,
        changedKeys: ['receivedByName', 'position', 'clientCode', 'dateReceived', 'remarks'].filter(k => (a as Record<string, unknown>)[k]),
        note: `Recorded from: ${ACK_BASIS[a.basis]}`, actorId: g.actor.id } });
      await tx.activity.create({ data: {
        type: 'service_referral',
        message: a.status === 'ACKNOWLEDGED'
          ? `Service referral ${r.reference}: receipt by the receiving organization recorded by ${me?.name ?? 'an official'}`
          : `Service referral ${r.reference}: returned for follow-up - recorded by ${me?.name ?? 'an official'}`,
        entityId: rid, entityType: 'ServiceReferral', userId: g.actor.id, caseId: id, color: a.status === 'ACKNOWLEDGED' ? '#15803d' : '#b45309',
      } });
    });
    const fresh = await loadReferral(id, rid);
    const name = await namesFor([fresh!]);
    await g.log('permitted', `${g.access.code}:ack`);
    return noStore({ success: true, data: { referral: referralDto(fresh!, name) } });
  } catch (e) {
    if ((e as { stale?: boolean }).stale) return noStore({ success: false, error: 'The acknowledgement changed since you opened it. Reload to see it.', code: 'stale' }, 409);
    return errorResponse('The acknowledgement could not be recorded right now. Try again.', 503);
  }
}
