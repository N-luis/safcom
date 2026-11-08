import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords } from '@/lib/caseRecordsServer';
import { REFERRAL_AGENCIES } from '@/lib/caseRecords';
import { buildReferralFormPdf } from '@/lib/referralFormPdf';
import { formOf } from '@/lib/referralForm';

/**
 * Annex B - Referral Form of one referral, as a PDF - for the officials who
 * may see the case's records (a VAWC case outside the role does not exist).
 * The referral must belong to this case. Every download is logged.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'referral_form_pdf');
  if ('error' in g) return g.error;
  try {
    const r = await prisma.caseReferral.findUnique({ where: { id: rid } });
    // Another case's referral, reached through this case's id: not found.
    if (!r || r.caseId !== id) return errorResponse('Referral not found', 404);
    const to = r.agency === 'OTHER' ? r.agencyOther ?? 'Other office' : REFERRAL_AGENCIES[r.agency as keyof typeof REFERRAL_AGENCIES]?.label ?? r.agency;
    const bytes = await buildReferralFormPdf({ caseNumber: g.c.caseNumber, referredAt: r.referredAt, to, reason: r.reason, form: formOf(r), generatedAt: new Date() });
    await g.log('permitted', g.access.code);
    const day = new Date(r.referredAt.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    return new Response(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Referral-${g.c.caseNumber.replace(/[^A-Za-z0-9-]/g, '')}-${day}.pdf"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return errorResponse('The referral form could not be produced right now.', 503);
  }
}
