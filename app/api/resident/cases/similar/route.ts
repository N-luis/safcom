import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { SIMILAR_CASE_WINDOW_DAYS } from '@/lib/followUps';

export const dynamic = 'force-dynamic';

/**
 * Finds an open case of the resident's that a new report may be a repeat of.
 *
 * This is a suggestion, never a block. Filing a second case is sometimes
 * exactly right - the same street and type can be a genuinely separate
 * incident - so the UI offers a follow-up and lets the resident carry on if
 * they disagree.
 */
export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const caseType = req.nextUrl.searchParams.get('caseType') ?? '';
  const barangay = req.nextUrl.searchParams.get('barangay') ?? '';
  if (!caseType) return rError('caseType is required', 400);

  const since = new Date(Date.now() - SIMILAR_CASE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const match = await prisma.case.findFirst({
      where: {
        residentId: auth.resident.residentId,
        caseType,
        status: { notIn: ['Resolved', 'Closed'] },
        filedAt: { gte: since },
        ...(barangay ? { barangay: { equals: barangay, mode: 'insensitive' } } : {}),
      },
      orderBy: { filedAt: 'desc' },
      select: {
        id: true, caseNumber: true, caseType: true, barangay: true,
        status: true, progressState: true, filedAt: true, lastResidentUpdateAt: true,
      },
    });

    return rSuccess({ match, windowDays: SIMILAR_CASE_WINDOW_DAYS });
  } catch {
    return rError('Server error', 500);
  }
}
