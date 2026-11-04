import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, recordEvent, hearingActivity, actorName, hearingPartySelect, partyAccounts, syncHearingStatus, hearingSnap } from '@/lib/hearingsServer';
import { isLive, kpFormName, NOTICE_METHODS, NOTICE_RECIPIENTS, type NoticeMethod, type NoticeRecipient, type PartyRole } from '@/lib/hearings';

/**
 * What happened to a notice, as an official records it:
 *   issue        given out (how), from generated
 *   delivery     delivered, or not delivered (with a note)
 *   acknowledge  the recipient's signed receipt
 * The proceeding's status follows its notices to the parties
 * (lib/hearings.ts statusFromNotices). A KP 11 notice to a Pangkat member
 * is recorded the same way, and does not move the status.
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
      prisma.caseHearing.findUnique({ where: { id: hid }, include: hearingPartySelect }),
      prisma.caseHearingNotice.findUnique({ where: { id: nid } }),
    ]);
    if (!h || h.caseId !== id || !n || n.hearingId !== hid) return errorResponse('Notice not found', 404);
    const member = n.recipientRole === 'PANGKAT_MEMBER';
    if (member ? h.status === 'CANCELLED' : !isLive(h.status)) return errorResponse('This hearing is no longer scheduled.', 409);
    if (!FROM[d.action].includes(n.status)) return errorResponse(n.status === 'SUPERSEDED' ? 'This notice was replaced when the date changed.' : 'This notice is not at that step.', 409);
    const account = member ? null : partyAccounts(g.c, h)[n.recipientRole as PartyRole];
    if (d.action === 'issue' && d.method === 'SAFECOMM' && !account) {
      return errorResponse(member
        ? 'A Pangkat member\'s notice is handed over or served - it is not delivered to a resident account.'
        : `The ${NOTICE_RECIPIENTS[n.recipientRole as NoticeRecipient].toLowerCase()} has no SafeComm account linked to this case. Hand the notice over or serve it, or link their account first.`, 400);
    }
    const by = await actorName(g.actor.id);
    const who = member ? `Pangkat member ${n.recipientName}` : `the ${NOTICE_RECIPIENTS[n.recipientRole as NoticeRecipient].toLowerCase()}`;
    const form = kpFormName(n.formNo);
    const now = new Date();
    await prisma.$transaction(async tx => {
      const data = d.action === 'issue'
        ? { status: 'ISSUED', issueMethod: d.method, issuedById: g.actor.id, issuedAt: now,
          ...(d.method === 'SAFECOMM' ? { channel: 'SAFECOMM_ACCOUNT', recipientResidentId: account } : { channel: 'OFFICER' }) }
        : d.action === 'delivery' ? { status: d.delivered ? 'DELIVERED' : 'UNDELIVERED', deliveryRecordedById: g.actor.id, deliveryRecordedAt: now, deliveryNote: d.note || null }
          : { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedVia: 'RECORDED', deliveryRecordedById: g.actor.id, deliveryRecordedAt: now, deliveryNote: d.note || n.deliveryNote };
      const r = await tx.caseHearingNotice.updateMany({ where: { id: nid, status: n.status }, data });
      if (!r.count) throw new Error('changed');
      const kind = d.action === 'issue' ? 'notice_issued' : d.action === 'delivery' ? 'notice_delivery' : 'notice_acknowledged';
      const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind, actorType: 'official', actorId: g.actor.id,
        before: { status: n.status }, after: { ...hearingSnap(h, n.scheduledAt, n.venue), formNo: n.formNo, recipientRole: n.recipientRole, noticeNumber: n.noticeNumber,
          status: data.status, ...(d.action === 'issue' && { method: d.method }) }, note: d.action === 'issue' ? null : d.note || null });
      await hearingActivity(tx, e.id, id, g.actor.id, d.action === 'issue' ? `${form} (${n.noticeNumber}) issued to ${who} by ${by}`
        : d.action === 'delivery' ? `${form} (${n.noticeNumber}) recorded as ${d.delivered ? 'delivered' : 'not delivered'} by ${by}`
          : `${form} (${n.noticeNumber}): ${who}'s acknowledgement recorded by ${by}`);
      if (!member) await syncHearingStatus(tx, h, g.actor.id);
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This notice was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The notice could not be updated right now.', 503);
  }
}
