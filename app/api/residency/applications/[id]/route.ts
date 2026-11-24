import { NextRequest } from 'next/server';
import { sendNoticeEmail } from '@/lib/email';
import { siteOrigin } from '@/lib/siteUrl';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { RESIDENCY_VERIFIER_ROLES, RESIDENCE_SELECT, recordResidencyEvent, checkAgainstJurisdiction, loadJurisdiction } from '@/lib/jurisdictionServer';
import { RESIDENCY_STATUSES, DECIDE_FROM, addressLine, type ResidencyStatus } from '@/lib/jurisdiction';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The verifier, re-read from the database on every request, and each look logged. */
async function gate(req: NextRequest, id: string, purpose: 'view' | 'decide') {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return { error: errorResponse('Unauthorized', 401) };
  const allowed = RESIDENCY_VERIFIER_ROLES.includes(actor.role.trim());
  // The access log keys rows by record id: here the resident's (fields: residency).
  await prisma.reporterAccessLog.create({ data: { actorId: actor.id, actorRole: actor.role, caseId: id.slice(0, 64), caseNumber: null,
    fields: ['residency'], outcome: allowed ? 'permitted' : 'denied', code: `residency:${purpose}` } }).catch(() => undefined);
  if (!allowed) return { error: noStore({ success: false, error: 'Only the Barangay Captain verifies residents.' }, 403) };
  return { actor };
}

/**
 * One applicant, for the verifier: the registration details, the residential
 * address, the confirmed home location (exact - for this review only), the
 * server's check against the jurisdiction, re-run now against the boundary
 * as it is configured today, and the residency history.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gate(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    const [r, events, cfg] = await Promise.all([
      prisma.resident.findUnique({ where: { id }, select: { ...RESIDENCE_SELECT, _count: { select: { cases: true } } } }),
      prisma.residencyEvent.findMany({ where: { residentId: id }, orderBy: { createdAt: 'asc' } }),
      loadJurisdiction(),
    ]);
    if (!r) return errorResponse('Resident not found', 404);
    const ids = [...new Set([r.residencyVerifiedById, ...events.filter(e => e.actorType === 'official').map(e => e.actorId)].filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const name = (uid: string | null) => (uid ? users.find(u => u.id === uid)?.name ?? 'Former official' : null);
    const checkNow = await checkAgainstJurisdiction({ ...r, latitude: r.homeLatitude, longitude: r.homeLongitude }, 'residence');
    return noStore({ success: true, data: {
      resident: {
        id: r.id, residentNumber: r.residentNumber, name: `${r.firstName} ${r.lastName}`, birthDate: r.birthDate, age: r.age, sex: r.gender,
        contactNumber: r.contactNumber, email: r.email, emailVerified: r.emailVerified, accountStatus: r.status,
        registeredAt: r.registeredAt, updatedAt: r.updatedAt, cases: r._count.cases,
      },
      residency: {
        status: r.residencyStatus, statusLabel: RESIDENCY_STATUSES[r.residencyStatus as ResidencyStatus] ?? r.residencyStatus,
        submittedAt: r.residencySubmittedAt, verifiedAt: r.residencyVerifiedAt, verifiedBy: name(r.residencyVerifiedById), note: r.residencyNote,
        canDecide: (DECIDE_FROM as string[]).includes(r.residencyStatus),
      },
      address: { province: r.province, municipality: r.municipality, barangay: r.barangay, street: r.street, houseNumber: r.houseNumber, purok: r.purok,
        line: addressLine(r) || r.address },
      location: r.homeLatitude !== null && r.homeLongitude !== null ? { latitude: r.homeLatitude, longitude: r.homeLongitude, source: r.homeLocationSource } : null,
      checkAtSubmission: r.addressCheck, checkNow,
      jurisdiction: { barangay: cfg.barangay, municipality: cfg.municipality, province: cfg.province, boundary: cfg.boundary, boundarySource: cfg.boundarySource },
      history: events.map(e => ({ id: e.id, kind: e.kind, actorType: e.actorType, by: e.actorType === 'official' ? name(e.actorId) : e.actorType === 'resident' ? 'The resident' : 'SafeComm',
        fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt })),
    } });
  } catch (e) {
    logRouteError('GET /api/residency/applications/[id]', e);
    return errorResponse('The application could not be loaded right now.', 503);
  }
}

const decision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(5, 'Give the reason - the resident sees it').max(500) }),
  z.object({ action: z.literal('request_info'), note: z.string().trim().min(5, 'Say what is needed - the resident sees it').max(500) }),
]);

const OUTCOME = {
  approve: { to: 'VERIFIED', kind: 'approved', account: 'Active', activity: 'residency_verified', word: 'verified' },
  reject: { to: 'REJECTED', kind: 'rejected', account: 'Rejected', activity: 'residency_rejected', word: 'rejected' },
  request_info: { to: 'NEEDS_INFO', kind: 'info_requested', account: 'Pending', activity: 'residency_info_requested', word: 'returned for more information' },
} as const;

const DECISION_MAIL = {
  approve: { subject: 'Your SafeComm residency is verified', text: 'An authorized official of Barangay Biñang 2nd verified your residency. You can now file reports in the SafeComm Resident Portal.' },
  reject: { subject: 'Your SafeComm residency was not approved', text: 'An authorized official of Barangay Biñang 2nd did not approve your residency. You can correct your details and submit them again from your residency page.' },
  request_info: { subject: 'SafeComm needs more information about your residency', text: 'An authorized official of Barangay Biñang 2nd needs more information before verifying your residency. Update your details from your residency page.' },
} as const;

/**
 * The verifier's decision on a pending application: approve (the resident is
 * Verified and the portal opens), reject with a reason, or ask for more
 * information. Only from Pending Verification, and only if the application is
 * still as it was read (a resident who changes the address meanwhile is
 * checked again). Recorded with the verifier and the date, in the residency
 * history and the activity log.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gate(req, id, 'decide');
  if ('error' in g) return g.error;
  const parsed = decision.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the decision', 400);
  const d = parsed.data;
  try {
    const r = await prisma.resident.findUnique({ where: { id }, select: { residencyStatus: true, updatedAt: true, residentNumber: true, firstName: true, lastName: true, email: true } });
    if (!r) return errorResponse('Resident not found', 404);
    if (!(DECIDE_FROM as string[]).includes(r.residencyStatus)) {
      return errorResponse(`This application is ${RESIDENCY_STATUSES[r.residencyStatus as ResidencyStatus]?.toLowerCase() ?? r.residencyStatus} - only a pending application can be decided.`, 409);
    }
    const o = OUTCOME[d.action];
    const note = d.action === 'approve' ? d.note || null : d.action === 'reject' ? d.reason : d.note;
    const now = new Date();
    const ok = await prisma.$transaction(async tx => {
      const u = await tx.resident.updateMany({ where: { id, residencyStatus: r.residencyStatus, updatedAt: r.updatedAt }, data: {
        residencyStatus: o.to, status: o.account,
        residencyNote: d.action === 'approve' ? null : note,
        ...(d.action === 'approve' ? { residencyVerifiedAt: now, residencyVerifiedById: g.actor.id } : { residencyVerifiedAt: null, residencyVerifiedById: null }),
      } });
      if (!u.count) return false;
      await recordResidencyEvent(tx, { residentId: id, kind: o.kind, actorType: 'official', actorId: g.actor.id, fromStatus: r.residencyStatus, toStatus: o.to, note });
      await tx.activity.create({ data: { type: o.activity, message: `Residency of ${r.firstName} ${r.lastName} (${r.residentNumber}) ${o.word}`,
        entityId: id, entityType: 'Resident', userId: g.actor.id, color: d.action === 'approve' ? '#15803d' : d.action === 'reject' ? '#b91c1c' : '#b45309' } });
      return true;
    });
    if (!ok) return errorResponse('This application changed while you were reviewing it. Reload to see it.', 409);
    // The resident is told by email too (it is also on their dashboard and residency page). Never undoes the decision.
    const emailed = r.email ? await sendNoticeEmail(r.email, `${r.firstName} ${r.lastName}`, DECISION_MAIL[d.action].subject,
      [DECISION_MAIL[d.action].text, ...(note && d.action !== 'approve' ? [`${d.action === 'reject' ? 'Reason' : 'What is needed'}: ${note}`] : [])],
      { label: d.action === 'approve' ? 'Open SafeComm' : 'Open my residency', url: `${siteOrigin(req.nextUrl.origin)}/resident${d.action === 'approve' ? '' : '/residency'}` })
      .catch(() => ({ ok: false })) : { ok: false };
    return noStore({ success: true, data: { status: o.to, residentEmailed: emailed.ok } });
  } catch (e) {
    logRouteError('POST /api/residency/applications/[id]', e);
    return errorResponse('The decision could not be saved right now.', 503);
  }
}
