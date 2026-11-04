import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import {
  gateHearings, noStore, actorName, complainantName, respondentName, kpNoticeInputFor, pdfResponse, issueStageNotices, hearingPartySelect,
} from '@/lib/hearingsServer';
import { allowedFrom, partyFormsFor, isKpStage, NOTICE_RECIPIENTS, type PartyRole } from '@/lib/hearings';
import { buildKpNoticePdf } from '@/lib/kpNoticesPdf';

/**
 * A proceeding's KP notices to the parties.
 *
 *   GET  ?recipient=COMPLAINANT|RESPONDENT - preview the stage's form for
 *        that party as a PDF, marked "preview - not issued". Nothing is stored.
 *   POST { recipient } - make that party's notice again when none is current
 *        (scheduling makes both by itself). A party with a SafeComm account
 *        gets it there; otherwise it waits for an officer to hand it over or
 *        serve it (./[nid]). KP 11 to Pangkat members is made from the
 *        Pangkat (../../../pangkat).
 */

type Params = { params: Promise<{ id: string; hid: string }> };

async function load(id: string, hid: string) {
  const h = await prisma.caseHearing.findUnique({ where: { id: hid }, include: hearingPartySelect });
  return h && h.caseId === id ? h : null;
}

const role = z.enum(['COMPLAINANT', 'RESPONDENT']);

export async function GET(req: NextRequest, { params }: Params) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  const recipient = role.safeParse(req.nextUrl.searchParams.get('recipient'));
  if (!recipient.success) return errorResponse('Choose who the notice is for', 400);
  try {
    const h = await load(id, hid);
    if (!h) return errorResponse('Hearing not found', 404);
    const r = recipient.data;
    const form = partyFormsFor(isKpStage(h.stage) ? h.stage : 'MEDIATION').find(f => f.recipientRole === r)!;
    const name = r === 'COMPLAINANT' ? complainantName(g.c, h.complainantParty) : respondentName(h.respondentParty);
    const bytes = await buildKpNoticePdf(await kpNoticeInputFor(g.c, h,
      { formNo: form.formNo, noticeNumber: null, recipientRole: r, recipientName: name, issuedAt: null }, 'PREVIEW', await actorName(g.actor.id)));
    await g.log('permitted', `${g.access.code}:notice_preview`);
    return pdfResponse(bytes, `Preview-KP${form.formNo}-${h.reference}-${r}.pdf`, true);
  } catch {
    return errorResponse('The preview could not be produced right now.', 503);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = z.object({ recipient: role }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Choose who the notice is for', 400);
  const recipient = parsed.data.recipient as PartyRole;
  try {
    const h = await load(id, hid);
    if (!h) return errorResponse('Hearing not found', 404);
    if (!allowedFrom('notice', h.status)) return errorResponse('Notices are made for a scheduled hearing.', 409);
    const current = await prisma.caseHearingNotice.findFirst({ where: { hearingId: hid, recipientRole: recipient, status: { not: 'SUPERSEDED' } } });
    if (current) return errorResponse(`A notice to the ${NOTICE_RECIPIENTS[recipient].toLowerCase()} for this date is already on record (${current.noticeNumber}).`, 409);
    const by = await actorName(g.actor.id);
    const [notice] = await prisma.$transaction(tx => issueStageNotices(tx, g.c, h, g.actor.id, by, [recipient]));
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: notice }, 201);
  } catch {
    return errorResponse('The notice could not be generated right now.', 503);
  }
}
