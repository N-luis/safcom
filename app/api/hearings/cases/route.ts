import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor, BLOTTER_ROLES, VAWC_DESK_ROLES, isVawcType } from '@/lib/reporterAccess';
import { canSeeVawc } from '@/lib/caseAccess';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import { noStore } from '@/lib/hearingsServer';
import { listHearingCases, logRouteError, type KpEligibilityState, type CaseHearingState } from '@/lib/hearingCasesServer';
import { VAWC_HEARING_REFUSAL, KP_ELIGIBILITY_STATES, type CaseTrack } from '@/lib/hearings';

export const dynamic = 'force-dynamic';

const ELIGIBILITY: KpEligibilityState[] = [...KP_ELIGIBILITY_STATES];
const HEARING: CaseHearingState[] = ['NOT_SCHEDULED', 'IN_PROGRESS', 'AWAITING_NEXT', 'ENDED'];

/**
 * The cases for Hearing Management and the Create Hearing dialog, one case
 * type at a time: ?track=BLOTTER (the default) or ?track=VAWC - the VAWC
 * desk's own list, for the VAWC desk and the captain only (403 otherwise).
 *
 * The blotter cases:
 * every case on the blotter desk - with a hearing or not yet - with its
 * eligibility for Katarungang Pambarangay proceedings, its proceedings so
 * far, and whether this official may manage it (lib/hearingCasesServer.ts).
 *
 *   ?q=            case number, complainant or respondent
 *   ?status=       OPEN (default), ANY, or a case status
 *   ?eligibility=  PENDING_REVIEW | ELIGIBLE | NOT_ELIGIBLE
 *   ?hearing=      NOT_SCHEDULED | IN_PROGRESS | AWAITING_NEXT | ENDED
 *   ?page= &pageSize=
 *
 * On the blotter list a VAWC case is never listed: typed in by its number
 * (by a role that may see it), it comes back with the reason it has no KP
 * proceedings - its hearings are on the VAWC list.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  const role = actor.role.trim();
  const sp = req.nextUrl.searchParams;
  const track: CaseTrack = sp.get('track')?.toUpperCase() === 'VAWC' ? 'VAWC' : VAWC_DESK_ROLES.includes(role) && !sp.get('track') ? 'VAWC' : 'BLOTTER';
  if (track === 'VAWC' && !(VAWC_DESK_ROLES.includes(role) || role === 'admin')) {
    return noStore({ success: false, error: 'VAWC cases are confidential (RA 9262 sec. 44): only the VAWC desk and the Punong Barangay manage their hearings.' }, 403);
  }
  if (track === 'BLOTTER' && !BLOTTER_ROLES.includes(role) && role !== 'admin') {
    return noStore({ success: false, error: 'Only blotter officers and the barangay captain manage hearings on blotter cases.' }, 403);
  }
  const q = sp.get('q')?.trim().slice(0, 60) || null;
  const pick = <T extends string>(v: string | null, allowed: T[]) => (allowed.includes(v as T) ? v as T : null);
  try {
    const data = await listHearingCases(actor, {
      q, status: sp.get('status')?.slice(0, 40) || null,
      eligibility: pick(sp.get('eligibility'), ELIGIBILITY), hearing: pick(sp.get('hearing'), HEARING),
      page: Number(sp.get('page')) || 1, pageSize: Number(sp.get('pageSize')) || 25,
    }, track);
    // The VAWC case asked for by number: shown, with why it never gets a hearing.
    let vawc = null;
    if (track === 'BLOTTER' && q && canSeeVawc(role)) {
      const v = await prisma.case.findFirst({ where: { caseNumber: { equals: q, mode: 'insensitive' }, caseType: { in: [...VAWC_TYPES] } },
        select: { id: true, caseNumber: true, caseType: true, status: true } });
      if (v && isVawcType(v.caseType)) vawc = { ...v, reason: VAWC_HEARING_REFUSAL };
    }
    return noStore({ success: true, data: { ...data, vawc, track } });
  } catch (e) {
    logRouteError('GET /api/hearings/cases', e);
    return errorResponse('The cases could not be loaded right now.', 503);
  }
}
