import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { isVawcCaseHidden } from '@/lib/caseAccess';
import { evidenceForStaff } from '@/lib/evidenceServer';

export const dynamic = 'force-dynamic';

/**
 * GET - the case's evidence photos (the report's and its follow-ups'), for the
 * officials who may open the case: the same gate as the case itself
 * (/api/cases/[id]) - a VAWC case outside the VAWC roles does not exist.
 * Metadata only; each image is served, checked again, by /api/attachments/[id].
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;
  try {
    const c = await prisma.case.findUnique({ where: { id }, select: { caseType: true } });
    if (!c || isVawcCaseHidden(auth.user.role, c.caseType)) return errorResponse('Case not found', 404);
    const res = successResponse({ items: await evidenceForStaff(id) });
    res.headers.set('Cache-Control', 'no-store, private');
    return res;
  } catch {
    return errorResponse('The evidence could not be loaded right now.', 503);
  }
}
