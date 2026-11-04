import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import {
  decideIntakeAccess, loadIntakeCase, intakeContext, startingAnswers, validateResponses, canonical, changedKeys,
  logIntakeAccess, type IntakeCase,
} from '@/lib/officialIntake';
import { type Responses } from '@/lib/officialIntakeForm';
import { formForType, formTypeForCase, missingIn, upgradeResponses, type FormDef } from '@/lib/intakeForms';
import { loadHearingCase, eligibilityOf } from '@/lib/hearingsServer';

/** The form this case's intake is - the stored one, or its desk's for a new one. */
const formOf = (c: IntakeCase): FormDef => formForType(c.officialIntake?.formType ?? formTypeForCase(c.caseType));

/**
 * The official intake for one case.
 *
 *   GET  - the first section (case and reporter, from the records), and the
 *          intake if one exists. Every look is logged.
 *   POST - start the intake. If one exists, it is returned - never a second.
 *   PUT  - save: a draft, a completion, or an edit of a completed intake.
 *          The save names the version it edited; a repeated or stale save is
 *          refused (409) or recognised as no change, never stored twice.
 *          `autosave: true` is the form saving a draft by itself while the
 *          official types: it keeps the draft current, and a revision is kept
 *          at most every AUTOSAVE_CHECKPOINT_MINUTES per official, so the
 *          history stays readable. A completion or an edit of a completed
 *          intake is never an autosave, and always keeps its revision.
 *          Every save is written to the audit log (without its answers).
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
  const decided = decideIntakeAccess(actor, c);
  // Intake records are kept by the desk officers and the captain: a system
  // administrator may read one, never record on it.
  const access = actor.role === 'system_admin' && decided.edit
    ? { ...decided, edit: false, message: 'System administrators can view intake records. Recording them is for the barangay officials.' }
    : decided;
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
    id: i.id, status: i.status, version: i.version, formVersion: i.formVersion, formType: formOf(c).type,
    // Read in the current form's shape; what is stored is not rewritten.
    responses: upgradeResponses(formOf(c), i.responses as Responses), prefilled: (i.prefilled ?? {}) as Record<string, string>,
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
    // On a blotter intake: whether KP Form No. 7 may be produced, and why not.
    let kp: { eligible: boolean; reasons: string[] } | null = null;
    if (formOf(g.c).type === 'BLOTTER_REPORT') {
      const hc = await loadHearingCase(id);
      const e = hc ? await eligibilityOf(hc) : null;
      kp = { eligible: Boolean(e?.eligible), reasons: e?.reasons ?? [] };
    }
    return noStore({ success: true, data: {
      access: { view: g.access.view, edit: g.access.edit, message: g.access.message },
      context: intakeContext(g.c), intake: await shape(g.c), formVersion: formOf(g.c).version, formType: formOf(g.c).type, kp,
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
    const def = formOf(g.c);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const { responses, prefilled } = startingAnswers(g.c, { role: g.actor.role, name: me?.name ?? null }, def);
    try {
      await prisma.$transaction(async tx => {
        const intake = await tx.officialIntake.create({ data: {
          caseId: g.c.id, residentId: g.c.reporterIdentityWithheld ? null : g.c.residentId, status: 'DRAFT', version: 1,
          formVersion: def.version, formType: def.type, responses: JSON.parse(JSON.stringify(responses)), prefilled,
          startedById: g.actor.id, updatedById: g.actor.id,
        } });
        await tx.officialIntakeRevision.create({ data: {
          intakeId: intake.id, version: 1, status: 'DRAFT', responses: JSON.parse(JSON.stringify(responses)),
          changedKeys: Object.keys(responses), changedById: g.actor.id,
        } });
        await tx.activity.create({ data: {
          type: 'intake', message: `${def.title} started (draft) by ${me?.name ?? 'an official'}`,
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
  autosave: z.boolean().optional(),
});

/** How often an autosaved draft keeps a revision, per official. */
const AUTOSAVE_CHECKPOINT_MINUTES = 10;

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

  const def = formOf(g.c);
  const valid = validateResponses(parsed.data.responses && typeof parsed.data.responses === 'object' && !Array.isArray(parsed.data.responses)
    ? upgradeResponses(def, parsed.data.responses as Responses) : parsed.data.responses, def);
  if (!valid.ok) return errorResponse(valid.error, 400);
  const responses = valid.responses;
  const status = parsed.data.status;
  const autosave = parsed.data.autosave === true;
  if (autosave && (status !== 'DRAFT' || current.status !== 'DRAFT')) {
    return errorResponse('Only a draft is saved automatically; save a completed intake as an update', 422);
  }
  if (current.status === 'COMPLETED' && status === 'DRAFT') {
    return errorResponse('A completed intake stays completed; save your edits as an update', 422);
  }
  if (status === 'COMPLETED') {
    const missing = missingIn(def, responses);
    if (missing.length) {
      return noStore({ success: false, error: 'Some items still need an answer, or N/A, Unknown or Declined',
        missing: missing.map(m => ({ key: m.key, no: m.no ?? null, label: m.label })) }, 422);
    }
  }
  // The same save again - a double click, a retried request: nothing new.
  const stored = upgradeResponses(def, current.responses as Responses);
  if (status === current.status && canonical(responses) === canonical(stored)) {
    return noStore({ success: true, data: { intake: await shape(g.c), unchanged: true } });
  }
  if (parsed.data.expectedVersion !== current.version) {
    return noStore({ success: false, error: 'This intake was saved elsewhere since you opened it. Reload to see the latest version - your changes are still on this page.',
      code: 'version_conflict', currentVersion: current.version }, 409);
  }

  try {
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    // An autosave joins the official's recent draft revision instead of adding
    // one per pause in typing; the next kept revision lists everything changed
    // since the last one kept.
    const lastRevision = await prisma.officialIntakeRevision.findFirst({
      where: { intakeId: current.id }, orderBy: { version: 'desc' }, select: { status: true, changedById: true, createdAt: true, responses: true },
    });
    const recentOwnDraft = Boolean(lastRevision && lastRevision.status === 'DRAFT' && lastRevision.changedById === g.actor.id
      && Date.now() - lastRevision.createdAt.getTime() < AUTOSAVE_CHECKPOINT_MINUTES * 60_000);
    const keepRevision = !(autosave && recentOwnDraft);
    const changed = changedKeys(upgradeResponses(def, (lastRevision?.responses ?? current.responses) as Responses), responses, def);
    const completing = status === 'COMPLETED' && current.status !== 'COMPLETED';
    const editingCompleted = current.status === 'COMPLETED';
    const dangerNow = responses.immediateDanger?.value === 'yes' && g.c.triageStatus !== 'URGENT_REVIEW';
    const next = current.version + 1;
    await prisma.$transaction(async tx => {
      // Only if still at the version this save was based on.
      const updated = await tx.officialIntake.updateMany({
        where: { id: current.id, version: parsed.data.expectedVersion },
        data: {
          // Saved now in this version of the form.
          responses: JSON.parse(JSON.stringify(responses)), status, version: next, updatedById: g.actor.id, formVersion: def.version,
          ...(completing && { completedById: g.actor.id, completedAt: new Date() }),
        },
      });
      if (updated.count === 0) throw new Error('version_conflict');
      if (keepRevision) {
        await tx.officialIntakeRevision.create({ data: {
          intakeId: current.id, version: next, status, responses: JSON.parse(JSON.stringify(responses)), changedKeys: changed, changedById: g.actor.id,
        } });
      }
      if (completing || editingCompleted) {
        await tx.activity.create({ data: {
          type: 'intake',
          message: completing ? `${def.title} completed by ${me?.name ?? 'an official'}` : `${def.title} updated by ${me?.name ?? 'an official'} (version ${next}, ${changed.length} item${changed.length === 1 ? '' : 's'} changed)`,
          entityId: current.id, entityType: 'OfficialIntake', userId: g.actor.id, caseId: g.c.id, color: completing ? '#16a34a' : '#0ea5e9',
        } });
      }
      // Danger disclosed during the interview: the urgent workflow, now -
      // not when the form is finished. Recorded and raised to the desks.
      if (dangerNow) {
        await tx.case.update({ where: { id: g.c.id }, data: { triageStatus: 'URGENT_REVIEW', requiresOfficerReview: true } });
        await tx.activity.create({ data: {
          type: 'intake', message: `Immediate danger recorded on the ${def.title} - flagged for urgent review by ${me?.name ?? 'an official'}`,
          entityId: current.id, entityType: 'OfficialIntake', userId: g.actor.id, caseId: g.c.id, color: '#dc2626',
        } });
        await tx.notification.create({ data: {
          title: `Urgent: danger recorded on the ${def.title} for ${g.c.caseNumber}`,
          message: 'An official recorded during the intake interview that someone is in immediate danger. Open the case now.',
          type: 'error', userId: null, caseId: g.c.id,
        } });
      }
    });
    // Who saved what kind of save, and when - never the answers.
    await g.log('permitted', completing ? 'save:complete' : editingCompleted ? 'save:update' : autosave ? 'save:autosave' : 'save:draft');
    const fresh = await loadIntakeCase(id);
    return noStore({ success: true, data: { intake: fresh ? await shape(fresh) : null, flaggedUrgent: dangerNow, revisionKept: keepRevision } });
  } catch (e) {
    if (e instanceof Error && e.message === 'version_conflict') {
      return noStore({ success: false, error: 'This intake was saved elsewhere at the same moment. Reload to see the latest version.', code: 'version_conflict' }, 409);
    }
    return errorResponse('The intake could not be saved right now. Your answers are still on this page - try again.', 503);
  }
}
