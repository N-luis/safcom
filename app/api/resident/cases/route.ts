import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireResidentAuth, rSuccess, rError } from '@/lib/residentAuth';
import { parsePhotos } from '@/lib/evidenceServer';
import { INCIDENT_TIME_FUTURE, isFutureIncidentTime } from '@/lib/incidentTime';
import { parseCaseSearch, searchSummary } from '@/lib/caseSearch';
import { caseSearchWhere } from '@/lib/caseSearchServer';
import { residencyOf, notVerifiedBody, checkAgainstJurisdiction } from '@/lib/jurisdictionServer';
import { incidentOutcome } from '@/lib/jurisdiction';
import { SERVER_ONLY_FIELDS, createSchema, fileResidentCase } from '@/lib/residentCaseFiling';
import { saveIncidentReferral } from '@/lib/incidentReferralServer';

/**
 * A resident's reports.
 *
 *   GET  - their own cases (search, filter, paging).
 *   POST - File a Report. The server checks the incident location against the
 *          jurisdiction and decides what the submission becomes: a SafeComm
 *          case (inside - lib/residentCaseFiling.ts), a referral record
 *          (outside), or a record held for an official to verify the place
 *          (uncertain) - lib/incidentReferralServer.ts. Nothing the client
 *          says about the jurisdiction is trusted.
 */



export async function GET(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 10)));
  // Accepts a comma-separated group so a caller can ask for exactly what the
  // dashboard counts as one number - "Resolved Cases" there is Resolved plus
  // Closed, which a single exact status could not express.
  const status = (searchParams.get('status') || '')
    .split(',').map(v => v.trim()).filter(Boolean);
  const search = parseCaseSearch(searchParams.get('search'));

  // Only this resident's own reports; the search narrows those, never widens them.
  const where: Record<string, unknown> = { residentId: auth.resident.residentId };
  if (status.length) where.status = { in: status };
  // Their own words: the reference, the type, the narrative, the incident date, and the person
  // they reported - as they wrote it (an official's records are not searched from here).
  if (search) where.AND = [caseSearchWhere(search, { reporterName: false, description: true, peopleVisible: {}, reporterSuppliedOnly: true })];

  try {
    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { filedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, caseNumber: true, caseType: true, status: true,
          riskLevel: true, barangay: true, description: true,
          filedAt: true, updatedAt: true, notes: true,
        },
      }),
      prisma.case.count({ where }),
    ]);
    return rSuccess({ cases, total, page, limit, totalPages: Math.ceil(total / limit), search: searchSummary(search) });
  } catch {
    return rError('Server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireResidentAuth(req);
  if ('status' in auth) return auth;

  try {
    const body = await req.json();
    const forbidden = body && typeof body === 'object' ? SERVER_ONLY_FIELDS.filter(f => f in body) : [];
    if (forbidden.length) {
      return rError(`These are set by SafeComm's assessment, not by the report: ${forbidden.join(', ')}`, 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return rError(parsed.error.issues[0]?.message ?? 'Validation error', 400);
    if (isFutureIncidentTime(parsed.data.incidentDate, parsed.data.incidentTimeApprox)) return rError(INCIDENT_TIME_FUTURE, 400);

    // Standard reports are for verified residents only - read from the database, never the token.
    const residency = await residencyOf(auth.resident.residentId);
    if (!residency) return rError('Resident not found', 404);
    if (!residency.verified) return Response.json(notVerifiedBody(residency.status), { status: 403 });
    // And for incidents inside the jurisdiction. The check is the server's, from what was sent:
    // a client that skips the form's warning gets the same answer.
    const incidentCheck = await checkAgainstJurisdiction({
      province: parsed.data.incidentProvince, municipality: parsed.data.incidentMunicipality, barangay: parsed.data.incidentBarangay,
      street: parsed.data.barangay, details: parsed.data.incidentLocationDetails || parsed.data.locationLabel,
      latitude: parsed.data.latitude, longitude: parsed.data.longitude,
    }, 'incident');
    if (incidentCheck.status === 'INCOMPLETE') {
      return Response.json({ success: false, code: 'INCIDENT_LOCATION_INCOMPLETE', error: incidentCheck.explanation, missing: incidentCheck.missing }, { status: 400 });
    }

    // The photos first: a bad file is reported (by name) before any work is done,
    // and the same photo picked twice is kept once. A referral keeps them too.
    const photoParse = parsePhotos(parsed.data.attachments ?? []);
    if ('error' in photoParse) return rError(photoParse.error, 400);
    const unclearWordCount = Array.isArray(body?.documentUnclearWords) ? body.documentUnclearWords.length : 0;

    // What the location means, decided here from the server's own check - never from the form:
    // inside, a SafeComm case; outside, a referral record; uncertain, held for an official to
    // verify the place. The resident never has to choose, and a client that skips the form's
    // notice gets the same answer.
    const outcome = incidentOutcome(incidentCheck);
    if (outcome !== 'CASE') {
      const r = await saveIncidentReferral({
        residentId: auth.resident.residentId, data: parsed.data, photos: photoParse.photos, unclearWordCount,
        check: incidentCheck, kind: outcome === 'REFERRAL' ? 'OUTSIDE_JURISDICTION' : 'LOCATION_VERIFICATION',
      });
      return rSuccess(r.body, r.duplicate ? 200 : 201);
    }

    return await fileResidentCase({
      residentId: auth.resident.residentId, data: parsed.data, photos: photoParse.photos, unclearWordCount, locationReview: false,
    });
  } catch (err) {
    // Logged: a silent 500 here hid an attachment failure that looked identical
    // to any other server fault.
    console.error('[Resident case create]', err);
    return rError('Server error', 500);
  }
}
