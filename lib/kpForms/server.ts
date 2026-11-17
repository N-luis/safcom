/**
 * Server side of the KP Forms on the Walk-in Report: who may use them, the
 * walk-in report (its blotter case) they belong to, and what it prefills.
 *
 * Blotter officials and the Punong Barangay ('admin') may create, edit and
 * delete them. A VAWC case never has a KP form (RA 9262 sec. 33): to a
 * blotter official it does not exist (404); the Punong Barangay is told why.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../prisma';
import { requireAuth, errorResponse } from '../auth';
import { loadActor, BLOTTER_ROLES, isVawcType, type Actor } from '../reporterAccess';
import type { KpPrefill } from './forms';

export const KP_ROLES = [...BLOTTER_ROLES, 'admin'];
export const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });

/** A walk-in report: a case filed from the Walk-in Report page carries this mark at the start of its narrative. */
export const WALK_IN_MARK = '[Walk-in Report';

export async function gateKp(req: NextRequest): Promise<{ actor: Actor } | { error: Response }> {
  const auth = await requireAuth(req);
  if ('status' in auth) return { error: auth };
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return { error: errorResponse('Unauthorized', 401) };
  if (!KP_ROLES.includes(actor.role.trim())) return { error: noStore({ success: false, error: 'KP Forms are for the Blotter desk.' }, 403) };
  return { actor };
}

/** The walk-in report's case, if this official may fill KP forms on it. */
export async function kpCase(actor: Actor, caseId: string): Promise<{ c: { id: string; caseNumber: string; caseType: string; residentName: string; description: string; reporterIdentityWithheld: boolean } } | { error: Response }> {
  const c = await prisma.case.findUnique({ where: { id: caseId.slice(0, 64) },
    select: { id: true, caseNumber: true, caseType: true, residentName: true, description: true, reporterIdentityWithheld: true } });
  if (!c) return { error: errorResponse('Walk-in report not found', 404) };
  if (isVawcType(c.caseType)) {
    // A blotter official is not told a VAWC case exists; the Punong Barangay is told why there is no form.
    if (actor.role.trim() !== 'admin') return { error: errorResponse('Walk-in report not found', 404) };
    return { error: noStore({ success: false, error: 'KP forms are for blotter cases. VAWC cases are not subject to barangay conciliation (RA 9262 sec. 33).' }, 422) };
  }
  return { c };
}

/** What the forms are prefilled with: the case number, its category, the reporter, the persons reported, the narrative. */
export async function kpPrefill(c: { id: string; caseNumber: string; caseType: string; residentName: string; description: string; reporterIdentityWithheld: boolean }): Promise<KpPrefill> {
  const parties = await prisma.caseParty.findMany({ where: { caseId: c.id, role: 'REPORTED', fullName: { not: null } }, select: { fullName: true }, orderBy: { createdAt: 'asc' } });
  // The walk-in narrative starts "[Walk-in Report <date> <time>]" - that line is the system's, not the complaint.
  const narrative = c.description.replace(/^\[Walk-in Report[^\]]*\]\s*/, '').trim();
  return {
    caseNumber: c.caseNumber, caseType: c.caseType,
    complainant: c.reporterIdentityWithheld ? null : (c.residentName.trim() || null),
    respondents: parties.map(p => (p.fullName ?? '').trim()).filter(Boolean),
    narrative,
  };
}

export const recordRow = (r: { id: string; formType: string; caseNo: string | null; createdAt: Date; updatedAt: Date; createdById: string }) =>
  ({ id: r.id, formType: r.formType, caseNo: r.caseNo, createdAt: r.createdAt, updatedAt: r.updatedAt });
