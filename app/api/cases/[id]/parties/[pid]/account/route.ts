import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, recordEvent, hearingActivity, actorName, syncHearingStatus, hearingSnap } from '@/lib/hearingsServer';
import { LIVE_STATUSES, kpFormName } from '@/lib/hearings';

/**
 * Link a party on a case to their own SafeComm account, so their hearing
 * notices reach them there - the respondent, say, or a person affected who
 * has an account of their own.
 *
 * Linked only by the account's exact resident number, entered by an
 * official, never matched by name. The reporter cannot be linked as the
 * respondent of their own case, and one account cannot stand for both
 * sides. Linking delivers the party's notices still waiting to be handed
 * over (for a date not yet past) to the account; unlinking takes the
 * proceedings out of that account from then on - what was delivered stays on
 * record. Every change is in the proceedings' history and the access log.
 *
 *   POST   { residentNumber }
 *   DELETE { reason }
 */

type Params = { params: Promise<{ id: string; pid: string }> };

async function partyOf(caseId: string, pid: string) {
  const p = await prisma.caseParty.findUnique({ where: { id: pid }, select: { id: true, caseId: true, role: true, fullName: true, residentId: true } });
  return p && p.caseId === caseId ? p : null;
}

/** The proceedings this party is named in, still to be held. */
const liveHearingsOf = (caseId: string, pid: string, role: string) => prisma.caseHearing.findMany({
  where: { caseId, status: { in: [...LIVE_STATUSES] }, ...(role === 'REPORTED' ? { respondentPartyId: pid } : { complainantPartyId: pid }) },
  select: { id: true, hearingNumber: true, stage: true, session: true, scheduledAt: true, venue: true, status: true, rescheduleCount: true },
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id, pid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = z.object({ residentNumber: z.string().trim().min(3, 'Enter the resident number').max(40) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Enter the resident number', 400);
  try {
    const party = await partyOf(id, pid);
    if (!party) return errorResponse('Party not found', 404);
    const resident = await prisma.resident.findUnique({ where: { residentNumber: parsed.data.residentNumber }, select: { id: true, residentNumber: true, status: true } });
    if (!resident) { await g.log('denied', 'party_link_no_account'); return errorResponse('No SafeComm account has that resident number. Check it with the person.', 404); }
    if (resident.status !== 'Active') return errorResponse('That account is not active.', 409);
    if (party.residentId === resident.id) return noStore({ success: true, unchanged: true });
    if (party.residentId) return errorResponse('This party is already linked to another account. Unlink it first.', 409);
    if (party.role === 'REPORTED' && g.c.residentId === resident.id) {
      await g.log('denied', 'party_link_reporter');
      return errorResponse('That is the account of the person who filed the case. The reporter cannot be linked as the respondent.', 409);
    }
    const otherSide = await prisma.caseParty.findFirst({ where: { caseId: id, residentId: resident.id, role: { not: party.role } }, select: { id: true } });
    if (otherSide) return errorResponse('That account is already linked to the other side of this case.', 409);

    const by = await actorName(g.actor.id);
    const me = g.actor.id;
    const role = party.role === 'REPORTED' ? 'RESPONDENT' : 'COMPLAINANT';
    const hearings = await liveHearingsOf(id, pid, party.role);
    let delivered = 0;
    await prisma.$transaction(async tx => {
      const r = await tx.caseParty.updateMany({ where: { id: pid, residentId: null }, data: { residentId: resident.id, residentLinkedById: me, residentLinkedAt: new Date() } });
      if (!r.count) throw new Error('changed');
      for (const h of hearings) {
        const e = await recordEvent(tx, { hearingId: h.id, caseId: id, kind: 'party_account_linked', actorType: 'official', actorId: me,
          after: { ...hearingSnap(h, h.scheduledAt, h.venue), partyId: pid, recipientRole: role } });
        await hearingActivity(tx, e.id, id, me, `The ${role.toLowerCase()} was linked to their SafeComm account by ${by}`);
        const waiting = await tx.caseHearingNotice.findMany({ where: { hearingId: h.id, recipientRole: role, status: 'GENERATED', scheduledAt: { gte: new Date() } } });
        for (const n of waiting) {
          await tx.caseHearingNotice.update({ where: { id: n.id }, data: {
            status: 'ISSUED', channel: 'SAFECOMM_ACCOUNT', recipientResidentId: resident.id, issueMethod: 'SAFECOMM', issuedById: me, issuedAt: new Date() } });
          const ne = await recordEvent(tx, { hearingId: h.id, caseId: id, kind: 'notice_issued', actorType: 'official', actorId: me,
            after: { ...hearingSnap(h, n.scheduledAt, n.venue), formNo: n.formNo, recipientRole: role, noticeNumber: n.noticeNumber, channel: 'SAFECOMM_ACCOUNT', method: 'SAFECOMM' } });
          await hearingActivity(tx, ne.id, id, me, `${kpFormName(n.formNo)} (${n.noticeNumber}) delivered to the ${role.toLowerCase()}'s SafeComm account by ${by}`);
          delivered++;
        }
        await syncHearingStatus(tx, h, me);
      }
      if (!hearings.length) {
        await tx.activity.create({ data: { type: 'case_update', message: `A ${party.role === 'REPORTED' ? 'person reported' : 'person affected'} was linked to their SafeComm account by ${by}`,
          userId: me, caseId: id, color: '#0369a1' } });
      }
    });
    await g.log('permitted', `${g.access.code}:party_link`);
    return noStore({ success: true, data: { residentNumber: resident.residentNumber, noticesDelivered: delivered } });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This party was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The account could not be linked right now.', 503);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, pid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = z.object({ reason: z.string().trim().min(3, 'Say why the account is unlinked').max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Say why the account is unlinked', 400);
  try {
    const party = await partyOf(id, pid);
    if (!party) return errorResponse('Party not found', 404);
    if (!party.residentId) return noStore({ success: true, unchanged: true });
    const by = await actorName(g.actor.id);
    const me = g.actor.id;
    const role = party.role === 'REPORTED' ? 'RESPONDENT' : 'COMPLAINANT';
    const hearings = await liveHearingsOf(id, pid, party.role);
    await prisma.$transaction(async tx => {
      const r = await tx.caseParty.updateMany({ where: { id: pid, residentId: party.residentId }, data: { residentId: null, residentLinkedById: me, residentLinkedAt: new Date() } });
      if (!r.count) throw new Error('changed');
      for (const h of hearings) {
        const e = await recordEvent(tx, { hearingId: h.id, caseId: id, kind: 'party_account_linked', actorType: 'official', actorId: me,
          after: { ...hearingSnap(h, h.scheduledAt, h.venue), partyId: pid, recipientRole: role, unlinked: true }, note: parsed.data.reason });
        await hearingActivity(tx, e.id, id, me, `The ${role.toLowerCase()}'s SafeComm account was unlinked by ${by}`);
      }
      if (!hearings.length) {
        await tx.activity.create({ data: { type: 'case_update', message: `A party's SafeComm account was unlinked by ${by}`, userId: me, caseId: id, color: '#64748b' } });
      }
    });
    await g.log('permitted', `${g.access.code}:party_unlink`);
    return noStore({ success: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'changed') return errorResponse('This party was updated elsewhere. Reload to see it.', 409);
    return errorResponse('The account could not be unlinked right now.', 503);
  }
}
