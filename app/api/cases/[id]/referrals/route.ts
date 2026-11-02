import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateCaseRecords, noStore } from '@/lib/caseRecordsServer';
import { referralSchema, referralRefusal, REFERRAL_AGENCIES } from '@/lib/caseRecords';

/**
 * Record a referral - officer-only. A VAWC case is never referred to the
 * Lupon for mediation or conciliation; that is refused here, not only
 * hidden in the form.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateCaseRecords(req, id, 'edit', 'referrals');
  if ('error' in g) return g.error;
  const parsed = referralSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the referral', 400);
  const refusal = referralRefusal(parsed.data.agency, g.c.caseType);
  if (refusal) return errorResponse(refusal, 422);
  const referredAt = new Date(`${parsed.data.referredAt}T00:00:00+08:00`);
  if (!Number.isFinite(referredAt.getTime()) || referredAt.getTime() > Date.now() + 86_400_000) {
    return errorResponse('The referral date cannot be in the future', 400);
  }

  try {
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    const office = parsed.data.agency === 'OTHER' ? parsed.data.agencyOther : REFERRAL_AGENCIES[parsed.data.agency].label;
    const referral = await prisma.$transaction(async tx => {
      const r = await tx.caseReferral.create({ data: {
        caseId: id, agency: parsed.data.agency, agencyOther: parsed.data.agencyOther ?? null, referredAt,
        reason: parsed.data.reason ?? null, status: parsed.data.status, notes: parsed.data.notes ?? null, createdById: g.actor.id,
      } });
      await tx.activity.create({ data: {
        type: 'referral', message: `Referred to ${office} by ${me?.name ?? 'an official'}`,
        entityId: r.id, entityType: 'CaseReferral', userId: g.actor.id, caseId: id, color: '#7c3aed',
      } });
      return r;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: referral }, 201);
  } catch {
    return errorResponse('The referral could not be saved right now. It is still on your screen - try again.', 503);
  }
}
