import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, recordEvent, hearingActivity, actorName } from '@/lib/hearingsServer';
import { statusFromNotices, isLive, NOTICE_METHODS, NOTICE_RECIPIENTS, type NoticeMethod, type NoticeRecipient } from '@/lib/hearings';

/**
 * What happened to a notice, as an official records it:
 *   issue        given out (how), from generated
 *   delivery     delivered, or not delivered (with a note)
 *   acknowledge  the recipient's signed receipt
 * The hearing's status follows its notices (lib/hearings.ts statusFromNotices).
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('issue'), method: z.enum(Object.keys(NOTICE_METHODS) as [NoticeMethod, ...NoticeMethod[]]) }),
  z.object({ action: z.literal('delivery'), delivered: z.boolean(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('acknowledge'), note: z.string().trim().max(300).optional() }),
]);

const FROM: Record<string, string[]> = {
  issue: ['GENERATED'],
  delivery: ['ISSUED', 'DELIVERED', 'UNDELIVERED'],
  acknowledge: ['ISSUED', 'DELIVERED', 'UNDELIVERED'],
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string; nid: string }> }) {
  const { id, hid, nid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);
  const d = parsed.data;
  try {
    const [h, n] = await Promise.all([
      prisma.caseHearing.findUnique({ where: { id: hid } }),
      prisma.caseHearingNotice.findUnique({ where: { id: nid } }),
    ]);
    if (!h || h.caseId !== id || !n || n.hearingId !== hid) return errorResponse('Notice not found', 404);
    if (!isLive(h.status)) return errorResponse('This hearing is no longer scheduled.', 409);
    if (!FROM[d.action].includes(n.status)) return errorResponse(n.status === 'SUPERSEDED' ? 'This notice was replaced when the date changed.' : 'This notice is not at that step.', 409);
    if (d.action === 'issue' && d.method === 'SAFECOMM' && (n.recipientRole !== 'COMPLAINANT' || !g.c.residentId)) {
      return errorResponse('Only the complainant who filed through SafeComm can receive a notice in SafeComm.', 400);
    }
    const by = await actorName(g.actor.id);
    const who = NOTICE_RECIPIENTS[n.recipientRole as NoticeRecipient].toLowerCase();
    const now = new Date();
    await prisma.$transaction(async tx => {
      const data = d.action === 'issue' ? { status: 'ISSUED', issueMethod: d.method, issuedById: g.actor.id, issuedAt: now }
        : d.action === 'delivery' ? { status: d.delivered ? 'DELIVERED' : 'UNDELIVERED', deliveryRecordedById: g.actor.id, deliveryRecordedAt: now, deliveryNote: d.note || null }
          : { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedVia: 'RECORDED', deliveryRecordedById: g.actor.id, deliveryRecordedAt: now, deliveryNote: d.note || n.deliveryNote };
      const r = await tx.caseHearingNotice.updateMany({ where: { id: nid, status: n.status }, data });
      if (!r.count) throw new Error('changed');
      const kind = d.action === 'issue' ? 'notice_issued' : d.action === 'delivery' ? 'notice_delivery' : 'notice_acknowledged';
      const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind, actorType: 'official', actorId: g.actor.id,
        before: { status: n.status }, after: { hearingNumber: h.hearingNumber, recipientRole: n.recipientRole, noticeNumber: n.noticeNumber, status: data.status,
          ...(d.action === 'issue' && { method: d.method }) }, note: d.action === 'issue' ? null : d.note || null });
      await hearingActivity(tx, e.id, id, g.actor.id, d.action === 'issue' ? `Notice ${n.noticeNumber} issued to the ${who} by ${by}`
        : d.action === 'delivery' ? `Notice ${n.noticeNumber} recorded as ${d.delivered ? 'delivered' : 'not delivered'} by ${by}`
          : `Notice ${n.noticeNumber}: the ${who}'s acknowledgement recorded by ${by}`);
      const current = await tx.caseHearingNotice.findMany({ where: { hearingId: hid, status: { not: 'SUPERSEDED' } }, select: { status: true } });
      const status = statusFromNotices(h, current);
      if (status !== h.status) await tx.caseHearing.update({ where: { id: hid }, data: { status, updatedById: g.actor.id } });
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This notice was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The notice could not be updated right now.', 503);
  }
}
