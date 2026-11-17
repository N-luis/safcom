import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { errorResponse } from '@/lib/auth';
import { gateKp, kpCase, noStore, recordRow } from '@/lib/kpForms/server';
import { kpData } from '@/lib/kpForms/schema';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The record and its walk-in report, if this official may see them. */
async function load(req: NextRequest, id: string) {
  const g = await gateKp(req);
  if ('error' in g) return g;
  const r = await prisma.kpFormRecord.findUnique({ where: { id: id.slice(0, 64) } });
  if (!r) return { error: errorResponse('Form not found', 404) };
  const k = await kpCase(g.actor, r.walkInReportId);
  if ('error' in k) return k;
  return { actor: g.actor, r };
}

/** One saved form, to reopen it. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    return noStore({ success: true, data: { ...recordRow(l.r), walkInReportId: l.r.walkInReportId, data: l.r.data } });
  } catch (e) {
    console.error('[KP form]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The form could not be loaded right now.', 503);
  }
}

const updateSchema = z.object({ data: kpData });

/** Save changes to a form already saved (its report and form number never change). */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the form', 400);
  try {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    const r = await prisma.kpFormRecord.update({ where: { id: l.r.id }, data: {
      data: parsed.data.data as Prisma.InputJsonValue, caseNo: parsed.data.data.shared.caseNo.trim() || null, updatedById: l.actor.id,
    } });
    return noStore({ success: true, data: recordRow(r) });
  } catch (e) {
    console.error('[KP form update]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The form could not be saved right now. Nothing was changed.', 503);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    await prisma.kpFormRecord.delete({ where: { id: l.r.id } });
    return noStore({ success: true });
  } catch (e) {
    console.error('[KP form delete]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The form could not be deleted right now.', 503);
  }
}
