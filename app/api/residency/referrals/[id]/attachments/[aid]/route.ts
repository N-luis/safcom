import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { referralAttachmentFor } from '@/lib/incidentReferralServer';

export const dynamic = 'force-dynamic';

/**
 * A photo a referral came with, for the officials who may open that referral
 * (the captain; the VAWC desk for a confidential one) - checked every time.
 * Anyone else gets "not found", as for a case they may not see.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await ctx.params;
  const auth = await requireAuth(req);
  if ('status' in auth) return new NextResponse('Unauthorized', { status: 401 });
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return new NextResponse('Unauthorized', { status: 401 });
  const a = await referralAttachmentFor(actor.role, id, aid);
  if (!a) return new NextResponse('Not found', { status: 404 });
  const download = req.nextUrl.searchParams.get('download') === '1';
  const ascii = a.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'evidence';
  return new NextResponse(Buffer.from(a.data), {
    headers: {
      'Content-Type': a.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    },
  });
}
