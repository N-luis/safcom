import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { gateKp, noStore, WALK_IN_MARK } from '@/lib/kpForms/server';

export const dynamic = 'force-dynamic';

/**
 * The walk-in reports KP forms can be filled from: blotter cases filed on the
 * Walk-in Report page, newest first. Search by case number.  ?q=
 */
export async function GET(req: NextRequest) {
  const g = await gateKp(req);
  if ('error' in g) return g.error;
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 40) ?? '';
  try {
    const rows = await prisma.case.findMany({
      where: { description: { startsWith: WALK_IN_MARK }, caseType: { notIn: [...VAWC_TYPES] }, ...(q && { caseNumber: { contains: q, mode: 'insensitive' } }) },
      orderBy: { filedAt: 'desc' }, take: 30,
      select: { id: true, caseNumber: true, caseType: true, filedAt: true, _count: { select: { kpFormRecords: true } } },
    });
    return noStore({ success: true, data: { rows: rows.map(r => ({ id: r.id, caseNumber: r.caseNumber, caseType: r.caseType, filedAt: r.filedAt, forms: r._count.kpFormRecords })) } });
  } catch (e) {
    console.error('[KP forms cases]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The walk-in reports could not be loaded right now.', 503);
  }
}
