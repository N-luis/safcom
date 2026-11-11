import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { serviceReferralFormSchema, changedKeys, readForm } from '@/lib/serviceReferralForm';
import { gateServiceReferral, loadReferral, referralCaseContext, namesFor, referralDto, noStore } from '@/lib/serviceReferralServer';

type Ctx = { params: Promise<{ id: string; rid: string }> };

/** GET - one Service Referral Form of this case, with the case context it was made in. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'view', 'service_referral');
  if ('error' in g) return g.error;
  try {
    const r = await loadReferral(id, rid);
    if (!r) { await g.log('denied', 'referral_not_found'); return errorResponse('Referral not found', 404); }
    const [context, name, me] = await Promise.all([referralCaseContext(id), namesFor([r]),
      prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } })]);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: { referral: referralDto(r, name), context, me: { name: me?.name ?? null },
      access: { edit: g.access.edit, message: g.access.message } } });
  } catch {
    return errorResponse('The referral could not be loaded right now.', 503);
  }
}

const saveSchema = z.object({
  /** The version the officer was editing: a stale or repeated save cannot overwrite a newer one. */
  expectedVersion: z.number().int().positive(),
  form: z.unknown(),
});

/**
 * PUT { expectedVersion, form } - save a draft (Sections A and B and the
 * signature choice). Never Section C: the form schema has no such fields and
 * refuses unknown ones. Only a draft; only the officer the case is assigned
 * to. The case itself is not changed.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referral');
  if ('error' in g) return g.error;
  const body = saveSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return errorResponse('Check the referral', 400);
  const form = serviceReferralFormSchema.safeParse(body.data.form ?? {});
  if (!form.success) return errorResponse(form.error.issues[0]?.message ?? 'Check the referral form', 400);

  try {
    const r = await loadReferral(id, rid);
    if (!r) return errorResponse('Referral not found', 404);
    if (r.status !== 'DRAFT') return errorResponse(`This referral is ${r.status.toLowerCase()} - its form can no longer be changed.`, 409);
    if (r.version !== body.data.expectedVersion) {
      return noStore({ success: false, error: 'This referral was saved elsewhere since you opened it. Reload to see the saved version.', code: 'stale' }, 409);
    }
    const before = readForm(r.form);
    const keys = changedKeys(before, form.data);
    if (!keys.length) {
      const name = await namesFor([r]);
      return noStore({ success: true, data: { referral: referralDto(r, name), unchanged: true } });
    }
    const f = form.data;
    await prisma.$transaction(async tx => {
      // Only if still the draft, at the version edited - two saves cannot both land.
      const res = await tx.serviceReferral.updateMany({
        where: { id: rid, caseId: id, status: 'DRAFT', version: body.data.expectedVersion },
        data: {
          form: f, destination: f.destination || null, services: f.services,
          receivingOrganization: f.receivingAgency.trim() || null,
          version: { increment: 1 }, updatedById: g.actor.id,
        },
      });
      if (res.count !== 1) throw Object.assign(new Error('stale'), { stale: true });
      await tx.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: 'SAVED', version: body.data.expectedVersion + 1, changedKeys: keys, actorId: g.actor.id } });
    });
    const fresh = await loadReferral(id, rid);
    const name = await namesFor([fresh!]);
    await g.log('permitted', `${g.access.code}:save`);
    return noStore({ success: true, data: { referral: referralDto(fresh!, name), unchanged: false } });
  } catch (e) {
    if ((e as { stale?: boolean }).stale) return noStore({ success: false, error: 'This referral was saved elsewhere since you opened it. Reload to see the saved version.', code: 'stale' }, 409);
    return errorResponse('The draft could not be saved right now. It is still on your screen - try again.', 503);
  }
}
