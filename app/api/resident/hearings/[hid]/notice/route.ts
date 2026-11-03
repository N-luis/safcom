import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { loadHearingCase, noticeInputFor, pdfResponse } from '@/lib/hearingsServer';
import { LIVE_NOTICE } from '@/lib/hearings';
import { buildHearingNoticePdf } from '@/lib/hearingNoticePdf';

/**
 * The complainant's own hearing notice as a PDF - only once an official has
 * issued it, and only the notice addressed to the complainant. The
 * respondent's notice is never served here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ hid: string }> }) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const { hid } = await params;
  try {
    const h = await prisma.caseHearing.findFirst({
      where: { id: hid, status: { not: 'DRAFT' }, case: { residentId: auth.resident.residentId, caseType: { notIn: [...VAWC_TYPES] } } },
    });
    if (!h) return rError('Hearing not found', 404);
    const n = await prisma.caseHearingNotice.findFirst({
      where: { hearingId: hid, recipientRole: 'COMPLAINANT', status: { in: [...LIVE_NOTICE] } }, orderBy: { generatedAt: 'desc' },
    });
    if (!n) return rError('Your notice for this hearing has not been issued yet.', 404);
    const c = await loadHearingCase(h.caseId);
    if (!c) return rError('Hearing not found', 404);
    const by = n.issuedById ? (await prisma.user.findUnique({ where: { id: n.issuedById }, select: { name: true } }))?.name ?? null : null;
    const bytes = await buildHearingNoticePdf(noticeInputFor(c, h, {
      noticeNumber: n.noticeNumber, recipientRole: 'COMPLAINANT', recipientName: n.recipientName, scheduledAt: n.scheduledAt, venue: n.venue, issuedAt: n.issuedAt,
    }, 'ISSUED', by));
    return pdfResponse(bytes, `${n.noticeNumber}.pdf`, req.nextUrl.searchParams.get('inline') === '1');
  } catch {
    return rError('Your notice could not be produced right now.', 503);
  }
}
