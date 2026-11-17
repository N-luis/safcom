import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { loadActor, logReporterAccess, type AccessField } from '@/lib/reporterAccess';
import { canUseDirectory, strictestPreference, contactAdvice, DIRECTORY_STATUSES } from '@/lib/residentDirectory';

export const dynamic = 'force-dynamic';

const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
const text = (v: string | null | undefined) => v?.trim() || null;
/** The access log's case column, for a view that is about a resident, not a case. */
const LOG_KEY = '(resident-directory)';
/** As the case page's resident information: enough for real work, too few to walk the directory. */
const VIEW_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

/**
 * One resident's full profile, from the Resident Directory, by the
 * resident's id - never by a name. Logged (who, their role, which resident,
 * which details) before it is sent; if the log cannot be written, nothing is
 * shown. No case of theirs is read out, counted or named, so the profile
 * opens no case: each case keeps its own access rules.
 *
 * POST, not GET: a view is a recorded action, never prefetched or cached.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ rid: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { rid } = await params;
  const id = rid.slice(0, 64);
  try {
    const actor = await loadActor(auth.user.userId);
    const log = (outcome: 'permitted' | 'denied', code: string, fields: AccessField[] = ['profile'], residentId: string | null = null) =>
      logReporterAccess({ actorId: auth.user.userId, actorRole: actor?.role ?? auth.user.role ?? null, caseId: LOG_KEY, outcome, code, fields, residentId });

    if (!actor?.active) { await log('denied', 'inactive_or_unknown'); return errorResponse('Unauthorized', 401); }
    if (!canUseDirectory(actor.role)) {
      await log('denied', 'role_not_permitted');
      return noStore({ success: false, error: 'The Resident Directory is for Blotter and VAWC officials.' }, 403);
    }
    if (!rateLimit(`resident-directory-view:${actor.id}`, VIEW_LIMIT).allowed) {
      await log('denied', 'rate_limited');
      return errorResponse('Too many profiles opened. Try again in a few minutes.', 429);
    }

    const r = await prisma.resident.findFirst({
      where: { id, status: { in: DIRECTORY_STATUSES } },
      // Never: password, clerkId, username, notes, riskLevel, residentNumber, emailVerified - nor any case.
      // No resident ID and no verification state: ID verification was removed from SafeComm.
      select: { id: true, firstName: true, lastName: true, age: true, gender: true, barangay: true, address: true,
        contactNumber: true, email: true, status: true, registeredAt: true, updatedAt: true },
    });
    if (!r) { await log('denied', 'not_found'); return errorResponse('Resident not found', 404); }

    // How it is safe to reach them: the strictest wish on any of their reports, unnamed.
    const prefs = await prisma.case.findMany({ where: { residentId: r.id, contactPreference: { not: null } }, select: { contactPreference: true } });
    const phone = text(r.contactNumber);
    const email = text(r.email);
    const advice = contactAdvice(strictestPreference(prefs.map(p => p.contactPreference)), Boolean(phone));

    const fields: AccessField[] = ['profile', ...(phone ? ['phone' as const] : []), ...(email ? ['email' as const] : [])];
    await log('permitted', 'directory_view', fields, r.id);

    return noStore({ success: true, data: {
      resident: {
        id: r.id,
        fullName: [text(r.firstName), text(r.lastName)].filter(Boolean).join(' ') || null,
        age: typeof r.age === 'number' && r.age > 0 ? r.age : null,
        sex: text(r.gender),
        address: text(r.address),
        barangay: text(r.barangay),
        phone,
        email,
        accountStatus: text(r.status),
        registeredAt: r.registeredAt,
        updatedAt: r.updatedAt,
      },
      // How it is safe to reach them, shown beside the number the official may copy. No call link is sent.
      contact: advice,
    } });
  } catch (e) {
    console.error('[Resident directory view]', e instanceof Error ? e.message : 'failed');
    return errorResponse('The resident profile is unavailable right now.', 503);
  }
}
