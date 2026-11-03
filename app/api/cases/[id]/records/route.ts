import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { affectedPartySchema, reportedPartySchema, caseNumberLabel, hasPartyDetails, pathOfType } from '@/lib/caseRecords';

/**
 * A case's records beside the narrative - officials only.
 *
 *   GET - the report details (form, channel, when, witnesses), the person
 *         affected and the person reported, the safety assessment with its
 *         earlier versions, and the referrals. Every look is logged.
 *   PUT - an official's record of the person affected or the person
 *         reported. The reporter's own record is kept as they gave it; the
 *         official's sits beside it, so nothing the reporter said is lost.
 *
 * Residents never reach this: it is a staff route, and the resident API
 * returns none of it.
 */

type Params = { params: Promise<{ id: string }> };

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return (id: string | null | undefined) => (id && users.find(u => u.id === id)?.name) || null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'case_records');
  if ('error' in g) return g.error;
  try {
    const [parties, safety, safetyHistory, referrals] = await Promise.all([
      prisma.caseParty.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.caseSafetyAssessment.findUnique({ where: { caseId: id } }),
      prisma.assessmentHistory.findMany({
        where: { caseId: id, kind: 'safety_assessment' }, orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, rationale: true, reason: true, actorId: true, createdAt: true },
      }),
      prisma.caseReferral.findMany({ where: { caseId: id }, orderBy: { referredAt: 'desc' } }),
    ]);
    const name = await names([...parties.map(p => p.updatedById), safety?.updatedById, ...safetyHistory.map(h => h.actorId), ...referrals.map(r => r.createdById), g.c.resolvedById]);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      access: { view: g.access.view, edit: g.access.edit, message: g.access.edit ? null : g.access.message },
      report: {
        caseNumber: g.c.caseNumber, caseNumberLabel: caseNumberLabel(g.c.caseType), desk: pathOfType(g.c.caseType),
        reportPath: g.c.reportPath, reportingChannel: g.c.reportingChannel,
        incidentDate: g.c.incidentDate ? g.c.incidentDate.toISOString().slice(0, 10) : null,
        incidentTimeApprox: g.c.incidentTimeApprox, witnessInfo: g.c.witnessInfo, filedAt: g.c.filedAt,
        reportingRelationship: g.c.reportingRelationship, affectedPersonNote: g.c.affectedPersonNote,
        resolution: g.c.resolutionType ? {
          type: g.c.resolutionType, summary: g.c.resolutionSummary, at: g.c.resolvedAt, by: name(g.c.resolvedById),
        } : null,
      },
      parties: parties.map(p => ({ ...p, updatedBy: name(p.updatedById) })),
      safety: safety ? { ...safety, updatedBy: name(safety.updatedById) } : null,
      safetyHistory: safetyHistory.map(h => ({ id: h.id, snapshot: h.rationale, by: name(h.actorId), at: h.createdAt })),
      referrals: referrals.map(r => ({ ...r, createdBy: name(r.createdById) })),
    } });
  } catch {
    return errorResponse('The records could not be loaded right now.', 503);
  }
}

const putSchema = z.object({
  role: z.enum(['AFFECTED', 'REPORTED']),
  party: z.record(z.string(), z.unknown()),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'parties');
  if ('error' in g) return g.error;
  try {
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorResponse('Say whose details these are', 400);
    const one = (parsed.data.role === 'AFFECTED' ? affectedPartySchema : reportedPartySchema).safeParse(parsed.data.party);
    if (!one.success) return errorResponse(one.error.issues[0]?.message ?? 'Check the details', 400);
    if (!hasPartyDetails(one.data)) return errorResponse('Enter at least one detail, or leave this person as reported', 400);

    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const role = parsed.data.role;
    // Every field set explicitly, so clearing one clears it. Contact and
    // dependents are asked about the person affected only.
    const p = one.data as { fullName?: string; age?: number; address?: string; relationship?: string; details?: string;
      contactNumber?: string; dependentsAffected?: string };
    const data = {
      fullName: p.fullName ?? null, age: p.age ?? null, address: p.address ?? null,
      relationship: p.relationship ?? null, details: p.details ?? null,
      contactNumber: role === 'AFFECTED' ? p.contactNumber ?? null : null,
      dependentsAffected: role === 'AFFECTED' ? p.dependentsAffected ?? null : null,
      updatedById: g.actor.id,
    };
    await prisma.$transaction(async tx => {
      const existing = await tx.caseParty.findFirst({ where: { caseId: id, role, source: 'official' } });
      if (existing) await tx.caseParty.update({ where: { id: existing.id }, data });
      else await tx.caseParty.create({ data: { ...data, caseId: id, role, source: 'official' } });
      await tx.activity.create({ data: {
        type: 'case_records',
        message: `${role === 'AFFECTED' ? 'Person affected' : 'Person reported'} details recorded by ${me?.name ?? 'an official'}`,
        entityId: id, entityType: 'Case', userId: g.actor.id, caseId: id, color: '#475569',
      } });
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true });
  } catch {
    return errorResponse('The details could not be saved right now. They are still on your screen - try again.', 503);
  }
}
