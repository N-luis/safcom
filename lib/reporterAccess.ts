import 'server-only';
import { prisma } from './prisma';
import { canSeeVawc } from './caseAccess';
import { VAWC_TYPES } from './vawcTypes';

/**
 * Who may see a reporter's contact details, and the record of every attempt.
 *
 * THE POLICY (decideReporterAccess below is the only place it is decided)
 *   - Blotter officer: blotter cases assigned to them. Never a VAWC case.
 *   - VAWC officer: VAWC cases assigned to them, always with a stated reason.
 *   - Barangay captain (admin) and system administrator - oversight: with a
 *     stated reason, a case that is urgent or that nobody is handling yet. A
 *     case another official is handling, and that is not urgent, is theirs to
 *     contact. A VAWC case needs to be urgent, not just unassigned.
 *   - Residents: never through here. Their own profile is /api/auth/resident-me.
 *   - Everyone: an active account, re-read from the database on every request
 *     - a role in a week-old session token is not trusted for this.
 * A risk label alone never grants access: urgency only matters for oversight,
 * and only together with the role and a reason.
 *
 * WHAT LEAVES THE SERVER. The case page gets a masked number and whether
 * access is possible. The full number is sent only by the reveal endpoint,
 * only after this policy allows it, and the attempt is logged either way.
 */

export const BLOTTER_ROLES = ['officer', 'blotter_officer'];
export const VAWC_DESK_ROLES = ['vawc_officer', 'vawc', 'vawc_lead'];
export const OVERSIGHT_ROLES = ['admin', 'system_admin'];
export const REASON_MIN = 10;
export const REASON_MAX = 300;

export type ContactField = 'phone' | 'email';

export const CONTACT_PREFERENCES = ['call_ok', 'text_first', 'no_phone'] as const;
export type ContactPreference = typeof CONTACT_PREFERENCES[number];

/** What each preference asks of staff - the safeguarding procedure shown with the number. */
export const PREFERENCE_GUIDANCE: Record<ContactPreference, { label: string; guidance: string; allowCall: boolean; allowText: boolean }> = {
  call_ok: {
    label: 'Calls and texts are fine',
    guidance: 'The reporter said they can be called or texted.',
    allowCall: true, allowText: true,
  },
  text_first: {
    label: 'Text first before calling',
    guidance: 'Send a short, neutral text first (no case details) and call only once they reply that it is safe to talk.',
    allowCall: true, allowText: true,
  },
  no_phone: {
    label: 'Do not call or text - not safe',
    guidance: 'The reporter said phone contact could put them at risk. Do not call or text. Use the in-app follow-up messages, or arrange contact through the VAWC desk in person.',
    allowCall: false, allowText: false,
  },
};

export interface Actor { id: string; role: string; active: boolean }
export interface CaseFacts {
  caseType: string;
  assignedToId: string | null;
  /** Null when undetermined. */
  riskLevel: string | null;
  requiresOfficerReview: boolean;
  immediateSafetyConcern: boolean;
  /** An anonymous report: nobody is shown who filed it. */
  identityWithheld?: boolean;
}

export type Decision =
  | { allowed: true; basis: 'assigned' | 'oversight'; reasonRequired: boolean; code: 'assigned' | 'oversight' }
  | { allowed: false; code: DenyCode; reasonRequired: boolean; canClaim: boolean; hidden: boolean };

export type DenyCode =
  | 'inactive'            // account deactivated
  | 'role_not_permitted'  // a role with no case-contact access
  | 'vawc_restricted'     // a VAWC case, and not the VAWC desk or oversight
  | 'wrong_desk'          // a VAWC officer on a blotter case
  | 'not_assigned'        // the desk is right, but the case is not theirs
  | 'oversight_not_applicable' // captain: assigned elsewhere and not urgent
  | 'reason_required'     // allowed, once a reason is given
  | 'identity_withheld';  // an anonymous report

export const isVawcType = (caseType: string) => (VAWC_TYPES as readonly string[]).includes(caseType);

/** Urgent for oversight purposes: a high level, a person needed, or danger now. */
export const isUrgent = (c: Pick<CaseFacts, 'riskLevel' | 'requiresOfficerReview' | 'immediateSafetyConcern'>) =>
  c.immediateSafetyConcern || c.riskLevel === 'Critical' || c.riskLevel === 'High' || c.requiresOfficerReview;

/** The whole policy. Pure: the same inputs always give the same answer. */
export function decideReporterAccess(actor: Actor, c: CaseFacts, reason?: string | null): Decision {
  const vawc = isVawcType(c.caseType);
  const role = actor.role.trim();
  const hasReason = (reason ?? '').trim().length >= REASON_MIN;
  const deny = (code: DenyCode, extra: Partial<{ canClaim: boolean; hidden: boolean; reasonRequired: boolean }> = {}): Decision =>
    ({ allowed: false, code, canClaim: false, hidden: false, reasonRequired: false, ...extra });

  if (!actor.active) return deny('inactive');
  // Anonymous means anonymous - for every role, urgent or not.
  if (c.identityWithheld && !(vawc && !canSeeVawc(role))) return deny('identity_withheld');
  // A case on a desk this role cannot see is reported as not found.
  if (vawc && !canSeeVawc(role)) return deny('vawc_restricted', { hidden: true });

  if (BLOTTER_ROLES.includes(role) || VAWC_DESK_ROLES.includes(role)) {
    const ownDesk = VAWC_DESK_ROLES.includes(role) ? vawc : !vawc;
    if (!ownDesk) return deny('wrong_desk');
    if (c.assignedToId !== actor.id) return deny('not_assigned', { canClaim: c.assignedToId === null });
    // VAWC: stricter - every look at a survivor's contact details says why.
    if (vawc && !hasReason) return deny('reason_required', { reasonRequired: true });
    return { allowed: true, basis: 'assigned', code: 'assigned', reasonRequired: vawc };
  }

  if (OVERSIGHT_ROLES.includes(role)) {
    if (c.assignedToId === actor.id) {
      if (vawc && !hasReason) return deny('reason_required', { reasonRequired: true });
      return { allowed: true, basis: 'assigned', code: 'assigned', reasonRequired: vawc };
    }
    const urgent = isUrgent(c);
    const applies = vawc ? urgent : urgent || c.assignedToId === null;
    if (!applies) return deny('oversight_not_applicable');
    if (!hasReason) return deny('reason_required', { reasonRequired: true });
    return { allowed: true, basis: 'oversight', code: 'oversight', reasonRequired: true };
  }

  return deny('role_not_permitted');
}

/** Plain-language explanations for the case page. */
export const DENY_MESSAGE: Record<DenyCode, string> = {
  inactive: 'Your account is not active.',
  role_not_permitted: 'Your role does not have access to reporter contact details.',
  vawc_restricted: 'Case not found.',
  wrong_desk: 'This case belongs to the other desk.',
  not_assigned: 'Only the officer assigned to this case can view the reporter’s contact details.',
  oversight_not_applicable: 'This case is assigned to another official and is not marked urgent, so its contact details stay with them.',
  reason_required: 'Give a reason to view the contact details. It is recorded.',
  identity_withheld: 'This report was filed anonymously. The reporter’s identity and contact details are not shown to officials.',
};

/**
 * The resident directory (/api/residents) shows phone numbers and e-mails to
 * the captain and the system administrator only - the roles that manage
 * resident records. Officers reach a reporter's contact details through the
 * case they are handling, where access is decided per case and logged.
 */
export async function canSeeDirectoryContacts(userId: string): Promise<boolean> {
  const actor = await loadActor(userId);
  return Boolean(actor?.active && OVERSIGHT_ROLES.includes(actor.role));
}

/**
 * Whether this official may change who a case is assigned to. Assignment is
 * what opens a reporter's contact details to an officer, so it cannot be a
 * way around the policy: an officer may only take an unassigned case on their
 * own desk (as "Take this case" does); reassigning is for the captain and the
 * system administrator, and only to someone who works that desk.
 * Returns null when allowed, or the refusal.
 */
export async function checkAssignmentChange(actorId: string, kase: { caseType: string; assignedToId: string | null }, to: string | null):
  Promise<{ status: number; message: string } | null> {
  const actor = await loadActor(actorId);
  if (!actor?.active) return { status: 401, message: 'Unauthorized' };
  const vawc = isVawcType(kase.caseType);
  if (to) {
    const target = await loadActor(to);
    const fits = target?.active && (OVERSIGHT_ROLES.includes(target.role)
      || (vawc ? VAWC_DESK_ROLES.includes(target.role) : BLOTTER_ROLES.includes(target.role)));
    if (!fits) return { status: 400, message: `That official cannot be assigned a ${vawc ? 'VAWC' : 'blotter'} case` };
  }
  if (OVERSIGHT_ROLES.includes(actor.role)) return null;
  const ownDesk = vawc ? VAWC_DESK_ROLES.includes(actor.role) : BLOTTER_ROLES.includes(actor.role);
  if (ownDesk && kase.assignedToId === null && to === actor.id) return null;
  return { status: 403, message: 'Only the barangay captain can reassign a case. You can take an unassigned case on your own desk.' };
}

// ─── Masking ─────────────────────────────────────────────────────────────────

/** "09171234567" -> "0917 ••• ••67". Never more than the first 4 and last 2 digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 7) return d ? '•••' : null;
  return `${d.slice(0, 4)} ••• ••${d.slice(-2)}`;
}

/** "maria.santos@mail.com" -> "m•••@mail.com". */
export function maskEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  const at = e.indexOf('@');
  if (at < 1) return e ? '•••' : null;
  return `${e[0]}•••${e.slice(at)}`;
}

/** Digits and a leading +, for a tel:/sms: link. */
export const dialable = (phone: string) => phone.replace(/(?!^\+)[^\d]/g, '');

// ─── Loading what the decision needs, fresh ──────────────────────────────────

export async function loadActor(userId: string): Promise<Actor | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
  return u ? { id: u.id, role: u.role, active: u.active } : null;
}

/** The case, its urgency, and the reporter's contact details - read on the server only. */
export async function loadCaseForContact(caseId: string) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true,
      requiresOfficerReview: true, assignedToId: true, residentName: true,
      contactPreference: true, contactSafetyNote: true,
      reporterIdentityWithheld: true, reportingRelationship: true, affectedPersonNote: true,
      assignedTo: { select: { name: true } },
      intake: { select: { immediateSafetyConcern: true, assessmentStatus: true } },
      resident: { select: { residentNumber: true, firstName: true, lastName: true, contactNumber: true, email: true } },
    },
  });
  if (!c) return null;
  return {
    ...c,
    facts: {
      caseType: c.caseType, assignedToId: c.assignedToId, riskLevel: c.riskLevel,
      requiresOfficerReview: c.requiresOfficerReview,
      immediateSafetyConcern: Boolean(c.intake?.immediateSafetyConcern),
      identityWithheld: c.reporterIdentityWithheld,
    } satisfies CaseFacts,
  };
}

// ─── The audit log ───────────────────────────────────────────────────────────

/**
 * One row per attempt. Never the number, the e-mail or the narrative. A
 * failure to write is reported to the caller: a reveal that cannot be
 * recorded is not made.
 */
export async function logReporterAccess(entry: {
  actorId: string | null; actorRole: string | null; caseId: string; caseNumber?: string | null;
  fields: ContactField[]; outcome: 'permitted' | 'denied'; code: string; reason?: string | null;
}) {
  await prisma.reporterAccessLog.create({
    data: {
      actorId: entry.actorId, actorRole: entry.actorRole, caseId: entry.caseId.slice(0, 64),
      caseNumber: entry.caseNumber ?? null, fields: entry.fields, outcome: entry.outcome,
      code: entry.code, reason: entry.reason?.trim().slice(0, REASON_MAX) || null,
    },
  });
}
