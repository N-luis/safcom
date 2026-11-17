import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { phInstant } from '@/lib/hearings';
import { logRouteError } from '@/lib/hearingCasesServer';
import { forbiddenRequest } from '@/lib/vawcAppointments';
import { noStore, gateAppointments, checkOfficer, logAccess, notifyAppointmentOfficials } from '@/lib/vawcAppointmentsServer';
import {
  BPO_APPLICANT_KEYS, REFERRAL_AGENCY_KEYS, VAWC_REFERRAL_STATUS_KEYS, KIND_LABEL, NOT_A_COURT,
} from '@/lib/vawcProceedings';
import { loadProceedings, nextProceedingReference, recordProceedingEvent, proceedingActivity } from '@/lib/vawcProceedingsServer';

export const dynamic = 'force-dynamic';

/**
 * VAWC Case Proceedings: the BPO and referral records an
 * official may see (VAWC cases only, by construction), with the dated items
 * for the calendar; and recording a new one on a VAWC case, by its id.
 *   GET  ?caseId=  (one case)
 *   POST { kind: 'bpo' | 'referral', caseId, ... }
 * (An external court date is a Hearing: POST /api/vawc/appointments, type EXTERNAL_COURT_HEARING.)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  const caseId = req.nextUrl.searchParams.get('caseId')?.trim().slice(0, 64) || null;
  try {
    let canCreate = false;
    if (caseId) {
      // One case: its own gate, so a blotter case or another desk's case says so.
      const g = await gateAppointments(req, caseId, 'view');
      if ('error' in g) return g.error;
      canCreate = g.access.edit;
    }
    const data = await loadProceedings(actor, caseId);
    if (!data) {
      await logAccess(actor, '(proceedings)', null, 'denied', 'role_not_permitted');
      return noStore({ success: false, error: 'VAWC Case Proceedings are for the VAWC desk.', code: 'wrong_desk' }, 403);
    }
    await logAccess(actor, caseId ?? '(proceedings)', null, 'permitted', 'proceedings_list');
    return noStore({ success: true, data: { ...data, canCreate } });
  } catch (e) {
    logRouteError('GET /api/vawc/proceedings', e);
    return errorResponse('The records could not be loaded right now.', 503);
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the time');
const officer = z.string().max(64).nullable().optional();
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bpo'), caseId: z.string().min(1).max(64), appliedDate: date, appliedTime: time,
    applicantType: z.enum(BPO_APPLICANT_KEYS), applicationNotes: z.string().trim().max(2000).optional(), assignedOfficerId: officer }),
  z.object({ kind: z.literal('referral'), caseId: z.string().min(1).max(64), agencyType: z.enum(REFERRAL_AGENCY_KEYS),
    agencyName: z.string().trim().min(2, 'Enter the agency or service provider').max(200), referredDate: date,
    purpose: z.string().trim().min(5, 'Write what the referral is for (at least 5 characters)').max(1000),
    status: z.enum(VAWC_REFERRAL_STATUS_KEYS).optional(), followUpDate: date.nullable().optional(),
    serviceReferralId: z.string().max(64).nullable().optional(), assignedOfficerId: officer }),
]);

const DAY = 86_400_000;

/** Record a BPO application or a referral - on a VAWC case, by its id. */
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const forbidden = forbiddenRequest(raw);
  if (forbidden) return errorResponse(forbidden, 400);
  if (raw && typeof raw === 'object' && /conduct|create.?hearing|preside/i.test(String((raw as Record<string, unknown>).action ?? ''))) return errorResponse(NOT_A_COURT, 400);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  const d = parsed.data;
  const g = await gateAppointments(req, d.caseId, 'edit');
  if ('error' in g) return g.error;
  const { actor, c } = g;
  const now = Date.now();
  const officerId = d.assignedOfficerId === undefined ? (c.assignedToId ?? actor.id) : d.assignedOfficerId;
  const badOfficer = await checkOfficer(officerId);
  if (badOfficer) return errorResponse(badOfficer, 400);

  // Dates: what has happened cannot be in the future.
  let at: Date | null = null;
  let followUp: Date | null = null;
  if (d.kind === 'bpo') {
    at = phInstant(d.appliedDate, d.appliedTime);
    if (!at || at.getTime() > now + 5 * 60_000) return errorResponse('The application date and time cannot be in the future.', 400);
  } else {
    at = phInstant(d.referredDate, '09:00');
    if (!at || at.getTime() > now + DAY) return errorResponse('The referral date cannot be in the future.', 400);
    if (d.followUpDate) {
      followUp = phInstant(d.followUpDate, '09:00');
      if (!followUp || d.followUpDate < d.referredDate) return errorResponse('The follow-up date cannot be before the referral.', 400);
    }
    if (d.serviceReferralId) {
      const sr = await prisma.serviceReferral.findFirst({ where: { id: d.serviceReferralId, caseId: c.id }, select: { id: true } });
      if (!sr) return errorResponse('That Service Referral Form is not on this case.', 400);
    }
  }

  try {
    const by = (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'an official';
    const created = await prisma.$transaction(async tx => {
      const reference = await nextProceedingReference(tx, d.kind, c.id, c.caseNumber);
      const base = { caseId: c.id, reference, assignedOfficerId: officerId, createdById: actor.id, updatedById: actor.id };
      let row: { id: string; reference: string };
      let after: Record<string, unknown>;
      let eventKind: string;
      if (d.kind === 'bpo') {
        row = await tx.vawcBpo.create({ data: { ...base, appliedAt: at!, applicantType: d.applicantType, applicationNotes: d.applicationNotes || null, receivedById: actor.id } });
        after = { appliedAt: at!.toISOString(), applicantType: d.applicantType };
        eventKind = 'bpo_applied';
      } else {
        row = await tx.vawcReferral.create({ data: { ...base, agencyType: d.agencyType, agencyName: d.agencyName, referredAt: at!, purpose: d.purpose,
          status: d.status ?? 'REFERRED', followUpAt: followUp, serviceReferralId: d.serviceReferralId || null } });
        after = { agencyType: d.agencyType, agencyName: d.agencyName, status: d.status ?? 'REFERRED', followUpAt: followUp?.toISOString() ?? null };
        eventKind = 'referral_recorded';
      }
      const e = await recordProceedingEvent(tx, { caseId: c.id, recordKind: d.kind, recordId: row.id, kind: eventKind, actorId: actor.id, after });
      await proceedingActivity(tx, e.id, c.id, actor.id, `${KIND_LABEL[d.kind]} recorded (${row.reference}) by ${by}`);
      // A BPO application is acted on the same day (sec. 14): the officials are told at once.
      await notifyAppointmentOfficials(tx, { assignedOfficerId: officerId }, c,
        d.kind === 'bpo' ? `BPO application - ${c.caseNumber}` : `${KIND_LABEL[d.kind]} recorded - ${c.caseNumber}`,
        d.kind === 'bpo' ? `A BPO application (${row.reference}) was recorded. Under RA 9262 sec. 14 it is acted on the date of filing.`
          : `${row.reference} was recorded. Open VAWC Case Proceedings for the details.`,
        d.kind === 'bpo' ? 'warning' : 'info', actor.id);
      return row;
    });
    await g.log('permitted', `${d.kind}_recorded`);
    return noStore({ success: true, data: { id: created.id, reference: created.reference, kind: d.kind } }, 201);
  } catch (e) {
    logRouteError('POST /api/vawc/proceedings', e);
    return errorResponse('The record could not be saved right now. Nothing was changed.', 503);
  }
}
