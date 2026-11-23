import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireResidentAuth, rError } from '@/lib/residentAuth';
import { noStore } from '@/lib/caseRecordsServer';
import { rateLimit } from '@/lib/rateLimit';
import { residencyOf, notVerifiedBody } from '@/lib/jurisdictionServer';
import { residentPrecheck } from '@/lib/caseMatchingServer';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * The check a resident's report gets before it is filed: may it be the same
 * incident as a report already on file?
 *
 * What comes back is only for this resident: their OWN earlier reports that
 * may match (reference, date filed, status, why), and - in general words,
 * never which report, whose, what it says or where it stands - whether a
 * report from someone else on the blotter desk may describe the same thing.
 * Another resident's VAWC report is never looked at here.
 *
 * Nothing is saved, nothing is blocked: the resident decides whether to file.
 * An urgent report skips the check entirely (the form never asks), and a
 * check that fails answers "no match" so the form carries on.
 */
const person = z.string().trim().max(120);
const schema = z.object({
  description: z.string().trim().min(10).max(8000),
  caseType: z.string().trim().max(120).optional().nullable(),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  street: z.string().trim().max(120).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  people: z.array(person).max(10).optional(),
  urgent: z.boolean().optional(),
  useAi: z.boolean().optional(),
}).strict();

const NONE = { result: 'NO_MATCH', own: [], otherReportMayExist: false, message: null };

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Check the report', 400);
  const d = parsed.data;
  // Someone in danger is never slowed down by a check.
  if (d.urgent) return noStore({ success: true, data: { ...NONE, skipped: 'urgent' } });
  const me = auth.resident.residentId;
  try {
    const residency = await residencyOf(me);
    if (!residency) return rError('Resident not found', 404);
    if (!residency.verified) return Response.json(notVerifiedBody(residency.status), { status: 403 });
  } catch (e) {
    logRouteError('POST /api/resident/cases/duplicate-check residency', e);
    return noStore({ success: true, data: { ...NONE, skipped: 'unavailable' } });
  }
  // Not a search tool: a handful of checks per hour is plenty for filing reports.
  if (!rateLimit(`duplicate-check:${me}`, { max: 15, windowMs: 3_600_000 }).allowed) {
    return noStore({ success: true, data: { ...NONE, skipped: 'rate_limited' } });
  }
  const incidentDate = d.incidentDate ? new Date(`${d.incidentDate}T00:00:00Z`) : null;
  const people = (d.people ?? []).filter(n => n.length >= 3);
  try {
    const r = await residentPrecheck(me, {
      description: d.description, caseType: d.caseType || null, incidentDate: incidentDate && !Number.isNaN(incidentDate.getTime()) ? incidentDate : null,
      street: d.street || null, latitude: d.latitude ?? null, longitude: d.longitude ?? null, partyNames: people, redactNames: people,
    }, d.useAi !== false);
    return noStore({ success: true, data: r });
  } catch (e) {
    // The check is a courtesy: when it fails the resident files as usual.
    logRouteError('POST /api/resident/cases/duplicate-check', e);
    return noStore({ success: true, data: { ...NONE, skipped: 'unavailable' } });
  }
}
