import { NextRequest } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, BLOTTER_ROLES } from '@/lib/reporterAccess';
import { noStore, findConflicts } from '@/lib/hearingsServer';
import { phInstant, scheduleTimeRefusal } from '@/lib/hearings';

export const dynamic = 'force-dynamic';

/**
 * Checks a proposed date, time, venue and official before anything is saved,
 * so the scheduling forms can warn as the official types. The saving routes
 * run the same check again - this one changes nothing.
 *
 *   ?date=YYYY-MM-DD&time=HH:MM&venue=...&officialId=...&excludeId=<hearing being moved>
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  if (!BLOTTER_ROLES.includes(actor.role) && actor.role !== 'admin') return noStore({ success: false, error: 'Only officials who schedule hearings can check the schedule.' }, 403);
  const sp = req.nextUrl.searchParams;
  const at = phInstant(sp.get('date') ?? '', sp.get('time') ?? '');
  const invalid = scheduleTimeRefusal(at);
  if (invalid || !at) return noStore({ success: true, data: { valid: false, problem: invalid, conflicts: [] } });
  try {
    const conflicts = await findConflicts(actor, {
      at, venue: sp.get('venue')?.slice(0, 200) || 'Barangay Hall',
      officialId: sp.get('officialId')?.slice(0, 64) || actor.id, excludeId: sp.get('excludeId')?.slice(0, 64) || null,
    });
    return noStore({ success: true, data: { valid: true, problem: null, conflicts } });
  } catch {
    return errorResponse('The schedule could not be checked right now.', 503);
  }
}
