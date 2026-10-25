import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import {
  decideIntakeAccess, loadIntakeCase, intakeContext, startingAnswers, validateResponses, canonical, changedKeys,
  logIntakeAccess, INTAKE_FORM_VERSION, type IntakeCase,
} from '@/lib/officialIntake';
import { missingForCompletion, type Responses } from '@/lib/officialIntakeForm';

/**
 * The official intake for one case.
 *
 *   GET  - the first section (case and reporter, from the records), and the
 *          intake if one exists. Every look is logged.
 *   POST - start the intake. If one exists, it is returned - never a second.
 *   PUT  - save: a draft, a completion, or an edit of a completed intake.
 *          The save names the version it edited; a repeated or stale save is
 *          refused (409) or recognised as no change, never stored twice.
 *
 * Every request re-reads the official's account and the case, so a case
 * reassigned while the form is open stops the next save. Nothing here calls
 * the AI: an intake saves whether or not Groq is reachable. The original
 * report is never changed.
 */

const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

async function gate(req: NextRequest, id: string, need: 'view' | 'edit') {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor) return { error: errorResponse('Unauthorized', 401) };
  let c: IntakeCase | null;
  try {
    c = await loadIntakeCase(id);
  } catch {
    return { error: errorResponse('The case could not be loaded right now. Nothing was changed.', 503) };
  }
  const log = (outcome: 'permitted' | 'denied', code: string) =>
    logIntakeAccess({ actorId: actor.id, actorRole: actor.role, caseId: id, caseNumber: c?.caseNumber, outcome, code }).catch(() => {});
  if (!c) { await log('denied', 'not_found'); return { error: errorResponse('Case not found', 404) }; }
  const access = decideIntakeAccess(actor, c);
  if (access.hidden) { await log('denied', access.code); return { error: errorResponse('Case not found', 404) }; }
  if (!access.view || (need === 'edit' && !access.edit)) {
    await log('denied', access.code);
    return { error: noStore({ success: false, error: access.message ?? 'Not permitted', code: access.code, canClaim: access.canClaim }, 403) };
  }
  return { actor, c, access, log };
}

async function shape(c: IntakeCase) {
  const i = c.officialIntake;
  if (!i) return null;
  const revisions = await prisma.officialIntakeRevision.findMany({
    where: { intakeId: i.id }, orderBy: { version: 'desc' }, take: 20,
    select: { version: true, status: true, changedKeys: true, changedById: true, createdAt: true },
  });
  const ids = [...new Set([i.startedById, i.updatedById, i.completedById, ...revisions.map(r => r.changedById)].filter((x): x is string => Boolean(x)))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (uid: string | null) => (uid && users.find(u => u.id === uid)?.name) || null;
  return {
    id: i.id, status: i.status, version: i.version, formVersion: i.formVersion,
    responses: i.responses as Responses, prefilled: (i.prefilled ?? {}) as Record<string, string>,
    startedBy: name(i.startedById), updatedBy: name(i.updatedById), completedBy: name(i.completedById),
    completedAt: i.completedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
    revisions: revisions.map(r => ({ version: r.version, status: r.status, changedItems: r.changedKeys.length, by: name(r.changedById), at: r.createdAt.toISOString() })),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id, 'view');
  if ('error' in g) return g.error;
  try {
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      access: { view: g.access.view, edit: g.access.edit, message: g.access.message },
      context: intakeContext(g.c), intake: await shape(g.c), formVersion: INTAKE_FORM_VERSION,
    } });
  } catch {
    return errorResponse('The intake could not be loaded right now.', 503);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id, 'edit');
  if ('error' in g) return g.error;
  try {
    if (g.c.officialIntake) return noStore({ success: true, data: { intake: await shape(g.c), created: false } });
    const { responses, prefilled } = startingAnswers(g.c, g.actor);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    try {
      await prisma.$transaction(async tx => {
        const intake = await tx.officialIntake.create({ data: {
          caseId: g.c.id, residentId: g.c.reporterIdentityWithheld ? null : g.c.residentId, status: 'DRAFT', version: 1,
          formVersion: INTAKE_FORM_VERSION, responses: JSON.parse(JSON.stringify(responses)), prefilled,
          startedById: g.actor.id, updatedById: g.actor.id,
        } });
        await tx.officialIntakeRevision.create({ data: {
          intakeId: intake.id, version: 1, status: 'DRAFT', responses: JSON.parse(JSON.stringify(responses)),
          changedKeys: Object.keys(responses), changedById: g.actor.id,
        } });
        await tx.activity.create({ data: {
          type: 'intake', message: `Intake started (draft) by ${me?.name ?? 'an official'}`,
          entityId: intake.id, entityType: 'OfficialIntake', userId: g.actor.id, caseId: g.c.id, color: '#0ea5e9',
        } });
      });
    } catch (e) {
      // Two "Start" clicks at once: the unique case id lets only one through,
      // and the other is given the intake that now exists.
      if (!(e instanceof Error && /Unique constraint|P2002/.test(e.message))) throw e;
    }
    const fresh = await loadIntakeCase(id);
    return noStore({ success: true, data: { intake: fresh ? await shape(fresh) : null, created: true } }, 201);
  } catch {
    return errorResponse('The intake could not be started right now. Nothing was saved.', 503);
  }
}

const saveSchema = z.object({
  expectedVersion: z.number().int().min(1),
  status: z.enum(['DRAFT', 'COMPLETED']),
  responses: z.unknown(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid request', 400); }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
  const g = await gate(req, id, 'edit');
  if ('error' in g) return g.error;
  const current = g.c.officialIntake;
  if (!current) return errorResponse('Start the intake first', 409);

  const valid = validateResponses(parsed.data.responses);
  if (!valid.ok) return errorResponse(valid.error, 400);
  const responses = valid.responses;
  const status = parsed.data.status;
  if (current.status === 'COMPLETED' && status === 'DRAFT') {
    return errorResponse('A completed intake stays completed; save your edits as an update', 422);
  }
  if (status === 'COMPLETED') {
    const missing = missingForCompletion(responses);
    if (missing.length) {
      return noStore({ success: false, error: 'Some items still need an answer, or N/A, Unknown or Declined',
        missing: missing.map(m => ({ key: m.key, no: m.no ?? null, label: m.label })) }, 422);
    }
  }
  // The same save again - a double click, a retried request: nothing new.
  if (status === current.status && canonical(responses) === canonical(current.responses as Responses)) {
    return noStore({ success: true, data: { intake: await shape(g.c), unchanged: true } });
  }
  if (parsed.data.expectedVersion !== current.version) {
    return noStore({ success: false, error: 'This intake was saved elsewhere since you opened it. Reload to see the latest version - your changes are still on this page.',
      code: 'version_conflict', currentVersion: current.version }, 409);
  }

  try {
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const changed = changedKeys(current.responses as Responses, responses);
    const completing = status === 'COMPLETED' && current.status !== 'COMPLETED';
    const editingCompleted = current.status === 'COMPLETED';
    const dangerNow = responses.immediateDanger?.value === 'yes' && g.c.triageStatus !== 'URGENT_REVIEW';
    const next = current.version + 1;
    await prisma.$transaction(async tx => {
      // Only if still at the version this save was based on.
      const updated = await tx.officialIntake.updateMany({
        where: { id: current.id, version: parsed.data.expectedVersion },
        data: {
          responses: JSON.parse(JSON.stringify(responses)), status, version: next, updatedById: g.actor.id,
          ...(completing && { completedById: g.actor.id, completedAt: new Date() }),
        },
      });
      if (updated.count === 0) throw new Error('version_conflict');
      await tx.officialIntakeRevision.create({ data: {
        intakeId: current.id, version: next, status, responses: JSON.parse(JSON.stringify(responses)), changedKeys: changed, changedById: g.actor.id,
      } });
      if (completing || editingCompleted) {
        await tx.activity.create({ data: {
          type: 'intake',
          message: completing ? `Intake completed by ${me?.name ?? 'an official'}` : `Intake updated by ${me?.name ?? 'an official'} (version ${next}, ${changed.length} item${changed.length === 1 ? '' : 's'} changed)`,
          entityId: current.id, entityType: 'OfficialIntake', userId: g.actor.id, caseId: g.c.id, color: completing ? '#16a34a' : '#0ea5e9',
        } });
      }
      // Danger disclosed during the interview: the urgent workflow, now -
      // not when the form is finished. Recorded and raised to the desks.
      if (dangerNow) {
        await tx.case.update({ where: { id: g.c.id }, data: { triageStatus: 'URGENT_REVIEW', requiresOfficerReview: true } });
        await tx.activity.create({ data: {
          type: 'intake', message: `Immediate danger disclosed during intake - flagged for urgent review by ${me?.name ?? 'an official'}`,
          entityId: current.id, entityType: 'OfficialIntake', userId: g.actor.id, caseId: g.c.id, color: '#dc2626',
        } });
        await tx.notification.create({ data: {
          title: `Urgent: danger disclosed during intake for ${g.c.caseNumber}`,
          message: 'An official recorded during the intake interview that someone is in immediate danger. Open the case now.',
          type: 'error', userId: null, caseId: g.c.id,
        } });
      }
    });
    const fresh = await loadIntakeCase(id);
    return noStore({ success: true, data: { intake: fresh ? await shape(fresh) : null, flaggedUrgent: dangerNow } });
  } catch (e) {
    if (e instanceof Error && e.message === 'version_conflict') {
      return noStore({ success: false, error: 'This intake was saved elsewhere at the same moment. Reload to see the latest version.', code: 'version_conflict' }, 409);
    }
    return errorResponse('The intake could not be saved right now. Your answers are still on this page - try again.', 503);
  }
}
