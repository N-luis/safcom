import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { parseReferralScan, MAX_REFERRAL_SCANS } from '@/lib/serviceReferralScan';
import { gateServiceReferral, loadReferral, namesFor, referralDto, noStore } from '@/lib/serviceReferralServer';

const schema = z.object({
  /** SIGNED_REFERRAL: the signed paper copy. ACKNOWLEDGEMENT: the receiving organization's signed Section C or confirmation. */
  kind: z.enum(['SIGNED_REFERRAL', 'ACKNOWLEDGEMENT']),
  dataUrl: z.string().max(5_000_000),
});

/**
 * POST { kind, dataUrl } - keep a scan or photo of a signed paper copy with
 * the referral. There is no electronic signature in SafeComm: a form is
 * signed by hand on paper, and this is where the proof of it is kept.
 *
 * Stored privately in the database (no file URL), readable only through
 * .../attachments/[aid] after the same access check. No file name is kept -
 * names of people often end up in them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const g = await gateServiceReferral(req, id, 'edit', 'service_referral_scan');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Choose a JPG, PNG, WEBP or PDF file', 400);
  const file = parseReferralScan(parsed.data.dataUrl);
  if ('error' in file) return errorResponse(file.error, 400);
  try {
    const r = await loadReferral(id, rid);
    if (!r) return errorResponse('Referral not found', 404);
    if (r.status === 'CANCELLED') return errorResponse('This referral is cancelled.', 409);
    if (parsed.data.kind === 'ACKNOWLEDGEMENT' && r.status !== 'ISSUED') return errorResponse('Proof of acknowledgement can be added once the referral is issued.', 409);
    if (r.attachments.length >= MAX_REFERRAL_SCANS) return errorResponse(`A referral keeps at most ${MAX_REFERRAL_SCANS} scans.`, 409);
    await prisma.$transaction(async tx => {
      await tx.serviceReferralAttachment.create({ data: { referralId: rid, kind: parsed.data.kind, mimeType: file.mimeType, size: file.bytes.length, data: file.bytes, uploadedById: g.actor.id } });
      await tx.serviceReferralEvent.create({ data: { referralId: rid, caseId: id, type: 'SCAN_ADDED', version: r.version, changedKeys: [],
        note: parsed.data.kind === 'SIGNED_REFERRAL' ? 'Scan of the signed referral form added' : 'Proof of acknowledgement added', actorId: g.actor.id } });
    });
    const fresh = await loadReferral(id, rid);
    const name = await namesFor([fresh!]);
    await g.log('permitted', `${g.access.code}:scan`);
    return noStore({ success: true, data: { referral: referralDto(fresh!, name) } }, 201);
  } catch {
    return errorResponse('The scan could not be saved right now.', 503);
  }
}
