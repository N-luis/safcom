import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noticeInputFor, pdfResponse } from '@/lib/hearingsServer';
import { buildHearingNoticePdf } from '@/lib/hearingNoticePdf';

/** A stored notice as a PDF, for officials who may view the case's hearings. Each download is logged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string; nid: string }> }) {
  const { id, hid, nid } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const [h, n] = await Promise.all([
      prisma.caseHearing.findUnique({ where: { id: hid } }),
      prisma.caseHearingNotice.findUnique({ where: { id: nid } }),
    ]);
    if (!h || h.caseId !== id || !n || n.hearingId !== hid) return errorResponse('Notice not found', 404);
    const officer = n.issuedById ?? n.generatedById;
    const by = (await prisma.user.findUnique({ where: { id: officer }, select: { name: true } }))?.name ?? null;
    const state = n.status === 'SUPERSEDED' ? 'SUPERSEDED' : n.status === 'GENERATED' ? 'GENERATED' : 'ISSUED';
    const bytes = await buildHearingNoticePdf(noticeInputFor(g.c, h, {
      noticeNumber: n.noticeNumber, recipientRole: n.recipientRole as 'COMPLAINANT' | 'RESPONDENT', recipientName: n.recipientName,
      scheduledAt: n.scheduledAt, venue: n.venue, issuedAt: n.issuedAt,
    }, state, by));
    await g.log('permitted', `${g.access.code}:notice_pdf`);
    return pdfResponse(bytes, `${n.noticeNumber}.pdf`, req.nextUrl.searchParams.get('inline') === '1');
  } catch {
    return errorResponse('The notice could not be produced right now.', 503);
  }
}
