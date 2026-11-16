import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { requireResidentAuth } from '@/lib/residentAuth';
import { isVawcCaseHidden } from '@/lib/caseAccess';
import { loadActor } from '@/lib/reporterAccess';
import { decideHearingAccess } from '@/lib/hearingsServer';
import { residentMayView } from '@/lib/evidenceServer';

export const dynamic = 'force-dynamic';

/**
 * Serves an evidence photo - the stored bytes, after checking the caller every
 * time. `?download=1` sends it as a file to save; otherwise it is shown inline.
 *
 * Two audiences reach this with two different cookies: barangay staff, and
 * the resident who filed the case. Staff is checked first because an officer
 * never carries a resident token; a resident falls through to the ownership check.
 *
 * Staff do not see a VAWC case's photos outside the VAWC roles (not found,
 * as everywhere else). A photo attached to a hearing record is for the
 * officials who may view that case's hearings, and never for a resident. A
 * resident sees the photos of their own report and of follow-ups shown to them -
 * never an official's internal or hidden note (lib/evidenceServer residentMayView).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const attachment = await prisma.caseAttachment.findUnique({
    where: { id },
    select: { data: true, mimeType: true, filename: true, caseId: true, hearingId: true, followUpId: true,
      case: { select: { caseType: true, assignedToId: true, caseNumber: true } } },
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
    // Taking a copy of evidence out of SafeComm is recorded, like the case's other documents.
    if (download) {
      await prisma.reporterAccessLog.create({ data: { actorId: staff.user.userId, actorRole: staff.user.role, caseId: attachment.caseId,
        caseNumber: attachment.case.caseNumber, fields: ['evidence_download'], outcome: 'permitted', code: 'evidence' } }).catch(() => undefined);
    }
    return sendImage(attachment, download);
  }

  const resident = await requireResidentAuth(req);
  if ('status' in resident) return new NextResponse('Unauthorized', { status: 401 });
  if (!(await residentMayView(attachment, resident.resident.residentId))) return new NextResponse('Forbidden', { status: 403 });
  return sendImage(attachment, download);
}

function sendImage(a: { data: Uint8Array; mimeType: string; filename: string }, download: boolean) {
  // A plain-ASCII fallback name, and the original (any language) per RFC 6266.
  const ascii = a.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'evidence';
  return new NextResponse(Buffer.from(a.data), {
    headers: {
      'Content-Type': a.mimeType,
      // Private: the image is behind an authorisation check, so no shared cache
      // should ever hold a copy of it.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    },
  });
}
