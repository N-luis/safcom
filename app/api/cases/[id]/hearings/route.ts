import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import {
  gateHearings, noStore, eligibilityOf, presidingOfficials, complainantName, respondentName, recordEvent, hearingActivity,
  actorName, isUniqueViolation, scheduleFields, instantOf, checkPeople, findConflicts, conflictResponse, hearingSnap, issueStageNotices,
  hearingPartySelect, partyAccounts, loadPangkat, pangkatConstituted, type HearingCase,
} from '@/lib/hearingsServer';
import {
  nextStep, hearingReference, scheduleTimeRefusal, formatHearingWhen, sessionTitle, partyFormsFor, kpFormName, KP_STAGES, KP_STAGE_KEYS,
  VAWC_HEARING_REFUSAL,
} from '@/lib/hearings';
import { isVawcType } from '@/lib/reporterAccess';

/**
 * The Katarungang Pambarangay proceedings on one blotter case.
 *
 *   GET  - every proceeding with its notices, requests and history; the
 *          parties (and whether each has a SafeComm account); the Pangkat;
 *          the next stage the case may have, or why none.
 *   POST - create the next proceeding - mediation, the constitution of the
 *          Pangkat, or conciliation, in that order - as a draft (officials
 *          only) or scheduled, which makes the stage's KP notices for both
 *          parties at once. Refused on a VAWC case, on a case whose category
 *          no official has verified, and without an official's eligibility
 *          review - SafeComm records that review, it does not make the
 *          legal call.
 */

type Params = { params: Promise<{ id: string }> };

/** The parties a proceeding may name, from the case's own records - with the SafeComm account each is linked to. */
async function partiesOf(c: HearingCase) {
  const rows = await prisma.caseParty.findMany({
    where: { caseId: c.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, fullName: true, source: true, residentId: true, residentLinkedAt: true,
      resident: { select: { residentNumber: true, firstName: true, lastName: true } } },
  });
  const account = (r: (typeof rows)[number]) => (r.resident
    ? { residentNumber: r.resident.residentNumber, name: `${r.resident.firstName} ${r.resident.lastName}`.trim(), linkedAt: r.residentLinkedAt } : null);
  return {
    complainants: [
      { id: null as string | null, name: complainantName(c, null), label: 'The reporter (filed the case)', account: c.residentId ? { residentNumber: null, name: null, linkedAt: null, reporter: true } : null },
      ...rows.filter(r => r.role === 'AFFECTED').map(r => ({ id: r.id as string | null, name: r.fullName || 'Not named',
        label: `Person affected (${r.source === 'official' ? 'official record' : "reporter's account"})`, account: account(r) })),
    ],
    respondents: rows.filter(r => r.role === 'REPORTED').map(r => ({ id: r.id, name: r.fullName || 'Not named',
      label: `Person reported (${r.source === 'official' ? 'official record' : "reporter's account"})`, account: account(r) })),
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
        hearings: [], next: null, canEdit: false, blocked: VAWC_HEARING_REFUSAL, vawc: true, pangkat: null,
        eligibility: { eligible: false, reasons: [VAWC_HEARING_REFUSAL], warnings: [], categoryVerified: false, needsReview: false, review: null },
        parties: { complainants: [], respondents: [] }, officials: [],
      } });
    }
    const [hearings, eligibility, parties, officials, pangkat] = await Promise.all([
      prisma.caseHearing.findMany({
        where: { caseId: id }, orderBy: [{ hearingNumber: 'asc' }, { createdAt: 'asc' }],
        include: {
          notices: { orderBy: { generatedAt: 'asc' } },
          requests: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'asc' } },
          attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } },
          assignedOfficial: { select: { id: true, name: true } },
          ...hearingPartySelect,
        },
      }),
      eligibilityOf(g.c),
      partiesOf(g.c),
      presidingOfficials(),
      loadPangkat(id),
    ]);
    // Names for the history, read once. A resident is shown by their side, never by name.
    const ids = [...new Set([
      ...hearings.flatMap(h => [
        ...h.events.filter(e => e.actorType === 'official').map(e => e.actorId),
        ...h.notices.flatMap(n => [n.generatedById, n.issuedById, n.deliveryRecordedById]),
        ...h.requests.map(r => r.reviewedById), h.createdById, h.completedById, h.cancelledById,
      ]),
      ...(pangkat?.members ?? []).flatMap(m => [m.addedById, m.removedById]),
    ].filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const name = (uid: string | null | undefined) => (uid ? users.find(u => u.id === uid)?.name ?? 'Former official' : null);

    const step = nextStep(g.c.caseType, hearings, pangkatConstituted(pangkat));
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      case: { id, caseNumber: g.c.caseNumber, caseType: g.c.caseType, status: g.c.status, hasReporterAccount: Boolean(g.c.residentId) },
      hearings: hearings.map(h => {
        const accounts = partyAccounts(g.c, h);
        return {
          ...h,
          title: sessionTitle(h.stage, h.session),
          complainant: { partyId: h.complainantPartyId, name: complainantName(g.c, h.complainantParty), hasAccount: Boolean(accounts.COMPLAINANT) },
          respondent: { partyId: h.respondentPartyId, name: respondentName(h.respondentParty), hasAccount: Boolean(accounts.RESPONDENT) },
          createdBy: name(h.createdById), completedBy: name(h.completedById), cancelledBy: name(h.cancelledById),
          notices: h.notices.map(n => ({ ...n, formName: kpFormName(n.formNo), generatedBy: name(n.generatedById), issuedBy: name(n.issuedById), deliveryRecordedBy: name(n.deliveryRecordedById) })),
          requests: h.requests.map(r => ({ id: r.id, requesterRole: r.requesterRole, reason: r.reason, preferredSchedule: r.preferredSchedule, status: r.status, createdAt: r.createdAt,
            reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, reviewedBy: name(r.reviewedById) })),
          events: h.events.map(e => ({ id: e.id, kind: e.kind, actorType: e.actorType, before: e.before, after: e.after, note: e.note, createdAt: e.createdAt,
            by: e.actorType === 'official' ? name(e.actorId)
              : e.actorType === 'resident' ? `${e.actorId && e.actorId === accounts.RESPONDENT ? 'Respondent' : 'Complainant'} (SafeComm)` : 'SafeComm' })),
        };
      }),
      next: step.stage ? { stage: step.stage, session: step.session, label: KP_STAGES[step.stage].label, title: sessionTitle(step.stage, step.session),
        forms: partyFormsFor(step.stage).map(f => ({ ...f, name: kpFormName(f.formNo) })) } : null,
      canEdit: g.access.edit,
      accessMessage: g.access.message,
      // Why nothing can be created now, if so - shown instead of the button.
      blocked: step.refusal ?? (eligibility.eligible ? null : eligibility.reasons[0]),
      pangkat: pangkat ? { ...pangkat, members: pangkat.members.map(m => ({ ...m, addedBy: name(m.addedById), removedBy: name(m.removedById) })) } : null,
      eligibility, parties, officials,
    } });
  } catch {
    return errorResponse('The hearings could not be loaded right now.', 503);
  }
}

const idOrNull = z.string().trim().min(1).max(64).nullable().optional();
const postSchema = z.object({
  /** The stage the official means to create; it must be the case's next one. */
  stage: z.enum(KP_STAGE_KEYS).optional(),
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
    const [existing, pangkat] = await Promise.all([
      prisma.caseHearing.findMany({ where: { caseId: id }, select: { hearingNumber: true, stage: true, session: true, status: true, outcome: true } }),
      loadPangkat(id),
    ]);
    const step = nextStep(g.c.caseType, existing, pangkatConstituted(pangkat));
    if (step.stage === null) { await g.log('denied', 'hearing_refused'); return errorResponse(step.refusal, 422); }
    if (d.stage && d.stage !== step.stage) {
      await g.log('denied', 'hearing_refused');
      return errorResponse(`The next proceeding on this case is ${KP_STAGES[step.stage].label.toLowerCase()}, not ${KP_STAGES[d.stage].label.toLowerCase()}.`, 422);
    }
    const eligibility = await eligibilityOf(g.c);
    if (!eligibility.eligible) { await g.log('denied', 'not_eligible'); return noStore({ success: false, error: eligibility.reasons[0], eligibility }, 422); }
    const at = instantOf(d);
    if (!at) return errorResponse('Choose the hearing date and time', 400);
    const timeRefusal = scheduleTimeRefusal(at);
    if (timeRefusal) return errorResponse(timeRefusal, 400);
    const draft = d.asDraft === true;
    // The respondent is a record on this case. With only one person reported, it is that one.
    let respondentPartyId = d.respondentPartyId ?? null;
    if (!respondentPartyId) {
      const reported = await prisma.caseParty.findMany({ where: { caseId: id, role: 'REPORTED' }, select: { id: true }, take: 2 });
      if (reported.length === 1) respondentPartyId = reported[0].id;
      else if (!draft) {
        return errorResponse(reported.length
          ? 'Choose the respondent from the persons reported on this case.'
          : 'Record the respondent on the case first (Case Records - persons reported). The summons and notices are addressed to them.', 400);
      }
    }
    const people = await checkPeople(id, { ...d, respondentPartyId });
    if (people) return errorResponse(people, 400);
    const venue = d.venue || 'Barangay Hall';
    const officialId = d.assignedOfficialId ?? g.actor.id;
    // Another hearing with the same official or in the same venue at that time: say so, change nothing.
    const conflicts = await findConflicts(g.actor, { at, venue, officialId });
    if (conflicts.length && !d.confirmConflicts) return conflictResponse(conflicts);

    const by = await actorName(g.actor.id);
    const stage = step.stage, session = step.session;
    // The proceeding's place on the case; a cancelled one is replaced in its place.
    const hearingNumber = existing.filter(h => h.status !== 'CANCELLED').length + 1;
    const attempt = existing.filter(h => h.stage === stage && h.session === session).length + 1;
    const title = sessionTitle(stage, session);
    const hearing = await prisma.$transaction(async tx => {
      const h = await tx.caseHearing.create({
        data: {
          caseId: id, reference: hearingReference(g.c.caseNumber, stage, session, attempt), hearingNumber, stage, session,
          scheduledAt: at, venue, status: draft ? 'DRAFT' : 'SCHEDULED',
          activeKey: `${id}:${hearingNumber}`, openKey: id,
          assignedOfficialId: officialId,
          complainantPartyId: d.complainantPartyId ?? null, respondentPartyId,
          notes: d.notes || null, residentInstructions: d.residentInstructions || null,
          createdById: g.actor.id, updatedById: g.actor.id,
        },
        include: hearingPartySelect,
      });
      const e = await recordEvent(tx, { hearingId: h.id, caseId: id, kind: draft ? 'created' : 'scheduled', actorType: 'official', actorId: g.actor.id,
        after: { ...hearingSnap(h, h.scheduledAt, h.venue), ...(conflicts.length && { conflictsAccepted: conflicts.map(c => c.message) }) } });
      await hearingActivity(tx, e.id, id, g.actor.id, draft
        ? `${title} drafted by ${by} (not yet scheduled)`
        : `${title} scheduled for ${formatHearingWhen(h.scheduledAt)} at ${venue} by ${by}`);
      // One schedule, the stage's notices to both parties.
      const notices = draft ? [] : await issueStageNotices(tx, g.c, h, g.actor.id, by);
      if (h.assignedOfficialId && h.assignedOfficialId !== g.actor.id) {
        await tx.notification.create({ data: {
          title: `You are assigned to the ${title.toLowerCase()} on ${g.c.caseNumber}`,
          message: `${draft ? 'Drafted' : 'Scheduled'} for ${formatHearingWhen(h.scheduledAt)}. Open Hearing Management for the details.`,
          type: 'info', userId: h.assignedOfficialId, caseId: id,
        } });
      }
      return { ...h, notices };
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: hearing }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return errorResponse('This case already has an open proceeding or this one is already on record. Reload to see it.', 409);
    return errorResponse('The hearing could not be created right now.', 503);
  }
}
