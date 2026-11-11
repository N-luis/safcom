import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateServiceReferral } from '@/lib/serviceReferralServer';

/**
 * GET - one scan kept with a Service Referral Form, for the officials who may
 * view the case's records. It must belong to this referral, of this case.
 * Never cached; every look is logged.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string; aid: string }> }) {
  const { id, rid, aid } = await params;
  const g = await gateServiceReferral(req, id, 'view', 'service_referral_scan');
  if ('error' in g) return g.error;
  try {
    const a = await prisma.serviceReferralAttachment.findUnique({ where: { id: aid }, select: { data: true, mimeType: true, referral: { select: { id: true, caseId: true, reference: true } } } });
    if (!a || a.referral.id !== rid || a.referral.caseId !== id) { await g.log('denied', 'scan_not_found'); return errorResponse('Not found', 404); }
    await g.log('permitted', `${g.access.code}:scan_view`);
    const ext = a.mimeType === 'application/pdf' ? 'pdf' : a.mimeType.split('/')[1];
    return new NextResponse(Buffer.from(a.data), { headers: {
      'Content-Type': a.mimeType,
      'Content-Disposition': `inline; filename="Service-Referral-${a.referral.reference.replace(/[^A-Za-z0-9-]/g, '')}-scan.${ext}"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    } });
  } catch {
    return errorResponse('The scan could not be opened right now.', 503);
  }
}
