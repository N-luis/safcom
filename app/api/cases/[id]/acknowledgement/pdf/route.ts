import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords } from '@/lib/caseRecordsServer';
import { buildAcknowledgementPdf } from '@/lib/acknowledgementPdf';
import { BARANGAY_CONTEXT } from '@/lib/safecommConfig';
import { VAWC_TYPES } from '@/lib/vawcTypes';

/** The acknowledgement letter as a PDF - for anyone who may view the case. Each download is logged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'acknowledgement_pdf');
  if ('error' in g) return g.error;
  try {
    const [l, c] = await Promise.all([
      prisma.acknowledgementLetter.findUnique({ where: { caseId: id } }),
      prisma.case.findUnique({ where: { id }, select: { caseNumber: true, caseType: true, filedAt: true, municipality: true, province: true } }),
    ]);
    if (!l || !c) return errorResponse('No letter has been generated for this case', 404);
    const vawc = (VAWC_TYPES as readonly string[]).includes(c.caseType);
    const by = await prisma.user.findUnique({ where: { id: l.generatedById }, select: { name: true } });
    const bytes = await buildAcknowledgementPdf({
      letterNumber: l.letterNumber, caseNumber: c.caseNumber, recipient: l.recipient,
      // On a VAWC letter, not the officer's name either: desk accounts are
      // often named for the desk ("VAWC Officer ...").
      receivedAt: c.filedAt, generatedAt: l.generatedAt, preparedBy: vawc ? null : by?.name ?? null,
      // Never on a VAWC letter.
      category: vawc ? null : c.caseType,
      barangay: BARANGAY_CONTEXT.name, municipality: c.municipality || 'Bocaue', province: c.province || 'Bulacan',
      status: l.status === 'ISSUED' ? 'ISSUED' : 'GENERATED', issuedAt: l.issuedAt,
    });
    await g.log('permitted', g.access.code);
    return new Response(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${l.letterNumber}.pdf"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return errorResponse('The letter could not be produced right now.', 503);
  }
}
