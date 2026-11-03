import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import {
  gateHearings, noStore, eligibilityOf, presidingOfficials, complainantName, respondentName, recordEvent, hearingActivity,
  actorName, isUniqueViolation, scheduleFields, instantOf, checkPeople, type HearingCase,
} from '@/lib/hearingsServer';
import {
  hearingRefusal, nextHearingNumber, hearingReference, isPastDay, formatHearingWhen, VAWC_HEARING_REFUSAL,
} from '@/lib/hearings';
import { isVawcType } from '@/lib/reporterAccess';

/**
 * Katarungang Pambarangay hearings for one blotter case.
 *
 *   GET  - every hearing with its notices, requests and history; the parties
 *          and officials it may involve; whether the case may have one.
 *   POST - create the next hearing, as a draft (officials only) or scheduled
 *          (the complainant is told). Refused on a VAWC case, on a case whose
 *          category no official has verified, and without an official's
 *          eligibility review - SafeComm records that review, it does not
 *          make the legal call.
 */

type Params = { params: Promise<{ id: string }> };

/** The parties a hearing may name, from the case's own records. */
async function partiesOf(c: HearingCase) {
  const rows = await prisma.caseParty.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' }, select: { id: true, role: true, fullName: true, source: true } });
  return {
    complainants: [
      { id: null as string | null, name: complainantName(c, null), label: 'The reporter (filed the case)' },
      ...rows.filter(r => r.role === 'AFFECTED').map(r => ({ id: r.id as string | null, name: r.fullName || 'Not named', label: `Person affected (${r.source === 'official' ? 'official record' : "reporter's account"})` })),
    ],
    respondents: rows.filter(r => r.role === 'REPORTED').map(r => ({ id: r.id, name: r.fullName || 'Not named', label: `Person reported (${r.source === 'official' ? 'official record' : "reporter's account"})` })),
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    if (isVawcType(g.c.caseType)) {
      await g.log('permitted', g.access.code);
      return noStore({ success: true, data: {
        case: { id, caseNumber: g.c.caseNumber, caseType: g.c.caseType, status: g.c.status, hasReporterAccount: Boolean(g.c.residentId) },
        hearings: [], next: null, canEdit: false, blocked: VAWC_HEARING_REFUSAL, vawc: true,
        eligibility: { eligible: false, reasons: [VAWC_HEARING_REFUSAL], warnings: [], categoryVerified: false, needsReview: false, review: null },
        parties: { complainants: [], respondents: [] }, officials: [],
      } });
    }
    const [hearings, eligibility, parties, officials] = await Promise.all([
      prisma.caseHearing.findMany({
        where: { caseId: id }, orderBy: [{ hearingNumber: 'asc' }, { createdAt: 'asc' }],
        include: {
          notices: { orderBy: { generatedAt: 'asc' } },
          requests: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
          attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } },
          assignedOfficial: { select: { id: true, name: true } },
          complainantParty: { select: { id: true, fullName: true } },
          respondentParty: { select: { id: true, fullName: true } },
        },
      }),
      eligibilityOf(g.c),
      partiesOf(g.c),
      presidingOfficials(),
    ]);
    // Names for the history, read once. A resident is shown as "Complainant".
    const ids = [...new Set(hearings.flatMap(h => [
      ...h.events.filter(e => e.actorType === 'official').map(e => e.actorId),
      ...h.notices.flatMap(n => [n.generatedById, n.issuedById, n.deliveryRecordedById]),
      ...h.requests.map(r => r.reviewedById), h.createdById, h.completedById, h.cancelledById,
    ]).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const name = (uid: string | null | undefined) => (uid ? users.find(u => u.id === uid)?.name ?? 'Former official' : null);

    const next = nextHearingNumber(hearings);
    const refusal = next ? hearingRefusal(g.c.caseType, hearings, next) : 'All three hearings have been held.';
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      case: { id, caseNumber: g.c.caseNumber, caseType: g.c.caseType, status: g.c.status, hasReporterAccount: Boolean(g.c.residentId) },
      hearings: hearings.map(h => ({
        ...h,
        complainant: { partyId: h.complainantPartyId, name: complainantName(g.c, h.complainantParty) },
        respondent: { partyId: h.respondentPartyId, name: respondentName(h.respondentParty) },
        createdBy: name(h.createdById), completedBy: name(h.completedById), cancelledBy: name(h.cancelledById),
        notices: h.notices.map(n => ({ ...n, generatedBy: name(n.generatedById), issuedBy: name(n.issuedById), deliveryRecordedBy: name(n.deliveryRecordedById) })),
        requests: h.requests.map(r => ({ id: r.id, reason: r.reason, preferredSchedule: r.preferredSchedule, status: r.status, createdAt: r.createdAt,
          reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewedBy: name(r.reviewedById) })),
        events: h.events.map(e => ({ id: e.id, kind: e.kind, actorType: e.actorType, before: e.before, after: e.after, note: e.note, createdAt: e.createdAt,
          by: e.actorType === 'official' ? name(e.actorId) : e.actorType === 'resident' ? 'Complainant (SafeComm)' : 'SafeComm' })),
      })),
      next,
      canEdit: g.access.edit,
      accessMessage: g.access.message,
      // Why nothing can be created now, if so - shown instead of the button.
      blocked: refusal ?? (eligibility.eligible ? null : eligibility.reasons[0]),
      eligibility, parties, officials,
    } });
  } catch {
    return errorResponse('The hearings could not be loaded right now.', 503);
  }
}

const idOrNull = z.string().trim().min(1).max(64).nullable().optional();
const postSchema = z.object({
  hearingNumber: z.number().int().min(1).max(3),
  ...scheduleFields,
  assignedOfficialId: idOrNull,
  complainantPartyId: idOrNull,
  respondentPartyId: idOrNull,
  notes: z.string().trim().max(1000).optional(),
  residentInstructions: z.string().trim().max(600).optional(),
  asDraft: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the hearing details', 400);
  const d = parsed.data;
  try {
    const existing = await prisma.caseHearing.findMany({ where: { caseId: id }, select: { hearingNumber: true, status: true, outcome: true } });
    const refusal = hearingRefusal(g.c.caseType, existing, d.hearingNumber);
    if (refusal) { await g.log('denied', 'hearing_refused'); return errorResponse(refusal, 422); }
    const eligibility = await eligibilityOf(g.c);
    if (!eligibility.eligible) { await g.log('denied', 'not_eligible'); return noStore({ success: false, error: eligibility.reasons[0], eligibility }, 422); }
    const at = instantOf(d);
    if (!at) return errorResponse('Choose the hearing date and time', 400);
    if (isPastDay(at)) return errorResponse('The hearing date has already passed. Choose today or a later date.', 400);
    const people = await checkPeople(id, d);
    if (people) return errorResponse(people, 400);

    const by = await actorName(g.actor.id);
    const draft = d.asDraft === true;
    const venue = d.venue || 'Barangay Hall';
    const attempt = existing.filter(h => h.hearingNumber === d.hearingNumber).length + 1;
    const hearing = await prisma.$transaction(async tx => {
      const h = await tx.caseHearing.create({ data: {
        caseId: id, reference: hearingReference(g.c.caseNumber, d.hearingNumber, attempt), hearingNumber: d.hearingNumber,
        scheduledAt: at, venue, status: draft ? 'DRAFT' : 'SCHEDULED',
        activeKey: `${id}:${d.hearingNumber}`, openKey: id,
        assignedOfficialId: d.assignedOfficialId ?? g.actor.id,
        complainantPartyId: d.complainantPartyId ?? null, respondentPartyId: d.respondentPartyId ?? null,
        notes: d.notes || null, residentInstructions: d.residentInstructions || null,
        createdById: g.actor.id, updatedById: g.actor.id,
      } });
      const snapshot = { hearingNumber: h.hearingNumber, scheduledAt: h.scheduledAt.toISOString(), venue: h.venue };
      const e = await recordEvent(tx, { hearingId: h.id, caseId: id, kind: draft ? 'created' : 'scheduled', actorType: 'official', actorId: g.actor.id, after: snapshot });
      await hearingActivity(tx, e.id, id, g.actor.id, draft
        ? `Hearing ${h.hearingNumber} drafted by ${by} (not yet scheduled)`
        : `Hearing ${h.hearingNumber} scheduled for ${formatHearingWhen(h.scheduledAt)} at ${venue} by ${by}`);
      if (h.assignedOfficialId && h.assignedOfficialId !== g.actor.id) {
        await tx.notification.create({ data: {
          title: `You are assigned to Hearing ${h.hearingNumber} on ${g.c.caseNumber}`,
          message: `${draft ? 'Drafted' : 'Scheduled'} for ${formatHearingWhen(h.scheduledAt)}. Open Hearing Management for the details.`,
          type: 'info', userId: h.assignedOfficialId, caseId: id,
        } });
      }
      return h;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: hearing }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return errorResponse('This case already has an open hearing or this hearing is already on record. Reload to see it.', 409);
    return errorResponse('The hearing could not be created right now.', 503);
  }
}
