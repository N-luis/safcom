import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, recordEvent, hearingActivity, actorName, loadPangkat, pangkatRefusal, pangkatConstituted, isUniqueViolation } from '@/lib/hearingsServer';
import { noticeNumber, kpFormName, PANGKAT_CHOSEN_BY, PANGKAT_SIZE, type PangkatChosenBy } from '@/lib/hearings';

/**
 * The Pangkat ng Tagapagkasundo on one case (RA 7160 sec. 410(b)-(c)): the
 * three Lupon members chosen to conciliate the dispute, its chairman and
 * secretary, and a KP Form No. 11 notice to each member.
 *
 * Recorded against the case's constitution proceeding - so only once
 * mediation has failed and that proceeding has been created. The Pangkat is
 * recorded as constituted when that proceeding is held with the outcome
 * "Pangkat constituted" (../hearings/[hid], action complete). A removed
 * member is kept, with when and why.
 *
 *   GET
 *   POST { action: 'add_member', name, chosenBy, userId? }
 *        { action: 'remove_member', memberId, reason }
 *        { action: 'officers', chairmanMemberId, secretaryMemberId }
 *        { action: 'kp11', memberId }  - make the member's KP 11 notice
 */

type Params = { params: Promise<{ id: string }> };

/** The constitution proceeding the Pangkat is recorded against: the latest one not cancelled. */
const constitutionOf = (caseId: string) => prisma.caseHearing.findFirst({
  where: { caseId, stage: 'CONSTITUTION', status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' },
  select: { id: true, reference: true, hearingNumber: true, stage: true, session: true, scheduledAt: true, venue: true, status: true },
});

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const [pangkat, hearing] = await Promise.all([loadPangkat(id), constitutionOf(id)]);
    const notices = pangkat ? await prisma.caseHearingNotice.findMany({
      where: { caseId: id, recipientRole: 'PANGKAT_MEMBER' }, orderBy: { generatedAt: 'asc' },
      select: { id: true, hearingId: true, noticeNumber: true, pangkatMemberId: true, recipientName: true, status: true, generatedAt: true, issuedAt: true, acknowledgedAt: true },
    }) : [];
    await g.log('permitted', `${g.access.code}:pangkat`);
    return noStore({ success: true, data: {
      pangkat, constitutionHearing: hearing, notices, canEdit: g.access.edit && Boolean(hearing),
      refusal: pangkatRefusal(pangkat), constituted: pangkatConstituted(pangkat),
    } });
  } catch {
    return errorResponse('The Pangkat could not be loaded right now.', 503);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_member'), name: z.string().trim().min(3, "Enter the member's full name").max(120),
    chosenBy: z.enum(Object.keys(PANGKAT_CHOSEN_BY) as [PangkatChosenBy, ...PangkatChosenBy[]]), userId: z.string().trim().max(64).nullable().optional() }),
  z.object({ action: z.literal('remove_member'), memberId: z.string().max(64), reason: z.string().trim().min(3, 'Say why the member is removed').max(300) }),
  z.object({ action: z.literal('officers'), chairmanMemberId: z.string().max(64), secretaryMemberId: z.string().max(64) }),
  z.object({ action: z.literal('kp11'), memberId: z.string().max(64) }),
]);

class Changed extends Error {}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the Pangkat details', 400);
  const d = parsed.data;
  try {
    const hearing = await constitutionOf(id);
    if (!hearing) return errorResponse('The Pangkat is recorded at its constitution. Schedule the constitution of the Pangkat first - it follows a mediation without settlement.', 409);
    const me = g.actor.id;
    const by = await actorName(me);
    const pangkat = await loadPangkat(id);
    const serving = (pangkat?.members ?? []).filter(m => !m.removedAt);
    const member = 'memberId' in d ? serving.find(m => m.id === d.memberId) : undefined;
    if ('memberId' in d && !member) return errorResponse('That member is not serving on this Pangkat.', 404);
    const ev = (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], kind: string, after: Record<string, unknown>, note?: string) =>
      recordEvent(tx, { hearingId: hearing.id, caseId: id, kind, actorType: 'official', actorId: me, after: { hearingNumber: hearing.hearingNumber, ...after }, note });

    if (d.action === 'add_member') {
      if (serving.length >= PANGKAT_SIZE) return errorResponse(`The Pangkat already has ${PANGKAT_SIZE} members. Remove one first to replace them.`, 409);
      if (serving.some(m => m.name.trim().toLowerCase() === d.name.toLowerCase())) return errorResponse('That member is already on this Pangkat.', 409);
      if (d.userId && !(await prisma.user.findFirst({ where: { id: d.userId, active: true }, select: { id: true } }))) {
        return errorResponse('The linked staff account must be an active SafeComm account.', 400);
      }
      await prisma.$transaction(async tx => {
        const p = pangkat ?? await tx.casePangkat.create({ data: { caseId: id, createdById: me, updatedById: me } });
        const m = await tx.casePangkatMember.create({ data: { pangkatId: p.id, name: d.name, chosenBy: d.chosenBy, userId: d.userId || null, addedById: me } });
        await tx.casePangkat.update({ where: { id: p.id }, data: { updatedById: me } });
        const e = await ev(tx, 'pangkat_member_added', { memberId: m.id, chosenBy: d.chosenBy });
        await hearingActivity(tx, e.id, id, me, `Pangkat member recorded (${PANGKAT_CHOSEN_BY[d.chosenBy].toLowerCase()}) by ${by}`);
      });
    }

    else if (d.action === 'remove_member') {
      if (pangkat && (pangkat.chairmanMemberId === member!.id || pangkat.secretaryMemberId === member!.id)) {
        return errorResponse('This member is the Pangkat chairman or secretary. Choose another member for that office first.', 409);
      }
      await prisma.$transaction(async tx => {
        const r = await tx.casePangkatMember.updateMany({ where: { id: member!.id, removedAt: null }, data: { removedAt: new Date(), removedById: me, removedReason: d.reason } });
        if (!r.count) throw new Changed();
        await tx.casePangkat.update({ where: { id: pangkat!.id }, data: { updatedById: me } });
        const e = await ev(tx, 'pangkat_member_removed', { memberId: member!.id }, d.reason);
        await hearingActivity(tx, e.id, id, me, `Pangkat member removed by ${by}`);
      });
    }

    else if (d.action === 'officers') {
      const ids = serving.map(m => m.id);
      if (!ids.includes(d.chairmanMemberId) || !ids.includes(d.secretaryMemberId)) return errorResponse('The chairman and the secretary are chosen from the serving members.', 400);
      if (d.chairmanMemberId === d.secretaryMemberId) return errorResponse('The chairman and the secretary must be different members.', 400);
      await prisma.$transaction(async tx => {
        const r = await tx.casePangkat.updateMany({ where: { id: pangkat!.id, updatedAt: pangkat!.updatedAt },
          data: { chairmanMemberId: d.chairmanMemberId, secretaryMemberId: d.secretaryMemberId, updatedById: me } });
        if (!r.count) throw new Changed();
        const e = await ev(tx, 'pangkat_officers', { chairmanMemberId: d.chairmanMemberId, secretaryMemberId: d.secretaryMemberId },
        );
        await hearingActivity(tx, e.id, id, me, `Pangkat chairman and secretary recorded by ${by}`);
      });
    }

    else {
      const current = await prisma.caseHearingNotice.findFirst({ where: { pangkatMemberId: member!.id, status: { not: 'SUPERSEDED' } }, select: { noticeNumber: true } });
      if (current) return errorResponse(`This member's KP Form No. 11 is already on record (${current.noticeNumber}).`, 409);
      const notice = await prisma.$transaction(async tx => {
        const seq = (await tx.caseHearingNotice.count({ where: { hearingId: hearing.id, recipientRole: 'PANGKAT_MEMBER' } })) + 1;
        const n = await tx.caseHearingNotice.create({ data: {
          hearingId: hearing.id, caseId: id, formNo: 11, recipientRole: 'PANGKAT_MEMBER', pangkatMemberId: member!.id, recipientName: member!.name,
          noticeNumber: noticeNumber(hearing.reference, 11, 'PANGKAT_MEMBER', seq),
          scheduledAt: hearing.scheduledAt, venue: hearing.venue, generatedById: me, status: 'GENERATED', channel: 'OFFICER',
        } });
        const e = await ev(tx, 'notice_generated', { formNo: 11, recipientRole: 'PANGKAT_MEMBER', noticeNumber: n.noticeNumber, memberId: member!.id });
        await hearingActivity(tx, e.id, id, me, `${kpFormName(11)} (${n.noticeNumber}) generated by ${by} - to be handed to the member`);
        // A member with a staff account is told in SafeComm as well; the signed notice is still handed over.
        if (member!.userId) {
          await tx.notification.create({ data: { userId: member!.userId, caseId: id, type: 'info',
            title: `You were chosen for the Pangkat on ${g.c.caseNumber}`, message: 'Your KP Form No. 11 notice will be handed to you by the barangay.' } });
        }
        return n;
      });
      await g.log('permitted', g.access.code);
      return noStore({ success: true, data: notice }, 201);
    }

    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Changed) return errorResponse('The Pangkat was updated elsewhere. Reload to see it.', 409);
    if (isUniqueViolation(e)) return errorResponse('That is already on record. Reload to see it.', 409);
    return errorResponse('The Pangkat could not be updated right now.', 503);
  }
}
