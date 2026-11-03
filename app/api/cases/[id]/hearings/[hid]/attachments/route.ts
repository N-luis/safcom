import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/auth';
import { gateHearings, noStore, recordEvent, hearingActivity, actorName } from '@/lib/hearingsServer';
import { parseImageDataUrl } from '@/lib/attachments';

/**
 * An image attached to a hearing record - a signed attendance sheet, a
 * settlement page. Officials only: it is served to staff who may view the
 * case's hearings and never to a resident (app/api/attachments/[id]).
 */

const MAX_PER_HEARING = 5;
const schema = z.object({ dataUrl: z.string().max(4_000_000), filename: z.string().trim().min(1).max(120) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  const g = await gateHearings(req, id, 'edit');
  if ('error' in g) return g.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse('Choose an image to attach', 400);
  const file = parseImageDataUrl(parsed.data.dataUrl);
  if ('error' in file) return errorResponse(file.error, 400);
  try {
    const h = await prisma.caseHearing.findUnique({ where: { id: hid }, select: { caseId: true, hearingNumber: true, status: true } });
    if (!h || h.caseId !== id) return errorResponse('Hearing not found', 404);
    if (h.status === 'CANCELLED') return errorResponse('This hearing was cancelled.', 409);
    if ((await prisma.caseAttachment.count({ where: { hearingId: hid } })) >= MAX_PER_HEARING) return errorResponse(`A hearing can have up to ${MAX_PER_HEARING} attachments.`, 409);
    const by = await actorName(g.actor.id);
    const a = await prisma.$transaction(async tx => {
      const row = await tx.caseAttachment.create({ data: {
        caseId: id, hearingId: hid, filename: parsed.data.filename.replace(/[^\w. -]/g, '_'), mimeType: file.mimeType, size: file.bytes.length, data: file.bytes,
      }, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } });
      const e = await recordEvent(tx, { hearingId: hid, caseId: id, kind: 'attachment_added', actorType: 'official', actorId: g.actor.id, after: { attachmentId: row.id, filename: row.filename } });
      await hearingActivity(tx, e.id, id, g.actor.id, `Attachment added to Hearing ${h.hearingNumber} by ${by}`);
      return row;
    });
    await g.log('permitted', g.access.code);
    return noStore({ success: true, data: a }, 201);
  } catch {
    return errorResponse('The attachment could not be saved right now.', 503);
  }
}
