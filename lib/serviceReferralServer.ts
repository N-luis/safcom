import 'server-only';
import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from './prisma';
import { errorResponse } from './auth';
import { gateCaseRecords, noStore, type Gate } from './caseRecordsServer';
import { isVawcType } from './reporterAccess';
import { ROLE_TITLE } from './officialIntake';
import { BARANGAY_CONTEXT } from './safecommConfig';
import { buildServiceReferralPdf } from './serviceReferralPdf';
import {
  EMPTY_SERVICE_REFERRAL_FORM, readForm, serviceSuggestions, EMPTY_SECTION_C,
  type ServiceReferralForm, type FormKey, type SectionC, type AckStatus,
} from './serviceReferralForm';

/**
 * The Service Referral Form on the server: who may reach it, what a new one
 * starts with, how a referral is numbered, read and printed.
 *
 * ACCESS is the case records' rule (lib/caseRecordsServer gateCaseRecords,
 * itself lib/officialIntake decideIntakeAccess), read fresh on every request:
 *   - the VAWC officer the case is assigned to creates and manages referrals;
 *   - the Punong Barangay ('admin') may view them; recording on a VAWC case is
 *     for the officer it is assigned to (or the captain, when assigned);
 *   - to anyone else a VAWC case does not exist (404) - blotter officers and
 *     the system administrator included.
 * Every look, refusal and download is written to ReporterAccessLog by the
 * gate, without any form value. The form is for VAWC cases only.
 */

export type ReferralGate = Exclude<Gate, { error: Response }>;

/** Field -> where its starting value came from, and that value (the editor shows the source while it is unchanged). */
export type Prefilled = Partial<Record<FormKey, { source: string; value: string }>>;

export async function gateServiceReferral(req: NextRequest, caseId: string, need: 'view' | 'edit', field: string): Promise<{ error: Response } | ReferralGate> {
  const g = await gateCaseRecords(req, caseId, need, field);
  if ('error' in g) return g;
  if (!isVawcType(g.c.caseType)) {
    await g.log('denied', 'not_vawc');
    return { error: errorResponse('The Service Referral Form is for VAWC cases. Use Referrals in the case records for this case.', 422) };
  }
  return g;
}

/** A referral of this case, or null - another case's referral is "not found" here. */
export async function loadReferral(caseId: string, rid: string) {
  const r = await prisma.serviceReferral.findUnique({
    where: { id: rid },
    // The stored PDF is read only by the download route.
    omit: { issuedDocument: true },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      attachments: { select: { id: true, kind: true, mimeType: true, size: true, uploadedById: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  return r && r.caseId === caseId ? r : null;
}
export type LoadedReferral = NonNullable<Awaited<ReturnType<typeof loadReferral>>>;

/**
 * What the officer sees about the case while filling in a referral: its
 * reference and state, the safe-contact preference, and the safety
 * assessment's flags the suggestions come from. Not the narrative, not the
 * people, not the evidence.
 */
export async function referralCaseContext(caseId: string) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, caseType: true, status: true, riskLevel: true, triageStatus: true, filedAt: true, contactPreference: true,
      assignedTo: { select: { name: true } },
      safetyAssessment: { select: { immediateConcern: true, shelterNeeded: true, policeOrReferralNeeded: true } },
      officialIntake: { select: { status: true } },
    },
  });
  if (!c) return null;
  return {
    caseId: c.id, caseNumber: c.caseNumber, caseType: c.caseType, status: c.status, riskLevel: c.riskLevel, triageStatus: c.triageStatus,
    filedAt: c.filedAt.toISOString(), assignedTo: c.assignedTo?.name ?? null, contactPreference: c.contactPreference,
    intakeStatus: c.officialIntake?.status ?? null,
    safety: c.safetyAssessment,
    suggestions: serviceSuggestions(c.safetyAssessment),
  };
}

const intakeText = (responses: unknown, key: string): string => {
  const a = (responses && typeof responses === 'object' ? (responses as Record<string, { value?: unknown }>)[key] : undefined);
  return typeof a?.value === 'string' ? a.value.trim() : '';
};

/**
 * What a new referral starts with - only values with an exact source, each
 * marked with it for the officer to check. Never a guess: the officer's name
 * is one string on the account, so it is not split into last/first/middle
 * here (the editor offers that as a button, for the officer to check).
 * Nothing in the case is changed.
 */
export async function startingForm(caseId: string, actor: { id: string; role: string }) {
  const [c, me] = await Promise.all([
    prisma.case.findUnique({ where: { id: caseId }, select: { caseNumber: true, officialIntake: { select: { responses: true } } } }),
    prisma.user.findUnique({ where: { id: actor.id }, select: { email: true, phone: true } }),
  ]);
  if (!c) return null;
  const form: ServiceReferralForm = { ...EMPTY_SERVICE_REFERRAL_FORM };
  const prefilled: Prefilled = {};
  const set = (k: Exclude<FormKey, 'services' | 'destination' | 'clientSignatory'>, v: string | null | undefined, source: string) => {
    const s = (v ?? '').trim();
    if (!s) return;
    form[k] = s; prefilled[k] = { source, value: s };
  };
  const responses = c.officialIntake?.responses;
  set('clientCode', intakeText(responses, 'clientCode'), 'the official intake form (item 6)');
  const intakeIncident = intakeText(responses, 'incidentNo');
  if (intakeIncident) set('incidentNo', intakeIncident, 'the official intake form (item 7)');
  else set('incidentNo', c.caseNumber, 'the case reference number');
  set('referringOrganization', `Barangay ${BARANGAY_CONTEXT.name} VAWC Desk`, 'SafeComm barangay settings');
  set('position', ROLE_TITLE[actor.role], 'your SafeComm role');
  set('contactNo', me?.phone, 'your SafeComm account');
  set('email', me?.email, 'your SafeComm account');
  set('addressBarangay', BARANGAY_CONTEXT.name, 'SafeComm barangay settings');
  return { form: readForm(form), prefilled };
}

/** The next free SR-<case number>-<n> for the case. Run inside the creating transaction. */
export async function nextReference(tx: Prisma.TransactionClient, caseId: string, caseNumber: string): Promise<string> {
  const n = await tx.serviceReferral.count({ where: { caseId } });
  const safe = caseNumber.replace(/[^A-Za-z0-9-]/g, '');
  return `SR-${safe}-${n + 1}`;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function sectionCOf(r: Pick<LoadedReferral, 'ackStatus' | 'ackReceivedByName' | 'ackPosition' | 'ackClientCode' | 'ackDateReceived' | 'ackRemarks'>): SectionC {
  if (!r.ackStatus) return EMPTY_SECTION_C;
  return {
    status: r.ackStatus as AckStatus, receivedByName: r.ackReceivedByName, position: r.ackPosition,
    clientCode: r.ackClientCode, dateReceived: r.ackDateReceived, remarks: r.ackRemarks,
  };
}

/**
 * A PDF built from the saved referral: a draft (watermarked), a cancelled
 * one, or the record copy with Section C as SafeComm recorded it. The issued
 * copy is never built here - it is the bytes stored when it was issued.
 */
export async function referralPdf(r: Pick<LoadedReferral, 'reference' | 'form' | 'status' | 'issuedAt' | 'updatedAt' | 'ackStatus' | 'ackReceivedByName' | 'ackPosition' | 'ackClientCode' | 'ackDateReceived' | 'ackRemarks'>, withSectionC: boolean) {
  const status = r.status === 'ISSUED' ? 'ISSUED' : r.status === 'CANCELLED' ? 'CANCELLED' : 'DRAFT';
  return buildServiceReferralPdf({
    reference: r.reference, form: readForm(r.form), status,
    sectionC: withSectionC ? sectionCOf(r) : null,
    documentDate: r.issuedAt ?? r.updatedAt,
  });
}

/** Names of the officials a referral mentions, by id. */
export async function namesFor(rs: LoadedReferral[]) {
  const ids = new Set<string>();
  for (const r of rs) {
    [r.createdById, r.updatedById, r.issuedById, r.ackRecordedById, r.cancelledById].forEach(x => x && ids.add(x));
    r.events.forEach(e => ids.add(e.actorId));
    r.attachments.forEach(a => ids.add(a.uploadedById));
  }
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
  const map = new Map(users.map(u => [u.id, u.name]));
  return (id: string | null | undefined) => (id ? map.get(id) ?? 'A former official' : null);
}

/** A referral as the officer's screen receives it. */
export function referralDto(r: LoadedReferral, name: (id: string | null | undefined) => string | null) {
  return {
    id: r.id, caseId: r.caseId, reference: r.reference, status: r.status, destination: r.destination, services: r.services,
    receivingOrganization: r.receivingOrganization, form: readForm(r.form), prefilled: (r.prefilled ?? {}) as Prefilled,
    version: r.version, formVersion: r.formVersion,
    createdBy: name(r.createdById), createdAt: r.createdAt.toISOString(), updatedBy: name(r.updatedById), updatedAt: r.updatedAt.toISOString(),
    issuedBy: name(r.issuedById), issuedAt: r.issuedAt?.toISOString() ?? null, issuedVia: r.issuedVia,
    documentSha256: r.documentSha256,
    ack: {
      ...sectionCOf(r), basis: r.ackBasis,
      recordedBy: name(r.ackRecordedById), recordedAt: r.ackRecordedAt?.toISOString() ?? null,
    },
    cancelled: r.cancelledAt ? { by: name(r.cancelledById), at: r.cancelledAt.toISOString(), reason: r.cancelReason } : null,
    events: r.events.map(e => ({ id: e.id, type: e.type, version: e.version, changedKeys: e.changedKeys, note: e.note, by: name(e.actorId), at: e.createdAt.toISOString() })),
    attachments: r.attachments.map(a => ({ id: a.id, kind: a.kind, mimeType: a.mimeType, size: a.size, by: name(a.uploadedById), at: a.createdAt.toISOString() })),
  };
}
export type ReferralDto = ReturnType<typeof referralDto>;

export { noStore };
