import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { errorResponse } from '@/lib/auth';
import { KP_FORM_IDS } from '@/lib/kpForms/forms';
import { gateKp, kpCase, kpPrefill, noStore, recordRow } from '@/lib/kpForms/server';
import { kpData } from '@/lib/kpForms/schema';

export const dynamic = 'force-dynamic';

/**
 * KP Forms on one walk-in report.
 *   GET  ?caseId=   what the forms are prefilled with, and the forms saved on it
 *   POST            save a new one: { caseId, formType, data }
 */
export async function GET(req: NextRequest) {
  const g = await gateKp(req);
  if ('error' in g) return g.error;
  const caseId = req.nextUrl.searchParams.get('caseId')?.trim() ?? '';
  if (!caseId) return errorResponse('Choose a walk-in report', 400);
  try {
    const k = await kpCase(g.actor, caseId);
    if ('error' in k) return k.error;
    const [prefill, records] = await Promise.all([
      kpPrefill(k.c),
      prisma.kpFormRecord.findMany({ where: { walkInReportId: k.c.id }, orderBy: { updatedAt: 'desc' },
        select: { id: true, formType: true, caseNo: true, createdAt: true, updatedAt: true, createdById: true } }),
    ]);
    return noStore({ success: true, data: { case: { id: k.c.id, caseNumber: k.c.caseNumber, caseType: k.c.caseType }, prefill, records: records.map(recordRow) } });
  } catch (e) {
    console.error('[KP forms]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The KP forms could not be loaded right now.', 503);
  }
}

const createSchema = z.object({ caseId: z.string().min(1).max(64), formType: z.enum(KP_FORM_IDS), data: kpData });

export async function POST(req: NextRequest) {
  const g = await gateKp(req);
  if ('error' in g) return g.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the form', 400);
  const d = parsed.data;
  try {
    const k = await kpCase(g.actor, d.caseId);
    if ('error' in k) return k.error;
    const r = await prisma.kpFormRecord.create({ data: {
      walkInReportId: k.c.id, formType: d.formType, caseNo: d.data.shared.caseNo.trim() || null, data: d.data as Prisma.InputJsonValue,
      createdById: g.actor.id, updatedById: g.actor.id,
    } });
    return noStore({ success: true, data: recordRow(r) }, 201);
  } catch (e) {
    console.error('[KP forms save]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The form could not be saved right now. Nothing was changed.', 503);
  }
}
