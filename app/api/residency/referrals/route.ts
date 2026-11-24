import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { REFERRAL_STATUS_KEYS } from '@/lib/jurisdiction';
import {
  referralAccessWhere, listReferralsFor, referralDetailFor, actOnReferral, assignableOfficials, type ReferralAction,
} from '@/lib/incidentReferralServer';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * Referral management for officials.
 *
 * The Barangay Captain sees every referral record; the VAWC desk sees only the
 * confidential ones (a possible VAWC concern); the blotter desk and the system
 * administrator see none - enforced in the query (lib/incidentReferralServer.ts).
 *
 *   GET   ?status=OPEN (default) | ALL | <status>     - the list, with counts
 *   GET   ?id=<referral id>                          - one record: the report as submitted,
 *                                                      the location check, photos, history
 *   PATCH { id, action, ... }                        - see ReferralAction
 */
async function gate(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return { error: errorResponse('Unauthorized', 401) };
  if (referralAccessWhere(actor.role) === null) return { error: noStore({ success: false, error: 'Referral records are handled by the Barangay Captain and, for VAWC concerns, the VAWC desk.' }, 403) };
  return { actor: { id: actor.id, role: actor.role.trim() } };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const sp = req.nextUrl.searchParams;
  try {
    const id = sp.get('id');
    if (id) {
      const d = await referralDetailFor(g.actor.role, id);
      if ('error' in d) return errorResponse(d.error === 403 ? 'Forbidden' : 'Referral record not found', d.error);
      return noStore({ success: true, data: { ...d.data, assignable: await assignableOfficials(d.data.confidential) } });
    }
    const status = sp.get('status') ?? 'OPEN';
    const list = await listReferralsFor(g.actor.role, ['ALL', 'OPEN', ...REFERRAL_STATUS_KEYS].includes(status) ? status : 'OPEN');
    return noStore({ success: true, data: list });
  } catch (e) {
    logRouteError('GET /api/residency/referrals', e);
    return errorResponse('The referral records could not be loaded right now.', 503);
  }
}

const note = z.string().trim().min(3, 'Write a short note').max(1000);
const optNote = z.string().trim().max(1000).optional();
const message = z.string().trim().min(3).max(600).optional();
const coord = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();
const patch = z.discriminatedUnion('action', [
  z.object({ id: z.string().min(1).max(64), action: z.literal('status'), status: z.enum(REFERRAL_STATUS_KEYS), note: optNote, residentMessage: message }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('note'), note }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('message'), residentMessage: z.string().trim().min(3).max(600) }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('assign'), assignedToId: z.string().min(1).max(64).nullable(), note: optNote }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('receiving_office'), receivingOffice: z.string().trim().min(3).max(200), note: optNote }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('forwarded'), receivingOffice: z.string().trim().min(3).max(200).optional(), forwardedAt: z.string().max(40).optional(), note, residentMessage: message }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('acknowledged'), acknowledgedAt: z.string().max(40).optional(), note, residentMessage: message }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('relocate'), note, location: z.object({
    province: z.string().trim().max(80).optional(), municipality: z.string().trim().max(80).optional(), barangay: z.string().trim().max(80).optional(),
    street: z.string().trim().max(120).optional(), details: z.string().trim().max(300).optional(),
    latitude: coord(-90, 90), longitude: coord(-180, 180),
  }).strict() }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('confirm_outside'), note, residentMessage: message }),
  z.object({ id: z.string().min(1).max(64), action: z.literal('file_as_case'), note, residentMessage: message }),
]);

export async function PATCH(req: NextRequest) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);
  const { id, ...action } = parsed.data;
  try {
    const r = await actOnReferral(g.actor, id, action as ReferralAction);
    if (!r.ok) return errorResponse(r.error, r.status);
    return noStore({ success: true, data: r.data ?? null });
  } catch (e) {
    logRouteError('PATCH /api/residency/referrals', e);
    return errorResponse('The referral could not be updated right now.', 503);
  }
}
