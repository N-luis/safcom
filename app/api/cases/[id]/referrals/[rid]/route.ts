import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { referralUpdateSchema, REFERRAL_STATUSES, pathOfType } from '@/lib/caseRecords';
import { referralFormSchema, formOf } from '@/lib/referralForm';

/**
 * GET - one referral with its referral form, for the live form editor. The
 * officials who may see the case's records; the referral must belong to this case.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateCaseRecords(req, id, 'view', 'referral_form');
  if ('error' in g) return g.error;
  try {
    const r = await prisma.caseReferral.findUnique({ where: { id: rid } });
    if (!r || r.caseId !== id) { await g.log('denied', 'referral_not_found'); return errorResponse('Referral not found', 404); }
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: {
      referral: { id: r.id, agency: r.agency, agencyOther: r.agencyOther, referredAt: r.referredAt.toISOString(), reason: r.reason, form: formOf(r) },
      caseNumber: g.c.caseNumber, desk: pathOfType(g.c.caseType), access: { edit: g.access.edit, message: g.access.message },
    } });
  } catch {
    return errorResponse('The referral could not be loaded right now.', 503);
  }
}

/** Update a referral's status or notes - officer-only. The referral must belong to this case. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'referrals');
  if ('error' in g) return g.error;
  const parsed = referralUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the update', 400);

  try {
    const existing = await prisma.caseReferral.findUnique({ where: { id: rid } });
    // Another case's referral, reached through this case's id: not found.
    if (!existing || existing.caseId !== id) return errorResponse('Referral not found', 404);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const updated = await prisma.$transaction(async tx => {
      const r = await tx.caseReferral.update({ where: { id: rid }, data: { status: parsed.data.status, notes: parsed.data.notes ?? existing.notes } });
      if (existing.status !== parsed.data.status) {
        await tx.activity.create({ data: {
          type: 'referral', message: `Referral marked ${REFERRAL_STATUSES[parsed.data.status].toLowerCase()} by ${me?.name ?? 'an official'}`,
          entityId: rid, entityType: 'CaseReferral', userId: g.actor.id, caseId: id, color: '#7c3aed',
        } });
      }
      return r;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: updated });
  } catch {
    return errorResponse('The referral could not be updated right now.', 503);
  }
}

/**
 * PUT { form, reason? } - fill in or correct the referral's Annex B form (a referral
 * recorded before the form existed, or a detail to fix). Officer-only; the
 * referral must belong to this case. Who changed it, and when, is kept.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'referrals');
  if ('error' in g) return g.error;
  const body = await req.json().catch(() => null) as { form?: unknown; reason?: unknown } | null;
  const parsed = referralFormSchema.safeParse(body?.form ?? null);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the referral form', 400);
  // The form's "Reason/s for Referral" is the referral's own reason.
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : undefined;
  if (typeof body?.reason === 'string' && body.reason.trim().length > 500) return errorResponse('Keep the reason under 500 characters', 400);
  try {
    const existing = await prisma.caseReferral.findUnique({ where: { id: rid }, select: { caseId: true } });
    if (!existing || existing.caseId !== id) return errorResponse('Referral not found', 404);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const updated = await prisma.$transaction(async tx => {
      const r = await tx.caseReferral.update({ where: { id: rid }, data: { ...parsed.data, ...(reason !== undefined ? { reason: reason || null } : {}), formUpdatedAt: new Date(), formUpdatedById: g.actor.id } });
      await tx.activity.create({ data: { type: 'referral', message: `Referral form updated by ${me?.name ?? 'an official'}`,
        entityId: rid, entityType: 'CaseReferral', userId: g.actor.id, caseId: id, color: '#7c3aed' } });
      return r;
    });
    await g.log('permitted', `${g.access.code}:referral_form`);
    return noStore({ success: true, data: updated });
  } catch {
    return errorResponse('The referral form could not be saved right now. It is still on your screen - try again.', 503);
  }
}
