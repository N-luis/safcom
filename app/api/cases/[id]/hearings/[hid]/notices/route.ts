import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import {
  gateHearings, noStore, recordEvent, hearingActivity, actorName, complainantName, respondentName, noticeInputFor, pdfResponse,
} from '@/lib/hearingsServer';
import { allowedFrom, noticeNumber, NOTICE_RECIPIENTS, type NoticeRecipient } from '@/lib/hearings';
import { buildHearingNoticePdf } from '@/lib/hearingNoticePdf';

/**
 * Hearing notices.
 *
 *   GET  ?recipient=COMPLAINANT|RESPONDENT - preview the notice as a PDF,
 *        marked "preview - not issued". Nothing is stored.
 *   POST { recipient } - generate the notice: it gets its number and is kept,
 *        still not issued. Issuing, delivery and acknowledgement are recorded
 *        separately (./[nid]) - generating a notice delivers nothing.
 */

type Params = { params: Promise<{ id: string; hid: string }> };

async function load(id: string, hid: string) {
  const h = await prisma.caseHearing.findUnique({
    where: { id: hid },
    include: { complainantParty: { select: { fullName: true } }, respondentParty: { select: { fullName: true } } },
  });
  return h && h.caseId === id ? h : null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  const recipient = req.nextUrl.searchParams.get('recipient');
  if (recipient !== 'COMPLAINANT' && recipient !== 'RESPONDENT') return errorResponse('Choose who the notice is for', 400);
  try {
    const h = await load(id, hid);
    if (!h) return errorResponse('Hearing not found', 404);
    const name = recipient === 'COMPLAINANT' ? complainantName(g.c, h.complainantParty) : respondentName(h.respondentParty);
    const bytes = await buildHearingNoticePdf(noticeInputFor(g.c, h, { noticeNumber: null, recipientRole: recipient, recipientName: name, issuedAt: null },
      'PREVIEW', await actorName(g.actor.id)));
    await g.log('permitted', `${g.access.code}:notice_preview`);
    return pdfResponse(bytes, `Preview-${h.reference}-${recipient}.pdf`, true);
  } catch {
    return errorResponse('The preview could not be produced right now.', 503);
  }
}

const schema = z.object({ recipient: z.enum(['COMPLAINANT', 'RESPONDENT']) });

export async function POST(req: NextRequest, { params }: Params) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Choose who the notice is for', 400);
  const recipient = parsed.data.recipient as NoticeRecipient;
  try {
    const h = await load(id, hid);
    if (!h) return errorResponse('Hearing not found', 404);
    if (!allowedFrom('notice', h.status)) return errorResponse('Notices are generated for a scheduled hearing.', 409);
    const current = await prisma.caseHearingNotice.findFirst({ where: { hearingId: hid, recipientRole: recipient, status: { not: 'SUPERSEDED' } } });
    if (current) return errorResponse(`A notice to the ${NOTICE_RECIPIENTS[recipient].toLowerCase()} for this date is already on record (${current.noticeNumber}).`, 409);
    const seq = (await prisma.caseHearingNotice.count({ where: { hearingId: hid, recipientRole: recipient } })) + 1;
    const name = recipient === 'COMPLAINANT' ? complainantName(g.c, h.complainantParty) : respondentName(h.respondentParty);
    const by = await actorName(g.actor.id);
    const notice = await prisma.$transaction(async tx => {
      const n = await tx.caseHearingNotice.create({ data: {
        hearingId: hid, caseId: id, noticeNumber: noticeNumber(g.c.caseNumber, h.hearingNumber, recipient, seq),
        recipientRole: recipient, recipientName: name, scheduledAt: h.scheduledAt, venue: h.venue, generatedById: g.actor.id,
      } });
      const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'notice_generated', actorType: 'official', actorId: g.actor.id,
        after: { hearingNumber: h.hearingNumber, recipientRole: recipient, noticeNumber: n.noticeNumber } });
      await hearingActivity(tx, e.id, id, g.actor.id, `Notice ${n.noticeNumber} (${NOTICE_RECIPIENTS[recipient].toLowerCase()}) generated for Hearing ${h.hearingNumber} by ${by} - not yet issued`);
      return n;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: notice }, 201);
  } catch {
    return errorResponse('The notice could not be generated right now.', 503);
  }
}
