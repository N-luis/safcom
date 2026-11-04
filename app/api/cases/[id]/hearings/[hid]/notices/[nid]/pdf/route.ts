import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, kpNoticeInputFor, pdfResponse, hearingPartySelect } from '@/lib/hearingsServer';
import { buildKpNoticePdf } from '@/lib/kpNoticesPdf';

/** A stored KP notice as a PDF, for officials who may view the case's hearings. Each download is logged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string; nid: string }> }) {
  const { id, hid, nid } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const [h, n] = await Promise.all([
      prisma.caseHearing.findUnique({ where: { id: hid }, include: hearingPartySelect }),
      prisma.caseHearingNotice.findUnique({ where: { id: nid } }),
    ]);
    if (!h || h.caseId !== id || !n || n.hearingId !== hid) return errorResponse('Notice not found', 404);
    const by = (await prisma.user.findUnique({ where: { id: n.issuedById ?? n.generatedById }, select: { name: true } }))?.name ?? null;
    const state = n.status === 'SUPERSEDED' ? 'SUPERSEDED' : n.status === 'GENERATED' ? 'GENERATED' : 'ISSUED';
    const bytes = await buildKpNoticePdf(await kpNoticeInputFor(g.c, h, n, state, by));
    await g.log('permitted', `${g.access.code}:notice_pdf`);
    return pdfResponse(bytes, `${n.noticeNumber}.pdf`, req.nextUrl.searchParams.get('inline') === '1');
  } catch {
    return errorResponse('The notice could not be produced right now.', 503);
  }
}
