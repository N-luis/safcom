import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateServiceReferral, loadReferral, referralPdf, sha256 } from '@/lib/serviceReferralServer';

/**
 * GET - a Service Referral Form as a PDF, for the officials who may view the
 * case's records (a VAWC case outside the role does not exist).
 *
 *   ?copy=issued (default for an issued referral) - the document as issued:
 *     the stored bytes, checked against their SHA-256 before they are sent.
 *   ?copy=record - the issued form with Section C as SafeComm recorded it.
 *   A draft or a cancelled referral: built from what is saved, watermarked.
 *
 * No file URL exists for any of it: the PDF is only ever this response,
 * never cached. Every download is logged (access log and the referral's own
 * history). The file name carries the referral number only - no names.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'view', 'service_referral_pdf');
  if ('error' in g) return g.error;
  const copy = req.nextUrl.searchParams.get('copy') === 'record' ? 'record' : 'issued';
  try {
    const r = await loadReferral(id, rid);
    if (!r) { await g.log('denied', 'referral_not_found'); return errorResponse('Referral not found', 404); }

    let bytes: Uint8Array;
    let suffix = '';
    if (r.status === 'ISSUED' && copy === 'issued') {
      const stored = await prisma.serviceReferral.findUnique({ where: { id: rid }, select: { issuedDocument: true, documentSha256: true } });
      if (!stored?.issuedDocument || sha256(stored.issuedDocument) !== stored.documentSha256) {
        await g.log('denied', 'document_integrity');
        return errorResponse('The issued document failed its integrity check and was not sent. Tell the system administrator.', 500);
      }
      bytes = stored.issuedDocument;
    } else {
      bytes = await referralPdf(r, r.status === 'ISSUED');
      suffix = r.status === 'DRAFT' ? '-DRAFT' : r.status === 'CANCELLED' ? '-CANCELLED' : '-RECORD';
    }
    // Recorded before it is sent.
    await g.log('permitted', `${g.access.code}:${r.status === 'ISSUED' ? copy : r.status.toLowerCase()}`);
    await prisma.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: 'DOCUMENT_GENERATED', version: r.version, changedKeys: [],
      note: r.status === 'ISSUED' ? (copy === 'issued' ? 'Issued copy downloaded' : 'Record copy (with Section C) downloaded') : `${r.status === 'DRAFT' ? 'Draft' : 'Cancelled'} copy downloaded`,
      actorId: g.actor.id } }).catch(() => undefined);
    return new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Service-Referral-${r.reference.replace(/[^A-Za-z0-9-]/g, '')}${suffix}.pdf"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      ...(r.documentSha256 && copy === 'issued' && r.status === 'ISSUED' && { 'X-Document-SHA256': r.documentSha256 }),
    } });
  } catch {
    return errorResponse('The referral form could not be produced right now.', 503);
  }
}
