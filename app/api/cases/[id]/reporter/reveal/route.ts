import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, errorResponse } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import {
  loadActor, loadCaseForContact, decideReporterAccess, logReporterAccess, dialable,
  DENY_MESSAGE, PREFERENCE_GUIDANCE, CONTACT_PREFERENCES, REASON_MAX, type ContactField, type ContactPreference,
} from '@/lib/reporterAccess';

/**
 * Reveals a reporter's phone number and/or e-mail to an authorised official.
 *
 * Every call is decided by lib/reporterAccess.ts against the official's
 * current account and this case, and logged - permitted or denied - before
 * anything is returned. If the log cannot be written, nothing is revealed.
 * The response is never cached.
 */
const schema = z.object({
  fields: z.array(z.enum(['phone', 'email'])).min(1).max(2),
  reason: z.string().trim().max(REASON_MAX).optional().nullable(),
});

/** Enough for real follow-up work; too few to walk the case list. */
const REVEAL_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

const noStore = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse('Invalid request', 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
  const fields = [...new Set(parsed.data.fields)] as ContactField[];
  const reason = parsed.data.reason ?? null;

  try {
    const actor = await loadActor(auth.user.userId);
    const actorRole = actor?.role ?? auth.user.role ?? null;
    const log = (outcome: 'permitted' | 'denied', code: string, caseNumber?: string | null) =>
      logReporterAccess({ actorId: auth.user.userId, actorRole, caseId: id, caseNumber, fields, outcome, code, reason });

    if (!actor) { await log('denied', 'unknown_account'); return errorResponse('Unauthorized', 401); }
    if (!rateLimit(`reveal:${actor.id}`, REVEAL_LIMIT).allowed) {
      await log('denied', 'rate_limited');
      return errorResponse('Too many contact lookups. Try again in a few minutes.', 429);
    }

    const c = await loadCaseForContact(id);
    if (!c) { await log('denied', 'not_found'); return errorResponse('Case not found', 404); }

    const decision = decideReporterAccess(actor, c.facts, reason);
    if (!decision.allowed) {
      await log('denied', decision.code, decision.hidden ? null : c.caseNumber);
      if (decision.hidden) return errorResponse('Case not found', 404);
      return noStore({ success: false, error: DENY_MESSAGE[decision.code], code: decision.code, reasonRequired: decision.reasonRequired }, 403);
    }

    const r = c.resident;
    const phone = fields.includes('phone') ? r?.contactNumber?.trim() || null : null;
    const email = fields.includes('email') ? r?.email?.trim() || null : null;
    const nothing = !phone && !email;
    // Recorded before it is sent: a reveal with no record is not made.
    await log('permitted', nothing ? 'no_contact_on_file' : decision.code, c.caseNumber);

    const pref = (CONTACT_PREFERENCES as readonly string[]).includes(c.contactPreference ?? '')
      ? PREFERENCE_GUIDANCE[c.contactPreference as ContactPreference] : null;
    return noStore({
      success: true,
      data: {
        phone, email,
        // Links only - nothing is dialled or sent from here. Withheld where
        // the reporter said phone contact is not safe.
        telHref: phone && (pref?.allowCall ?? true) ? `tel:${dialable(phone)}` : null,
        smsHref: phone && (pref?.allowText ?? true) ? `sms:${dialable(phone)}` : null,
        basis: decision.basis,
        missing: nothing ? (r ? 'The reporter has no phone number or e-mail on file.' : 'This report was not filed from a resident account, so there is no contact on file.') : null,
      },
    });
  } catch (err) {
    console.error('[Reporter reveal]', err instanceof Error ? err.message : 'failed');
    return errorResponse('Contact details are unavailable right now.', 503);
  }
}
