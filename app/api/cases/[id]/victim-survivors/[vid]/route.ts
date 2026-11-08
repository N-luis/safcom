import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { logRouteError } from '@/lib/hearingCasesServer';
import { victimSurvivorSchema, victimSurvivorData, victimRow } from '@/lib/victimSurvivors';

/**
 *   PATCH  - correct a victim-survivor record.
 *   DELETE { reason } - mark a mistaken record removed: kept, with who, when
 *            and why, and left out of the statistics from then on.
 * The officer the VAWC case is assigned to, as for its other records.
 */

type Params = { params: Promise<{ id: string; vid: string }> };

async function rowOf(caseId: string, vid: string) {
  const r = await prisma.caseVictimSurvivor.findUnique({ where: { id: vid } });
  return r && r.caseId === caseId ? r : null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, vid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'victim_survivors');
  if ('error' in g) return g.error;
  const parsed = victimSurvivorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the details', 400);
  try {
    const r = await rowOf(id, vid);
    if (!r) return errorResponse('Not found', 404);
    if (r.removedAt) return errorResponse('This record was removed. Record the person again instead.', 409);
    const row = await prisma.caseVictimSurvivor.update({ where: { id: vid }, data: victimSurvivorData(parsed.data) });
    await g.log('permitted', `${g.access.code}:victim_edit`);
    return noStore({ success: true, data: victimRow(row) });
  } catch (e) {
    logRouteError('PATCH /api/cases/[id]/victim-survivors/[vid]', e);
    return errorResponse('The record could not be saved right now. Nothing was changed.', 503);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, vid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'victim_survivors');
  if ('error' in g) return g.error;
  const parsed = z.object({ reason: z.string().trim().min(3, 'Say why the record is removed').max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Say why the record is removed', 400);
  try {
    const r = await rowOf(id, vid);
    if (!r) return errorResponse('Not found', 404);
    if (r.removedAt) return noStore({ success: true, unchanged: true });
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    await prisma.$transaction([
      prisma.caseVictimSurvivor.update({ where: { id: vid }, data: { removedAt: new Date(), removedById: g.actor.id, removedReason: parsed.data.reason } }),
      prisma.activity.create({ data: { type: 'case_records', message: `A victim-survivor record was removed by ${me?.name ?? 'an official'}`,
        entityId: id, entityType: 'Case', userId: g.actor.id, caseId: id, color: '#64748b' } }),
    ]);
    await g.log('permitted', `${g.access.code}:victim_remove`);
    return noStore({ success: true });
  } catch (e) {
    logRouteError('DELETE /api/cases/[id]/victim-survivors/[vid]', e);
    return errorResponse('The record could not be removed right now.', 503);
  }
}
