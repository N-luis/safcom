import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { logRouteError } from '@/lib/hearingCasesServer';
import { isVawcType, victimFromIntake } from '@/lib/reportingStats';
import { victimSurvivorSchema, victimSurvivorData, victimRow } from '@/lib/victimSurvivors';

/**
 * The victim-survivors of a VAWC case, for the women-and-children statistics -
 * VAWC personnel with access to the case only (the same gate as the case's
 * other records; a VAWC case outside the role does not exist).
 *
 *   GET  - the recorded victim-survivors (removed ones with who and why), and
 *          what the completed VAWC intake form says, to copy from.
 *   POST - record one: sex at birth, birthdate or age at the incident, and the
 *          VAWC client code. No name is kept here.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'victim_survivors');
  if ('error' in g) return g.error;
  try {
    const c = await prisma.case.findUnique({ where: { id }, select: { caseType: true, officialIntake: { select: { formType: true, status: true, responses: true } } } });
    if (!c || !isVawcType(c.caseType)) return errorResponse('Victim-survivors are recorded on VAWC cases only.', 409);
    const rows = await prisma.caseVictimSurvivor.findMany({ where: { caseId: id }, orderBy: { createdAt: 'asc' } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => [r.recordedById, r.removedById]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
    const nameOf = (uid: string | null) => (uid && users.find(u => u.id === uid)?.name) || null;
    const intake = c.officialIntake?.formType === 'VAWC_INTAKE' && c.officialIntake.status === 'COMPLETED' ? victimFromIntake(id, c.officialIntake.responses) : null;
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      canEdit: g.access.edit,
      victims: rows.map(r => ({ ...victimRow(r), recordedBy: nameOf(r.recordedById), removedBy: nameOf(r.removedById) })),
      // While nothing is recorded here, the statistics use this person.
      fromIntake: intake ? { sexAtBirth: intake.sexAtBirth, birthDate: intake.birthDate?.toISOString().slice(0, 10) ?? null, clientCode: intake.clientCode } : null,
    } });
  } catch (e) {
    logRouteError('GET /api/cases/[id]/victim-survivors', e);
    return errorResponse('The victim-survivors could not be loaded right now.', 503);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'victim_survivors');
  if ('error' in g) return g.error;
  const parsed = victimSurvivorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  try {
    const c = await prisma.case.findUnique({ where: { id }, select: { caseType: true } });
    if (!c || !isVawcType(c.caseType)) return errorResponse('Victim-survivors are recorded on VAWC cases only.', 409);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const row = await prisma.$transaction(async tx => {
      const r = await tx.caseVictimSurvivor.create({ data: { caseId: id, ...victimSurvivorData(parsed.data), source: parsed.data.source, recordedById: g.actor.id } });
      await tx.activity.create({ data: { type: 'case_records', message: `A victim-survivor was recorded for the statistics by ${me?.name ?? 'an official'}`,
        entityId: id, entityType: 'Case', userId: g.actor.id, caseId: id, color: '#7c3aed' } });
      return r;
    });
    await g.log('permitted', `${g.access.code}:victim_add`);
    return noStore({ success: true, data: victimRow(row) }, 201);
  } catch (e) {
    logRouteError('POST /api/cases/[id]/victim-survivors', e);
    return errorResponse('The victim-survivor could not be saved right now. Nothing was changed.', 503);
  }
}
