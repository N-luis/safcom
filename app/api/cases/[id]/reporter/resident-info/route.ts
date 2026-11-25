import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import {
  loadActor, loadCaseForContact, decideReporterAccess, logReporterAccess, dialable,
  DENY_MESSAGE, PREFERENCE_GUIDANCE, CONTACT_PREFERENCES, type AccessField, type ContactPreference,
} from '@/lib/reporterAccess';

/**
 * The reporter's resident information, for an official handling the case:
 * their stored profile, contact details and account state.
 *
 * Opened directly - no reason or confirmation is asked for. Every call is
 * still decided by lib/reporterAccess.ts against the official's current
 * account and this case, and logged - permitted or denied, with the official,
 * their role, the case, the resident and what was disclosed - before anything
 * is returned. If the log cannot be written, nothing is shown. Only stored
 * values are sent (null where nothing is on file), never a sign-in detail,
 * and the response is never cached.
 *
 * POST, not GET: a view is an action that is recorded, and it must not be
 * prefetched or replayed from a cache.
 */

/** Enough for real follow-up work; too few to walk the case list. */
const VIEW_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

const text = (v: string | null | undefined) => v?.trim() || null;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const actor = await loadActor(auth.user.userId);
    const actorRole = actor?.role ?? auth.user.role ?? null;
    const log = (outcome: 'permitted' | 'denied', code: string, extra: { caseNumber?: string | null; residentId?: string | null; fields?: AccessField[] } = {}) =>
      logReporterAccess({ actorId: auth.user.userId, actorRole, caseId: id, outcome, code, fields: extra.fields ?? ['profile'],
        caseNumber: extra.caseNumber, residentId: extra.residentId });

    if (!actor) { await log('denied', 'unknown_account'); return errorResponse('Unauthorized', 401); }
    if (!(await rateLimit(`resident-info:${actor.id}`, VIEW_LIMIT)).allowed) {
      await log('denied', 'rate_limited');
      return errorResponse('Too many lookups. Try again in a few minutes.', 429);
    }

    const c = await loadCaseForContact(id);
    if (!c) { await log('denied', 'not_found'); return errorResponse('Case not found', 404); }

    const decision = decideReporterAccess(actor, c.facts);
    if (!decision.allowed) {
      // A hidden (VAWC) case is not named in the log entry's case number,
      // as it is not named to the official.
      await log('denied', decision.code, { caseNumber: decision.hidden ? null : c.caseNumber });
      if (decision.hidden) return errorResponse('Case not found', 404);
      return noStore({ success: false, error: DENY_MESSAGE[decision.code], code: decision.code }, 403);
    }

    const r = c.resident;
    if (!r) {
      await log('permitted', 'no_resident_record', { caseNumber: c.caseNumber });
      return noStore({ success: true, data: { resident: null, basis: decision.basis,
        missing: 'This report was not filed from a resident account, so there is no resident record.' } });
    }

    const phone = text(r.contactNumber);
    const email = text(r.email);
    const fields: AccessField[] = ['profile', ...(phone ? ['phone' as const] : []), ...(email ? ['email' as const] : [])];
    // Recorded before it is sent: a view with no record is not made.
    await log('permitted', decision.code, { caseNumber: c.caseNumber, residentId: r.id, fields });

    const pref = (CONTACT_PREFERENCES as readonly string[]).includes(c.contactPreference ?? '')
      ? PREFERENCE_GUIDANCE[c.contactPreference as ContactPreference] : null;
    return noStore({
      success: true,
      data: {
        basis: decision.basis,
        resident: {
          fullName: [text(r.firstName), text(r.lastName)].filter(Boolean).join(' ') || null,
          residentNumber: text(r.residentNumber),
          // As given at registration - the record keeps no birthdate.
          age: typeof r.age === 'number' && r.age > 0 ? r.age : null,
          sex: text(r.gender),
          address: text(r.address),
          barangay: text(r.barangay),
          phone,
          email,
          accountStatus: text(r.status),
          emailVerified: r.emailVerified,
          registeredAt: r.registeredAt,
          updatedAt: r.updatedAt,
        },
        // Links only - nothing is dialled or sent from here. Withheld where
        // the reporter said phone contact is not safe.
        telHref: phone && (pref?.allowCall ?? true) ? `tel:${dialable(phone)}` : null,
        smsHref: phone && (pref?.allowText ?? true) ? `sms:${dialable(phone)}` : null,
        missing: !phone && !email ? 'The reporter has no phone number or e-mail on file.' : null,
      },
    });
  } catch (err) {
    console.error('[Resident info]', err instanceof Error ? err.message : 'failed');
    return errorResponse('Resident information is unavailable right now.', 503);
  }
}
