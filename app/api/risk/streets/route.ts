import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { VAWC_TYPES } from '@/lib/vawcTypes';
import {
  matchStreet, levelFromRisks,
  type StreetRisk, type StreetRiskResponse,
} from '@/lib/streetRisk';

/**
 * Per-street incident counts and risk levels for the heatmap.
 *
 * `scope` follows the module showing the map: the VAWC page should not colour
 * a street with blotter incidents, and vice versa.
 *   vawc    - VAWC case types only
 *   blotter - everything that is not a VAWC case type
 *   all     - both (default)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;

  const scope = req.nextUrl.searchParams.get('scope') ?? 'all';

  const where =
    scope === 'vawc' ? { caseType: { in: [...VAWC_TYPES] } }
      : scope === 'blotter' ? { caseType: { notIn: [...VAWC_TYPES] } }
        : {};

  try {
    const cases = await prisma.case.findMany({
      where,
      select: { barangay: true, riskLevel: true },
      take: 5000,
    });

    const buckets = new Map<string, string[]>();
    const unplacedValues = new Set<string>();
    let placed = 0;

    for (const c of cases) {
      const street = matchStreet(c.barangay);
      if (!street) {
        unplacedValues.add((c.barangay ?? '').trim() || '(blank)');
        continue;
      }
      placed += 1;
      const list = buckets.get(street) ?? [];
      list.push(c.riskLevel);
      buckets.set(street, list);
    }

    const streets: StreetRisk[] = [...buckets.entries()]
      .map(([street, risks]) => ({
        street,
        total: risks.length,
        level: levelFromRisks(risks),
        byLevel: risks.reduce<Record<string, number>>((acc, r) => {
          acc[r] = (acc[r] ?? 0) + 1;
          return acc;
        }, {}),
      }))
      .sort((a, b) => b.total - a.total);

    const payload: StreetRiskResponse = {
      streets,
      placed,
      unplaced: cases.length - placed,
      unplacedValues: [...unplacedValues].sort(),
      total: cases.length,
    };
    return successResponse(payload);
  } catch {
    return errorResponse('Server error', 500);
  }
}
