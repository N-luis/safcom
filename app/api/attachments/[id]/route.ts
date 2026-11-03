import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { requireResidentAuth } from '@/lib/residentAuth';
import { isVawcCaseHidden } from '@/lib/caseAccess';
import { loadActor } from '@/lib/reporterAccess';
import { decideHearingAccess } from '@/lib/hearingsServer';

export const dynamic = 'force-dynamic';

/**
 * Serves a report photo.
 *
 * Two audiences reach this with two different cookies: barangay staff, and
 * the resident who filed the case, who may see only their own. Staff is
 * checked first because an officer never carries a resident token; a
 * resident falls through to the ownership check.
 *
 * Staff do not see a VAWC case's photos outside the VAWC roles (not found,
 * as everywhere else). A photo attached to a hearing record is for the
 * officials who may view that case's hearings, and never for a resident.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const attachment = await prisma.caseAttachment.findUnique({
    where: { id },
    select: { data: true, mimeType: true, filename: true, caseId: true, hearingId: true,
      case: { select: { caseType: true, assignedToId: true } } },
  });
  if (!attachment) return new NextResponse('Not found', { status: 404 });

  const staff = await requireAuth(req);
  if (!('status' in staff)) {
    if (isVawcCaseHidden(staff.user.role, attachment.case.caseType)) return new NextResponse('Not found', { status: 404 });
    if (attachment.hearingId) {
      const actor = await loadActor(staff.user.userId);
      const presides = actor ? (await prisma.caseHearing.count({ where: { caseId: attachment.caseId, assignedOfficialId: actor.id } })) > 0 : false;
      if (!actor || !decideHearingAccess(actor, attachment.case, presides).view) return new NextResponse('Forbidden', { status: 403 });
    }
    return sendImage(attachment);
  }

  const resident = await requireResidentAuth(req);
  if ('status' in resident) return new NextResponse('Unauthorized', { status: 401 });
  if (attachment.hearingId) return new NextResponse('Forbidden', { status: 403 });

  const owned = await prisma.case.findFirst({
    where: { id: attachment.caseId, residentId: resident.resident.residentId },
    select: { id: true },
  });
  if (!owned) return new NextResponse('Forbidden', { status: 403 });

  return sendImage(attachment);
}

function sendImage(a: { data: Uint8Array; mimeType: string; filename: string }) {
  return new NextResponse(Buffer.from(a.data), {
    headers: {
      'Content-Type': a.mimeType,
      // Private: the image is behind an authorisation check, so no shared cache
      // should ever hold a copy of it.
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${a.filename.replace(/"/g, '')}"`,
    },
  });
}
