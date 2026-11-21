import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/app/generated/prisma/client';
import { requireAuth, errorResponse } from '@/lib/auth';
import { loadActor } from '@/lib/reporterAccess';
import { noStore } from '@/lib/caseRecordsServer';
import { JURISDICTION_ADMIN_ROLES, loadJurisdiction, forgetJurisdiction } from '@/lib/jurisdictionServer';
import { boundaryProblem, boundaryGeometry, pointInBoundary, DEFAULT_JURISDICTION } from '@/lib/jurisdiction';
import { BARANGAY_CENTER } from '@/lib/geo';
import { logRouteError } from '@/lib/hearingCasesServer';

export const dynamic = 'force-dynamic';

/**
 * The jurisdiction SafeComm serves.
 *
 *   GET - its names, its official boundary (or that none is configured), and
 *         where the boundary came from. For any signed-in official.
 *   PUT - change them: the Barangay Captain or the system administrator.
 *         The boundary is a GeoJSON Polygon or MultiPolygon from an official
 *         source, recorded with that source. It is checked (closed rings,
 *         points in the Philippines, [longitude, latitude] order) and refused
 *         rather than half-used; null clears it. Never generated or guessed
 *         by SafeComm. Every change is logged.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const cfg = await loadJurisdiction(true);
  const row = await prisma.jurisdictionConfig.findUnique({ where: { id: 'default' }, select: { updatedAt: true, updatedById: true } }).catch(() => null);
  const by = row?.updatedById ? (await prisma.user.findUnique({ where: { id: row.updatedById }, select: { name: true } }))?.name ?? 'Former official' : null;
  return noStore({ success: true, data: { ...cfg, boundaryConfigured: Boolean(cfg.boundary), updatedAt: row?.updatedAt ?? null, updatedBy: by,
    canEdit: JURISDICTION_ADMIN_ROLES.includes(auth.user.role) } });
}

const schema = z.object({
  barangay: z.string().trim().min(2).max(80).optional(),
  barangayAliases: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
  municipality: z.string().trim().min(2).max(80).optional(),
  province: z.string().trim().min(2).max(80).optional(),
  boundary: z.unknown().optional(),
  boundarySource: z.string().trim().max(300).optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  const actor = await loadActor(auth.user.userId);
  if (!actor?.active) return errorResponse('Unauthorized', 401);
  if (!JURISDICTION_ADMIN_ROLES.includes(actor.role.trim())) return noStore({ success: false, error: 'Only the Barangay Captain or the system administrator can change the jurisdiction.' }, 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Check the jurisdiction', 400);
  const d = parsed.data;
  let boundary: unknown = undefined;
  const warnings: string[] = [];
  if (d.boundary !== undefined && d.boundary !== null) {
    const problem = boundaryProblem(d.boundary);
    if (problem) return errorResponse(problem, 400);
    if (!d.boundarySource || d.boundarySource.length < 3) return errorResponse('Record where the boundary came from (the office or survey it is from).', 400);
    boundary = boundaryGeometry(d.boundary);
    if (!pointInBoundary(BARANGAY_CENTER.lat, BARANGAY_CENTER.lng, boundary as never)) {
      warnings.push('The configured barangay centre is not inside this boundary. Check that it is the right barangay - SafeComm saved it as given.');
    }
  } else if (d.boundary === null) boundary = null;
  try {
    const current = await loadJurisdiction(true);
    const data = {
      barangay: d.barangay ?? current.barangay, barangayAliases: d.barangayAliases ?? current.barangayAliases,
      municipality: d.municipality ?? current.municipality, province: d.province ?? current.province,
      ...(boundary !== undefined && { boundary: boundary === null ? Prisma.DbNull : (boundary as Prisma.InputJsonValue), boundarySource: boundary === null ? null : d.boundarySource }),
      updatedById: actor.id,
    };
    await prisma.$transaction(async tx => {
      await tx.jurisdictionConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...data, barangayAliases: data.barangayAliases ?? DEFAULT_JURISDICTION.barangayAliases },
        update: data });
      await tx.activity.create({ data: { type: 'jurisdiction_updated', userId: actor.id, color: '#0f766e', entityType: 'JurisdictionConfig', entityId: 'default',
        message: `Jurisdiction updated: ${data.barangay}, ${data.municipality}, ${data.province}${boundary === undefined ? '' : boundary === null ? ' - boundary cleared' : ` - boundary set (source: ${d.boundarySource})`}` } });
    });
    forgetJurisdiction();
    return noStore({ success: true, data: await loadJurisdiction(true), warnings });
  } catch (e) {
    logRouteError('PUT /api/jurisdiction', e);
    return errorResponse('The jurisdiction could not be saved right now.', 503);
  }
}
