import 'server-only';
import { prisma } from './prisma';
import { canSeeVawc } from './caseAccess';
import { BLOTTER_ROLES, VAWC_DESK_ROLES, OVERSIGHT_ROLES, isVawcType, type Actor } from './reporterAccess';
import {
  ALL_ITEMS, ITEM_BY_KEY, optionsOf, INTAKE_FORM_VERSION, type Answer, type Item, type Responses,
} from './officialIntakeForm';

/**
 * The official intake on the server: who may see or fill it, the first
 * section's case and reporter details, the start-up prefill, and validation.
 *
 * THE REPORTER is the resident account the case itself points to
 * (Case.residentId). Never a name match, never a guess: an anonymous report
 * shows no one, a report with no account says so, and a missing record is a
 * warning - not someone else's details.
 *
 * ACCESS (decideIntakeAccess). Read fresh from the account on every request.
 *   - A desk officer: cases on their own desk that are assigned to them.
 *   - The captain / system administrator: may view any case's intake they
 *     can see (logged); may fill it in on a blotter case, or on a VAWC case
 *     assigned to them - VAWC is stricter.
 *   - A VAWC case is "not found" to anyone outside the VAWC desk and
 *     oversight. Residents never reach this - the endpoints are staff-only.
 */

export interface IntakeAccess {
  view: boolean;
  edit: boolean;
  /** Report "not found", as the case page does. */
  hidden: boolean;
  code: string;
  message: string | null;
  canClaim: boolean;
}

export function decideIntakeAccess(actor: Actor, c: { caseType: string; assignedToId: string | null }): IntakeAccess {
  const vawc = isVawcType(c.caseType);
  const role = actor.role.trim();
  const no = (code: string, message: string, extra: Partial<IntakeAccess> = {}): IntakeAccess =>
    ({ view: false, edit: false, hidden: false, code, message, canClaim: false, ...extra });
  if (!actor.active) return no('inactive', 'Your account is not active.');
  if (vawc && !canSeeVawc(role)) return no('vawc_restricted', 'Case not found.', { hidden: true });
  if (BLOTTER_ROLES.includes(role) || VAWC_DESK_ROLES.includes(role)) {
    const ownDesk = VAWC_DESK_ROLES.includes(role) ? vawc : !vawc;
    if (!ownDesk) return no('wrong_desk', 'This case belongs to the other desk.');
    if (c.assignedToId !== actor.id) {
      return no('not_assigned', 'Only the officer assigned to this case can open its intake. Take the case first if it is unassigned.',
        { canClaim: c.assignedToId === null });
    }
    return { view: true, edit: true, hidden: false, code: 'assigned', message: null, canClaim: false };
  }
  if (OVERSIGHT_ROLES.includes(role)) {
    const edit = c.assignedToId === actor.id || !vawc;
    return { view: true, edit, hidden: false, code: 'oversight', canClaim: false,
      message: edit ? null : 'You can view this VAWC intake. Filling it in is for the officer it is assigned to.' };
  }
  return no('role_not_permitted', 'Your role cannot open intake forms.');
}

/** Everything the intake needs about the case, read once, on the server. */
export async function loadIntakeCase(caseId: string) {
  return prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, triageStatus: true,
      description: true, barangay: true, locationLabel: true, municipality: true, province: true, filedAt: true,
      assignedToId: true, residentId: true, residentName: true,
      reportingRelationship: true, affectedPersonNote: true, reporterIdentityWithheld: true,
      assignedTo: { select: { name: true } },
      intake: { select: { narrative: true } },
      resident: { select: { id: true, residentNumber: true, firstName: true, lastName: true, age: true, gender: true,
        address: true, barangay: true, registeredAt: true, contactNumber: true, email: true } },
      officialIntake: true,
    },
  });
}
export type IntakeCase = NonNullable<Awaited<ReturnType<typeof loadIntakeCase>>>;

const NP = 'Not provided';

/**
 * Section 1, from the records as they are now. Registered details are shown,
 * not copied into the intake; contact details stay masked here and are
 * revealed through the Reporter Information panel's logged endpoint.
 */
export function intakeContext(c: IntakeCase) {
  const warnings: string[] = [];
  const anonymous = c.reporterIdentityWithheld;
  const self = (c.reportingRelationship ?? 'SELF') === 'SELF';
  let reporter: null | {
    name: string; residentNumber: string; address: string; barangay: string; age: string; gender: string;
    registeredAt: string; hasPhone: boolean; hasEmail: boolean;
  } = null;
  if (anonymous) {
    warnings.push('This report was filed anonymously. No reporter identity is shown, and none is filled in from any other record.');
  } else if (!c.residentId) {
    warnings.push('No resident account is linked to this case (it was filed by staff or a walk-in). Reporter details must be confirmed with the person directly.');
  } else if (!c.resident) {
    warnings.push('The resident account linked to this case could not be found. No other record has been used in its place.');
  } else {
    const r = c.resident;
    reporter = {
      name: `${r.firstName} ${r.lastName}`.trim() || NP, residentNumber: r.residentNumber || NP,
      address: r.address?.trim() || NP, barangay: r.barangay?.trim() || NP,
      age: r.age ? String(r.age) : NP, gender: r.gender?.trim() || NP,
      registeredAt: r.registeredAt.toISOString(), hasPhone: Boolean(r.contactNumber), hasEmail: Boolean(r.email),
    };
    if (!r.contactNumber) warnings.push('The reporter has no phone number on file.');
    if (!r.email) warnings.push('The reporter has no e-mail address on file.');
  }
  if (!self && !anonymous) warnings.push('The reporter says this report is about someone else. Do not treat the reporter as the victim-survivor.');
  return {
    case: {
      id: c.id, caseNumber: c.caseNumber, submittedAt: c.filedAt.toISOString(), category: c.caseType,
      narrative: c.intake?.narrative ?? c.description, incidentDateTime: NP,
      street: c.barangay || NP, locationLabel: c.locationLabel || NP, municipality: c.municipality || NP, province: c.province || NP,
      status: c.status, riskLevel: c.riskLevel, triageStatus: c.triageStatus, assignedTo: c.assignedTo?.name ?? 'Unassigned',
      reportingRelationship: c.reportingRelationship ?? 'SELF',
    },
    reporter,
    affectedPerson: anonymous ? 'Not provided (anonymous report)'
      : self ? 'The reporter (they reported this about themselves)'
        : c.affectedPersonNote?.trim() || 'Someone other than the reporter - not identified on the report',
    accusedPerson: 'Not recorded on the original report - see Section D',
    warnings,
  };
}

const ROLE_TITLE: Record<string, string> = {
  officer: 'Blotter Officer', blotter_officer: 'Blotter Officer', vawc_officer: 'VAWC Officer', vawc: 'VAWC Officer',
  vawc_lead: 'VAWC Desk Lead', admin: 'Punong Barangay', system_admin: 'System Administrator',
};

/** Philippine date today, YYYY-MM-DD. */
const todayInManila = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * The answers filled in when an intake is started, each marked with where it
 * came from so the official confirms it with the client. Only what the case
 * actually establishes: the victim-survivor's details come from the reporter
 * only when the reporter said the report is about themselves.
 */
export function startingAnswers(c: IntakeCase, actor: { role: string }) {
  const responses: Responses = {};
  const prefilled: Record<string, string> = {};
  const set = (key: string, a: Answer, from: string) => { responses[key] = a; prefilled[key] = from; };
  set('dateOfIntake', { value: todayInManila() }, 'today');
  if (ROLE_TITLE[actor.role]) set('positionTitle', { value: ROLE_TITLE[actor.role] }, 'your account');
  set('incidentNo', { value: c.caseNumber }, 'case record');
  const rel = c.reportingRelationship ?? 'SELF';
  const r = !c.reporterIdentityWithheld ? c.resident : null;
  if (rel === 'SELF' && !c.reporterIdentityWithheld) set('reportingMode', { value: 'victim_survivor' }, 'reporting relationship on the case');
  if ((rel === 'THIRD_PARTY' || rel === 'ON_BEHALF') && r) {
    set('informantName', { value: `${r.firstName} ${r.lastName}`.trim() }, 'registered resident profile');
  }
  if (rel === 'SELF' && r) {
    set('victimName', { value: { last: r.lastName, first: r.firstName } }, 'registered resident profile');
    if (r.age) set('age', { value: String(r.age) }, 'registered resident profile');
    const g = r.gender?.trim().toLowerCase();
    if (g === 'male' || g === 'female') set('sexAtBirth', { value: g }, 'registered resident profile');
  }
  const loc: Record<string, string> = {};
  if (c.municipality) loc.city = c.municipality;
  if (c.province) loc.province = c.province;
  if (Object.keys(loc).length) set('incidentLocation', { value: loc }, 'map pin on the report');
  return { responses, prefilled };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const MAX_TEXT = 300;
const MAX_LONG = 8000;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** Checks every answer against its item; unknown items or values are refused, not dropped. */
export function validateResponses(raw: unknown): { ok: true; responses: Responses } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Responses must be an object' };
  const out: Responses = {};
  for (const [key, a] of Object.entries(raw as Record<string, unknown>)) {
    const item: Item | undefined = ITEM_BY_KEY[key];
    if (!item) return { ok: false, error: `Unknown item: ${key.slice(0, 40)}` };
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: `Item ${item.no ?? item.key}: invalid answer` };
    const ans = a as Record<string, unknown>;
    const bad = (why: string) => ({ ok: false as const, error: `Item ${item.no ?? item.label}: ${why}` });
    const allowed = new Set(['value', 'specify', 'homeless', 'detail', 'marker']);
    if (Object.keys(ans).some(k => !allowed.has(k))) return bad('unexpected field');
    const clean: Answer = {};
    if (ans.marker !== undefined) {
      if (!['na', 'unknown', 'declined'].includes(String(ans.marker)) || item.type === 'confirm') return bad('invalid marker');
      clean.marker = ans.marker as Answer['marker'];
    }
    if (ans.specify !== undefined) {
      if (!ans.specify || typeof ans.specify !== 'object' || Array.isArray(ans.specify)) return bad('invalid "specify"');
      const sp: Record<string, string> = {};
      for (const [k, v] of Object.entries(ans.specify as Record<string, unknown>)) {
        const okKey = k === 'yes' ? item.type === 'yesNoSpecify' : optionsOf(item).some(x => x.value === k);
        if (!okKey || !str(v, MAX_TEXT)) return bad('invalid "specify"');
        sp[k] = v as string;
      }
      clean.specify = sp;
    }
    const v = ans.value;
    if (v !== undefined && v !== null && v !== '') {
      const values = new Set(optionsOf(item).map(x => x.value));
      switch (item.type) {
        case 'text': case 'number': case 'date': case 'time':
          if (!str(v, MAX_TEXT)) return bad('too long or not text');
          if (item.type === 'number' && !/^\d{1,3}$/.test(v as string)) return bad('must be a whole number');
          if (item.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v as string)) return bad('must be a date');
          if (item.type === 'time' && !/^\d{2}:\d{2}$/.test(v as string)) return bad('must be a time');
          break;
        case 'textarea':
          if (!str(v, MAX_LONG)) return bad('too long');
          break;
        case 'name': case 'address': case 'place': case 'location': {
          if (typeof v !== 'object' || Array.isArray(v)) return bad('invalid');
          const parts = new Set((item.parts ?? []).map(p => p.key));
          for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!parts.has(k) || !str(x, 200)) return bad('invalid part');
          break;
        }
        case 'single':
          if (typeof v !== 'string' || !values.has(v)) return bad('not one of the options');
          break;
        case 'multi':
          if (!Array.isArray(v) || v.length > 60 || v.some(x => typeof x !== 'string' || !values.has(x))) return bad('not among the options');
          break;
        case 'yesNoSpecify': case 'yesNoDetail': case 'confirm':
          if (!['yes', 'no'].includes(String(v)) || (item.type === 'confirm' && v !== 'yes')) return bad('must be yes or no');
          break;
      }
      clean.value = v as Answer['value'];
    }
    if (ans.homeless !== undefined) {
      if (item.type !== 'address' || !item.homeless || typeof ans.homeless !== 'boolean') return bad('invalid "homeless"');
      clean.homeless = ans.homeless;
    }
    if (ans.detail !== undefined && ans.detail !== null && ans.detail !== '') {
      if (item.type !== 'yesNoDetail' || !item.detailOptions?.some(x => x.value === ans.detail)) return bad('invalid detail');
      clean.detail = ans.detail as string;
    }
    out[key] = clean;
  }
  return { ok: true, responses: out };
}

/** A stable rendering of the answers, so "no change" can be recognised. */
export const canonical = (r: Responses) => JSON.stringify(Object.keys(r).sort().map(k => [k, sortDeep(r[k])]));
function sortDeep(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortDeep);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortDeep((x as Record<string, unknown>)[k])]));
  return x;
}

/** Which items an edit changed - for the revision record, never their content. */
export function changedKeys(before: Responses, after: Responses): string[] {
  return ALL_ITEMS.map(i => i.key).filter(k => JSON.stringify(sortDeep(before[k] ?? null)) !== JSON.stringify(sortDeep(after[k] ?? null)));
}

export { INTAKE_FORM_VERSION };

/** Who looked at an intake, permitted or not. No answers are logged. */
export async function logIntakeAccess(e: { actorId: string; actorRole: string | null; caseId: string; caseNumber?: string | null; outcome: 'permitted' | 'denied'; code: string }) {
  await prisma.reporterAccessLog.create({
    data: { actorId: e.actorId, actorRole: e.actorRole, caseId: e.caseId.slice(0, 64), caseNumber: e.caseNumber ?? null,
      fields: ['intake'], outcome: e.outcome, code: e.code },
  });
}
