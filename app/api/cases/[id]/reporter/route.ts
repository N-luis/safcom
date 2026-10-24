import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/auth';
import {
  loadActor, loadCaseForContact, decideReporterAccess, maskPhone, maskEmail, isUrgent, isVawcType,
  DENY_MESSAGE, PREFERENCE_GUIDANCE, CONTACT_PREFERENCES, type ContactPreference,
} from '@/lib/reporterAccess';

/**
 * The Reporter Information panel's first look: who reported, whether contact
 * details exist, and whether this official may see them - with the number
 * masked. The full number is never in this response; it comes only from
 * ./reveal, after the policy allows it, and is logged there.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const { id } = await params;

  try {
    const actor = await loadActor(auth.user.userId);
    if (!actor) return errorResponse('Unauthorized', 401);
    const c = await loadCaseForContact(id);
    if (!c) return errorResponse('Case not found', 404);

    const decision = decideReporterAccess(actor, c.facts);
    // Not found, as the case page itself says, for a VAWC case outside this role.
    if (!decision.allowed && decision.hidden) return errorResponse('Case not found', 404);
    const canReveal = decision.allowed || decision.code === 'reason_required';

    const pref = (CONTACT_PREFERENCES as readonly string[]).includes(c.contactPreference ?? '')
      ? c.contactPreference as ContactPreference : null;
    const vawc = isVawcType(c.caseType);
    // Anonymous: nothing about who filed it leaves the server.
    const r = c.reporterIdentityWithheld ? null : c.resident;

    const body = {
      caseNumber: c.caseNumber,
      reporter: {
        name: r ? `${r.firstName} ${r.lastName}` : c.residentName,
        registered: Boolean(r),
        residentNumber: canReveal ? r?.residentNumber ?? null : null,
        anonymous: c.reporterIdentityWithheld,
        // Who the report is for, and who was affected in the reporter's words:
        // the reporter is not assumed to be the person harmed.
        relationship: c.reportingRelationship,
        affectedPersonNote: c.affectedPersonNote,
      },
      contact: {
        hasPhone: Boolean(r?.contactNumber),
        hasEmail: Boolean(r?.email),
        phoneMasked: canReveal ? maskPhone(r?.contactNumber) : null,
        emailMasked: canReveal ? maskEmail(r?.email) : null,
      },
      // The reporter's own instructions, for the staff who may contact them.
      safety: canReveal ? {
        preference: pref,
        label: pref ? PREFERENCE_GUIDANCE[pref].label : null,
        guidance: pref ? PREFERENCE_GUIDANCE[pref].guidance : null,
        allowCall: pref ? PREFERENCE_GUIDANCE[pref].allowCall : true,
        allowText: pref ? PREFERENCE_GUIDANCE[pref].allowText : true,
        note: c.contactSafetyNote,
        // Never assume a call is safe on a VAWC case: the person responsible
        // may share the phone or the home.
        caution: vawc
          ? 'VAWC case: the person responsible may have access to this phone or be nearby. When the reporter answers, first confirm they can talk safely; do not leave case details in a message or voicemail.'
          : null,
      } : null,
      urgency: {
        urgent: isUrgent(c.facts),
        riskLevel: c.riskLevel,
        status: c.status,
        requiresOfficerReview: c.requiresOfficerReview,
        immediateSafetyConcern: c.facts.immediateSafetyConcern,
        assessmentStatus: c.intake?.assessmentStatus ?? null,
      },
      access: {
        canReveal,
        reasonRequired: decision.reasonRequired,
        basis: decision.allowed ? decision.basis : null,
        code: decision.code,
        message: decision.allowed ? null : DENY_MESSAGE[decision.code],
        canClaim: !decision.allowed && decision.canClaim,
        assignedTo: c.assignedTo?.name ?? null,
      },
    };
    return NextResponse.json({ success: true, data: body }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (err) {
    console.error('[Reporter summary]', err instanceof Error ? err.message : 'failed');
    return errorResponse('Server error', 500);
  }
}
