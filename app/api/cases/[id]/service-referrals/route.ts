import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { SERVICE_REFERRAL_FORM_VERSION } from '@/lib/serviceReferralForm';
import {
  gateServiceReferral, referralCaseContext, startingForm, nextReference, namesFor, referralDto, noStore,
} from '@/lib/serviceReferralServer';

/**
 * GET - the case's Service Referral Forms (Referral History) and the case
 * context a new one is made in. Officials who may view the case's records:
 * the assigned VAWC officer and the Punong Barangay. Anyone else: not found.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateServiceReferral(req, id, 'view', 'service_referrals');
  if ('error' in g) return g.error;
  try {
    const [context, rows] = await Promise.all([
      referralCaseContext(id),
      prisma.serviceReferral.findMany({
        where: { caseId: id }, orderBy: { createdAt: 'desc' }, omit: { issuedDocument: true },
        include: {
          events: { orderBy: { createdAt: 'asc' } },
          attachments: { select: { id: true, kind: true, mimeType: true, size: true, uploadedById: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        },
      }),
    ]);
    if (!context) return errorResponse('Case not found', 404);
    const name = await namesFor(rows);
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: { context, referrals: rows.map(r => referralDto(r, name)), access: { edit: g.access.edit, message: g.access.message } } });
  } catch {
    return errorResponse('The referrals could not be loaded right now.', 503);
  }
}

const createSchema = z.object({
  /** One per click on "Create Service Referral": a repeated request returns the same draft. */
  requestKey: z.string().regex(/^[A-Za-z0-9-]{8,80}$/, 'Missing request key'),
});

/**
 * POST { requestKey } - start a new Service Referral Form on this case, as a
 * draft, prefilled only from exact sources (each marked). Only the VAWC
 * officer the case is assigned to. The same requestKey never makes two.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referrals');
  if ('error' in g) return g.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the request', 400);
  const { requestKey } = parsed.data;

  const existing = async () => prisma.serviceReferral.findUnique({ where: { caseId_requestKey: { caseId: id, requestKey } }, select: { id: true, reference: true } });
  try {
    const again = await existing();
    if (again) return noStore({ success: true, data: { id: again.id, reference: again.reference, created: false } });

    const start = await startingForm(id, g.actor);
    if (!start) return errorResponse('Case not found', 404);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });

    // Two officers' clicks at once may reach for the same number: try the next.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await prisma.$transaction(async tx => {
          const reference = await nextReference(tx, id, g.c.caseNumber);
          const created = await tx.serviceReferral.create({ data: {
            caseId: id, reference, requestKey, status: 'DRAFT',
            form: start.form, prefilled: start.prefilled, formVersion: SERVICE_REFERRAL_FORM_VERSION,
            services: [], createdById: g.actor.id, updatedById: g.actor.id,
          }, select: { id: true, reference: true } });
          await tx.serviceReferralEvent.create({ data: { referralId: created.id, caseId: id, type: 'CREATED', version: 1, changedKeys: Object.keys(start.prefilled), actorId: g.actor.id } });
          await tx.activity.create({ data: {
            type: 'service_referral', message: `Service referral ${created.reference} started by ${me?.name ?? 'an official'} (draft)`,
            entityId: created.id, entityType: 'ServiceReferral', userId: g.actor.id, caseId: id, color: '#7c3aed',
          } });
          return created;
        });
        await g.log('permitted', `${g.access.code}:create`);
        return noStore({ success: true, data: { id: r.id, reference: r.reference, created: true } }, 201);
      } catch (e) {
        const code = (e as { code?: string }).code;
        const target = JSON.stringify((e as { meta?: unknown }).meta ?? '');
        if (code !== 'P2002') throw e;
        // The same click arrived twice: hand back the draft the first one made.
        if (/requestKey/.test(target) || !/reference/.test(target)) {
          const first = await existing();
          if (first) return noStore({ success: true, data: { id: first.id, reference: first.reference, created: false } });
        }
      }
    }
    return errorResponse('The referral could not be numbered right now. Try again.', 503);
  } catch {
    return errorResponse('The referral could not be started right now. Nothing was saved - try again.', 503);
  }
}
