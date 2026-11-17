import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { loadActor } from '@/lib/reporterAccess';
import { canUseDirectory, nameWhere, DIRECTORY_STATUSES, DIRECTORY_PAGE_SIZE } from '@/lib/residentDirectory';

export const dynamic = 'force-dynamic';

const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

/**
 * The Resident Directory list: registered residents, by name only - with or
 * without any report. Search and pages run on the database, over every
 * resident, not on the rows already shown.
 *   ?q=   part of a first or last name (each word must match)
 *   ?page=
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  if (!canUseDirectory(actor.role)) return noStore({ success: false, error: 'The Resident Directory is for Blotter and VAWC officials.' }, 403);
  // Generous for typing a search; too few to page through for harvesting.
  if (!rateLimit(`resident-directory:${actor.id}`, { max: 120, windowMs: 5 * 60 * 1000 }).allowed) {
    return errorResponse('Too many searches. Try again in a few minutes.', 429);
  }

  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim().slice(0, 80) ?? '';
  const page = Math.min(1000, Math.max(1, Number(sp.get('page')) || 1));
  const where = { status: { in: DIRECTORY_STATUSES }, AND: nameWhere(q) };
  try {
    const [rows, total] = await Promise.all([
      prisma.resident.findMany({
        where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * DIRECTORY_PAGE_SIZE, take: DIRECTORY_PAGE_SIZE,
        // Names only. Contact details come one resident at a time, logged.
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.resident.count({ where }),
    ]);
    return noStore({ success: true, data: {
      rows: rows.map(r => ({ id: r.id, name: [r.firstName, r.lastName].map(s => s.trim()).filter(Boolean).join(' ') || 'Unnamed resident' })),
      total, page, pageSize: DIRECTORY_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
    } });
  } catch (e) {
    console.error('[Resident directory]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The Resident Directory is unavailable right now.', 503);
  }
}
