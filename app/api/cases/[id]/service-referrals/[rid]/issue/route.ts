import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { issueSchema, issueProblems, readForm, DESTINATIONS, ISSUED_VIA } from '@/lib/serviceReferralForm';
import { buildServiceReferralPdf } from '@/lib/serviceReferralPdf';
import { gateServiceReferral, loadReferral, namesFor, referralDto, sha256, noStore } from '@/lib/serviceReferralServer';

/**
 * POST { expectedVersion, issuedVia, recipientVerified: true } - Issue /
 * Record Referral: the officer records that this referral was given to the
 * receiving organization. SafeComm sends nothing itself.
 *
 * Only a complete draft, at the version on the officer's screen, once: the
 * update is conditional on both, so a double click issues it once and the
 * second click is refused. The PDF made now is stored with its SHA-256 and
 * is the issued document from then on. Section C starts as "awaiting
 * acknowledgement" - issuing is not receipt, and receipt is not service.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referral_issue');
  if ('error' in g) return g.error;
  const parsed = issueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the request', 400);

  try {
    const r = await loadReferral(id, rid);
    if (!r) return errorResponse('Referral not found', 404);
    if (r.status !== 'DRAFT') return noStore({ success: false, error: `This referral is already ${r.status.toLowerCase()}.`, code: 'not_draft' }, 409);
    if (r.version !== parsed.data.expectedVersion) {
      return noStore({ success: false, error: 'This referral changed since you opened it. Save or reload before issuing.', code: 'stale' }, 409);
    }
    const form = readForm(r.form);
    const problems = issueProblems(form);
    if (problems.required.length) {
      return noStore({ success: false, error: `${problems.required.length} required item${problems.required.length === 1 ? '' : 's'} still to fill in before issuing.`, missing: problems.required }, 422);
    }
    const issuedAt = new Date();
    const bytes = await buildServiceReferralPdf({ reference: r.reference, form, status: 'ISSUED', sectionC: null, documentDate: issuedAt });
    const hash = sha256(bytes);
    const me = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { name: true } });
    await prisma.$transaction(async tx => {
      const res = await tx.serviceReferral.updateMany({
        where: { id: rid, caseId: id, status: 'DRAFT', version: parsed.data.expectedVersion },
        data: {
          status: 'ISSUED', issuedAt, issuedById: g.actor.id, issuedVia: parsed.data.issuedVia, recipientVerifiedAt: issuedAt,
          documentSha256: hash, issuedDocument: new Uint8Array(bytes), ackStatus: 'AWAITING',
          version: { increment: 1 }, updatedById: g.actor.id,
        },
      });
      if (res.count !== 1) throw Object.assign(new Error('stale'), { stale: true });
      await tx.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: 'ISSUED', version: r.version + 1, changedKeys: [],
        note: `${ISSUED_VIA[parsed.data.issuedVia]}; recipient confirmed by the officer; document SHA-256 ${hash}`, actorId: g.actor.id } });
      // The case timeline: the number and the kind of office only - no names, no addresses.
      await tx.activity.create({ data: {
        type: 'service_referral',
        message: `Service referral ${r.reference} issued to the ${DESTINATIONS[form.destination as keyof typeof DESTINATIONS].short} by ${me?.name ?? 'an official'} - awaiting acknowledgement`,
        entityId: rid, entityType: 'ServiceReferral', userId: g.actor.id, caseId: id, color: '#7c3aed',
      } });
    });
    const fresh = await loadReferral(id, rid);
    const name = await namesFor([fresh!]);
    await g.log('permitted', `${g.access.code}:issue`);
    return noStore({ success: true, data: { referral: referralDto(fresh!, name) } });
  } catch (e) {
    if ((e as { stale?: boolean }).stale) return noStore({ success: false, error: 'This referral was already issued or changed. Reload to see it.', code: 'stale' }, 409);
    return errorResponse('The referral could not be issued right now. Nothing was recorded - try again.', 503);
  }
}
